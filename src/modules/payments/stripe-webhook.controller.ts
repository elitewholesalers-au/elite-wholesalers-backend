
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
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import Stripe from 'stripe';

import { Public } from '../../common/decorators';

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
    @Req() request: RawBodyRequest<Request>,
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

    // Staging must never process live-mode Stripe events.
    if (event.livemode) {
      throw new BadRequestException(
        'Live Stripe events are not permitted',
      );
    }

    // No payment records are modified at this stage.
    // Payment verification and database updates will
    // be implemented in the next step.

    return {
      received: true,
      event_id: event.id,
      event_type: event.type,
    };
  }
}
