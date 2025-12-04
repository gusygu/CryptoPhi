// src/core/db/fs-runner.ts
// Minimal helper for legacy scripts that apply .sql files sequentially.

import { readFileSync } from "fs";
import { resolve } from "path";
import { getPool } from "./pool_server";

export async function applySqlFile(relativePath: string, label?: string): Promise<void> {
  const fullPath = resolve(process.cwd(), relativePath);
  const sql = readFileSync(fullPath, "utf8");
  if (!sql.trim()) return;

  const title = label ?? relativePath;
  console.info(`[db] applying ${title}`);
  const client = await getPool().connect();
  try {
    await client.query(sql);
    console.info(`[db] ${title} applied`);
  } finally {
    client.release();
  }
}
