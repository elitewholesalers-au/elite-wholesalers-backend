
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CheckoutPayment } from './entities/checkout-payment.entity';

@Injectable()
export class PaymentFirstFulfilmentService {
  constructor(
    private readonly configService: ConfigService,

    @InjectRepository(CheckoutPayment)
    private readonly paymentRepository: Repository<CheckoutPayment>,
  ) {}

  /**
   * STAGING ONLY
   *
   * Prepare a read-only Zoho sales order preview.
   * This method does not contact Zoho or create an order.
   */
  async previewZohoSalesOrder(paymentId: string) {
    if (this.configService.get<string>('APP_ENV') !== 'staging') {
      throw new ServiceUnavailableException(
        'Payment-first fulfilment preview is restricted to staging',
      );
    }

    if (!paymentId) {
      throw new BadRequestException(
        'Payment ID is required',
      );
    }

    const payment = await this.paymentRepository.findOne({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new NotFoundException(
        'Checkout payment was not found',
      );
    }

    if (
      payment.paymentMethod !== 'stripe' ||
      payment.paymentStatus !== 'paid' ||
      !payment.paymentVerifiedAt ||
      !payment.stripeCheckoutSessionId ||
      !payment.stripePaymentIntentId
    ) {
      throw new BadRequestException(
        'Stripe payment has not been fully verified',
      );
    }

    if (payment.currency !== 'AUD') {
      throw new BadRequestException(
        'Only AUD payments are supported',
      );
    }

    if (!payment.zohoContactId) {
      throw new BadRequestException(
        'Customer is not linked to Zoho Inventory',
      );
    }

    if (payment.zohoSalesorderId) {
      throw new BadRequestException(
        'A Zoho sales order is already recorded for this payment',
      );
    }

    if (payment.fulfilmentStatus !== 'not_started') {
      throw new BadRequestException(
        'Payment fulfilment has already started',
      );
    }

    const snapshot = payment.orderSnapshot;

    if (
      !snapshot ||
      !Array.isArray(snapshot.items) ||
      snapshot.items.length === 0
    ) {
      throw new BadRequestException(
        'Payment order snapshot is invalid',
      );
    }

    const lineItems = snapshot.items.map((item: any) => {
      if (
        typeof item.item_id !== 'string' ||
        !item.item_id ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity <= 0 ||
        !Number.isFinite(item.discounted_unit_price) ||
        item.discounted_unit_price < 0
      ) {
        throw new BadRequestException(
          'Invalid product information in order snapshot',
        );
      }

      return {
        item_id: item.item_id,
        quantity: item.quantity,
        rate: item.discounted_unit_price,
      };
    });

    const referenceNumber = `EWS-${payment.id}`;

    const salesOrderPreview = {
      customer_id: payment.zohoContactId,
      reference_number: referenceNumber,
      line_items: lineItems,
      shipping_charge: Number(payment.shippingExGst),
    };

    return {
      mode: 'DRY_RUN',
      zoho_order_created: false,
      payment_id: payment.id,
      payment_status: payment.paymentStatus,
      payment_verified_at: payment.paymentVerifiedAt,
      fulfilment_status: payment.fulfilmentStatus,
      expected_total_inc_gst: payment.totalIncGst,
      expected_gst: payment.gstAmount,
      proposed_sales_order: salesOrderPreview,
      warning:
        'Read-only staging preview. No Zoho order has been created. Zoho tax, reference lookup and duplicate prevention require further verification.',
    };
  }
}
