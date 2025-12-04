// src/core/features/cin-aux/env.ts
export const ENV = {
  EXCHANGE_API_KEY: process.env.EXCHANGE_API_KEY ?? "",
  EXCHANGE_API_SECRET: process.env.EXCHANGE_API_SECRET ?? "",
  BINANCE_BASE_URL: process.env.BINANCE_BASE_URL,
};
