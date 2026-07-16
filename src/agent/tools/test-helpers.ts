// Shared test scaffolding for tool unit tests. Kept branch-free so it doesn't dilute the
// 100%-coverage gate: every call site exercises the same lines.

import type { DhConfig } from "../../contracts/index.ts";
import { TaskRegistry } from "../tasks.ts";
import type { ToolContext } from "./types.ts";

export const TEST_CONFIG: DhConfig = {
  options: { defaultModel: "sonnet" },
  models: [{ name: "sonnet", provider: "anthropic", model: "sonnet-5" }],
  provider: [{ name: "anthropic", type: "anthropic" }],
};

export function makeToolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  const context: ToolContext = {
    cwd: process.cwd(),
    runInBackgroundDefault: true,
    agentId: "agent-test-root",
    config: TEST_CONFIG,
    tasks: new TaskRegistry(),
    spawnAgent: () => {
      throw new Error("spawnAgent not wired in this test context");
    },
    loadSkill: async () => null,
    searchDeferredTools: async () => ({ results: [] }),
    readRegistry: new Map(),
    activatedTools: new Set(),
    completeWithModel: async () => {
      throw new Error("completeWithModel not wired in this test context");
    },
    ...overrides,
  };
  return context;
}
