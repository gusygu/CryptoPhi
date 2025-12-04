// src/scripts/db/smoke-neon.mts
import 'dotenv/config';
import { Client } from 'pg';

async function main() {
  try {
    const url = process.env.DATABASE_URL;
    if (!url) {
      console.error("❌ DATABASE_URL not found in .env");
      process.exit(1);
    }

    console.log("Connecting to:", url.replace(/:.+@/, "://***:***@"));
    const client = new Client({ connectionString: url });

    await client.connect();
    const res = await client.query("select now() as ts");
    console.log("✅ Connected! Neon time:", res.rows[0].ts);

    await client.end();
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }
}

main();
