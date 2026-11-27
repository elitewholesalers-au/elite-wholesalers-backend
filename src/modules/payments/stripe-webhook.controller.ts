
import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  BadRequestException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

import { Public } from '../../common/decorators';

interface StripeWebhookRequest {
  rawBody?: Buffer;
}

@Controller('payments/stripe')
export class StripeWebhookController {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(
    StripeWebhookController.name,
  );

  constructor(private readonly configService: ConfigService) {
    const secretKey =
      this.configService.get<string>('STRIPE_SECRET_KEY');

    if (!secretKey || !secretKey.startsWith('sk_test_')) {
      throw new Error(
        'Stripe webhook requires a test-mode secret key',
      );
    }

    this.stripe = new Stripe(secretKey);
  }

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() request: StripeWebhookRequest,
    @Headers('stripe-signature') signature?: string,
  ) {
    const webhookSecret =
      this.configService.get<string>('STRIPE_WEBHOOK_SECRET');

    if (!webhookSecret) {
      throw new ServiceUnavailableException(
        'Stripe webhook is not configured',
      );
    }

    if (!signature || !request.rawBody) {
      throw new BadRequestException(
        'Missing Stripe signature or raw request body',
      );
    }

    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        request.rawBody,
        signature,
        webhookSecret,
      );
    } catch {
      throw new BadRequestException(
        'Invalid Stripe webhook signature',
      );
    }

    if (event.livemode) {
      throw new BadRequestException(
        'Live Stripe events are not permitted',
      );
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;

        if (session.payment_status !== 'paid') {
          this.logger.log(
            `Checkout session ${session.id} is not paid`,
          );
          break;
        }

        if (session.currency?.toLowerCase() !== 'aud') {
          this.logger.warn(
            `Rejected non-AUD checkout session ${session.id}`,
          );
          break;
        }

        if (
          !Number.isSafeInteger(session.amount_total) ||
          (session.amount_total ?? 0) <= 0
        ) {
          this.logger.warn(
            `Rejected invalid checkout amount for ${session.id}`,
          );
          break;
        }

        const paymentId =
          session.metadata?.checkout_payment_id;

        if (
          !paymentId ||
          paymentId !== session.client_reference_id
        ) {
          this.logger.warn(
            `Rejected checkout session ${session.id}: payment reference mismatch`,
          );
          break;
        }

        // Do not mark the payment as paid yet.
        // Database record matching and amount verification
        // will be implemented in the payment verification service.
        this.logger.log(
          `Received paid Stripe session ${session.id} for payment ${paymentId}; database verification pending`,
        );

        break;
      }

      case 'checkout.session.async_payment_succeeded':
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
        this.logger.log(
          `Received Stripe event ${event.type}`,
        );
        break;

      default:
        this.logger.log(
          `Ignored Stripe event ${event.type}`,
        );
    }

    return {
      received: true,
      event_id: event.id,
      event_type: event.type,
    };
  }
}
