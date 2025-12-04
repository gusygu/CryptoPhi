// src/core/db/index.ts
// Public facade re-exporting the modern DB helpers + legacy shims.

export * from "./db";
export * from "./session";
export * from "./db.ref";
export * from "./cycleDocuments";

export {
  getDb,
  appendAppLedger,
  getAppLedgerSince,
  appendTransferLedger,
  listTransferLegs,
  TABLES,
} from "./pool_server";
