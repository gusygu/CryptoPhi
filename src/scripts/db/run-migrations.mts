#!/usr/bin/env tsx
/**
 * Lightweight migrations runner (separate from core DDLs).
 *
 * Usage:
 *   pnpm tsx src/scripts/db/run-migrations.mts
 *   pnpm tsx src/scripts/db/run-migrations.mts --from 2025
 *   pnpm tsx src/scripts/db/run-migrations.mts --only invites
 *   pnpm tsx src/scripts/db/run-migrations.mts --dry-run
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { Client } from "pg";

console.log(">>> Using DATABASE_URL:", process.env.DATABASE_URL ?? "(not set)");

function getFlag(name: string): string | undefined {
  const args = process.argv.slice(2);
  const prefix = `--${name}=`;
  const direct = args.indexOf(`--${name}`);
  if (direct >= 0 && args[direct + 1]) return args[direct + 1];
  const prefixed = args.find((a) => a.startsWith(prefix));
  return prefixed ? prefixed.slice(prefix.length) : undefined;
}

function buildClient() {
  const url = process.env.DATABASE_URL;
  if (url && url.trim().length > 0) {
    console.log("🔌 Connecting via DATABASE_URL");
    return new Client({ connectionString: url });
  }
  const cfg = {
    host: process.env.PGHOST || "localhost",
    port: +(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "",
    database: process.env.PGDATABASE || "cryptophi",
    application_name: "cryptopi-migrations-runner",
  };
  console.log("🔌 Connecting via PG* envs:", `${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`);
  return new Client(cfg);
}

function listSqlFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files = files.concat(listSqlFiles(full));
    else if (e.isFile() && e.name.endsWith(".sql")) files.push(full);
  }
  return files.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

const FROM = getFlag("from");
const ONLY = getFlag("only");
const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";

async function run() {
  const migrationsDir = path.resolve("src/core/db/migrations");
  if (!fs.existsSync(migrationsDir)) {
    console.error("❌ No migrations directory at", migrationsDir);
    process.exit(1);
  }

  const allFiles = listSqlFiles(migrationsDir);
  if (!allFiles.length) {
    console.error("❌ No .sql migrations found in", migrationsDir);
    process.exit(1);
  }

  let files = allFiles;
  if (FROM) files = files.filter((f) => path.basename(f) >= FROM);
  if (ONLY) files = files.filter((f) => path.basename(f).includes(ONLY));

  console.log(`🟢 Applying ${files.length} migration file(s) from ${migrationsDir}`);
  if (DRY_RUN) {
    files.forEach((f) => console.log("   •", path.basename(f)));
    console.log("DRY RUN: nothing executed.");
    return;
  }

  const client = buildClient();
  await client.connect();
  let okCount = 0;
  try {
    for (const file of files) {
      const name = path.basename(file);
      const sql = fs.readFileSync(file, "utf8");
      console.log(`   ▶ Executing ${name}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("COMMIT");
        console.log(`   ✓ ${name}`);
        okCount++;
      } catch (err: any) {
        await client.query("ROLLBACK");
        console.error(`   ✖ ${name} failed: ${err.message}`);
        throw new Error(`Migration failed in ${name}: ${err.message}`);
      }
    }
  } finally {
    await client.end().catch(() => {});
  }
  console.log(`✅ Migrations complete. ${okCount}/${files.length} applied.`);
}

run().catch((err) => {
  console.error("❌ Failed to run migrations:", err);
  process.exit(1);
});

