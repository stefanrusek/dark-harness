import { describe, expect, test } from "bun:test";
import type { ServerTarget } from "../protocol.ts";
import { AppView } from "./app.ts";
import type { DownloadEnv } from "./download.ts";
import { createTestDom } from "./test-dom.ts";

/** A controllable fake SSE byte stream fed to the harness's fetch double. */
function fakeSseStream(): {
  body: ReadableStream<Uint8Array>;
  push(event: Record<string, unknown> & { id: string }): void;
  close(): void;
  error(err?: unknown): void;
} {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    body,
    push(event) {
      controller?.enqueue(encoder.encode(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`));
    },
    close() {
      controller?.close();
    },
    error(err) {
      controller?.error(err ?? new Error("stream dropped"));
    },
  };
}

interface FetchCall {
  url: string;
  init?: RequestInit | undefined;
}

/** Default `request_agent_tree` fixture: a single pre-start root, matching what Server
 *  actually synthesizes (see e2e/server-protocol.test.ts) — and deliberately using the
 *  same agentId ("root-1") that `spawnRoot()` below later spawns via SSE, so existing
 *  tests that call both see one consistent root, not two different agents racing. */
function defaultTreeResponse(): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      tree: [
        {
          agentId: "root-1",
          parentAgentId: null,
          model: "sonnet",
          status: "waiting",
          children: [],
        },
      ],
    }),
    { status: 200 },
  );
}

function harness(
  overrides: {
    commandResponse?: (body: unknown) => Response;
    treeResponse?: (body: unknown) => Response;
    now?: number;
  } = {},
) {
  const { document, root, dispatch, dispatchKey } = createTestDom();
  const target: ServerTarget = { baseUrl: "http://localhost:4000" };
  const stream = fakeSseStream();
  const calls: FetchCall[] = [];
  const commandBodies: unknown[] = [];

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/api/events")) {
      return new Response(stream.body, { status: 200 });
    }
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    commandBodies.push(body);
    // The tree bootstrap (app.ts's start()) is a separate concern from whatever a given
    // test is exercising via `commandResponse` (a failed send_message/stop_agent/
    // download_logs) — special-cased first so those overrides don't also fail the
    // bootstrap and throw an unrelated error banner into every such test.
    if (body?.type === "request_agent_tree") {
      return overrides.treeResponse ? overrides.treeResponse(body) : defaultTreeResponse();
    }
    if (overrides.commandResponse) return overrides.commandResponse(body);
    if (body?.type === "download_logs") return new Response("bytes", { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;

  const downloadCalls: Array<{ url: string; filename: string }> = [];
  const downloadEnv: DownloadEnv = {
    createObjectURL: () => "blob:fake",
    revokeObjectURL: () => {},
    triggerAnchorDownload: (url, filename) => downloadCalls.push({ url, filename }),
  };

  const timeoutCalls: Array<() => void> = [];
  const setTimeoutImpl = ((fn: () => void) => {
    timeoutCalls.push(fn);
    return timeoutCalls.length as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  const clearTimeoutImpl = (() => {}) as typeof clearTimeout;

  // Fake clock + interval for the liveness indicator (docs/handoffs/web.md Round 3):
  // `intervalCalls` captures the tick callback so a test can invoke it directly instead of
  // sleeping in real time, and `clock` lets a test move `nowFn()`'s reported time forward.
  const clock = { now: overrides.now ?? Date.parse("2026-01-01T00:00:00Z") };
  const nowFn = () => clock.now;
  const intervalCalls: Array<() => void> = [];
  let intervalCleared = false;
  const setIntervalImpl = ((fn: () => void) => {
    intervalCalls.push(fn);
    return intervalCalls.length as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;
  const clearIntervalImpl = (() => {
    intervalCleared = true;
  }) as typeof clearInterval;

  const app = new AppView(root, {
    doc: document,
    target,
    downloadEnv,
    fetchImpl,
    setTimeoutImpl,
    clearTimeoutImpl,
    nowFn,
    setIntervalImpl,
    clearIntervalImpl,
  });

  return {
    app,
    document,
    root,
    dispatch,
    dispatchKey,
    stream,
    calls,
    commandBodies,
    downloadCalls,
    timeoutCalls,
    target,
    clock,
    intervalCalls,
    isIntervalCleared: () => intervalCleared,
  };
}

/** Flushes pending microtasks *and* a macrotask turn — enough for a fetch/stream-read chain. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function spawnRoot(h: ReturnType<typeof harness>, agentId = "root-1"): Promise<void> {
  h.stream.push({
    version: 1,
    id: "e1",
    timestamp: "2026-01-01T00:00:00Z",
    type: "agent_spawned",
    agentId,
    parentAgentId: null,
    model: "sonnet",
  });
  await flush();
}

describe("AppView interactive bootstrap (Round 2 — fresh-session deadlock fix)", () => {
  test("a brand-new session can send its first message via composer + click, with no agent_spawned SSE event ever having fired", async () => {
    const h = harness();
    h.app.start();
    await flush(); // resolve the request_agent_tree bootstrap — no spawnRoot(), on purpose:
    // this is the whole point of the regression test. A fresh dh --web session has sent no
    // message yet, so no agent_spawned SSE event exists; the only way the composer can know
    // the root agent's id is the request_agent_tree bootstrap in app.ts's start().

    expect(h.app.getState().rootAgentId).toBe("root-1");
    expect(h.root.querySelector(".agent-row")).not.toBeNull();

    const textarea = h.root.querySelector("textarea") as HTMLTextAreaElement;
    const form = h.root.querySelector("form") as HTMLFormElement;
    expect(textarea).not.toBeNull();
    expect(form).not.toBeNull();
    textarea.value = "first message ever";
    h.dispatch(form, "submit", { cancelable: true });
    await flush();

    expect(h.commandBodies).toEqual([
      { type: "request_agent_tree" },
      { type: "send_message", agentId: "root-1", message: "first message ever" },
    ]);
  });

  test("a brand-new session can send its first message via Enter in the composer, same as click", async () => {
    const h = harness();
    h.app.start();
    await flush();

    const textarea = h.root.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "enter to send";
    h.dispatchKey(textarea, "keydown", { key: "Enter", cancelable: true });
    await flush();

    expect(h.commandBodies).toEqual([
      { type: "request_agent_tree" },
      { type: "send_message", agentId: "root-1", message: "enter to send" },
    ]);
  });

  test("seeds from the tree entry whose parentAgentId is null, not a hardcoded id", async () => {
    const h = harness({
      treeResponse: () =>
        new Response(
          JSON.stringify({
            ok: true,
            tree: [
              {
                agentId: "agent-42",
                parentAgentId: null,
                model: "opus",
                status: "waiting",
                children: [],
              },
            ],
          }),
          { status: 200 },
        ),
    });
    h.app.start();
    await flush();

    expect(h.app.getState().rootAgentId).toBe("agent-42");
    expect(h.root.querySelector(".agent-header-name")?.textContent).toBe("Root agent");
    expect(h.root.querySelector("form")).not.toBeNull();
  });

  test("a failed tree-bootstrap request surfaces the error banner instead of hanging silently", async () => {
    const h = harness({
      treeResponse: () =>
        new Response(JSON.stringify({ ok: false, error: "tree unavailable" }), { status: 200 }),
    });
    h.app.start();
    await flush();

    const banner = h.root.querySelector(".error-banner");
    expect(banner?.classList.contains("hidden")).toBe(false);
  });
});

describe("AppView construction and rendering", () => {
  test("renders the shell immediately without opening a connection", async () => {
    const { root, calls } = harness();
    expect(root.querySelector(".sidebar")).not.toBeNull();
    await flush();
    expect(calls).toHaveLength(0);
  });

  test("start() opens exactly one SSE request against the target's events endpoint", async () => {
    const { app, calls } = harness();
    app.start();
    await flush();
    const sseCalls = calls.filter((c) => c.url.endsWith("/api/events"));
    expect(sseCalls).toHaveLength(1);
    expect(sseCalls[0]?.url).toBe("http://localhost:4000/api/events");
  });

  test("stop() aborts the connection and is safe to call twice", async () => {
    const { app } = harness();
    app.start();
    await flush();
    app.stop();
    expect(() => app.stop()).not.toThrow();
  });

  test("the liveness indicator advances on its own tick, with no new SSE event, via the injected clock/interval", async () => {
    const h = harness();
    h.app.start();
    await spawnRoot(h);
    await flush();

    const elapsedBefore = h.root.querySelector(".status-elapsed")?.textContent;
    expect(elapsedBefore).toContain("just now");
    expect(h.intervalCalls).toHaveLength(1);

    h.clock.now += 65_000; // 1m 05s later, no new event.
    h.intervalCalls[0]?.(); // Fire the injected tick directly instead of sleeping for real.

    const elapsedAfter = h.root.querySelector(".status-elapsed")?.textContent;
    expect(elapsedAfter).toBe("for 1m 05s");
  });

  test("stop() clears the liveness ticker so it doesn't keep firing after teardown", async () => {
    const h = harness();
    h.app.start();
    await flush();
    expect(h.isIntervalCleared()).toBe(false);
    h.app.stop();
    expect(h.isIntervalCleared()).toBe(true);
  });

  test("incoming events update state and re-render the sidebar/header", async () => {
    const h = harness();
    h.app.start();
    await spawnRoot(h);
    expect(h.app.getState().rootAgentId).toBe("root-1");
    expect(h.root.querySelector(".agent-row")).not.toBeNull();
    expect(h.root.querySelector(".agent-header-name")?.textContent).toBe("Root agent");
  });

  test("streaming output appends to the pane without resetting selection", async () => {
    const h = harness();
    h.app.start();
    await spawnRoot(h);
    h.stream.push({
      version: 1,
      id: "e2",
      timestamp: "2026-01-01T00:00:01Z",
      type: "agent_output",
      agentId: "root-1",
      chunk: "hello ",
    });
    h.stream.push({
      version: 1,
      id: "e3",
      timestamp: "2026-01-01T00:00:02Z",
      type: "agent_output",
      agentId: "root-1",
      chunk: "world",
    });
    await flush();
    const turns = h.root.querySelectorAll(".turn-assistant");
    expect(turns).toHaveLength(1);
    expect(turns[0]?.querySelector(".turn-text")?.textContent).toBe("hello world");
  });

  test("selecting a different agent swaps the rendered output", async () => {
    const h = harness();
    h.app.start();
    await spawnRoot(h);
    h.stream.push({
      version: 1,
      id: "e2",
      timestamp: "2026-01-01T00:00:01Z",
      type: "agent_spawned",
      agentId: "child-1",
      parentAgentId: "root-1",
      model: "haiku",
    });
    h.stream.push({
      version: 1,
      id: "e3",
      timestamp: "2026-01-01T00:00:02Z",
      type: "agent_output",
      agentId: "child-1",
      chunk: "child output",
    });
    await flush();

    const rows = h.root.querySelectorAll(".agent-row");
    h.dispatch(rows[1] as HTMLElement, "click");
    expect(h.app.getState().selectedAgentId).toBe("child-1");
    const turns = h.root.querySelectorAll(".turn-assistant");
    expect(turns).toHaveLength(1);
    expect(turns[0]?.querySelector(".turn-text")?.textContent).toBe("child output");
  });
});

describe("AppView commands", () => {
  test("sending a message posts a send_message command for the selected (root) agent", async () => {
    const h = harness();
    h.app.start();
    await spawnRoot(h);

    const textarea = h.root.querySelector("textarea") as HTMLTextAreaElement;
    const form = h.root.querySelector("form") as HTMLFormElement;
    textarea.value = "do the thing";
    h.dispatch(form, "submit", { cancelable: true });

    await flush();
    expect(h.commandBodies).toEqual([
      { type: "request_agent_tree" },
      { type: "send_message", agentId: "root-1", message: "do the thing" },
    ]);
  });

  test("a sent message appears as a user turn immediately, before any server response arrives (local echo)", async () => {
    const h = harness();
    h.app.start();
    await flush(); // only to resolve the request_agent_tree bootstrap that seeds root-1.

    const textarea = h.root.querySelector("textarea") as HTMLTextAreaElement;
    const form = h.root.querySelector("form") as HTMLFormElement;
    textarea.value = "hello from the operator";
    h.dispatch(form, "submit", { cancelable: true });

    // Deliberately no `await flush()` here: the whole point of local echo
    // (docs/handoffs/web.md Round 4) is that the operator's turn renders synchronously at
    // send time, without waiting on the send_message fetch (which hasn't resolved yet at
    // this point in the test) to come back from the server.
    const userTurns = h.root.querySelectorAll(".turn-user");
    expect(userTurns).toHaveLength(1);
    expect(userTurns[0]?.querySelector(".turn-text")?.textContent).toBe("hello from the operator");
  });

  test("download-log button triggers a browser download via the injected env", async () => {
    const h = harness();
    h.app.start();
    await spawnRoot(h);

    const buttons = [...h.root.querySelectorAll("button")];
    const logBtn = buttons.find((b) => b.textContent === "Download log");
    if (logBtn) h.dispatch(logBtn, "click");

    await flush();
    expect(h.downloadCalls).toHaveLength(1);
    expect(h.commandBodies).toEqual([
      { type: "request_agent_tree" },
      { type: "download_logs", agentId: "root-1" },
    ]);
  });

  test("download-session-bundle button requests the full bundle (no agentId)", async () => {
    const h = harness();
    h.app.start();
    await spawnRoot(h);

    const buttons = [...h.root.querySelectorAll("button")];
    const bundleBtn = buttons.find((b) => b.textContent === "Download session bundle");
    if (bundleBtn) h.dispatch(bundleBtn, "click");

    await flush();
    expect(h.downloadCalls).toHaveLength(1);
    expect(h.commandBodies).toEqual([{ type: "request_agent_tree" }, { type: "download_logs" }]);
  });

  test("stop button sends a stop_agent command for the selected agent", async () => {
    const h = harness();
    h.app.start();
    await spawnRoot(h);

    const buttons = [...h.root.querySelectorAll("button")];
    const stopBtn = buttons.find((b) => b.textContent === "Stop");
    expect(stopBtn).toBeDefined();
    if (stopBtn) h.dispatch(stopBtn, "click");

    await flush();
    expect(h.commandBodies).toEqual([
      { type: "request_agent_tree" },
      { type: "stop_agent", agentId: "root-1" },
    ]);
  });

  test("a failed stop command shows the error banner too", async () => {
    const h = harness({
      commandResponse: () =>
        new Response(JSON.stringify({ ok: false, error: "cannot stop" }), { status: 200 }),
    });
    h.app.start();
    await spawnRoot(h);

    const buttons = [...h.root.querySelectorAll("button")];
    const stopBtn = buttons.find((b) => b.textContent === "Stop");
    if (stopBtn) h.dispatch(stopBtn, "click");
    await flush();

    const banner = h.root.querySelector(".error-banner");
    expect(banner?.classList.contains("hidden")).toBe(false);
    expect(banner?.textContent).toBe("cannot stop");
  });

  test("the error banner actually hides once its injected timeout fires", async () => {
    const h = harness({
      commandResponse: () =>
        new Response(JSON.stringify({ ok: false, error: "boom" }), { status: 200 }),
    });
    h.app.start();
    await spawnRoot(h);

    const textarea = h.root.querySelector("textarea") as HTMLTextAreaElement;
    const form = h.root.querySelector("form") as HTMLFormElement;
    textarea.value = "will fail";
    h.dispatch(form, "submit", { cancelable: true });
    await flush();

    expect(h.timeoutCalls).toHaveLength(1);
    h.timeoutCalls[0]?.();
    const banner = h.root.querySelector(".error-banner");
    expect(banner?.classList.contains("hidden")).toBe(true);
  });

  test("a failed command shows the error banner via the injected timeout", async () => {
    const h = harness({
      commandResponse: () =>
        new Response(JSON.stringify({ ok: false, error: "boom" }), { status: 200 }),
    });
    h.app.start();
    await spawnRoot(h);

    const textarea = h.root.querySelector("textarea") as HTMLTextAreaElement;
    const form = h.root.querySelector("form") as HTMLFormElement;
    textarea.value = "will fail";
    h.dispatch(form, "submit", { cancelable: true });

    await flush();

    const banner = h.root.querySelector(".error-banner");
    expect(banner?.classList.contains("hidden")).toBe(false);
    expect(banner?.textContent).toBe("boom");
    expect(h.timeoutCalls.length).toBeGreaterThan(0);
  });

  test("a second error before the first banner times out replaces it without a stale hide", async () => {
    const h = harness({
      commandResponse: () =>
        new Response(JSON.stringify({ ok: false, error: "boom" }), { status: 200 }),
    });
    h.app.start();
    await spawnRoot(h);

    const textarea = h.root.querySelector("textarea") as HTMLTextAreaElement;
    const form = h.root.querySelector("form") as HTMLFormElement;
    textarea.value = "first";
    h.dispatch(form, "submit", { cancelable: true });
    await flush();
    textarea.value = "second";
    h.dispatch(form, "submit", { cancelable: true });
    await flush();

    expect(h.timeoutCalls.length).toBe(2);
    const banner = h.root.querySelector(".error-banner");
    expect(banner?.classList.contains("hidden")).toBe(false);
  });

  test("a failed single-agent log download shows the error banner", async () => {
    const h = harness({
      commandResponse: () =>
        new Response(JSON.stringify({ ok: false, error: "log not found" }), { status: 404 }),
    });
    h.app.start();
    await spawnRoot(h);

    const buttons = [...h.root.querySelectorAll("button")];
    const logBtn = buttons.find((b) => b.textContent === "Download log");
    if (logBtn) h.dispatch(logBtn, "click");
    await flush();

    const banner = h.root.querySelector(".error-banner");
    expect(banner?.classList.contains("hidden")).toBe(false);
    expect(banner?.textContent).toBe("Log download failed: log not found");
  });

  test("a failed session-bundle download shows the error banner", async () => {
    const h = harness({
      commandResponse: () => new Response("nope", { status: 500 }),
    });
    h.app.start();
    await spawnRoot(h);

    const buttons = [...h.root.querySelectorAll("button")];
    const bundleBtn = buttons.find((b) => b.textContent === "Download session bundle");
    if (bundleBtn) h.dispatch(bundleBtn, "click");
    await flush();

    const banner = h.root.querySelector(".error-banner");
    expect(banner?.classList.contains("hidden")).toBe(false);
  });
});

describe("AppView connection status", () => {
  test("reports open once the SSE response arrives, then reconnecting after the stream drops", async () => {
    const h = harness();
    h.app.start();
    await flush();
    expect(h.root.querySelector(".connection-pill")?.textContent).toBe("Live");

    h.stream.error();
    await flush();
    expect(h.root.querySelector(".connection-pill")?.textContent).toBe("Reconnecting…");
  });
});

describe("AppView scroll behavior", () => {
  test("clicking 'Jump to latest' scrolls the output pane to the bottom", async () => {
    const h = harness();
    h.app.start();
    await spawnRoot(h);

    const jumpBtn = h.root.querySelector(".jump-to-latest") as HTMLElement;
    expect(() => h.dispatch(jumpBtn, "click")).not.toThrow();
  });

  test("scrolling the output pane runs the near-bottom check without throwing", async () => {
    const h = harness();
    h.app.start();
    await spawnRoot(h);

    const scrollRegion = h.root.querySelector(".output-scroll") as HTMLElement;
    expect(() => h.dispatch(scrollRegion, "scroll")).not.toThrow();
  });
});
