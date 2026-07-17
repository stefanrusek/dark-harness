import { describe, expect, test } from "bun:test";
import type {
  AgentTreeResponse,
  ClientCommand,
  CommandAck,
  ListModelsResponse,
  ListSkillsResponse,
  ServerSentEvent,
} from "../contracts/index.ts";
import { startTui } from "./app.ts";
import type { StdinLike, StdoutLike } from "./app.ts";
import { COMMAND_PATH } from "./http-client.ts";
import { EVENTS_PATH } from "./sse-client.ts";

function sseFrame(event: ServerSentEvent): string {
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

  off(): this {
    return this;
  }

  removeListener(): this {
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

  off(_event: "resize", listener: () => void): this {
    this.resizeListeners = this.resizeListeners.filter((l) => l !== listener);
    return this;
  }

  removeListener(_event: "resize", listener: () => void): this {
    return this.off(_event, listener);
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
  commandResponses: Array<CommandAck | AgentTreeResponse | ListModelsResponse | ListSkillsResponse>;
  nextCommandThrows: boolean;
  fetchImpl: typeof fetch;
  sseController: ReadableStreamDefaultController<Uint8Array> | null;
  commandHeaders: Headers[];
  sseHeaders: Headers[];
}

function makeFakeServer(): FakeServer {
  const server: FakeServer = {
    commands: [],
    commandResponses: [],
    nextCommandThrows: false,
    sseController: null,
    fetchImpl: undefined as unknown as typeof fetch,
    commandHeaders: [],
    sseHeaders: [],
  };

  server.fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target.endsWith(COMMAND_PATH)) {
      server.commandHeaders.push(new Headers(init?.headers));
      if (server.nextCommandThrows) {
        throw new Error("network down");
      }
      const command = JSON.parse(String(init?.body)) as ClientCommand;
      server.commands.push(command);
      const canned = server.commandResponses.shift();
      const body: CommandAck | AgentTreeResponse | ListModelsResponse | ListSkillsResponse =
        canned ?? { ok: true };
      return new Response(JSON.stringify(body), {
        status: "ok" in body && body.ok === false ? 400 : 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (target.endsWith(EVENTS_PATH)) {
      server.sseHeaders.push(new Headers(init?.headers));
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

async function flush(times = 5, stdout?: FakeStdout): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  // DH-0044: app.ts coalesces redraws to at most one every FRAME_INTERVAL_MS (33ms) via a
  // real setTimeout, so a flush must wait out that window for a pending redraw to actually
  // land — otherwise assertions on stdout writes can race a still-pending coalesced frame.
  // DH-0136: Ink's own `render()` adds a second, independent throttle on top of that (its
  // internal write scheduling isn't synchronous with `rerender()`), so this window needs
  // enough headroom to clear both layers, not just app.ts's own one — 40ms (barely over the
  // first layer alone) was intermittently too tight and made this a flaky test once Ink
  // owned the actual write.
  await new Promise((resolve) => setTimeout(resolve, 100));

  // DH-0146: on a slower/differently-scheduled CI runner, 100ms is not always enough for
  // Ink's underlying render (yoga-layout WASM init, node graph resolution) to land at all —
  // stdout.writes can still be sitting at just the startup preamble. When a stdout is
  // provided, poll until writes stop growing (render has caught up and stabilized) instead
  // of trusting a single fixed sleep, up to a generous ceiling so a genuinely broken render
  // still fails fast rather than hanging.
  if (stdout) {
    let lastLength = stdout.writes.length;
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (stdout.writes.length === lastLength) break;
      lastLength = stdout.writes.length;
    }
  }
}

function enqueueSse(server: FakeServer, event: ServerSentEvent): void {
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

    const done = startTui("http://x", undefined, {
      io: { stdin, stdout, fetchImpl: server.fetchImpl },
    });
    await flush(5, stdout);
    expect(stdout.writes[0]).toContain(ALT_SCREEN_ENTER);
    expect(stdin.rawMode).toBe(true);

    stdin.type("\x03");
    await done;
  });

  test("renders root agent output once a spawn + output event arrive over SSE", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();

    const done = startTui("http://x", undefined, {
      io: { stdin, stdout, fetchImpl: server.fetchImpl },
    });
    await flush(5, stdout);

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
    await flush(5, stdout);

    expect(stdout.allWrites()).toContain("hello from the agent");

    stdin.type("\x03");
    await done;
  });

  test("typing and pressing enter sends a send_message command for the root agent", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();

    const done = startTui("http://x", undefined, {
      io: { stdin, stdout, fetchImpl: server.fetchImpl },
    });
    await flush(5, stdout);
    enqueueSse(server, {
      version: 1,
      id: "1",
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "agent_spawned",
      agentId: "root",
      parentAgentId: null,
      model: "sonnet",
    });
    await flush(5, stdout);

    stdin.type("hi");
    stdin.type("\r");
    await flush(5, stdout);

    expect(server.commands).toContainEqual({
      type: "send_message",
      agentId: "root",
      message: "hi",
    });

    stdin.type("\x03");
    await done;
  });

  test("DH-0126: enables SGR mouse reporting on startup and disables it on quit", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();

    const done = startTui("http://x", undefined, {
      io: { stdin, stdout, fetchImpl: server.fetchImpl },
    });
    await flush(5, stdout);

    expect(stdout.allWrites()).toContain("\x1b[?1000h\x1b[?1002h\x1b[?1006h");

    stdin.type("\x03");
    await done;

    expect(stdout.allWrites()).toContain("\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1015l");
  });

  test("DH-0126: a raw SGR mouse-wheel report does not leak into the composer as garbage keystrokes", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();

    const done = startTui("http://x", undefined, {
      io: { stdin, stdout, fetchImpl: server.fetchImpl },
    });
    await flush(5, stdout);
    enqueueSse(server, {
      version: 1,
      id: "1",
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "agent_spawned",
      agentId: "root",
      parentAgentId: null,
      model: "sonnet",
    });
    await flush(5, stdout);

    // A scroll-up wheel report (SGR 1006), the exact sequence a real terminal sends. Before
    // DH-0126's fix, `parseKeys` couldn't recognize the `[<...M` introducer and leaked its
    // digits into the composer as literal keystrokes.
    stdin.type("\x1b[<64;10;5M");
    stdin.type("\x1b[<65;10;5M");
    stdin.type("hi");
    stdin.type("\r");
    await flush(5, stdout);

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

    const done = startTui("http://x", undefined, {
      io: { stdin, stdout, fetchImpl: server.fetchImpl },
    });
    await flush(5, stdout);

    stdin.type("\x1b[D");
    await flush(5, stdout);

    expect(server.commands).toContainEqual({ type: "request_agent_tree" });
    expect(stdout.allWrites()).toContain("root (sonnet)");

    stdin.type("\x03");
    await done;
  });

  test("a configured token is sent as an Authorization: Bearer header on every request", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();
    server.commandResponses.push({
      ok: true,
      tree: [
        { agentId: "root", parentAgentId: null, model: "sonnet", status: "running", children: [] },
      ],
    });

    const done = startTui("http://x", "s3cret", {
      io: { stdin, stdout, fetchImpl: server.fetchImpl },
    });
    await flush(5, stdout);

    // The SSE connection and the two automatic startup commands (Round 3's request_agent_tree
    // deadlock fix, plus DH-0093's list_skills bootstrap) all fire as soon as the TUI starts —
    // all must carry the header.
    expect(server.sseHeaders).toHaveLength(1);
    expect(server.sseHeaders[0]?.get("Authorization")).toBe("Bearer s3cret");
    expect(server.commandHeaders).toHaveLength(2);
    expect(server.commandHeaders[0]?.get("Authorization")).toBe("Bearer s3cret");
    expect(server.commandHeaders[1]?.get("Authorization")).toBe("Bearer s3cret");

    // A later, operator-triggered command (left-arrow -> another request_agent_tree)
    // carries it too, not just the startup ones.
    stdin.type("\x1b[D");
    await flush(5, stdout);
    expect(server.commandHeaders).toHaveLength(3);
    expect(server.commandHeaders[2]?.get("Authorization")).toBe("Bearer s3cret");

    stdin.type("\x03");
    await done;
  });

  test("omits the Authorization header entirely when no token is configured", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();
    server.commandResponses.push({ ok: true, tree: [] });

    const done = startTui("http://x", undefined, {
      io: { stdin, stdout, fetchImpl: server.fetchImpl },
    });
    await flush(5, stdout);
    // Index 0/1 are the two automatic startup commands (request_agent_tree, list_skills).
    expect(server.sseHeaders[0]?.has("Authorization")).toBe(false);
    expect(server.commandHeaders[0]?.has("Authorization")).toBe(false);
    expect(server.commandHeaders[1]?.has("Authorization")).toBe(false);

    stdin.type("\x1b[D");
    await flush(5, stdout);
    expect(server.commandHeaders[2]?.has("Authorization")).toBe(false);

    stdin.type("\x03");
    await done;
  });

  test("fires request_agent_tree automatically on startup", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();

    const done = startTui("http://x", undefined, {
      io: { stdin, stdout, fetchImpl: server.fetchImpl },
    });
    await flush(5, stdout);

    expect(server.commands).toContainEqual({ type: "request_agent_tree" });

    stdin.type("\x03");
    await done;
  });

  test("Round 3: a fresh session can send its first message through the UI, seeded purely by " +
    "the startup tree fetch — no agent_spawned event ever arrives", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();
    server.commandResponses.push({
      ok: true,
      tree: [
        {
          agentId: "agent-root",
          parentAgentId: null,
          model: "sonnet",
          status: "waiting",
          children: [],
        },
      ],
    });

    const done = startTui("http://x", undefined, {
      io: { stdin, stdout, fetchImpl: server.fetchImpl },
    });
    await flush(5, stdout);

    // Deliberately no enqueueSse(...) call here — this is the whole point of the
    // regression test. Before Round 3's fix, this would sit forever on
    // "No root agent yet — please wait." since agent_spawned never fires until a first
    // message is sent, and a first message could never be sent.
    stdin.type("hello");
    stdin.type("\r");
    await flush(5, stdout);

    expect(server.commands).toContainEqual({
      type: "send_message",
      agentId: "agent-root",
      message: "hello",
    });
    expect(stdout.allWrites()).not.toContain("please wait");

    stdin.type("\x03");
    await done;
  });

  test("a command_error response updates the on-screen status message", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();
    server.commandResponses.push({ ok: false, error: "agent not found" });

    const done = startTui("http://x", undefined, {
      io: { stdin, stdout, fetchImpl: server.fetchImpl },
    });
    await flush(5, stdout);

    stdin.type("\x1b[D");
    await flush(5, stdout);

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

    const done = startTui("http://x", undefined, { io: { stdin, stdout, fetchImpl } });
    await flush(5, stdout);

    stdin.type("\x1b[D");
    await flush(5, stdout);

    expect(stdout.allWrites()).toContain("agent busy");

    stdin.type("\x03");
    await done;
  });

  test("a network failure while sending a command surfaces its error message", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();
    server.nextCommandThrows = true;

    const done = startTui("http://x", undefined, {
      io: { stdin, stdout, fetchImpl: server.fetchImpl },
    });
    await flush(5, stdout);

    stdin.type("\x1b[D");
    await flush(5, stdout);

    expect(stdout.allWrites()).toContain("network down");

    stdin.type("\x03");
    await done;
  });

  test("resize events trigger a re-render at the new size", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();

    const done = startTui("http://x", undefined, {
      io: { stdin, stdout, fetchImpl: server.fetchImpl },
    });
    await flush(5, stdout);
    const writesBefore = stdout.writes.length;

    stdout.triggerResize(40, 120);
    // DH-0025: resize events are debounced (RESIZE_DEBOUNCE_MS), so the redraw doesn't fire
    // on the same tick as the event — wait past the debounce window with real timers.
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(stdout.writes.length).toBeGreaterThan(writesBefore);

    stdin.type("\x03");
    await done;
  });

  test("a periodic tick redraws the frame on its own, advancing the liveness indicator", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();
    server.commandResponses.push({
      ok: true,
      tree: [
        { agentId: "root", parentAgentId: null, model: "sonnet", status: "running", children: [] },
      ],
    });

    const done = startTui("http://x", undefined, {
      io: { stdin, stdout, fetchImpl: server.fetchImpl },
    });
    await flush(5, stdout);

    // DH-0028/DH-0025: the tick only redraws when the rendered frame actually changes
    // (otherwise it's skipped, per DH-0025's "don't full-clear-and-rewrite when nothing
    // changed"). The root view's own content doesn't depend on `now`, so spawn an agent and
    // switch to the tree view, whose per-entry "last event" elapsed label does advance every
    // real second — that's what the liveness tick is meant to keep current.
    enqueueSse(server, {
      version: 1,
      id: "1",
      timestamp: new Date().toISOString(),
      type: "agent_spawned",
      agentId: "root",
      parentAgentId: null,
      model: "sonnet",
    });
    await flush(5, stdout);
    stdin.type("\x1b[D"); // left: open tree view
    await flush(5, stdout);
    const writesBefore = stdout.writes.length;

    // No key was pressed and no further SSE event arrived — any further redraw must come
    // from the app's own periodic tick timer, not from an externally triggered dispatch.
    await new Promise((resolve) => setTimeout(resolve, 2100));

    expect(stdout.writes.length).toBeGreaterThan(writesBefore);

    stdin.type("\x03");
    await done;
  });

  test("ctrl-c exits the alt screen, shows the cursor, and stops listening", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();

    const done = startTui("http://x", undefined, {
      io: { stdin, stdout, fetchImpl: server.fetchImpl },
    });
    await flush(5, stdout);

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

    const done = startTui("http://x", undefined, {
      io: { stdin, stdout, fetchImpl: server.fetchImpl },
    });
    await flush(5, stdout);
    enqueueSse(server, {
      version: 1,
      id: "1",
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "agent_output",
      agentId: "child",
      chunk: "child says hi",
    });
    await flush(5, stdout);

    stdin.type("\x1b[D"); // left: open tree
    await flush(5, stdout);
    stdin.type("\x1b[B"); // down: select "child"
    stdin.type("\r"); // enter: open its read-only view
    await flush(5, stdout);

    expect(stdout.allWrites()).toContain("child says hi");
    expect(stdout.allWrites()).toContain("read-only");

    stdin.type("\x1b"); // escape: back to root
    await flush(5, stdout);
    expect(stdout.lastWrite()).toContain("Root Agent");

    stdin.type("\x03");
    await done;
  });
});

