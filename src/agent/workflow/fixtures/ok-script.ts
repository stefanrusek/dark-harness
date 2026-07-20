// Test fixture for workflow.test.ts — a trivial workflow script whose default export just
// echoes the input it was given, using wf.log() to verify the log-drain path.
import type { WorkflowApi } from "../runner.ts";

export default async function (wf: WorkflowApi, input: Record<string, unknown>) {
  wf.log("starting");
  return `ok:${JSON.stringify(input)}`;
}
