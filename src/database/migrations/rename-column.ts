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

  // Run whichever query matches your setup:

  // If JSONB:
  await dataSource.query(`
    UPDATE "user" 
    SET business_details = jsonb_set(
      business_details - 'license_number', 
      '{licence_number}', 
      business_details->'license_number'
    )
    WHERE business_details ? 'license_number';
  `);

  console.log('Successfully renamed JSON key inside business_details!');
  await dataSource.destroy();
}

run().catch(console.error);
