
import {
  Injectable,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripePaymentService {
  private readonly stripe: Stripe;

  constructor(private readonly configService: ConfigService) {
    const secretKey =
      this.configService.get<string>('STRIPE_SECRET_KEY');

    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }

    this.stripe = new Stripe(secretKey);
  }

  async createCheckoutSession(
    paymentId: string,
    amountInCents: number,
    successUrl: string,
    cancelUrl: string,
  ): Promise<Stripe.Checkout.Session> {
    // Payment creation is disabled until the complete
    // payment-first checkout workflow is implemented.
    if (
      this.configService.get<string>(
        'STRIPE_CHECKOUT_ENABLED',
      ) !== 'true'
    ) {
      throw new ServiceUnavailableException(
        'Stripe checkout is not enabled yet',
      );
    }

    if (!this.stripe.getApiField('key')?.startsWith('sk_test_')) {
      throw new ServiceUnavailableException(
        'This checkout service currently permits test-mode Stripe only',
      );
    }

    if (!paymentId) {
      throw new BadRequestException(
        'Payment reference is required',
      );
    }

    if (
      !Number.isSafeInteger(amountInCents) ||
      amountInCents <= 0
    ) {
      throw new BadRequestException(
        'Invalid payment amount',
      );
    }

    for (const url of [successUrl, cancelUrl]) {
      try {
        const parsedUrl = new URL(url);

        if (parsedUrl.protocol !== 'https:') {
          throw new Error('HTTPS required');
        }
      } catch {
        throw new BadRequestException(
          'A valid HTTPS checkout return URL is required',
        );
      }
    }

    return this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        payment_method_types: ['card'],
        client_reference_id: paymentId,
        metadata: {
          checkout_payment_id: paymentId,
        },
        payment_intent_data: {
          metadata: {
            checkout_payment_id: paymentId,
          },
        },
        line_items: [
          {
            price_data: {
              currency: 'aud',
              product_data: {
                name: 'Elite Wholesalers Order',
              },
              unit_amount: amountInCents,
            },
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
      },
      {
        idempotencyKey: `checkout-${paymentId}`,
      },
    );
  }
}
