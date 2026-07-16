import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  AgentTreeNode,
  AgentTreeResponse,
  ClientCommand,
  CommandAck,
  ListModelsResponse,
  ListSkillsResponse,
} from "../contracts/index.ts";
import type { AgentLoopHandle } from "./agent-loop.ts";
import type { SessionLogger } from "./logger.ts";
import { buildTar } from "./tar.ts";

function findAgent(tree: AgentTreeNode[], agentId: string): AgentTreeNode | undefined {
  for (const node of tree) {
    if (node.agentId === agentId) return node;
    const found = findAgent(node.children, agentId);
    if (found) return found;
  }
  return undefined;
}

function isClientCommand(value: unknown): value is ClientCommand {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  switch (v.type) {
    case "send_message":
      return typeof v.agentId === "string" && typeof v.message === "string";
    case "request_agent_tree":
      return true;
    case "download_logs":
      return v.agentId === undefined || typeof v.agentId === "string";
    case "stop_agent":
      return typeof v.agentId === "string";
    case "list_models":
      return true;
    case "switch_model":
      return typeof v.agentId === "string" && typeof v.model === "string";
    case "list_skills":
      return true;
    case "invoke_skill":
      return (
        typeof v.agentId === "string" &&
        typeof v.skill === "string" &&
        (v.args === undefined || typeof v.args === "string")
      );
    default:
      return false;
  }
}

export interface CommandContext {
  agentLoop: AgentLoopHandle;
  logger: SessionLogger;
  sessionId: string;
}

export type CommandResult =
  | {
      kind: "json";
      status: number;
      body: CommandAck | AgentTreeResponse | ListModelsResponse | ListSkillsResponse;
    }
  | { kind: "binary"; status: number; body: Uint8Array; contentType: string; filename: string };

function unknownAgentError(agentId: string): CommandResult {
  return { kind: "json", status: 404, body: { ok: false, error: `unknown agentId: ${agentId}` } };
}

function handleDownloadLogs(agentId: string | undefined, ctx: CommandContext): CommandResult {
  if (agentId !== undefined) {
    const path = ctx.logger.filePathFor(agentId);
    if (!existsSync(path)) {
      return {
        kind: "json",
        status: 404,
        body: { ok: false, error: `no log file for agentId: ${agentId}` },
      };
    }
    return {
      kind: "binary",
      status: 200,
      body: Uint8Array.from(readFileSync(path)),
      contentType: "application/x-ndjson",
      filename: basename(path),
    };
  }

  const dir = ctx.logger.logDir;
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".jsonl")) : [];
  const entries = files.map((file) => {
    const path = join(dir, file);
    return {
      name: file,
      data: Uint8Array.from(readFileSync(path)),
      // DH-0021: real per-file mtime, not the archive's build time, so the exported
      // bundle retains diagnostic value (when each agent's log was last written).
      mtimeSeconds: Math.floor(statSync(path).mtimeMs / 1000),
    };
  });
  return {
    kind: "binary",
    status: 200,
    body: buildTar(entries),
    contentType: "application/x-tar",
    filename: `session-${ctx.sessionId}.tar`,
  };
}

/**
 * Routes one parsed POST body to the appropriate action against the running agent tree.
 * `command` is `unknown` at this boundary (it came off the wire as JSON) and is validated
 * before being trusted as a `ClientCommand`.
 *
 * DH-0093: `async` since `AgentLoopHandle.invokeSkill()` may itself be async (it loads a
 * skill file from disk before delivering the composed message) — threaded through to this
 * function's one caller, `src/server/server.ts`'s `handleCommandRequest`, which was already
 * `async` (every command handler before this one was synchronous, so nothing else changes).
 */
export async function handleCommand(command: unknown, ctx: CommandContext): Promise<CommandResult> {
  if (!isClientCommand(command)) {
    return { kind: "json", status: 400, body: { ok: false, error: "invalid command body" } };
  }

  switch (command.type) {
    case "send_message":
      if (!findAgent(ctx.agentLoop.getAgentTree(), command.agentId)) {
        return unknownAgentError(command.agentId);
      }
      ctx.agentLoop.sendMessage(command.agentId, command.message);
      return { kind: "json", status: 200, body: { ok: true } };
    case "stop_agent":
      if (!findAgent(ctx.agentLoop.getAgentTree(), command.agentId)) {
        return unknownAgentError(command.agentId);
      }
      ctx.agentLoop.stopAgent(command.agentId);
      return { kind: "json", status: 200, body: { ok: true } };
    case "request_agent_tree":
      return { kind: "json", status: 200, body: { ok: true, tree: ctx.agentLoop.getAgentTree() } };
    case "download_logs":
      return handleDownloadLogs(command.agentId, ctx);
    case "list_models":
      return { kind: "json", status: 200, body: { ok: true, models: ctx.agentLoop.listModels() } };
    case "switch_model":
      // DH-0093: AgentLoopHandle.switchModel() throws for an unknown model alias
      // (ConfigModelError) or a non-root agentId (RootOnlyModelSwitchError, v1 scope) — both
      // are surfaced as a 400 ack here, the class of error this command can synchronously
      // reject with (unlike send_message/stop_agent's separate "unknown agentId" 404, which
      // checks the tree up front instead).
      try {
        ctx.agentLoop.switchModel(command.agentId, command.model);
        return { kind: "json", status: 200, body: { ok: true } };
      } catch (err) {
        return {
          kind: "json",
          status: 400,
          body: { ok: false, error: err instanceof Error ? err.message : String(err) },
        };
      }
    case "list_skills":
      return { kind: "json", status: 200, body: { ok: true, skills: ctx.agentLoop.listSkills() } };
    case "invoke_skill":
      // DH-0093: an unknown skill name (UnknownSkillError) is the one error class this
      // command can reject with — surfaced as a 404 ack, per the ticket's design.
      try {
        await ctx.agentLoop.invokeSkill(command.agentId, command.skill, command.args);
        return { kind: "json", status: 200, body: { ok: true } };
      } catch (err) {
        return {
          kind: "json",
          status: 404,
          body: { ok: false, error: err instanceof Error ? err.message : String(err) },
        };
      }
  }
}
