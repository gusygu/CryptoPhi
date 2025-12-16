import { POST as engineRequest } from "@/app/api/engine/invite/request/route";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  const res = await engineRequest(req);
  try {
    res.headers.set("Cache-Control", "no-store");
  } catch {
    /* ignore header failures */
  }
  return res;
}

