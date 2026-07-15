import { describe, expect, test } from "bun:test";
import type {
  AgentOutputEvent,
  AgentSpawnedEvent,
  AgentTreeResponse,
  ClientCommand,
  CommandAck,
} from "../contracts/index.ts";
import { startTui } from "./app.ts";
import type { StdinLike, StdoutLike } from "./app.ts";
import { COMMAND_PATH } from "./http-client.ts";
import { EVENTS_PATH } from "./sse-client.ts";

function sseFrame(event: AgentSpawnedEvent | AgentOutputEvent): string {
  return `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
}

class FakeStdin implements StdinLike {
  private listeners: Array<(chunk: string) => void> = [];
  rawMode: boolean | null = null;
  paused = true;
  encoding: string | null = null;

  on(_event: "data", listener: (chunk: string) => void): this {
    this.listeners.push(listener);
    return this;
  }

  setEncoding(encoding: BufferEncoding): this {
    this.encoding = encoding;
    return this;
  }

  setRawMode(mode: boolean): this {
    this.rawMode = mode;
    return this;
  }

  resume(): this {
    this.paused = false;
    return this;
  }

  pause(): this {
    this.paused = true;
    return this;
  }

  removeAllListeners(): this {
    this.listeners = [];
    return this;
  }

  type(chunk: string): void {
    for (const listener of this.listeners) listener(chunk);
  }
}

class FakeStdout implements StdoutLike {
  writes: string[] = [];
  columns = 80;
  rows = 24;
  private resizeListeners: Array<() => void> = [];

  write(data: string): boolean {
    this.writes.push(data);
    return true;
  }

  on(_event: "resize", listener: () => void): this {
    this.resizeListeners.push(listener);
    return this;
  }

  removeAllListeners(): this {
    this.resizeListeners = [];
    return this;
  }

  triggerResize(rows: number, cols: number): void {
    this.rows = rows;
    this.columns = cols;
    for (const listener of this.resizeListeners) listener();
  }

  lastWrite(): string {
    return this.writes[this.writes.length - 1] ?? "";
  }

  allWrites(): string {
    return this.writes.join("");
  }
}

interface FakeServer {
  commands: ClientCommand[];
  commandResponses: Array<CommandAck | AgentTreeResponse>;
  nextCommandThrows: boolean;
  fetchImpl: typeof fetch;
  sseController: ReadableStreamDefaultController<Uint8Array> | null;
}

function makeFakeServer(): FakeServer {
  const server: FakeServer = {
    commands: [],
    commandResponses: [],
    nextCommandThrows: false,
    sseController: null,
    fetchImpl: undefined as unknown as typeof fetch,
  };

  server.fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target.endsWith(COMMAND_PATH)) {
      if (server.nextCommandThrows) {
        throw new Error("network down");
      }
      const command = JSON.parse(String(init?.body)) as ClientCommand;
      server.commands.push(command);
      const canned = server.commandResponses.shift();
      const body: CommandAck | AgentTreeResponse = canned ?? { ok: true };
      return new Response(JSON.stringify(body), {
        status: "ok" in body && body.ok === false ? 400 : 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (target.endsWith(EVENTS_PATH)) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          server.sseController = controller;
          const signal = init?.signal;
          if (signal) {
            if (signal.aborted) {
              controller.close();
              return;
            }
            signal.addEventListener("abort", () => {
              try {
                controller.close();
              } catch {
                // already closed
              }
            });
          }
        },
      });
      void encoder; // used by tests via server.sseController.enqueue with their own encoder
      return new Response(stream, { status: 200 });
    }
    throw new Error(`unexpected fetch to ${target}`);
  }) as unknown as typeof fetch;

  return server;
}

async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function enqueueSse(server: FakeServer, event: AgentSpawnedEvent | AgentOutputEvent): void {
  const encoder = new TextEncoder();
  server.sseController?.enqueue(encoder.encode(sseFrame(event)));
}

const ALT_SCREEN_ENTER = "\x1b[?1049h";
const ALT_SCREEN_EXIT = "\x1b[?1049l";

describe("startTui", () => {
  test("enters the alt screen and hides the cursor on start", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();

    const done = startTui("http://x", { stdin, stdout, fetchImpl: server.fetchImpl });
    await flush();
    expect(stdout.writes[0]).toContain(ALT_SCREEN_ENTER);
    expect(stdin.rawMode).toBe(true);

    stdin.type("\x03");
    await done;
  });

  test("renders root agent output once a spawn + output event arrive over SSE", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();

    const done = startTui("http://x", { stdin, stdout, fetchImpl: server.fetchImpl });
    await flush();

    enqueueSse(server, {
      version: 1,
      id: "1",
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "agent_spawned",
      agentId: "root",
      parentAgentId: null,
      model: "sonnet",
    });
    enqueueSse(server, {
      version: 1,
      id: "2",
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "agent_output",
      agentId: "root",
      chunk: "hello from the agent",
    });
    await flush();

    expect(stdout.allWrites()).toContain("hello from the agent");

    stdin.type("\x03");
    await done;
  });

  test("typing and pressing enter sends a send_message command for the root agent", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();

    const done = startTui("http://x", { stdin, stdout, fetchImpl: server.fetchImpl });
    await flush();
    enqueueSse(server, {
      version: 1,
      id: "1",
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "agent_spawned",
      agentId: "root",
      parentAgentId: null,
      model: "sonnet",
    });
    await flush();

    stdin.type("hi");
    stdin.type("\r");
    await flush();

    expect(server.commands).toContainEqual({
      type: "send_message",
      agentId: "root",
      message: "hi",
    });

    stdin.type("\x03");
    await done;
  });

  test("left-arrow on empty input requests and renders the agent tree", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();
    server.commandResponses.push({
      ok: true,
      tree: [
        { agentId: "root", parentAgentId: null, model: "sonnet", status: "running", children: [] },
      ],
    });

    const done = startTui("http://x", { stdin, stdout, fetchImpl: server.fetchImpl });
    await flush();

    stdin.type("\x1b[D");
    await flush();

    expect(server.commands).toContainEqual({ type: "request_agent_tree" });
    expect(stdout.allWrites()).toContain("root (sonnet)");

    stdin.type("\x03");
    await done;
  });

  test("a command_error response updates the on-screen status message", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();
    server.commandResponses.push({ ok: false, error: "agent not found" });

    const done = startTui("http://x", { stdin, stdout, fetchImpl: server.fetchImpl });
    await flush();

    stdin.type("\x1b[D");
    await flush();

    expect(stdout.allWrites()).toContain("agent not found");

    stdin.type("\x03");
    await done;
  });

  test("a 200 response whose body reports ok:false surfaces its error message", async () => {
    // Distinct from the HTTP-error case above: here the transport succeeds (status 200) but
    // the command itself failed at the application level, per the CommandAck.ok field.
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).endsWith(COMMAND_PATH)) {
        return new Response(
          JSON.stringify({ ok: false, error: "agent busy" } satisfies CommandAck),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 });
    }) as unknown as typeof fetch;

    const done = startTui("http://x", { stdin, stdout, fetchImpl });
    await flush();

    stdin.type("\x1b[D");
    await flush();

    expect(stdout.allWrites()).toContain("agent busy");

    stdin.type("\x03");
    await done;
  });

  test("a network failure while sending a command surfaces its error message", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();
    server.nextCommandThrows = true;

    const done = startTui("http://x", { stdin, stdout, fetchImpl: server.fetchImpl });
    await flush();

    stdin.type("\x1b[D");
    await flush();

    expect(stdout.allWrites()).toContain("network down");

    stdin.type("\x03");
    await done;
  });

  test("resize events trigger a re-render at the new size", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();

    const done = startTui("http://x", { stdin, stdout, fetchImpl: server.fetchImpl });
    await flush();
    const writesBefore = stdout.writes.length;

    stdout.triggerResize(40, 120);
    await flush();

    expect(stdout.writes.length).toBeGreaterThan(writesBefore);

    stdin.type("\x03");
    await done;
  });

  test("ctrl-c exits the alt screen, shows the cursor, and stops listening", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();

    const done = startTui("http://x", { stdin, stdout, fetchImpl: server.fetchImpl });
    await flush();

    stdin.type("\x03");
    await done;

    expect(stdout.allWrites()).toContain(ALT_SCREEN_EXIT);
    expect(stdin.rawMode).toBe(false);
    expect(stdin.paused).toBe(true);
  });

  test("navigating into the tree, selecting an agent, and going back works end to end", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();
    server.commandResponses.push({
      ok: true,
      tree: [
        { agentId: "root", parentAgentId: null, model: "sonnet", status: "running", children: [] },
        { agentId: "child", parentAgentId: "root", model: "haiku", status: "done", children: [] },
      ],
    });

    const done = startTui("http://x", { stdin, stdout, fetchImpl: server.fetchImpl });
    await flush();
    enqueueSse(server, {
      version: 1,
      id: "1",
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "agent_output",
      agentId: "child",
      chunk: "child says hi",
    });
    await flush();

    stdin.type("\x1b[D"); // left: open tree
    await flush();
    stdin.type("\x1b[B"); // down: select "child"
    stdin.type("\r"); // enter: open its read-only view
    await flush();

    expect(stdout.allWrites()).toContain("child says hi");
    expect(stdout.allWrites()).toContain("read-only");

    stdin.type("\x1b"); // escape: back to root
    await flush();
    expect(stdout.lastWrite()).toContain("Root Agent");

    stdin.type("\x03");
    await done;
  });
});