describe("DH-0059: startTui ownsServer Ctrl+C shutdown handshake", () => {
  test("ownsServer: false keeps today's detach-only behavior — no stop_agent sent", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();

    const done = startTui("http://x", undefined, {
      ownsServer: false,
      io: { stdin, stdout, fetchImpl: server.fetchImpl },
    });
    await flush(5, stdout);
    enqueueSse(server, {
      version: 1,
      id: "1",
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "agent_spawned",
      agentId: "agent-root",
      parentAgentId: null,
      model: "sonnet",
    });
    await flush(5, stdout);

    stdin.type("\x03");
    await done;

    expect(server.commands).not.toContainEqual({ type: "stop_agent", agentId: "agent-root" });
  });

  test("ownsServer: true with a root that was never active quits immediately, no stop_agent", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();

    const done = startTui("http://x", undefined, {
      ownsServer: true,
      io: { stdin, stdout, fetchImpl: server.fetchImpl },
    });
    await flush(5, stdout);

    stdin.type("\x03");
    await done;

    expect(server.commands).not.toContainEqual({ type: "stop_agent", agentId: "agent-root" });
  });

  test("ownsServer: true with an active root sends stop_agent, shows a stopping hint, then quits on session_ended", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();

    const done = startTui("http://x", undefined, {
      ownsServer: true,
      io: { stdin, stdout, fetchImpl: server.fetchImpl },
    });
    await flush(5, stdout);
    enqueueSse(server, {
      version: 1,
      id: "1",
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "agent_spawned",
      agentId: "agent-root",
      parentAgentId: null,
      model: "sonnet",
    });
    await flush(5, stdout);

    stdin.type("\x03");
    await flush(5, stdout);

    expect(server.commands).toContainEqual({ type: "stop_agent", agentId: "agent-root" });
    expect(stdout.allWrites()).toContain("stopping session");

    enqueueSse(server, {
      version: 1,
      id: "2",
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "session_ended",
      exitCode: 0,
    });
    await done;

    expect(stdout.allWrites()).toContain("session ended (exit 0)");
    expect(stdout.allWrites()).toContain(ALT_SCREEN_EXIT);
  });

  test("a second ctrl_c after shutdown was requested force-quits without waiting for session_ended", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();

    const done = startTui("http://x", undefined, {
      ownsServer: true,
      io: { stdin, stdout, fetchImpl: server.fetchImpl },
    });
    await flush(5, stdout);
    enqueueSse(server, {
      version: 1,
      id: "1",
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "agent_spawned",
      agentId: "agent-root",
      parentAgentId: null,
      model: "sonnet",
    });
    await flush(5, stdout);

    stdin.type("\x03");
    await flush(5, stdout);
    stdin.type("\x03");

    await done;
    expect(stdout.allWrites()).toContain(ALT_SCREEN_EXIT);
  });
});

