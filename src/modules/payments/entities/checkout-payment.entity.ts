
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PaymentMethod = 'stripe' | 'payid';

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'refunded';

export type FulfilmentStatus =
  | 'not_started'
  | 'processing'
  | 'completed'
  | 'failed';

@Entity({ name: 'checkout_payments' })
export class CheckoutPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({
    name: 'zoho_contact_id',
    type: 'varchar',
    nullable: true,
  })
  zohoContactId: string | null;

  @Column({ name: 'payment_method', type: 'varchar' })
  paymentMethod: PaymentMethod;

  @Column({
    name: 'payment_status',
    type: 'varchar',
    default: 'pending',
  })
  paymentStatus: PaymentStatus;

  @Column({
    type: 'varchar',
    length: 3,
    default: 'AUD',
  })
  currency: string;

  @Column({
    name: 'subtotal_ex_gst',
    type: 'numeric',
    precision: 12,
    scale: 2,
  })
  subtotalExGst: string;

  @Column({
    name: 'shipping_ex_gst',
    type: 'numeric',
    precision: 12,
    scale: 2,
  })
  shippingExGst: string;

  @Column({
    name: 'discount_ex_gst',
    type: 'numeric',
    precision: 12,
    scale: 2,
  })
  discountExGst: string;

  @Column({
    name: 'gst_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
  })
  gstAmount: string;

  @Column({
    name: 'total_inc_gst',
    type: 'numeric',
    precision: 12,
    scale: 2,
  })
  totalIncGst: string;

  @Column({
    name: 'delivery_method',
    type: 'varchar',
  })
  deliveryMethod: string;

  @Column({
    name: 'promo_code',
    type: 'varchar',
    nullable: true,
  })
  promoCode: string | null;

  @Column({
    name: 'order_snapshot',
    type: 'jsonb',
  })
  orderSnapshot: Record<string, unknown>;

  @Column({
    name: 'stripe_checkout_session_id',
    type: 'varchar',
    nullable: true,
    unique: true,
  })
  stripeCheckoutSessionId: string | null;

  @Column({
    name: 'stripe_payment_intent_id',
    type: 'varchar',
    nullable: true,
    unique: true,
  })
  stripePaymentIntentId: string | null;

  @Column({
    name: 'payid_reference',
    type: 'varchar',
    nullable: true,
    unique: true,
  })
  payidReference: string | null;

  @Column({
    name: 'payment_verified_at',
    type: 'timestamptz',
    nullable: true,
  })
  paymentVerifiedAt: Date | null;

  @Column({
    name: 'zoho_salesorder_id',
    type: 'varchar',
    nullable: true,
    unique: true,
  })
  zohoSalesorderId: string | null;

  @Column({
    name: 'zoho_invoice_id',
    type: 'varchar',
    nullable: true,
    unique: true,
  })
  zohoInvoiceId: string | null;

  @Column({
    name: 'fulfilment_status',
    type: 'varchar',
    default: 'not_started',
  })
  fulfilmentStatus: FulfilmentStatus;

  @Column({
    name: 'fulfilment_started_at',
    type: 'timestamptz',
    nullable: true,
  })
  fulfilmentStartedAt: Date | null;

  @Column({
    name: 'fulfilment_completed_at',
    type: 'timestamptz',
    nullable: true,
  })
  fulfilmentCompletedAt: Date | null;

  @Column({
    name: 'failure_reason',
    type: 'text',
    nullable: true,
  })
  failureReason: string | null;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
  })
  updatedAt: Date;
}
