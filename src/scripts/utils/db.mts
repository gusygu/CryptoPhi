import { Client, type ClientConfig } from "pg";

function asBool(v: unknown, fallback = false): boolean {
  if (v == null) return fallback;
  const normalized = String(v).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

const useUrl = !!process.env.DATABASE_URL;
const baseConfig: ClientConfig = useUrl
  ? { connectionString: String(process.env.DATABASE_URL) }
  : {
      host: String(process.env.PGHOST ?? "localhost"),
      port: Number(process.env.PGPORT ?? 1027),
      user: String(process.env.PGUSER ?? "postgres"),
      password: String(process.env.PGPASSWORD ?? "HwZ"),
      database: String(process.env.PGDATABASE ?? "cryptophi"),
    };

const config: ClientConfig = {
  ...baseConfig,
  ssl: asBool(process.env.DB_SSL ?? process.env.PGSSL)
    ? { rejectUnauthorized: false }
    : undefined,
};

export async function getClient(): Promise<Client> {
  const client = new Client(config);
  await client.connect();
  return client;
}
