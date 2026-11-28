
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';

import { Roles } from '../../common/decorators';
import { AccountType } from '../user/dto/create-user.dto';
import { PaymentFirstFulfilmentService } from './payment-first-fulfilment.service';

@Controller('payments/fulfilment')
@Roles(AccountType.ADMIN)
export class PaymentFirstFulfilmentController {
  constructor(
    private readonly fulfilmentService: PaymentFirstFulfilmentService,
  ) {}

  /**
   * ADMIN ONLY — STAGING ONLY
   *
   * Read-only Zoho sales order preview.
   *
   * Does not modify the database.
   * Does not contact Zoho.
   */
  @Get('preview/:paymentId')
  async previewSalesOrder(
    @Param('paymentId', new ParseUUIDPipe())
    paymentId: string,
  ) {
    return this.fulfilmentService.previewZohoSalesOrder(
      paymentId,
    );
  }

  /**
   * ADMIN ONLY — STAGING ONLY
   *
   * Atomically claims a verified Stripe payment
   * for fulfilment.
   *
   * Changes fulfilment_status:
   * not_started -> processing
   *
   * Does not create Zoho orders or invoices.
   *
   * This is a database-writing test endpoint.
   */
  @Post('claim/:paymentId')
  async claimPayment(
    @Param('paymentId', new ParseUUIDPipe())
    paymentId: string,
  ) {
    return this.fulfilmentService.claimPaymentForFulfilment(
      paymentId,
    );
  }
}
