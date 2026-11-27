
import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  BadRequestException,
  ServiceUnavailableException,
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

  constructor(private readonly configService: ConfigService) {
    const secretKey =
      this.configService.get<string>('STRIPE_SECRET_KEY');

    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
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

    // Signature verification only.
    // Do not update payments or create Zoho orders yet.

    return {
      received: true,
      event_id: event.id,
      event_type: event.type,
    };
  }
}
