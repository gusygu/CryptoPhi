// src/pages/api/poller/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerPoller } from "@/core/poller";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const poller = await getServerPoller();     // boots singleton if needed
  return poller.sseHandler(req, res as any);
}

export const config = {
  api: { bodyParser: false }, // SSE
};
