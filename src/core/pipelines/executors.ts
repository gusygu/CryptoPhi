// src/core/pipelines/executors.ts
import type { TaskExecutorRegistry } from "./metronome";
import type { PollTick, PipelineSettings } from "./types";
import { makeSamplingPlan, runStrAuxSnapshot } from "@/core/features/str-aux/frame/analytics";
import { buildPanel, savePanel, savePoints } from "@/core/features/str-aux/panel";

const logStub = async (name: string) => {
  console.warn(`[pipelines] executor "${name}" is not implemented in this environment`);
};

async function runStrAuxSample(task: any, tick: PollTick, settings: PipelineSettings) {
  const bases = Array.isArray(task.sample) && task.sample.length ? task.sample : settings.matrices.bases;
  const quote = task.quote || settings.matrices.quote;
  const depth = typeof task.size === "number" ? Number(task.size) : 5;
  const plan = makeSamplingPlan(bases, quote, tick, settings, depth);
  const snapshotPayload = await runStrAuxSnapshot(
    settings,
    tick,
    plan.sample,
    plan.quote,
    {},
    plan.depth
  );
  void buildPanel(snapshotPayload);
  await savePanel();
  await savePoints();
}

export const executors: TaskExecutorRegistry = {
  async "matrices.persist"() {
    await logStub("matrices.persist");
  },

  async "matrices.transient"() {
    await logStub("matrices.transient");
  },

  async "reference.snapshot"() {
    await logStub("reference.snapshot");
  },

  async "straux.sample"(task, tick, settings) {
    await runStrAuxSample(task, tick, settings);
  },

  async "window.aggregate"() {
    await logStub("window.aggregate");
  },
};
