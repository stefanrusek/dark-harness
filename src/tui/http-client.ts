// Client -> server command channel: plain HTTP POST (ADR 0002). Endpoint path confirmed
// against the Server domain's actual route (src/server/server.ts, POST /api/commands) —
// see docs/handoffs/tui.md status log.

import type { AgentTreeResponse, ClientCommand, CommandAck } from "../contracts/index.ts";

export interface SendCommandOptions {
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
}

export const COMMAND_PATH = "/api/commands";

/**
 * POST a ClientCommand to the server and return its parsed JSON response. Network/parse
 * failures are surfaced as a rejected promise with a message safe to show the operator
 * (never includes the auth token, since callers only ever pass a bearer header value that
 * this function doesn't log).
 */
export async function sendCommand(
  baseUrl: string,
  command: ClientCommand,
  options: SendCommandOptions = {},
): Promise<CommandAck | AgentTreeResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${COMMAND_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...options.headers },
      body: JSON.stringify(command),
    });
  } catch (err) {
    throw new Error(`request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`server returned a non-JSON response (status ${response.status})`);
  }

  if (!response.ok) {
    const message = isCommandAck(body) && body.error ? body.error : `HTTP ${response.status}`;
    throw new Error(message);
  }

  if (!isCommandAck(body)) {
    throw new Error("server returned an unexpected response shape");
  }
  return body as CommandAck | AgentTreeResponse;
}

function isCommandAck(value: unknown): value is CommandAck {
  return typeof value === "object" && value !== null && "ok" in value;
}
