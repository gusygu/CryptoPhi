// src/scripts/jobs/str-aux-runner.ts
// Simple loop that runs the STR-AUX sampling + vector pipeline on an interval.

import { runStrAuxTick } from "@/core/features/str-aux/runner";
import { loadSettings } from "@/core/settings";
import type { PipelineSettings, PollTick } from "@/core/pipelines/types";

const INTERVAL_MS = Math.max(
  5_000,
  Number(process.env.STR_AUX_RUNNER_INTERVAL_MS ?? 40_000),
);
const SESSION_ID = process.env.STR_AUX_RUNNER_SESSION_ID ?? "str-aux-runner";

// --- NEW: graceful shutdown flag
let shouldStop = false;

async function runOnce(settings: PipelineSettings) {
  const now = Date.now();
  const tick: PollTick = {
    cycleTs: now,
    periodMs: INTERVAL_MS,
    scale: "sampling",
    appSessionId: SESSION_ID,
  };
  await runStrAuxTick(settings, tick);
}

async function main() {
  console.log(
    `[str-aux-runner] booting with interval=${INTERVAL_MS}ms session=${SESSION_ID}`,
  );

  while (!shouldStop) {
    const loopStarted = Date.now();
    try {
      const settings = await loadSettings();
      await runOnce(settings);
    } catch (err) {
      console.error("[str-aux-runner] tick failed:", err);
    }

    const elapsed = Date.now() - loopStarted;
    const waitFor = Math.max(1_000, INTERVAL_MS - elapsed);
    await new Promise((resolve) => setTimeout(resolve, waitFor));
  }

  console.log("[str-aux-runner] stopped");
}

// --- NEW: shutdown handlers (Koyeb/containers will send SIGTERM)
process.on("SIGTERM", () => {
  console.log("[str-aux-runner] SIGTERM received, stopping...");
  shouldStop = true;
});
process.on("SIGINT", () => {
  console.log("[str-aux-runner] SIGINT received, stopping...");
  shouldStop = true;
});

// --- NEW: crash visibility (don’t silently exit)
process.on("unhandledRejection", (reason) => {
  console.error("[str-aux-runner] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[str-aux-runner] uncaughtException:", err);
  process.exit(1);
});

// --- REPLACE: entrypoint detection
function isEntrypoint(): boolean {
  // If you set this env var, we always run (useful for workers)
  if (process.env.STR_AUX_RUNNER_AUTOSTART === "1") return true;

  // Node ESM robust check
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { pathToFileURL } = require("node:url");
    const entry = process.argv[1];
    if (!entry) return false;
    const entryHref = pathToFileURL(entry).href;
    return typeof import.meta !== "undefined" && import.meta.url === entryHref;
  } catch {
    // If require() isn't available (pure ESM), fall back to import.meta.main if present
    return Boolean((import.meta as any)?.main);
  }
}

if (isEntrypoint()) {
  main().catch((err) => {
    console.error("[str-aux-runner] fatal error:", err);
    process.exit(1);
  });
}
