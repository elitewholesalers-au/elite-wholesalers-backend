
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Run manually against the verified Neon staging database.
 *
 * This script must never run automatically during application startup.
 */
async function run(): Promise<void> {
  if (process.env.PAYMENT_MIGRATION_ENV !== 'staging') {
    throw new Error(
      'Migration blocked: PAYMENT_MIGRATION_ENV must be staging.',
    );
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is missing.');
  }

  const parsedUrl = new URL(databaseUrl);

  if (
    !parsedUrl.hostname.startsWith('ep-cold-cake-b54saca1-') ||
    parsedUrl.pathname !== '/neondb'
  ) {
    throw new Error(
      'Migration blocked: database connection does not match the verified staging database.',
    );
  }

  const dataSource = new DataSource({
    type: 'postgres',
    url: databaseUrl,
    ssl: {
      rejectUnauthorized: false,
    },
    synchronize: false,
    logging: false,
  });

  try {
    await dataSource.initialize();

    /**
     * Additional staging safety verification.
     *
     * The environment_safety record must exist in the
     * staging database before this migration can proceed.
     */
    const safetyRecords: Array<{ environment_name: string }> =
      await dataSource.query(`
        SELECT environment_name
        FROM public.environment_safety
        WHERE environment_name = 'elite-wholesalers-staging'
      `);

    if (safetyRecords.length !== 1) {
      throw new Error(
        'Migration blocked: staging safety identifier not found.',
      );
    }

    console.log('Staging database safety identifier verified.');
    console.log('Connected to verified staging database.');

    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS checkout_payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        user_id UUID NOT NULL,

        zoho_contact_id VARCHAR(100),

        payment_method VARCHAR(20) NOT NULL
          CHECK (payment_method IN ('stripe', 'payid')),

        payment_status VARCHAR(30) NOT NULL DEFAULT 'pending'
          CHECK (
            payment_status IN (
              'pending',
              'processing',
              'paid',
              'failed',
              'cancelled',
              'expired',
              'refunded'
            )
          ),

        currency VARCHAR(3) NOT NULL DEFAULT 'AUD',

        subtotal_ex_gst NUMERIC(12, 2) NOT NULL
          CHECK (subtotal_ex_gst >= 0),

        shipping_ex_gst NUMERIC(12, 2) NOT NULL DEFAULT 0
          CHECK (shipping_ex_gst >= 0),

        discount_ex_gst NUMERIC(12, 2) NOT NULL DEFAULT 0
          CHECK (discount_ex_gst >= 0),

        gst_amount NUMERIC(12, 2) NOT NULL
          CHECK (gst_amount >= 0),

        total_inc_gst NUMERIC(12, 2) NOT NULL
          CHECK (total_inc_gst > 0),

        delivery_method VARCHAR(30) NOT NULL,

        promo_code VARCHAR(100),

        order_snapshot JSONB NOT NULL,

        stripe_checkout_session_id VARCHAR(255) UNIQUE,

        stripe_payment_intent_id VARCHAR(255) UNIQUE,

        payid_reference VARCHAR(100) UNIQUE,

        payment_verified_at TIMESTAMPTZ,

        zoho_salesorder_id VARCHAR(100) UNIQUE,

        zoho_invoice_id VARCHAR(100) UNIQUE,

        fulfilment_status VARCHAR(30) NOT NULL DEFAULT 'not_started'
          CHECK (
            fulfilment_status IN (
              'not_started',
              'processing',
              'completed',
              'failed'
            )
          ),

        fulfilment_started_at TIMESTAMPTZ,

        fulfilment_completed_at TIMESTAMPTZ,

        failure_reason TEXT,

        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await dataSource.query(`
      CREATE INDEX IF NOT EXISTS idx_checkout_payments_user_id
      ON checkout_payments (user_id);
    `);

    await dataSource.query(`
      CREATE INDEX IF NOT EXISTS idx_checkout_payments_status
      ON checkout_payments (payment_status);
    `);

    await dataSource.query(`
      CREATE INDEX IF NOT EXISTS idx_checkout_payments_created_at
      ON checkout_payments (created_at);
    `);

    console.log('checkout_payments table migration completed.');
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

run().catch((error) => {
  console.error('Payment migration failed:', error);
  process.exitCode = 1;
});
