import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { McpConnection } from "./connection.ts";

const FIXTURE_PATH = fileURLToPath(new URL("./__fixtures__/fake-stdio-server.ts", import.meta.url));

function stdioConnection(timeoutMs?: number): McpConnection {
  return new McpConnection("fixture", {
    command: process.execPath,
    args: ["run", FIXTURE_PATH],
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
}

describe("McpConnection: stdio transport", () => {
  test("connects, lists tools, calls a tool, and closes cleanly", async () => {
    const conn = stdioConnection();
    await conn.connect();
    expect(conn.state).toBe("connected");
    expect(conn.lastError).toBeUndefined();

    const tools = await conn.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["echo", "fail", "slow"]);

    const result = await conn.callTool("echo", { text: "hi" });
    expect(result.content?.[0]?.text).toBe("echo: hi");

    await conn.close();
    expect(conn.state).toBe("closed");
  });

  test("a tool that returns isError: true surfaces that on the raw MCP result", async () => {
    const conn = stdioConnection();
    await conn.connect();
    const result = await conn.callTool("fail", {});
    expect(result.isError).toBe(true);
    await conn.close();
  });

  test("a call that exceeds the per-call timeout marks the connection failed and rethrows", async () => {
    const conn = stdioConnection(200);
    await conn.connect();
    await expect(conn.callTool("slow", {})).rejects.toThrow(/timed out/);
    expect(conn.state).toBe("failed");
    expect(conn.lastError).toMatch(/timed out/);
    await conn.close();
  });

  test("an unreachable command (nonexistent binary) fails to connect, never throws", async () => {
    const conn = new McpConnection("broken", {
      command: "/definitely/does/not/exist/mcp-server",
      args: [],
    });
    await expect(conn.connect()).resolves.toBeUndefined();
    expect(conn.state).toBe("failed");
    expect(conn.lastError).toBeTruthy();
  });

  test("listTools() throws when not connected", async () => {
    const conn = new McpConnection("never-connected", { command: "/nonexistent" });
    await expect(conn.listTools()).rejects.toThrow(/not connected/);
  });

  test("callTool() throws when not connected", async () => {
    const conn = new McpConnection("never-connected", { command: "/nonexistent" });
    await expect(conn.callTool("whatever", {})).rejects.toThrow(/not connected/);
  });

  test("close() before connect() is a harmless no-op", async () => {
    const conn = new McpConnection("idle", { command: "/nonexistent" });
    await conn.close();
    expect(conn.state).toBe("closed");
  });

  test("a config with neither command nor url fails to connect with a clear error", async () => {
    const conn = new McpConnection("misconfigured", {});
    await conn.connect();
    expect(conn.state).toBe("failed");
    expect(conn.lastError).toMatch(/neither "command" nor "url"/);
  });
});

describe("McpConnection: HTTP transport", () => {
  test("an unreachable url fails to connect (Streamable HTTP then SSE fallback, both failing)", async () => {
    const conn = new McpConnection("http-broken", {
      url: "http://127.0.0.1:1/mcp",
      timeoutMs: 500,
    });
    await conn.connect();
    expect(conn.state).toBe("failed");
    expect(conn.lastError).toBeTruthy();
  }, 10_000);

  test("headers are accepted on a url-configured server (still fails to connect, but not for header parsing)", async () => {
    const conn = new McpConnection("http-with-headers", {
      url: "http://127.0.0.1:1/mcp",
      headers: { Authorization: "Bearer x" },
      timeoutMs: 500,
    });
    await conn.connect();
    expect(conn.state).toBe("failed");
  }, 10_000);
});
