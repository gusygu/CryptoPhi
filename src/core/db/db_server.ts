// Legacy shim: downstream modules historically imported from "@/core/db/db_server".
// pool_server.ts now implements the actual pool/query helpers, so re-export them here.

export * from "./pool_server";
