// Shared test scaffolding for tool unit tests. Kept branch-free so it doesn't dilute the
// 100%-coverage gate: every call site exercises the same lines.

import type { DhConfig } from "../../contracts/index.ts";
import { TaskRegistry } from "../tasks.ts";
import { TodoStore } from "../todos.ts";
import type { ToolContext } from "./types.type.ts";

export const TEST_CONFIG: DhConfig = Object.freeze<DhConfig>({
  options: { defaultModel: "sonnet" },
  models: [{ name: "sonnet", provider: "anthropic", model: "sonnet-5" }],
  provider: [{ name: "anthropic", type: "anthropic" }],
});

export function makeToolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  const tasks = overrides.tasks ?? new TaskRegistry();
  const context: ToolContext = {
    cwd: process.cwd(),
    runInBackgroundDefault: true,
    agentId: "agent-test-root",
    config: TEST_CONFIG,
    tasks,
    // DH-0003: default mirrors the plain (non-resuming) delegation `ctx.sendMessage` had
    // before AgentRuntime grew the finished-agent-resume path — tests that specifically want
    // resume behavior override this directly.
    sendMessage: (taskId, message) => tasks.sendMessage(taskId, message),
    spawnAgent: () => {
      throw new Error("spawnAgent not wired in this test context");
    },
    loadSkill: async () => null,
    searchDeferredTools: async () => ({ results: [] }),
    readRegistry: new Map(),
    activatedTools: new Set(),
    todos: new TodoStore(),
    completeWithModel: async () => {
      throw new Error("completeWithModel not wired in this test context");
    },
    ...overrides,
  };
  return context;
}
