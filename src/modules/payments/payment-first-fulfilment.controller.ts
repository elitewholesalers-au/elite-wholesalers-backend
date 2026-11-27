
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Roles } from '../../common/decorators';
import { AccountType } from '../user/dto/create-user.dto';
import { PaymentFirstFulfilmentService } from './payment-first-fulfilment.service';

@Controller('payments/fulfilment')
@Roles(AccountType.ADMIN)
export class PaymentFirstFulfilmentController {
  constructor(
    private readonly configService: ConfigService,
    private readonly fulfilmentService: PaymentFirstFulfilmentService,
  ) {}

  /**
   * Administrator-only, staging-only dry-run preview.
   *
   * Does not create Zoho sales orders or invoices.
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
}
