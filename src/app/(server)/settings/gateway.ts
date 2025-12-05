// src/server/settings/gateway.ts
import { z } from "zod";
import { getAll as getSettings } from "@/lib/settings/server";

// Keep this in sync with your Settings page schema
export const SettingsSchema = z.object({
  universe: z.array(z.string().min(2)),        // ["BTC","ETH","SOL",...]
  quote: z.string().default("USDT"),           // default quote
  timing: z.object({
    autoRefresh: z.boolean().default(true),
    autoRefreshMs: z.number().default(80_000),
    secondaryEnabled: z.boolean().default(true),
    secondaryCycles: z.number().default(3),
    strCycles: z.object({ m30: z.number(), h1: z.number(), h3: z.number() })
  }),
});

let current: z.infer<typeof SettingsSchema> | null = null;
let version = 0;

// TODO: plug into your real persistence (db/file). For now, import from the Settings page's server util.
export async function loadSettings(): Promise<z.infer<typeof SettingsSchema>> {
  if (!current) {
    try {
      const raw = await getSettings();
      current = SettingsSchema.parse({
        universe: raw.coinUniverse ?? [],
        quote: "USDT",
        timing: raw.timing,
      });
    } catch {
      current = SettingsSchema.parse({
        universe: ["BTC","ETH","BNB","SOL","ADA","XRP","PEPE","DOGE","USDT"],
        quote: "USDT",
        timing: { autoRefresh: true, autoRefreshMs: 80_000, secondaryEnabled: true, secondaryCycles: 3,
          strCycles: { m30: 60, h1: 60, h3: 60 } }
      });
    }
  }
  return current!;
}

export async function getSettingsWithVersion() {
  if (!current) await loadSettings();
  return { settings: current!, version };
}

// Call this from the Settings save endpoint
export async function applySettings(next: unknown) {
  current = SettingsSchema.parse(next);
  version++; // 🔔 bump; listeners should restart pollers/caches
  return { ok: true, version };
}
