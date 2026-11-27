
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
import { StripePaymentVerificationService } from './stripe-payment-verification.service';

interface StripeWebhookRequest {
  rawBody?: Buffer;
}

@Controller('payments/stripe')
export class StripeWebhookController {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(
    StripeWebhookController.name,
  );

  constructor(
    private readonly configService: ConfigService,
    private readonly paymentVerificationService:
      StripePaymentVerificationService,
  ) {
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
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session =
          event.data.object as Stripe.Checkout.Session;

        if (session.payment_status !== 'paid') {
          this.logger.log(
            `Checkout session ${session.id} is not paid`,
          );
          break;
        }

        if (
          this.configService.get<string>(
            'STRIPE_PAYMENT_VERIFICATION_ENABLED',
          ) !== 'true'
        ) {
          this.logger.log(
            `Payment verification disabled for ${session.id}`,
          );
          break;
        }

        const verified =
          await this.paymentVerificationService
            .verifySuccessfulPayment(session.id);

        if (!verified) {
          this.logger.warn(
            `Payment verification failed for ${session.id}`,
          );

          throw new ServiceUnavailableException(
            'Stripe payment verification was not completed',
          );
        }

        this.logger.log(
          `Stripe payment verified for ${session.id}`,
        );

        break;
      }

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
