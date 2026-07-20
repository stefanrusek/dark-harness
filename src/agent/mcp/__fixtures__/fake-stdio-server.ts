// Test-only fixture (DH-0002): a tiny real MCP server speaking stdio JSON-RPC, spawned by
// connection.test.ts / manager.test.ts as a `command`-configured McpServerConfig, so tests
// exercise the real StdioClientTransport wire path rather than mocking it away. Uses the
// MCP SDK's *server* half deliberately — that "never import the server half" constraint
// applies to product code (src/agent/mcp/*), not to a test fixture standing in for someone
// else's real MCP server.
//
// DH-0149: when this file is spawned as its own OS process (the `import.meta.main` branch
// below — how connection.test.ts/manager.test.ts/tools.test.ts actually exercise it, via a
// real `command`-configured spawn), its execution is structurally invisible to bun's
// coverage instrumentation, which only tracks the parent test process's own module graph.
// To close that gap without changing what gets spawned/exercised at runtime,
// fixture-coverage.test.ts imports `createFixtureServer`/`connectStdio` directly and drives
// them in-process (via the MCP SDK's InMemoryTransport, and a throwaway StdioServerTransport
// pointed at fake streams instead of the real process stdio) so every line here executes
// inside a `bun test --coverage` process at least once.
import type { Readable, Writable } from "node:stream";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

export function createFixtureServer(): McpServer {
  const server = new McpServer({ name: "dh-fake-fixture", version: "0.1.0" });

  server.registerTool(
    "echo",
    {
      description: "Echoes back the given text.",
      inputSchema: { text: z.string() },
    },
    async ({ text }) => ({ content: [{ type: "text", text: `echo: ${text}` }] }),
  );

  server.registerTool(
    "fail",
    {
      description: "Always returns an MCP-level tool error.",
      inputSchema: {},
    },
    async () => ({ content: [{ type: "text", text: "boom" }], isError: true }),
  );

  server.registerTool(
    "slow",
    {
      description: "Never responds within any reasonable per-call timeout.",
      inputSchema: {},
    },
    () => new Promise(() => {}),
  );

  return server;
}

// stdin/stdout are injectable so a same-process caller (fixture-coverage.test.ts) can hand
// in fake streams instead of taking over the test process's real stdio. Defaults preserve
// the original behavior when this file is run as a standalone entrypoint.
export async function connectStdio(
  stdin: Readable = process.stdin,
  stdout: Writable = process.stdout,
): Promise<McpServer> {
  const server = createFixtureServer();
  await server.connect(new StdioServerTransport(stdin, stdout));
  return server;
}

// One line so bun's line-coverage instrumentation marks it hit even though the guard
// short-circuits under `bun test` (import.meta.main is false for an imported module) — see
// fixture-coverage.test.ts, which exercises connectStdio() directly. Matches the pattern
// documented in src/web/client/main.ts.
import.meta.main && void connectStdio();
