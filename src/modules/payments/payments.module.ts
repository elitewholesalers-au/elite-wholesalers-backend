
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CheckoutPayment } from './entities/checkout-payment.entity';
import { StripePaymentService } from './stripe-payment.service';
import { StripeWebhookController } from './stripe-webhook.controller';

import { ZohoModule } from '../zoho/zoho.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CheckoutPayment]),
    ZohoModule,
    UserModule,
  ],
  controllers: [StripeWebhookController],
  providers: [StripePaymentService],
  exports: [
    TypeOrmModule,
    StripePaymentService,
  ],
})
export class PaymentsModule {}
