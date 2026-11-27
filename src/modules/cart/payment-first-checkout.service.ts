
import {
  Injectable,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CartService } from './cart.service';
import { CheckoutPayment } from '../payments/entities/checkout-payment.entity';
import {
  AccountType,
  DeliveryMethod,
} from '../user/dto/create-user.dto';
import { UserService } from '../user/user.service';

@Injectable()
export class PaymentFirstCheckoutService {
  constructor(
    private readonly configService: ConfigService,
    private readonly cartService: CartService,
    private readonly userService: UserService,

    @InjectRepository(CheckoutPayment)
    private readonly paymentRepository: Repository<CheckoutPayment>,
  ) {}

  async preparePendingPayment(
    userId: string,
    accountType: AccountType,
    deliveryMethod: DeliveryMethod,
    promoCode?: string,
  ): Promise<CheckoutPayment> {
    // This feature must remain disabled until we
    // explicitly approve staging payment tests.
    if (
      this.configService.get<string>(
        'PAYMENT_FIRST_CHECKOUT_ENABLED',
      ) !== 'true'
    ) {
      throw new ServiceUnavailableException(
        'Payment-first checkout is not enabled',
      );
    }

    // Do not allow this service to operate
    // with a live Stripe secret key.
    const stripeKey =
      this.configService.get<string>('STRIPE_SECRET_KEY');

    if (!stripeKey || !stripeKey.startsWith('sk_test_')) {
      throw new ServiceUnavailableException(
        'Payment-first checkout requires Stripe test mode',
      );
    }

    if (!userId) {
      throw new BadRequestException(
        'Authenticated customer ID is required',
      );
    }

    // Recalculate all prices on the backend.
    // Never trust totals provided by the browser.
    const preview = await this.cartService.previewCheckout(
      userId,
      accountType,
      deliveryMethod,
      promoCode,
    );

    const totalInCents = Math.round(
      preview.total_inc_gst * 100,
    );

    if (
      !Number.isSafeInteger(totalInCents) ||
      totalInCents <= 0
    ) {
      throw new BadRequestException(
        'Invalid checkout total',
      );
    }

    const user = await this.userService.findOne({
      id: userId,
    });

    if (!user) {
      throw new BadRequestException(
        'Customer account was not found',
      );
    }

    const money = (amount: number): string =>
      amount.toFixed(2);

    const payment = this.paymentRepository.create({
      userId,
      zohoContactId: user.zohoContactId ?? null,

      paymentMethod: 'stripe',
      paymentStatus: 'pending',
      currency: 'AUD',

      subtotalExGst: money(
        preview.discounted_subtotal,
      ),
      shippingExGst: money(
        preview.shipping_charge,
      ),
      discountExGst: money(
        preview.discount_amount,
      ),
      gstAmount: money(
        preview.gst_amount,
      ),
      totalIncGst: money(
        preview.total_inc_gst,
      ),

      deliveryMethod: String(deliveryMethod),
      promoCode: preview.promo_code,

      orderSnapshot: {
        items: preview.items,
        original_subtotal:
          preview.original_subtotal,
        discount_amount:
          preview.discount_amount,
        discounted_subtotal:
          preview.discounted_subtotal,
        shipping_charge:
          preview.shipping_charge,
        subtotal_ex_gst:
          preview.subtotal_ex_gst,
        gst_amount:
          preview.gst_amount,
        total_inc_gst:
          preview.total_inc_gst,
        delivery_method:
          String(deliveryMethod),
        promo_code:
          preview.promo_code,
      },

      stripeCheckoutSessionId: null,
      stripePaymentIntentId: null,
      payidReference: null,
      paymentVerifiedAt: null,

      zohoSalesorderId: null,
      zohoInvoiceId: null,

      fulfilmentStatus: 'not_started',
      fulfilmentStartedAt: null,
      fulfilmentCompletedAt: null,
      failureReason: null,
    });

    return await this.paymentRepository.save(payment);
  }
}
