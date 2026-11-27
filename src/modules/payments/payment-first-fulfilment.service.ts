
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

interface CheckoutSnapshotItem {
  item_id: string;
  quantity: number;
  discounted_unit_price: number;
  discounted_total?: number;
}

interface CheckoutSnapshot {
  items: CheckoutSnapshotItem[];
  subtotal_ex_gst?: number;
  shipping_charge?: number;
  gst_amount?: number;
  total_inc_gst?: number;
}

@Injectable()
export class PaymentFirstFulfilmentService {
  constructor(
    private readonly configService: ConfigService,

    @InjectRepository(CheckoutPayment)
    private readonly paymentRepository: Repository<CheckoutPayment>,
  ) {}

  /**
   * Convert a monetary amount into integer cents.
   * Reject invalid amounts and values with more
   * than two decimal places.
   */
  private toCents(
    value: unknown,
    fieldName: string,
  ): number {
    const amount = Number(value);

    if (
      value === null ||
      value === undefined ||
      value === '' ||
      !Number.isFinite(amount) ||
      amount < 0
    ) {
      throw new BadRequestException(
        `Invalid monetary amount: ${fieldName}`,
      );
    }

    const cents = Math.round(amount * 100);

    if (
      !Number.isSafeInteger(cents) ||
      Math.abs(amount * 100 - cents) > 0.000001
    ) {
      throw new BadRequestException(
        `Invalid currency precision: ${fieldName}`,
      );
    }

    return cents;
  }

  /**
   * STAGING ONLY
   *
   * Validates the payment and prepares a read-only
   * Zoho sales order preview.
   *
   * Does not create a Zoho order.
   * Does not modify the database.
   */
  async previewZohoSalesOrder(paymentId: string) {
    if (
      this.configService.get<string>('APP_ENV') !==
      'staging'
    ) {
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

    /**
     * Payment must already have been verified
     * by the Stripe verification workflow.
     */
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

    /**
     * Read the checkout snapshot associated
     * with the verified Stripe payment.
     *
     * The intermediate unknown cast resolves
     * TypeScript error TS2352.
     *
     * Runtime validation follows below.
     */
    const snapshot =
      payment.orderSnapshot as unknown as
        CheckoutSnapshot | null;

    if (
      !snapshot ||
      !Array.isArray(snapshot.items) ||
      snapshot.items.length === 0
    ) {
      throw new BadRequestException(
        'Payment order snapshot is invalid',
      );
    }

    /**
     * Validate each item and calculate
     * the expected product subtotal.
     */
    let calculatedSubtotalCents = 0;

    const lineItems = snapshot.items.map(
      (item: CheckoutSnapshotItem) => {
        if (
          !item ||
          typeof item.item_id !== 'string' ||
          !item.item_id.trim() ||
          !Number.isSafeInteger(item.quantity) ||
          item.quantity <= 0
        ) {
          throw new BadRequestException(
            'Invalid product information in order snapshot',
          );
        }

        const unitPriceCents = this.toCents(
          item.discounted_unit_price,
          'discounted_unit_price',
        );

        const lineTotalCents =
          unitPriceCents * item.quantity;

        if (!Number.isSafeInteger(lineTotalCents)) {
          throw new BadRequestException(
            'Product line total exceeds supported range',
          );
        }

        if (item.discounted_total !== undefined) {
          const snapshotLineTotalCents = this.toCents(
            item.discounted_total,
            'discounted_total',
          );

          if (
            snapshotLineTotalCents !== lineTotalCents
          ) {
            throw new BadRequestException(
              'Product line total does not match quantity and unit price',
            );
          }
        }

        calculatedSubtotalCents += lineTotalCents;

        if (
          !Number.isSafeInteger(
            calculatedSubtotalCents,
          )
        ) {
          throw new BadRequestException(
            'Order subtotal exceeds supported range',
          );
        }

        return {
          item_id: item.item_id,
          quantity: item.quantity,
          rate: unitPriceCents / 100,
        };
      },
    );

    /**
     * Validate the amount charged for products.
     */
    const paymentSubtotalCents = this.toCents(
      payment.subtotalExGst,
      'payment.subtotalExGst',
    );

    if (
      calculatedSubtotalCents !==
      paymentSubtotalCents
    ) {
      throw new BadRequestException(
        'Product subtotal does not match verified payment',
      );
    }

    /**
     * Validate shipping, GST and total.
     */
    const shippingCents = this.toCents(
      payment.shippingExGst,
      'payment.shippingExGst',
    );

    const gstCents = this.toCents(
      payment.gstAmount,
      'payment.gstAmount',
    );

    const totalCents = this.toCents(
      payment.totalIncGst,
      'payment.totalIncGst',
    );

    const calculatedTotalCents =
      calculatedSubtotalCents +
      shippingCents +
      gstCents;

    if (calculatedTotalCents !== totalCents) {
      throw new BadRequestException(
        'Order total does not match verified payment',
      );
    }

    /**
     * Cross-check amounts stored in the snapshot
     * when those fields are available.
     */
    if (
      snapshot.subtotal_ex_gst !== undefined &&
      this.toCents(
        snapshot.subtotal_ex_gst,
        'snapshot.subtotal_ex_gst',
      ) !== paymentSubtotalCents
    ) {
      throw new BadRequestException(
        'Snapshot subtotal does not match payment',
      );
    }

    if (
      snapshot.shipping_charge !== undefined &&
      this.toCents(
        snapshot.shipping_charge,
        'snapshot.shipping_charge',
      ) !== shippingCents
    ) {
      throw new BadRequestException(
        'Snapshot shipping does not match payment',
      );
    }

    if (
      snapshot.gst_amount !== undefined &&
      this.toCents(
        snapshot.gst_amount,
        'snapshot.gst_amount',
      ) !== gstCents
    ) {
      throw new BadRequestException(
        'Snapshot GST does not match payment',
      );
    }

    if (
      snapshot.total_inc_gst !== undefined &&
      this.toCents(
        snapshot.total_inc_gst,
        'snapshot.total_inc_gst',
      ) !== totalCents
    ) {
      throw new BadRequestException(
        'Snapshot total does not match payment',
      );
    }

    /**
     * Generate a deterministic reference.
     * The same payment always gets the same
     * proposed Zoho reference.
     */
    const referenceNumber = `EWS-${payment.id}`;

    const salesOrderPreview = {
      customer_id: payment.zohoContactId,
      reference_number: referenceNumber,
      line_items: lineItems,
      shipping_charge: shippingCents / 100,
    };

    return {
      mode: 'DRY_RUN',
      zoho_order_created: false,
      payment_id: payment.id,
      payment_status: payment.paymentStatus,
      payment_verified_at: payment.paymentVerifiedAt,
      fulfilment_status: payment.fulfilmentStatus,
      currency: payment.currency,
      expected_subtotal_ex_gst:
        paymentSubtotalCents / 100,
      expected_shipping_ex_gst:
        shippingCents / 100,
      expected_gst: gstCents / 100,
      expected_total_inc_gst:
        totalCents / 100,
      proposed_sales_order: salesOrderPreview,
      validation: {
        stripe_payment_verified: true,
        zoho_customer_linked: true,
        fulfilment_not_started: true,
        line_items_valid: true,
        subtotal_matches: true,
        shipping_matches: true,
        gst_matches_snapshot: true,
        total_matches: true,
      },
      warning:
        'Read-only staging preview. No Zoho order has been created. Zoho tax application, reference lookup, stock availability and duplicate prevention require further verification.',
    };
  }
}
