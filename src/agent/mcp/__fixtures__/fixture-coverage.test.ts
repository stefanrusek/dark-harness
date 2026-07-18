// DH-0149: closes a pre-existing coverage-completeness gap. fake-stdio-server.ts and
// fake-stdio-server-discovery-fails.ts are real MCP servers that connection.test.ts,
// manager.test.ts, and tools.test.ts spawn as their own OS process (a
// `command`-configured McpServerConfig, exercising the real StdioClientTransport wire
// path) — that spawn already runs every line in both fixtures for real, but as a
// separate process it's structurally invisible to bun's coverage instrumentation, which
// only tracks modules loaded within the current test process's own module graph.
//
// Rather than adding more integration tests (the functional behavior is already covered
// by the tests above), this file imports the fixtures' exported factories directly and
// drives them in-process:
//   - `createFixtureServer()` + the MCP SDK's `InMemoryTransport` + a real `Client` to
//     actually call the registered tools (covering the tool-handler bodies, including the
//     discovery-fail fixture's `throw`).
//   - `connectStdio()` with fake `PassThrough` streams instead of real process stdio, to
//     cover the `StdioServerTransport` construction/connect line without touching this
//     test process's actual stdin/stdout.
import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as goodFixture from "./fake-stdio-server.ts";
import * as discoveryFailFixture from "./fake-stdio-server-discovery-fails.ts";

describe("MCP stdio fixtures (DH-0149 coverage closure)", () => {
  test("fake-stdio-server.ts: registered tools behave as expected when driven in-process", async () => {
    const server = goodFixture.createFixtureServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "dh-fixture-coverage-client", version: "0.1.0" });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["echo", "fail", "slow"]);

    const echoResult = await client.callTool({ name: "echo", arguments: { text: "hi" } });
    expect((echoResult.content as Array<{ text?: string }>)[0]?.text).toBe("echo: hi");

    const failResult = await client.callTool({ name: "fail", arguments: {} });
    expect(failResult.isError).toBe(true);

    await client.close();
    await server.close();
  });

  test("fake-stdio-server.ts: connectStdio() wires a real StdioServerTransport", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    // Drain stdout so it never backpressures/blocks.
    stdout.resume();

    const server = await goodFixture.connectStdio(stdin, stdout);

    await server.close();
    stdin.end();
    stdout.end();
  });

  test("fake-stdio-server-discovery-fails.ts: tools/list throws as designed", async () => {
    const server = discoveryFailFixture.createFixtureServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "dh-fixture-coverage-client", version: "0.1.0" });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    await expect(client.listTools()).rejects.toThrow(/discovery deliberately broken/);

    await client.close();
    await server.close();
  });

  test("fake-stdio-server-discovery-fails.ts: connectStdio() wires a real StdioServerTransport", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdout.resume();

    const server = await discoveryFailFixture.connectStdio(stdin, stdout);

    await server.close();
    stdin.end();
    stdout.end();
  });
});
