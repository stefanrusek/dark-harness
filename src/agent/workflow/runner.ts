// Workflow tool's injected API (DH-0226) — deterministic sub-agent orchestration primitives
// built directly on top of the existing ctx.spawnAgent/ctx.tasks primitives (ADR 0009: a
// Workflow script is trusted control-flow, not a named sub-agent persona; every spawn it makes
// still goes through the exact same ad-hoc `spawnAgent({model, prompt})` path as the `Agent`
// tool, with the same fan-out budget backstop). MVP scope only: agent() + parallel(); no
// pipeline()/schema/resumability/phase() — see the ticket's Non-goals section.

import type { ToolContext } from "../tools/types.type.ts";

export interface WorkflowAgentOpts {
  model?: string;
  description?: string;
}

export interface WorkflowApi {
  /** Spawn one ad-hoc sub-agent, await it, resolve to its output. Rejects if it fails. */
  agent(prompt: string, opts?: WorkflowAgentOpts): Promise<string>;
  /** Barrier fan-out: every thunk is started before any is awaited; a rejected/throwing thunk
   * resolves to `null` at its slot rather than aborting the others; never rejects; input order
   * preserved. */
  parallel<T>(thunks: Array<() => Promise<T>>): Promise<Array<T | null>>;
  /** MVP: append a line to a buffer surfaced in the tool's textual output (no SSE). */
  log(message: string): void;
}

const DEFAULT_AGENT_DESCRIPTION = "workflow agent";

/** Mirrors `resolveModelName` in tools/agent.ts (same resolution rule + error message shape),
 * duplicated in miniature here rather than imported because that helper is file-private and
 * shaped around a validated tool `input` object rather than a bare prompt/opts pair — see the
 * ticket's FR note "reuse/extract that logic; do not duplicate the error string divergently."
 * The error string itself matches the Agent tool's wording exactly. */
function resolveModel(opts: WorkflowAgentOpts | undefined, ctx: ToolContext): string {
  const name = opts?.model ?? ctx.config.options.defaultModel;
  const known = ctx.config.models.some((m) => m.name === name);
  if (!known) {
    throw new Error(
      `Workflow agent() error: unknown model "${name}"; known models: ${ctx.config.models.map((m) => m.name).join(", ")}`,
    );
  }
  return name;
}

export function buildWorkflowApi(ctx: ToolContext): { api: WorkflowApi; drainLog(): string } {
  const logLines: string[] = [];

  const api: WorkflowApi = {
    async agent(prompt: string, opts?: WorkflowAgentOpts): Promise<string> {
      const model = resolveModel(opts, ctx);
      const taskId = ctx.spawnAgent({
        model,
        prompt,
        background: false,
        description: opts?.description ?? DEFAULT_AGENT_DESCRIPTION,
      });
      await ctx.tasks.awaitDone(taskId);
      const snapshot = ctx.tasks.snapshot(taskId);
      if (snapshot.status === "failed") {
        throw new Error(snapshot.error ?? "sub-agent failed");
      }
      return snapshot.output;
    },

    parallel<T>(thunks: Array<() => Promise<T>>): Promise<Array<T | null>> {
      // `Promise.resolve().then(t)` (rather than calling `t()` directly) is load-bearing: a
      // thunk that throws *synchronously* (e.g. ctx.spawnAgent's DH-0013 fan-out budget check,
      // which throws before returning a promise at all) would otherwise escape this map()
      // entirely and abort the whole parallel() call instead of collapsing to that slot's
      // `null`. Deferring the call into a microtask turns any synchronous throw into a
      // rejection the `.then(v => v, () => null)` below can catch uniformly alongside a real
      // async rejection.
      const settled = thunks.map((t) =>
        Promise.resolve()
          .then(t)
          .then(
            (v) => v,
            () => null,
          ),
      );
      return Promise.all(settled);
    },

    log(message: string): void {
      logLines.push(message);
    },
  };

  return { api, drainLog: () => logLines.join("\n") };
}
