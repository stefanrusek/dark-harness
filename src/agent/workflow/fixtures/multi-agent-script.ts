// Test fixture for workflow.test.ts — a realistic multi-agent script exercising both agent()
// and parallel() together against a scripted/mock ctx.spawnAgent.
import type { WorkflowApi } from "../runner.ts";

export default async function (wf: WorkflowApi) {
  const lead = await wf.agent("plan the work", { description: "lead" });
  const results = await wf.parallel([
    () => wf.agent("worker one", { description: "worker-1" }),
    () => wf.agent("worker two", { description: "worker-2" }),
    () => wf.agent("please fail", { description: "worker-3" }),
  ]);
  wf.log(`lead said: ${lead}`);
  return JSON.stringify(results);
}