describe("startTui: DH-0093 slash-command wiring", () => {
  test("fetches list_skills automatically on startup, alongside request_agent_tree", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();

    const done = startTui("http://x", undefined, {
      io: { stdin, stdout, fetchImpl: server.fetchImpl },
    });
    await flush(5, stdout);

    expect(server.commands).toContainEqual({ type: "request_agent_tree" });
    expect(server.commands).toContainEqual({ type: "list_skills" });

    stdin.type("\x03");
    await done;
  });

  test("/model opens the picker once list_models responds", async () => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const server = makeFakeServer();
    server.commandResponses.push({
      ok: true,
      tree: [
        { agentId: "root", parentAgentId: null, model: "sonnet", status: "running", children: [] },
      ],
    });

    const done = startTui("http://x", undefined, {
      io: { stdin, stdout, fetchImpl: server.fetchImpl },
    });
    await flush(5, stdout);

    server.commandResponses.push({
      ok: true,
      models: [
        {
          name: "sonnet",
          provider: "anthropic",
          model: "claude-sonnet",
          isDefault: true,
          isActive: true,
        },
        {
          name: "haiku",
          provider: "anthropic",
          model: "claude-haiku",
          isDefault: false,
          isActive: false,
        },
      ],
    });
    stdin.type("/model");
    stdin.type("\r");
    await flush(5, stdout);

    expect(server.commands).toContainEqual({ type: "list_models" });
    expect(stdout.allWrites()).toContain("Select Model");
    expect(stdout.allWrites()).toContain("haiku");

    stdin.type("\x03");
    await done;
  });
});
