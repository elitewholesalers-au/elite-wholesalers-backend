
import {
  Injectable,
  Optional,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CheckoutPayment } from './entities/checkout-payment.entity';
import { ZohoInventoryService } from '../zoho/zoho-inventory.service';

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

    @Optional()
    private readonly zohoInventoryService?: ZohoInventoryService,
  ) {}

  /**
   * Restrict development operations to staging.
   */
  private assertStaging(): void {
    if (
      this.configService.get<string>('APP_ENV') !==
      'staging'
    ) {
      throw new ServiceUnavailableException(
        'Payment-first fulfilment testing is restricted to staging',
      );
    }
  }

  /**
   * Convert a monetary amount into integer cents.
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
   * Validates a verified Stripe payment and prepares
   * a read-only Zoho sales order preview.
   *
   * No database writes.
   * No Zoho API calls.
   */
  async previewZohoSalesOrder(paymentId: string) {
    this.assertStaging();

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

  /**
   * STAGING ONLY
   *
   * Read-only Zoho reconciliation preview.
   *
   * Validates the Stripe payment and order snapshot,
   * then searches Zoho Inventory for an existing
   * sales order with the exact payment reference.
   *
   * No database writes.
   * No Zoho writes.
   *
   * This method is not connected to a controller
   * or webhook.
   */
  async previewZohoReconciliation(paymentId: string) {
    this.assertStaging();

    const preview =
      await this.previewZohoSalesOrder(paymentId);

    if (!this.zohoInventoryService) {
      throw new ServiceUnavailableException(
        'Zoho Inventory reconciliation service is unavailable',
      );
    }

    const customerId =
      preview.proposed_sales_order.customer_id;

    const referenceNumber =
      preview.proposed_sales_order.reference_number;

    let reconciliation: Awaited<
      ReturnType<
        ZohoInventoryService['reconcileSalesOrderByReference']
      >
    >;

    try {
      reconciliation =
        await this.zohoInventoryService
          .reconcileSalesOrderByReference(
            customerId,
            referenceNumber,
          );
    } catch {
      throw new ServiceUnavailableException(
        'Zoho reconciliation could not be completed. Automatic order creation remains blocked.',
      );
    }

    if (
      !reconciliation ||
      reconciliation.search_complete !== true ||
      reconciliation.customer_id !== customerId ||
      reconciliation.reference_number !==
        referenceNumber ||
      !Array.isArray(reconciliation.matches) ||
      reconciliation.match_count !==
        reconciliation.matches.length ||
      !Number.isInteger(
        reconciliation.pages_checked,
      ) ||
      reconciliation.pages_checked < 1
    ) {
      throw new ServiceUnavailableException(
        'Zoho reconciliation returned an invalid result. Automatic order creation remains blocked.',
      );
    }

    const expectedStatus =
      reconciliation.match_count === 0
        ? 'NOT_FOUND'
        : reconciliation.match_count === 1
          ? 'FOUND'
          : 'DUPLICATE';

    if (reconciliation.status !== expectedStatus) {
      throw new ServiceUnavailableException(
        'Zoho reconciliation returned an inconsistent status.',
      );
    }

    return {
      mode: 'READ_ONLY_RECONCILIATION',
      zoho_order_created: false,
      payment_id: preview.payment_id,
      payment_status: preview.payment_status,
      fulfilment_status: preview.fulfilment_status,
      currency: preview.currency,
      expected_total_inc_gst:
        preview.expected_total_inc_gst,
      proposed_sales_order:
        preview.proposed_sales_order,
      reconciliation,
      existing_order_detected:
        reconciliation.match_count > 0,
      duplicate_orders_detected:
        reconciliation.match_count > 1,
      automatic_order_creation_enabled: false,
      warning:
        'Read-only reconciliation only. No sales order has been created. A NOT_FOUND result is not authorisation to create an order. Live Zoho API response fields, tax, stock and concurrency safeguards still require verification.',
    };
  }

  /**
   * STAGING ONLY
   *
   * Atomically claim a verified Stripe payment
   * for fulfilment.
   *
   * Only one request can change the payment
   * from not_started to processing.
   *
   * Does not contact Zoho.
   * Does not create an order.
   */
  async claimPaymentForFulfilment(paymentId: string) {
    this.assertStaging();

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
      !payment.stripePaymentIntentId ||
      payment.currency !== 'AUD' ||
      !payment.zohoContactId
    ) {
      throw new BadRequestException(
        'Payment is not eligible for fulfilment',
      );
    }

    await this.previewZohoSalesOrder(paymentId);

    /**
     * Atomic conditional update.
     *
     * PostgreSQL allows only one concurrent
     * request to claim this payment.
     *
     * No Zoho API call is made here.
     */
    const result = await this.paymentRepository
      .createQueryBuilder()
      .update(CheckoutPayment)
      .set({
        fulfilmentStatus: 'processing',
        fulfilmentStartedAt: () =>
          'CURRENT_TIMESTAMP',
        failureReason: null,
      })
      .where('id = :paymentId', { paymentId })
      .andWhere('payment_method = :method', {
        method: 'stripe',
      })
      .andWhere('payment_status = :status', {
        status: 'paid',
      })
      .andWhere('payment_verified_at IS NOT NULL')
      .andWhere(
        'stripe_checkout_session_id IS NOT NULL',
      )
      .andWhere(
        'stripe_payment_intent_id IS NOT NULL',
      )
      .andWhere('currency = :currency', {
        currency: 'AUD',
      })
      .andWhere('zoho_contact_id IS NOT NULL')
      .andWhere(
        'fulfilment_status = :fulfilmentStatus',
        {
          fulfilmentStatus: 'not_started',
        },
      )
      .andWhere('zoho_salesorder_id IS NULL')
      .returning([
        'id',
        'payment_status',
        'fulfilment_status',
        'fulfilment_started_at',
        'zoho_salesorder_id',
      ])
      .execute();

    if (result.affected !== 1) {
      throw new ConflictException(
        'Payment fulfilment has already started or is no longer eligible',
      );
    }

    return {
      mode: 'STAGING_LOCK_TEST',
      payment_id: paymentId,
      claimed: true,
      fulfilment_status: 'processing',
      zoho_order_created: false,
      result: result.raw[0],
      warning:
        'Staging database claim only. No Zoho sales order was created. Do not automatically reset or retry processing payments without reconciliation.',
    };
  }
}
