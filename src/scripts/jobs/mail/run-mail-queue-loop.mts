// src/scripts/jobs/mail/run-mail-queue-loop.mts
import "dotenv/config";
import { runMailQueueOnce } from "./run-mail-queue.mts";

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const interval = Number(process.env.MAIL_LOOP_MS ?? DEFAULT_INTERVAL_MS);

  while (true) {
    const started = new Date();
    console.log(`[mail-loop] tick ${started.toISOString()}`);
    try {
      await runMailQueueOnce();
      console.log("[mail-loop] processed pending queue rows");
    } catch (err) {
      console.error("[mail-loop] error while processing queue:", err);
    }
    await sleep(interval);
  }
}

main().catch((err) => {
  console.error("[mail-loop] fatal error", err);
  process.exit(1);
});
