
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CartService } from './cart.service';
import { CartController } from './cart.controller';
import { PaymentFirstCheckoutService } from './payment-first-checkout.service';

import { Cart } from './entities/cart.entity';
import { CheckoutPayment } from '../payments/entities/checkout-payment.entity';
import { PaymentsModule } from '../payments/payments.module';

import { ZohoModule } from '../zoho/zoho.module';
import { UserModule } from '../user/user.module';
import { CommerceModule } from '../commerce/commerce.module';

@Module({
  imports: [
    ZohoModule,
    UserModule,
    CommerceModule,
    PaymentsModule,
    TypeOrmModule.forFeature([
      Cart,
      CheckoutPayment,
    ]),
  ],
  controllers: [CartController],
  providers: [
    CartService,
    PaymentFirstCheckoutService,
  ],
})
export class CartModule {}
