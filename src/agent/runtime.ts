// Composition root: wires dh.json config, provider adapters, the tool set, and the task
// registry together so a root agent (and any sub-agents it spawns via the Agent tool) can
// actually run. This is where the tools -> loop -> tools cycle is broken: tools only ever
// see a ToolContext.spawnAgent function; only this module imports both loop.ts and
// tools/index.ts.

import { randomUUID } from "node:crypto";
import {
  type DhConfig,
  ExitCode,
  type LogLine,
  type ModelConfig,
  type ServerSentEvent,
} from "../contracts/index.ts";
import { runAgentLoop } from "./loop.ts";
import { searchConfiguredMcpTools } from "./mcp.ts";
import { createProvider } from "./providers/index.ts";
import type { ModelProvider } from "./providers/types.ts";
import { loadSkillFromPaths } from "./skills.ts";
import { TaskRegistry } from "./tasks.ts";
import { ALL_TOOLS, buildToolMap } from "./tools/index.ts";
import type { Tool, ToolContext } from "./tools/types.ts";

export interface AgentRuntimeOptions {
  config: DhConfig;
  systemPrompt: string;
  cwd?: string;
  sessionId?: string;
  tools?: Tool[];
  onEvent?: (event: ServerSentEvent) => void;
  onLogLine?: (line: LogLine) => void;
}

export class ConfigModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigModelError";
  }
}

/** Wires dh.json into a runnable agent runtime: providers, tools, and the task registry that
 * lets Agent/Monitor/TaskOutput/SendMessage/TaskStop cooperate in-process. */
export class AgentRuntime {
  readonly sessionId: string;
  readonly tasks = new TaskRegistry();
  private readonly config: DhConfig;
  private readonly systemPrompt: string;
  private readonly cwd: string;
  private readonly toolMap: Map<string, Tool>;
  private readonly providers = new Map<string, ModelProvider>();
  private readonly onEvent: ((event: ServerSentEvent) => void) | undefined;
  private readonly onLogLine: ((line: LogLine) => void) | undefined;

  constructor(options: AgentRuntimeOptions) {
    this.config = options.config;
    this.systemPrompt = options.systemPrompt;
    this.cwd = options.cwd ?? process.cwd();
    this.sessionId = options.sessionId ?? randomUUID();
    this.toolMap = buildToolMap(options.tools ?? ALL_TOOLS);
    this.onEvent = options.onEvent;
    this.onLogLine = options.onLogLine;
  }

  private resolveModel(name: string): ModelConfig {
    const model = this.config.models.find((m) => m.name === name);
    if (!model) {
      throw new ConfigModelError(
        `unknown model "${name}"; known models: ${this.config.models.map((m) => m.name).join(", ")}`,
      );
    }
    return model;
  }

  private providerFor(model: ModelConfig): ModelProvider {
    let provider = this.providers.get(model.provider);
    if (!provider) {
      const providerConfig = this.config.provider.find((p) => p.name === model.provider);
      if (!providerConfig) {
        throw new ConfigModelError(
          `model "${model.name}" references unknown provider "${model.provider}"`,
        );
      }
      provider = createProvider(providerConfig);
      this.providers.set(model.provider, provider);
    }
    return provider;
  }

  private buildToolContext(agentId: string): ToolContext {
    return {
      cwd: this.cwd,
      runInBackgroundDefault: this.config.options.runInBackgroundDefault ?? true,
      agentId,
      config: this.config,
      tasks: this.tasks,
      spawnAgent: (params: { model: string; prompt: string }) => this.spawnAgent(agentId, params),
      loadSkill: (name: string) => loadSkillFromPaths(name, this.config.skillPaths ?? []),
      searchDeferredTools: (query: string) =>
        searchConfiguredMcpTools(this.config.mcpServers, query),
    };
  }

  /** Spawns a sub-agent as a task; returns immediately with the task id. */
  spawnAgent(parentAgentId: string, params: { model: string; prompt: string }): string {
    const model = this.resolveModel(params.model);
    const provider = this.providerFor(model);
    const agentId = `agent-${randomUUID()}`;

    return this.tasks.start({
      kind: "agent",
      parentAgentId,
      model: model.name,
      run: async (handle) => {
        const result = await runAgentLoop({
          sessionId: this.sessionId,
          agentId,
          parentAgentId,
          model: model.name,
          systemPrompt: this.systemPrompt,
          instruction: params.prompt,
          provider,
          tools: this.toolMap,
          toolContext: this.buildToolContext(agentId),
          registerSendMessage: handle.registerSendMessage,
          onEvent: (event) => {
            if (event.type === "agent_output") handle.append(event.chunk);
            this.onEvent?.(event);
          },
          ...(this.onLogLine ? { onLogLine: this.onLogLine } : {}),
        });
        if (!result.success) {
          throw new Error(result.finalOutput || "sub-agent reported failure");
        }
      },
    });
  }

  /** Runs the root agent to completion (not tracked as a task — it IS the session).
   *
   * Cross-domain note (docs/handoffs/core.md status log): emits a `session_ended`
   * ServerSentEvent on the normal return path (whether the root agent self-reported success
   * or failure) — this is what src/server/exit.ts's `waitForExitCode` (Server domain, main
   * branch) subscribes to for `--job` mode. It does NOT cover a harness error that prevents
   * the loop from ever starting (bad config, provider/auth failure) — callers (src/cli.ts)
   * must still wrap this call in their own try/catch for that class of failure, exactly as
   * src/server/exit.ts's own doc comment already assumes. */
  async runRoot(
    instruction: string,
    modelName?: string,
  ): Promise<{ success: boolean; finalOutput: string }> {
    const model = this.resolveModel(modelName ?? this.config.options.defaultModel);
    const provider = this.providerFor(model);
    const agentId = "agent-root";

    const result = await runAgentLoop({
      sessionId: this.sessionId,
      agentId,
      parentAgentId: null,
      model: model.name,
      systemPrompt: this.systemPrompt,
      instruction,
      provider,
      tools: this.toolMap,
      toolContext: this.buildToolContext(agentId),
      ...(this.onEvent ? { onEvent: this.onEvent } : {}),
      ...(this.onLogLine ? { onLogLine: this.onLogLine } : {}),
    });
    this.onEvent?.({
      version: 1,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "session_ended",
      exitCode: result.success ? ExitCode.Success : ExitCode.TaskFailure,
    });
    return { success: result.success, finalOutput: result.finalOutput };
  }
}
