import { POST as engineReject } from "@/app/api/engine/invite/reject/route";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  const res = await engineReject(req);
  try {
    res.headers.set("Cache-Control", "no-store");
  } catch {
    /* ignore */
  }
  return res;
}

