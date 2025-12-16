import { POST as engineApprove } from "@/app/api/engine/invite/approve/route";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  const res = await engineApprove(req);
  try {
    res.headers.set("Cache-Control", "no-store");
  } catch {
    /* ignore */
  }
  return res;
}

