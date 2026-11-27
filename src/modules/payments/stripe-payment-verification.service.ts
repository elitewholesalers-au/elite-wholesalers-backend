
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Stripe from 'stripe';

import { CheckoutPayment } from './entities/checkout-payment.entity';

@Injectable()
export class StripePaymentVerificationService {
  private readonly logger = new Logger(
    StripePaymentVerificationService.name,
  );

  private readonly stripe: Stripe;

  constructor(
    private readonly configService: ConfigService,

    @InjectRepository(CheckoutPayment)
    private readonly paymentRepository: Repository<CheckoutPayment>,
  ) {
    const secretKey =
      this.configService.get<string>('STRIPE_SECRET_KEY');

    if (!secretKey || !secretKey.startsWith('sk_test_')) {
      throw new Error(
        'Stripe payment verification requires a test-mode key',
      );
    }

    this.stripe = new Stripe(secretKey);
  }

  async verifySuccessfulPayment(
    checkoutSessionId: string,
  ): Promise<boolean> {
    if (!checkoutSessionId) {
      return false;
    }

    if (
      this.configService.get<string>(
        'STRIPE_PAYMENT_VERIFICATION_ENABLED',
      ) !== 'true'
    ) {
      throw new ServiceUnavailableException(
        'Stripe payment verification is not enabled',
      );
    }

    // Retrieve payment details directly from Stripe.
    const session =
      await this.stripe.checkout.sessions.retrieve(
        checkoutSessionId,
      );

    if (
      session.livemode ||
      session.mode !== 'payment' ||
      session.status !== 'complete' ||
      session.payment_status !== 'paid' ||
      session.currency?.toLowerCase() !== 'aud'
    ) {
      this.logger.warn(
        `Stripe session ${checkoutSessionId} failed verification`,
      );
      return false;
    }

    const paymentId =
      session.metadata?.checkout_payment_id;

    if (
      !paymentId ||
      session.client_reference_id !== paymentId
    ) {
      this.logger.warn(
        `Stripe session ${checkoutSessionId} has invalid payment references`,
      );
      return false;
    }

    if (
      !Number.isSafeInteger(session.amount_total) ||
      (session.amount_total ?? 0) <= 0
    ) {
      return false;
    }

    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;

    if (!paymentIntentId) {
      return false;
    }

    // Retrieve the matching Neon payment record.
    const payment = await this.paymentRepository.findOne({
      where: { id: paymentId },
    });

    if (!payment) {
      this.logger.warn(
        `No checkout payment record found for ${paymentId}`,
      );
      return false;
    }

    if (
      payment.paymentMethod !== 'stripe' ||
      payment.currency.toUpperCase() !== 'AUD'
    ) {
      return false;
    }

    // Never accept a Stripe session belonging to another payment.
    if (
      payment.stripeCheckoutSessionId !== checkoutSessionId
    ) {
      return false;
    }

    if (
      payment.stripePaymentIntentId &&
      payment.stripePaymentIntentId !== paymentIntentId
    ) {
      return false;
    }

    // Compare the exact AUD amount in cents.
    // Numeric database values are returned as strings.
    const total = payment.totalIncGst;

    if (!/^\d+\.\d{2}$/.test(total)) {
      return false;
    }

    const [dollars, cents] = total.split('.');

    const expectedAmount =
      Number(dollars) * 100 + Number(cents);

    if (
      !Number.isSafeInteger(expectedAmount) ||
      expectedAmount <= 0 ||
      expectedAmount !== session.amount_total
    ) {
      this.logger.warn(
        `Stripe payment amount mismatch for ${paymentId}`,
      );
      return false;
    }

    // Atomically transition only an unpaid payment to paid.
    // Duplicate webhook deliveries cannot repeat this transition.
    const result = await this.paymentRepository
      .createQueryBuilder()
      .update(CheckoutPayment)
      .set({
        paymentStatus: 'paid',
        paymentVerifiedAt: new Date(),
        stripePaymentIntentId: paymentIntentId,
      })
      .where('id = :paymentId', { paymentId })
      .andWhere('payment_status IN (:...statuses)', {
        statuses: ['pending', 'processing'],
      })
      .andWhere('payment_method = :method', {
        method: 'stripe',
      })
      .andWhere('stripe_checkout_session_id = :sessionId', {
        sessionId: checkoutSessionId,
      })
      .andWhere('currency = :currency', {
        currency: 'AUD',
      })
      .andWhere('total_inc_gst = :expectedTotal', {
        expectedTotal: total,
      })
      .execute();

    if (result.affected === 1) {
      this.logger.log(
        `Stripe payment verified for ${paymentId}`,
      );
      return true;
    }

    // Already-paid events are safe to receive again.
    const currentPayment =
      await this.paymentRepository.findOne({
        where: { id: paymentId },
      });

    if (
      currentPayment?.paymentStatus === 'paid' &&
      currentPayment.stripeCheckoutSessionId ===
        checkoutSessionId &&
      currentPayment.stripePaymentIntentId ===
        paymentIntentId &&
      currentPayment.paymentVerifiedAt !== null
    ) {
      return true;
    }

    return false;
  }
}
