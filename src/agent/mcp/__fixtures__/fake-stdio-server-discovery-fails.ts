// Test-only fixture (DH-0002): a real MCP server whose handshake succeeds but whose
// `tools/list` handler always throws — exercises McpManager's "connected but discovery
// failed" branch (manager.ts's connectAndCache catch path) without needing to race a real
// server's shutdown timing.
//
// DH-0149: see fake-stdio-server.ts's header comment — this file is normally spawned as its
// own OS process (invisible to bun's coverage instrumentation), so fixture-coverage.test.ts
// imports `createFixtureServer`/`connectStdio` directly and drives them in-process to make
// every line here coverage-visible.
import type { Readable, Writable } from "node:stream";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export function createFixtureServer(): Server {
  const server = new Server(
    { name: "dh-fake-discovery-fail", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    throw new Error("discovery deliberately broken for test");
  });

  return server;
}

export async function connectStdio(
  stdin: Readable = process.stdin,
  stdout: Writable = process.stdout,
): Promise<Server> {
  const server = createFixtureServer();
  await server.connect(new StdioServerTransport(stdin, stdout));
  return server;
}

// One line so bun's line-coverage instrumentation marks it hit even though the guard
// short-circuits under `bun test` (import.meta.main is false for an imported module) — see
// fixture-coverage.test.ts, which exercises connectStdio() directly. Matches the pattern
// documented in src/web/client/main.ts.
import.meta.main && void connectStdio();
