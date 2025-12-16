export type ParsedJson<T> = T;

export class NonJsonResponseError extends Error {
  status: number;
  snippet?: string;
  contentType?: string | null;
  constructor(message: string, opts: { status: number; snippet?: string; contentType?: string | null }) {
    super(message);
    this.status = opts.status;
    this.snippet = opts.snippet;
    this.contentType = opts.contentType;
  }
}

export async function safeJson<T = any>(res: Response): Promise<ParsedJson<T>> {
  const contentType = res.headers.get("content-type");
  const isJson = typeof contentType === "string" && contentType.toLowerCase().includes("application/json");
  if (!isJson) {
    const text = await res.text().catch(() => "");
    const snippet = text ? text.slice(0, 200) : "";
    throw new NonJsonResponseError("Expected JSON response", {
      status: res.status,
      snippet,
      contentType,
    });
  }

  try {
    return (await res.json()) as T;
  } catch (err: any) {
    throw new Error(`Failed to parse JSON (status ${res.status}): ${err?.message ?? err}`);
  }
}

