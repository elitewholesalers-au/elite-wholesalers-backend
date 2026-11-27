
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CheckoutPayment } from './entities/checkout-payment.entity';
import { ZohoModule } from '../zoho/zoho.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CheckoutPayment]),
    ZohoModule,
    UserModule,
  ],
  controllers: [],
  providers: [],
  exports: [TypeOrmModule],
})
export class PaymentsModule {}
