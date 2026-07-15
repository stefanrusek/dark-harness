// Client -> server command dispatch. Pure builders (easy to unit test) plus a thin
// `sendCommand` wrapper around `fetch` that accepts an injectable fetch implementation so
// tests never touch the network.

import type {
  AgentTreeResponse,
  ClientCommand,
  CommandAck,
  DownloadLogsCommand,
  RequestAgentTreeCommand,
  SendMessageCommand,
  StopAgentCommand,
} from "../../contracts/index.ts";
import { type ServerTarget, commandUrl } from "../protocol.ts";

export function buildSendMessageCommand(agentId: string, message: string): SendMessageCommand {
  return { type: "send_message", agentId, message };
}

export function buildRequestAgentTreeCommand(): RequestAgentTreeCommand {
  return { type: "request_agent_tree" };
}

export function buildDownloadLogsCommand(agentId?: string): DownloadLogsCommand {
  return agentId ? { type: "download_logs", agentId } : { type: "download_logs" };
}

export function buildStopAgentCommand(agentId: string): StopAgentCommand {
  return { type: "stop_agent", agentId };
}

export type FetchLike = typeof fetch;

export class CommandError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CommandError";
  }
}

function authHeaders(target: ServerTarget): HeadersInit {
  return target.token ? { Authorization: `Bearer ${target.token}` } : {};
}

/** Sends any `ClientCommand` and parses a JSON `CommandAck`-shaped response. */
export async function sendCommand<T extends CommandAck = CommandAck>(
  target: ServerTarget,
  command: ClientCommand,
  fetchImpl: FetchLike = fetch,
): Promise<T> {
  const res = await fetchImpl(commandUrl(target), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(target) },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    throw new CommandError(`Command failed with status ${res.status}`, res.status);
  }
  const body = (await res.json()) as T;
  if (!body.ok) {
    throw new CommandError(body.error ?? "Command reported failure");
  }
  return body;
}

export function sendMessage(
  target: ServerTarget,
  agentId: string,
  message: string,
  fetchImpl?: FetchLike,
): Promise<CommandAck> {
  return sendCommand(target, buildSendMessageCommand(agentId, message), fetchImpl);
}

export function requestAgentTree(
  target: ServerTarget,
  fetchImpl?: FetchLike,
): Promise<AgentTreeResponse> {
  return sendCommand<AgentTreeResponse>(target, buildRequestAgentTreeCommand(), fetchImpl);
}

export function stopAgent(
  target: ServerTarget,
  agentId: string,
  fetchImpl?: FetchLike,
): Promise<CommandAck> {
  return sendCommand(target, buildStopAgentCommand(agentId), fetchImpl);
}

/**
 * Sends `download_logs` and returns the raw `Response` so the caller can stream it into a
 * browser download (see download.ts) — a file payload isn't a `CommandAck`, so this
 * bypasses `sendCommand`'s JSON parsing.
 */
export async function requestLogDownload(
  target: ServerTarget,
  agentId: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  const res = await fetchImpl(commandUrl(target), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(target) },
    body: JSON.stringify(buildDownloadLogsCommand(agentId)),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.clone().json()) as CommandAck;
      detail = body.error ?? "";
    } catch {
      // Not JSON (e.g. plain-text error body) — fall through with the bare status.
    }
    throw new CommandError(
      detail ? `Log download failed: ${detail}` : `Log download failed with status ${res.status}`,
      res.status,
    );
  }
  return res;
}
