
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CheckoutPayment } from './entities/checkout-payment.entity';

import { StripePaymentService } from './stripe-payment.service';
import { StripePaymentVerificationService } from './stripe-payment-verification.service';
import { StripeWebhookController } from './stripe-webhook.controller';

import { PaymentFirstFulfilmentService } from './payment-first-fulfilment.service';
import { PaymentFirstFulfilmentController } from './payment-first-fulfilment.controller';

import { ZohoModule } from '../zoho/zoho.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CheckoutPayment]),
    ZohoModule,
    UserModule,
  ],
  controllers: [
    StripeWebhookController,
    PaymentFirstFulfilmentController,
  ],
  providers: [
    StripePaymentService,
    StripePaymentVerificationService,
    PaymentFirstFulfilmentService,
  ],
  exports: [
    TypeOrmModule,
    StripePaymentService,
    StripePaymentVerificationService,
    PaymentFirstFulfilmentService,
  ],
})
export class PaymentsModule {}
