// Client -> server command dispatch. Pure builders (easy to unit test) plus a thin
// `sendCommand` wrapper around `fetch` that accepts an injectable fetch implementation so
// tests never touch the network.

import type {
  AgentTreeResponse,
  ClientCommand,
  CommandAck,
  DownloadLogsCommand,
  InvokeSkillCommand,
  ListModelsCommand,
  ListModelsResponse,
  ListSkillsCommand,
  ListSkillsResponse,
  RequestAgentTreeCommand,
  SendMessageCommand,
  StopAgentCommand,
  SwitchModelCommand,
} from "../../contracts/index.ts";
import { commandUrl, type ServerTarget } from "../protocol.ts";

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

// DH-0093: slash-command backend commands (model switching, skill invocation) — see
// src/contracts/commands.ts for the wire shapes (architect-signed, backend round already
// merged). Builders follow the same shape as every command above.
export function buildListModelsCommand(): ListModelsCommand {
  return { type: "list_models" };
}

export function buildSwitchModelCommand(agentId: string, model: string): SwitchModelCommand {
  return { type: "switch_model", agentId, model };
}

export function buildListSkillsCommand(): ListSkillsCommand {
  return { type: "list_skills" };
}

export function buildInvokeSkillCommand(
  agentId: string,
  skill: string,
  args?: string,
): InvokeSkillCommand {
  return args === undefined
    ? { type: "invoke_skill", agentId, skill }
    : { type: "invoke_skill", agentId, skill, args };
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

/** DH-0029 (#37): a hung command send previously left the operator with no feedback at
 *  all — the composer just looked like it did nothing, forever. `sendCommand` now races the
 *  fetch against a timeout and reports a clear "still waiting" `CommandError` instead of
 *  hanging silently. This is a UI-visible timeout, not a network-level cancellation: the
 *  underlying `fetch` isn't aborted (no `AbortSignal` plumbed through the injectable
 *  `fetchImpl`, which test doubles and some environments don't honor), so a very late
 *  response is simply ignored once the timeout has already reported failure. */
export interface SendCommandOptions {
  /** How long to wait before reporting a timeout. Defaults to 15000ms. */
  timeoutMs?: number;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;

/** Sends any `ClientCommand` and parses a JSON `CommandAck`-shaped response. */
export async function sendCommand<T extends CommandAck = CommandAck>(
  target: ServerTarget,
  command: ClientCommand,
  fetchImpl: FetchLike = fetch,
  options: SendCommandOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const setTimeoutFn = options.setTimeoutImpl ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutImpl ?? clearTimeout;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeoutFn(() => {
      reject(
        new CommandError(
          `No response after ${Math.round(timeoutMs / 1000)}s — the server may be unresponsive.`,
        ),
      );
    }, timeoutMs);
  });

  try {
    const res = await Promise.race([
      fetchImpl(commandUrl(target), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(target) },
        body: JSON.stringify(command),
      }),
      timeout,
    ]);
    if (!res.ok) {
      throw new CommandError(`Command failed with status ${res.status}`, res.status);
    }
    const body = (await res.json()) as T;
    if (!body.ok) {
      throw new CommandError(body.error ?? "Command reported failure");
    }
    return body;
  } finally {
    if (timer !== undefined) clearTimeoutFn(timer);
  }
}

export function sendMessage(
  target: ServerTarget,
  agentId: string,
  message: string,
  fetchImpl?: FetchLike,
  options?: SendCommandOptions,
): Promise<CommandAck> {
  return sendCommand(target, buildSendMessageCommand(agentId, message), fetchImpl, options);
}

export function requestAgentTree(
  target: ServerTarget,
  fetchImpl?: FetchLike,
  options?: SendCommandOptions,
): Promise<AgentTreeResponse> {
  return sendCommand<AgentTreeResponse>(target, buildRequestAgentTreeCommand(), fetchImpl, options);
}

export function stopAgent(
  target: ServerTarget,
  agentId: string,
  fetchImpl?: FetchLike,
  options?: SendCommandOptions,
): Promise<CommandAck> {
  return sendCommand(target, buildStopAgentCommand(agentId), fetchImpl, options);
}

export function listModels(
  target: ServerTarget,
  fetchImpl?: FetchLike,
  options?: SendCommandOptions,
): Promise<ListModelsResponse> {
  return sendCommand<ListModelsResponse>(target, buildListModelsCommand(), fetchImpl, options);
}

export function switchModel(
  target: ServerTarget,
  agentId: string,
  model: string,
  fetchImpl?: FetchLike,
  options?: SendCommandOptions,
): Promise<CommandAck> {
  return sendCommand(target, buildSwitchModelCommand(agentId, model), fetchImpl, options);
}

export function listSkills(
  target: ServerTarget,
  fetchImpl?: FetchLike,
  options?: SendCommandOptions,
): Promise<ListSkillsResponse> {
  return sendCommand<ListSkillsResponse>(target, buildListSkillsCommand(), fetchImpl, options);
}

export function invokeSkill(
  target: ServerTarget,
  agentId: string,
  skill: string,
  args?: string,
  fetchImpl?: FetchLike,
  options?: SendCommandOptions,
): Promise<CommandAck> {
  return sendCommand(target, buildInvokeSkillCommand(agentId, skill, args), fetchImpl, options);
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
