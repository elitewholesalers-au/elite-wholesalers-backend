import {
  Injectable, BadRequestException, ForbiddenException,
  NotFoundException, ServiceUnavailableException, ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CartService } from './cart.service';
import { CheckoutPayment } from '../payments/entities/checkout-payment.entity';
import { StripePaymentService } from '../payments/stripe-payment.service';
import { AccountType, DeliveryMethod } from '../user/dto/create-user.dto';
import { UserService } from '../user/user.service';

@Injectable()
export class PaymentFirstCheckoutService {
  constructor(
    private readonly configService: ConfigService,
    private readonly cartService: CartService,
    private readonly userService: UserService,
    private readonly stripePaymentService: StripePaymentService,
    @InjectRepository(CheckoutPayment)
    private readonly paymentRepository: Repository<CheckoutPayment>,
  ) {}

  private assertStaging(): void {
    if (this.configService.get<string>('APP_ENV') !== 'staging' ||
        this.configService.get<string>('PAYMENT_FIRST_CHECKOUT_ENABLED') !== 'true' ||
        this.configService.get<string>('ZOHO_ORDER_CREATION_ENABLED') !== 'false' ||
        !this.configService.get<string>('STRIPE_SECRET_KEY')?.startsWith('sk_test_')) {
      throw new ServiceUnavailableException('Staging payment-first checkout is not available');
    }
  }

  async preparePendingPayment(
    userId: string, accountType: AccountType,
    deliveryMethod: DeliveryMethod, promoCode?: string,
  ): Promise<CheckoutPayment> {
    this.assertStaging();
    if (!userId) throw new BadRequestException('Authenticated customer ID is required');
    const preview = await this.cartService.previewCheckout(userId, accountType, deliveryMethod, promoCode);
    const totalInCents = Math.round(preview.total_inc_gst * 100);
    if (!Number.isSafeInteger(totalInCents) || totalInCents <= 0) {
      throw new BadRequestException('Invalid checkout total');
    }
    const user = await this.userService.findOne({ id: userId });
    if (!user) throw new BadRequestException('Customer account was not found');
    const money = (amount: number): string => amount.toFixed(2);
    const payment = this.paymentRepository.create({
      userId, zohoContactId: user.zohoContactId ?? null,
      paymentMethod: 'stripe', paymentStatus: 'pending', currency: 'AUD',
      subtotalExGst: money(preview.discounted_subtotal),
      shippingExGst: money(preview.shipping_charge),
      discountExGst: money(preview.discount_amount),
      gstAmount: money(preview.gst_amount),
      totalIncGst: money(preview.total_inc_gst),
      deliveryMethod: String(deliveryMethod), promoCode: preview.promo_code,
      orderSnapshot: {
        items: preview.items, original_subtotal: preview.original_subtotal,
        discount_amount: preview.discount_amount,
        discounted_subtotal: preview.discounted_subtotal,
        shipping_charge: preview.shipping_charge,
        subtotal_ex_gst: preview.subtotal_ex_gst,
        gst_amount: preview.gst_amount,
        total_inc_gst: preview.total_inc_gst,
        delivery_method: String(deliveryMethod), promo_code: preview.promo_code,
      },
      stripeCheckoutSessionId: null, stripePaymentIntentId: null,
      payidReference: null, paymentVerifiedAt: null,
      zohoSalesorderId: null, zohoInvoiceId: null,
      fulfilmentStatus: 'not_started', fulfilmentStartedAt: null,
      fulfilmentCompletedAt: null, failureReason: null,
    });
    return await this.paymentRepository.save(payment);
  }

  async createStripeSession(userId: string, paymentId: string): Promise<{
    payment_id: string; stripe_checkout_session_id: string; payment_url: string;
  }> {
    this.assertStaging();
    if (this.configService.get<string>('STRIPE_CHECKOUT_ENABLED') !== 'true') {
      throw new ServiceUnavailableException('Stripe Sandbox Checkout is disabled');
    }
    if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(paymentId)) {
      throw new BadRequestException('Valid payment ID and authenticated user are required');
    }
    const payment = await this.paymentRepository.findOne({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.userId !== userId) throw new ForbiddenException('Payment does not belong to this customer');
    if (payment.paymentMethod !== 'stripe' || payment.paymentStatus !== 'pending' || payment.currency !== 'AUD') {
      throw new ConflictException('Payment is not eligible for Stripe Checkout');
    }
    // Never create a second session if one has already been stored.
    if (payment.stripeCheckoutSessionId) {
      throw new ConflictException('A Stripe session already exists for this payment');
    }
    const cents = Math.round(Number(payment.totalIncGst) * 100);
    if (!Number.isSafeInteger(cents) || cents <= 0 ||
        Number(payment.totalIncGst).toFixed(2) !== Number(cents / 100).toFixed(2)) {
      throw new BadRequestException('Invalid saved payment total');
    }
    const frontend = 'https://elite-wholesalers-frontend-staging.up.railway.app';
    const session = await this.stripePaymentService.createCheckoutSession(
      payment.id, cents,
      `${frontend}/cart/checkout?stripe_result=success&session_id={CHECKOUT_SESSION_ID}`,
      `${frontend}/cart/checkout?stripe_result=cancelled`,
    );
    if (!session.url) throw new ServiceUnavailableException('Stripe did not provide a checkout URL');
    // Conditional update: prevents two concurrent requests overwriting the saved session ID.
    // Stripe idempotencyKey is also stable per payment ID.
    const updated = await this.paymentRepository.createQueryBuilder()
      .update(CheckoutPayment)
      .set({ stripeCheckoutSessionId: session.id })
      .where('id = :id', { id: payment.id })
      .andWhere('user_id = :userId', { userId })
      .andWhere('payment_status = :status', { status: 'pending' })
      .andWhere('stripe_checkout_session_id IS NULL')
      .execute();
    if (updated.affected !== 1) {
      throw new ConflictException('Payment session was already created or payment status changed');
    }
    return {
      payment_id: payment.id,
      stripe_checkout_session_id: session.id,
      payment_url: session.url,
    };
  }
}
