import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
dotenv.config();

const dataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
});

async function run() {
  await dataSource.initialize();
  console.log('Database connected!');

  // 1. Add the created_at column if it doesn't already exist
  await dataSource.query(`
    ALTER TABLE "user" 
    ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
  `);
  console.log('Added created_at column successfully!');

  // 2. Backfill any existing rows where created_at is null
  await dataSource.query(`
    UPDATE "user" 
    SET "created_at" = CURRENT_TIMESTAMP 
    WHERE "created_at" IS NULL;
  `);
  console.log('Backfilled existing rows with current timestamp!');

  await dataSource.destroy();
  console.log('Database connection closed.');
}

run().catch((err) => {
  console.error('Migration script failed:', err);
  process.exit(1);
});
