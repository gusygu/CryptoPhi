const FALLBACK_COINS = ["BTC", "ETH", "BNB", "SOL", "ADA", "USDT"];

export async function getAuxCoins(): Promise<string[]> {
  const raw = process.env.STR_AUX_COINS;
  if (!raw) return FALLBACK_COINS;
  const list = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return list.length ? list : FALLBACK_COINS;
}
