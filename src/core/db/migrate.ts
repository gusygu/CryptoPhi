// src/core/db/migrate.ts
// Runs your SQL schema in a safe, deterministic order.
// Looks for:
//   1) src/core/db/ddl.unified.sql              (primary, if present)
//   2) src/core/db/sql/*.sql (sorted lexicographically)
//   3) legacy fallbacks: ddl.sql, ddl-aux.sql, ddl-str.sql (if #1+#2 missing)

import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve, extname } from "path";
import { getPool } from "./db";

function findSqlFiles(): string[] {
  const root = resolve(process.cwd());
  const primary = resolve(root, "ddl/ddl.unified.sql");
  const sqlDir  = resolve(root, "ddl");
  const legacyPrimary = resolve(root, "src/core/db/ddl.unified.sql");
  const legacySqlDir  = resolve(root, "src/core/db/sql");
  const legacy  = [
    resolve(root, "src/core/db/ddl.sql"),
    resolve(root, "src/core/db/ddl-aux.sql"),
    resolve(root, "src/core/db/ddl-str.sql"),
  ];

  const files: string[] = [];
  if (existsSync(primary)) files.push(primary);

  if (existsSync(sqlDir)) {
    const dirFiles = readdirSync(sqlDir)
      .filter(f => extname(f).toLowerCase() === ".sql")
      .sort()
      .map(f => resolve(sqlDir, f));
    files.push(...dirFiles);
  }

  // legacy locations (src/core/db/ddl.unified.sql or src/core/db/sql/*.sql)
  if (existsSync(legacyPrimary)) files.push(legacyPrimary);

  if (existsSync(legacySqlDir)) {
    const dirFiles = readdirSync(legacySqlDir)
      .filter(f => extname(f).toLowerCase() === ".sql")
      .sort()
      .map(f => resolve(legacySqlDir, f));
    files.push(...dirFiles);
  }

  if (!files.length) files.push(...legacy.filter(existsSync));
  return files;
}

export async function runUnifiedDDL(paths?: string[]) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const files = (paths && paths.length ? paths : findSqlFiles());
    if (!files.length) throw new Error(
      "No .sql files found. Expected src/core/db/ddl.unified.sql or src/core/db/sql/*.sql"
    );

    for (const file of files) {
      const sql = readFileSync(file, "utf8");
      console.log(`→ applying ${file}`);
      await client.query("BEGIN");
      await client.query(sql);         // pg supports multiple statements per query
      await client.query("COMMIT");
      console.log(`✔ applied ${file}`);
    }
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

// allow `tsx src/core/db/migrate.ts`
if (require.main === module) {
  runUnifiedDDL()
    .then(() => { console.log("All migrations applied ✅"); process.exit(0); })
    .catch(err => { console.error("Migration failed ❌", err); process.exit(1); });
}
