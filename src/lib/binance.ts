// src/lib/binance.ts
// Lightweight wrapper for the signed Binance REST endpoints we still use.

import crypto from "crypto";

type ClientOptions = {
  apiKey?: string;
  apiSecret?: string;
  baseUrl?: string;
};

const DEFAULT_BASE = process.env.BINANCE_BASE_URL?.trim() || "https://api.binance.com";

export class BinanceClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;

  constructor(opts: ClientOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.EXCHANGE_API_KEY ?? "";
    this.apiSecret = opts.apiSecret ?? process.env.EXCHANGE_API_SECRET ?? "";
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
  }

  private assertCredentials() {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error("Missing Binance API credentials (EXCHANGE_API_KEY / EXCHANGE_API_SECRET).");
    }
  }

  private sign(query: string) {
    return crypto.createHmac("sha256", this.apiSecret).update(query).digest("hex");
  }

  private async signedGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    this.assertCredentials();
    const timestamp = Date.now();
    const usp = new URLSearchParams({ timestamp: String(timestamp) });
    for (const [key, value] of Object.entries(params)) {
      usp.set(key, String(value));
    }
    const signature = this.sign(usp.toString());
    usp.set("signature", signature);

    const res = await fetch(`${this.baseUrl}${path}?${usp.toString()}`, {
      method: "GET",
      headers: { "X-MBX-APIKEY": this.apiKey },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "<no-body>");
      throw new Error(`Binance ${path} -> ${res.status} ${text}`);
    }
    return (await res.json()) as T;
  }

  async accountInfo<T = any>(): Promise<T> {
    return this.signedGet<T>("/api/v3/account");
  }
}
