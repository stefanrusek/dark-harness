// McpAuth tool (DH-0057) — drives the OAuth 2.1 authorization of a URL-transport MCP server
// end-to-end, fitting dh's no-approval-prompt posture with a two-phase contract:
//
//   status   — reports the server's auth state (informational, never an error).
//   begin    — NON-BLOCKING. For authorization_code, runs discovery/DCR/PKCE, starts a
//              transient loopback receiver, and returns the authorization URL for the operator
//              to open out-of-band. For client_credentials, runs the whole grant inline.
//   complete — BLOCKS up to timeoutMs for the operator's redirect, exchanges the code for
//              tokens, and reconnects the server so its tools become callable.
//
// Default action when omitted: `status` when no flow is in progress, else `complete` (so a
// bare McpAuth({server}) after a begin naturally continues it).
//
// Secrets (client_secret, tokens, code verifier) never appear in this tool's output — it
// reports only action/server/outcome (ADR 0004's never-log-secrets rule).

import {
  McpAuthConfigError,
  McpAuthNoFlowError,
  McpAuthStateMismatchError,
} from "../mcp/manager.ts";
import { LoopbackTimeoutError } from "../mcp/oauth-loopback.ts";
import type { Tool, ToolContext, ToolResult } from "./types.type.ts";
import { validateInput } from "./validate-input.ts";

const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_TIMEOUT_MS = 900_000;

function fmtExpiry(expiresAt: number | undefined): string {
  if (expiresAt === undefined) return "";
  const secs = Math.round((expiresAt - Date.now()) / 1000);
  return secs > 0 ? ` The access token expires in about ${secs}s.` : "";
}

export const mcpAuthTool: Tool = Object.freeze<Tool>({
  name: "McpAuth",
  description:
    "Authenticate a configured OAuth-requiring MCP server. Two-phase for the interactive " +
    'authorization_code grant: action "begin" returns an authorization URL to open in a ' +
    'browser (non-blocking); action "complete" waits for that authorization to finish and ' +
    'exchanges it for tokens. Action "status" reports the current auth state. The ' +
    "client_credentials grant completes in a single begin call with no URL.",
  inputSchema: {
    type: "object",
    properties: {
      server: { type: "string", description: "The mcpServers config key to authenticate." },
      action: {
        type: "string",
        enum: ["status", "begin", "complete"],
        description: 'Optional. Defaults to "status" when no flow is in progress, else "complete".',
      },
      timeoutMs: {
        type: "integer",
        description:
          '"complete" only: how long to wait for the operator to authorize. Default 300000, capped 900000.',
      },
    },
    required: ["server"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const validation = validateInput(mcpAuthTool.inputSchema, "McpAuth", input);
    if (!validation.ok) return validation.result;
    const server = input.server as string;
    const explicitAction = input.action as "status" | "begin" | "complete" | undefined;

    // Default action: `complete` if a flow is pending, else `status`.
    const status = ctx.mcpAuth.status(server);
    const action = explicitAction ?? (status.state === "pending" ? "complete" : "status");

    try {
      if (action === "status") {
        return { output: describeStatus(server, status), isError: false };
      }
      if (action === "begin") {
        const result = await ctx.mcpAuth.begin(server);
        if (result.grant === "client_credentials") {
          return {
            output: `Authenticated MCP server "${server}" via the client_credentials grant.${fmtExpiry(result.expiresAt)} Its tools are now available.`,
            isError: false,
          };
        }
        if (result.alreadyAuthenticated) {
          return {
            output: `MCP server "${server}" is already authenticated (existing tokens were still valid).${fmtExpiry(result.expiresAt)}`,
            isError: false,
          };
        }
        return {
          output:
            `To authorize MCP server "${server}", open this URL in a browser and approve access:\n` +
            `  ${result.authorizationUrl}\n` +
            `Then call McpAuth with { "server": "${server}", "action": "complete" } to finish.\n` +
            `The loopback callback is listening at ${result.redirectUri}.`,
          isError: false,
        };
      }
      // action === "complete"
      const timeoutMs = Math.min(
        typeof input.timeoutMs === "number" ? input.timeoutMs : DEFAULT_TIMEOUT_MS,
        MAX_TIMEOUT_MS,
      );
      const result = await ctx.mcpAuth.complete(server, timeoutMs);
      return {
        output: `Authorization complete for MCP server "${server}". Tokens were stored and the server reconnected; its tools are now available.${fmtExpiry(result.expiresAt)}`,
        isError: false,
      };
    } catch (err) {
      if (err instanceof LoopbackTimeoutError) {
        // Actionable pending state, NOT a harness failure (ADR: everything allowed).
        return {
          output:
            `Still waiting — the authorization URL for MCP server "${server}" has not been visited yet. ` +
            `Open it in a browser and call McpAuth with { "server": "${server}", "action": "complete" } again.`,
          isError: false,
        };
      }
      if (err instanceof McpAuthNoFlowError || err instanceof McpAuthConfigError) {
        return { output: (err as Error).message, isError: false };
      }
      if (err instanceof McpAuthStateMismatchError) {
        return { output: (err as Error).message, isError: true };
      }
      return {
        output: `McpAuth ${action} for server "${server}" failed: ${(err as Error).message}`,
        isError: true,
      };
    }
  },
});

function describeStatus(
  server: string,
  status: ReturnType<ToolContext["mcpAuth"]["status"]>,
): string {
  switch (status.state) {
    case "unknown":
      return `Unknown MCP server "${server}" — it is not in the mcpServers config.`;
    case "not-configured":
      return `MCP server "${server}" has no "auth" block; no authentication is required or possible.`;
    case "authenticated":
      return `MCP server "${server}" is authenticated.${fmtExpiry(status.expiresAt)}`;
    case "pending":
      return (
        `MCP server "${server}" has an authorization in progress. ` +
        (status.authorizationUrl
          ? `Open this URL to approve, then call McpAuth complete:\n  ${status.authorizationUrl}`
          : `Call McpAuth complete once the operator has approved.`)
      );
    case "needs-auth":
      return `MCP server "${server}" needs authorization. Call McpAuth with { "server": "${server}", "action": "begin" }.`;
  }
}
