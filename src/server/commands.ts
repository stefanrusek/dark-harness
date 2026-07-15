import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  AgentTreeNode,
  AgentTreeResponse,
  ClientCommand,
  CommandAck,
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
  | { kind: "json"; status: number; body: CommandAck | AgentTreeResponse }
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
  const entries = files.map((file) => ({
    name: file,
    data: Uint8Array.from(readFileSync(join(dir, file))),
  }));
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
 */
export function handleCommand(command: unknown, ctx: CommandContext): CommandResult {
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
  }
}
