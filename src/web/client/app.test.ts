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
    skillsResponse?: (body: unknown) => Response;
    now?: number;
  } = {},
) {
  const { document, root, dispatch, dispatchKey } = createTestDom();
  const target: ServerTarget = { baseUrl: "http://localhost:4000" };
  // A fresh stream per `/api/events` fetch (not one shared stream reused across
  // reconnects) — matches how a real server behaves (every SSE request gets a distinct
  // response body) and is what makes a genuine reconnect-then-open sequence testable
  // (DH-0024): reading an already-closed/errored stream's body a second time either hangs
  // or throws "ReadableStream is locked", neither of which a real reconnect would do.
  let currentStream = fakeSseStream();
  const calls: FetchCall[] = [];
  const commandBodies: unknown[] = [];

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/api/events")) {
      currentStream = fakeSseStream();
      return new Response(currentStream.body, { status: 200 });
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
    // DH-0093: the list_skills startup bootstrap is likewise a separate concern from
    // whatever a given test's `commandResponse` override exercises — special-cased the same
    // way request_agent_tree already is above, so existing tests don't spuriously pick up an
    // extra failed-command error banner from a bootstrap call they aren't testing.
    if (body?.type === "list_skills") {
      return overrides.skillsResponse
        ? overrides.skillsResponse(body)
        : new Response(JSON.stringify({ ok: true, skills: [] }), { status: 200 });
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
    get stream() {
      return currentStream;
    },
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
      { type: "list_skills" },
      { type: "send_message", agentId: "root-1", message: "first message ever" },
    ]);
  });

  test("a brand-new session can send its first message via Enter in the composer, same as click", async () => {
    const h = harness();
    h.app.start();
    await flush();

    const textarea = h.root.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "enter to send";
    // React's ChangeEventPlugin tracks `keydown` against whichever element last received a
    // real `focus` event (`activeElementInst`) — a synthetic `keydown` dispatched without a
    // preceding `focus()` call never reaches this component's `onKeyDown` handler under
    // happy-dom, unlike a real browser where typing implies the field is already focused.
    textarea.focus();
    h.dispatchKey(textarea, "keydown", { key: "Enter", cancelable: true });
    await flush();

    expect(h.commandBodies).toEqual([
      { type: "request_agent_tree" },
      { type: "list_skills" },
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
    // DH-0135: the shell is now a single React root render, committed via React's scheduler
    // (a macrotask under happy-dom) rather than synchronous DOM mutation — a tick is needed
    // before asserting on the committed DOM, unlike the old imperative `buildShell` call.
    await flush();
    expect(root.querySelector(".sidebar")).not.toBeNull();
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
    await flush();

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

  test("stop() cancels a still-pending coalesced render (DH-0044 D9) without throwing, using the default rAF fallback", async () => {
    const h = harness();
    h.app.start();
    await spawnRoot(h);
    // Push an event and stop() immediately, before the default rAF fallback's macrotask
    // fires — exercises `scheduleRenderAll`'s pending-handle path and `defaultCancelRaf`'s
    // non-browser (`clearTimeout`) fallback, since this harness never overrides `rafImpl`.
    h.stream.push({
      version: 1,
      id: "e2",
      timestamp: "2026-01-01T00:00:01Z",
      type: "agent_output",
      agentId: "root-1",
      chunk: "hello",
    });
    expect(() => h.app.stop()).not.toThrow();
    await flush();
  });

  test("incoming events update state and re-render the sidebar/header", async () => {
    const h = harness();
    h.app.start();
    await spawnRoot(h);
    expect(h.app.getState().rootAgentId).toBe("root-1");
    expect(h.root.querySelector(".agent-row")).not.toBeNull();
    expect(h.root.querySelector(".agent-header-name")?.textContent).toBe("Root agent");
  });

  test("DH-0135: the React-mounted composer mounts exactly once and never duplicates across repeated old-renderer full-section rebuilds (sidebar/header/transcript still on render.ts)", async () => {
    const h = harness();
    h.app.start();
    await spawnRoot(h);

    const textareaBefore = h.root.querySelector("textarea");
    expect(textareaBefore).not.toBeNull();

    // Drives several full `renderAll()` passes via the still-imperative sections (sidebar/
    // header/transcript rebuild wholesale on every SSE event and liveness tick) — the
    // composer's own React root must not pick up a second mount or lose its node identity
    // as a byproduct of those unrelated rebuilds.
    for (let i = 0; i < 5; i++) {
      h.stream.push({
        version: 1,
        id: `tick-${i}`,
        timestamp: `2026-01-01T00:00:0${i}Z`,
        type: "agent_output",
        agentId: "root-1",
        chunk: `chunk-${i} `,
      });
      // eslint-disable-next-line no-await-in-loop
      await flush();
    }
    h.clock.now += 1000;
    h.intervalCalls[0]?.();

    expect(h.root.querySelectorAll("form.composer")).toHaveLength(1);
    expect(h.root.querySelectorAll("textarea.composer-input")).toHaveLength(1);
    expect(h.root.querySelector("textarea")).toBe(textareaBefore);
  });

  test("DH-0135: the composer's focus and unsent text survive an unrelated SSE event and the liveness tick (DH-0117 regression, end to end through AppView)", async () => {
    const h = harness();
    h.app.start();
    await spawnRoot(h);

    const textarea = h.root.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "unsent draft";
    textarea.focus();

    h.stream.push({
      version: 1,
      id: "e2",
      timestamp: "2026-01-01T00:00:01Z",
      type: "agent_output",
      agentId: "root-1",
      chunk: "unrelated output",
    });
    await flush();
    h.clock.now += 1000;
    h.intervalCalls[0]?.();

    const textareaAfter = h.root.querySelector("textarea");
    expect(textareaAfter).toBe(textarea);
    expect((textareaAfter as HTMLTextAreaElement).value).toBe("unsent draft");
    expect(h.document.activeElement).toBe(textarea);
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
    await flush();
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
      { type: "list_skills" },
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

    // DH-0135: state is still updated synchronously at send time (local echo, unchanged) —
    // only the committed DOM now needs one macrotask tick to catch up, since React's
    // scheduler (not synchronous DOM mutation) owns the render pass. The point of this test
    // (the echoed turn exists before any server round-trip completes) still holds: the fake
    // `send_message` fetch hasn't been awaited by anything here.
    await flush();
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
      { type: "list_skills" },
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
    expect(h.commandBodies).toEqual([
      { type: "request_agent_tree" },
      { type: "list_skills" },
      { type: "download_logs" },
    ]);
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
      { type: "list_skills" },
      { type: "stop_agent", agentId: "root-1" },
    ]);
  });

  // DH-0207/DH-0208
  test("cancel button on a queued turn sends a cancel_queued_message command for that entry", async () => {
    const h = harness();
    h.app.start();
    await spawnRoot(h);

    const textarea = h.root.querySelector("textarea") as HTMLTextAreaElement;
    const form = h.root.querySelector("form") as HTMLFormElement;
    textarea.value = "please hold";
    h.dispatch(form, "submit", { cancelable: true });
    await flush();

    // Simulate the server reporting this send is sitting in the queue, not yet delivered —
    // real production wiring for an agent that's mid-turn/asleep when the operator sends.
    h.stream.push({
      version: 1,
      id: "e-queue-1",
      timestamp: "2026-01-01T00:00:01Z",
      type: "agent_queue",
      agentId: "root-1",
      queue: [{ id: "qm-1", message: "please hold", queuedAt: "2026-01-01T00:00:01Z" }],
    });
    await flush();

    await flush();
    const cancelBtn = h.root.querySelector(".turn-queued-cancel") as HTMLButtonElement | null;
    expect(cancelBtn).not.toBeNull();
    if (cancelBtn) h.dispatch(cancelBtn, "click");
    await flush();

    expect(h.commandBodies).toEqual([
      { type: "request_agent_tree" },
      { type: "list_skills" },
      { type: "send_message", agentId: "root-1", message: "please hold" },
      { type: "cancel_queued_message", agentId: "root-1", messageId: "qm-1" },
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

    // 4 scheduled timers by this point: the tree-bootstrap command's timeout and the
    // list_skills bootstrap's own timeout (DH-0029 #37 — both cleared once their fetch
    // resolves, but this harness's clearTimeoutImpl is a no-op so they stay recorded, and
    // both are special-cased to succeed regardless of `commandResponse` — see the harness's
    // fetchImpl), this send_message's own command timeout (same reason), and finally the
    // error banner's auto-hide timer, which is the one this test cares about.
    expect(h.timeoutCalls).toHaveLength(4);
    h.timeoutCalls[3]?.();
    await flush();
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

    // 5 scheduled timers: tree bootstrap's command timeout, the list_skills bootstrap's own
    // timeout, then a (command timeout, error banner hide) pair per submit — see the comment
    // in the test above for why the no-op clearTimeoutImpl leaves cleared timers in this
    // array too.
    expect(h.timeoutCalls.length).toBe(6);
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

  test("DH-0024: shows a dismissible gap banner once the connection reconnects after a drop", async () => {
    const h = harness();
    h.app.start();
    await flush();

    h.stream.close();
    await flush();
    expect(h.root.querySelector(".gap-banner")?.classList.contains("hidden")).toBe(true);

    // Fire the scheduled reconnect timer directly (this harness's fake `fetchImpl` always
    // hands back the same stream body, already closed — reading it again resolves
    // immediately with `done: true`, which is enough to drive the reconnect status
    // transition without a second fake stream).
    const reconnectTimer = h.timeoutCalls.at(-1);
    reconnectTimer?.();
    await flush();

    const banner = h.root.querySelector(".gap-banner");
    expect(banner?.classList.contains("hidden")).toBe(false);
    expect(banner?.textContent).toContain("Reconnected");

    const dismissBtn = banner?.querySelector(".gap-banner-dismiss") as HTMLElement;
    h.dispatch(dismissBtn, "click");
    await flush();
    expect(h.root.querySelector(".gap-banner")?.classList.contains("hidden")).toBe(true);
  });

  test("DH-0202: a reconnect re-fetches the agent tree and fills in a model name lost across it", async () => {
    // The tree response is checked live (not snapshotted at harness-build time) so it can
    // report an updated model on the *second* call, simulating "the server always knows the
    // real model" while the client's own view of it was briefly blank.
    let treeCalls = 0;
    const h = harness({
      treeResponse: () => {
        treeCalls++;
        return new Response(
          JSON.stringify({
            ok: true,
            tree: [
              {
                agentId: "root-1",
                parentAgentId: null,
                model: "sonnet",
                status: "waiting",
                children:
                  treeCalls === 1
                    ? []
                    : [
                        {
                          agentId: "child-2",
                          parentAgentId: "root-1",
                          model: "haiku",
                          status: "running",
                          children: [],
                        },
                      ],
              },
            ],
          }),
          { status: 200 },
        );
      },
    });
    h.app.start();
    await flush(); // resolves the first request_agent_tree bootstrap (seeds root-1: "sonnet").
    expect(treeCalls).toBe(1);
    expect(h.app.getState().agents.get("root-1")?.model).toBe("sonnet");

    // Simulate a reconnect whose replay skipped the original `agent_spawned` event: an
    // `agent_output` event lands for a *new* agent id state has never seen, so `ensureAgent`
    // creates it with `model: ""` instead of `applyEvent`'s `agent_spawned` branch ever
    // setting it.
    h.stream.push({
      version: 1,
      id: "e2",
      timestamp: "2026-01-01T00:00:01Z",
      type: "agent_output",
      agentId: "child-2",
      chunk: "partial output with no spawn event ever seen",
    });
    await flush();
    expect(h.app.getState().agents.get("child-2")?.model).toBe("");

    // Drop the stream and fire the reconnect.
    h.stream.error();
    await flush();
    const reconnectTimer = h.timeoutCalls.at(-1);
    reconnectTimer?.();
    await flush();

    // The reconnect re-ran the tree bootstrap (a second request_agent_tree call), whose
    // response now reports child-2's real model -- filled in without disturbing root-1's
    // already-known model or child-2's live status/transcript.
    expect(treeCalls).toBe(2);
    expect(h.app.getState().agents.get("root-1")?.model).toBe("sonnet");
    expect(h.app.getState().agents.get("child-2")?.model).toBe("haiku");
    expect(h.app.getState().agents.get("child-2")?.transcript).toEqual([
      {
        role: "assistant",
        text: "partial output with no spawn event ever seen",
        timestamp: expect.any(String),
      },
    ]);
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

describe("AppView: slash commands (DH-0093)", () => {
  function submit(h: ReturnType<typeof harness>, text: string): void {
    const textarea = h.root.querySelector("textarea") as HTMLTextAreaElement;
    const form = h.root.querySelector("form") as HTMLFormElement;
    textarea.value = text;
    h.dispatch(form, "submit", { cancelable: true });
  }

  test("/help renders a local system transcript entry and sends nothing beyond bootstrap", async () => {
    const h = harness();
    h.app.start();
    await spawnRoot(h);
    const bodiesBefore = h.commandBodies.length;

    submit(h, "/help");
    await flush();

    expect(h.commandBodies).toHaveLength(bodiesBefore);
    const systemTurn = h.root.querySelector(".turn-system");
    expect(systemTurn).not.toBeNull();
    expect(systemTurn?.textContent).toContain("/model [name]");
    expect(systemTurn?.textContent).toContain("does NOT reset the agent's context");
  });

  test("/help lists cached skill commands", async () => {
    const h = harness({
      skillsResponse: () =>
        new Response(
          JSON.stringify({
            ok: true,
            skills: [{ name: "sm", description: "Sugar Maple filestore" }],
          }),
          { status: 200 },
        ),
    });
    h.app.start();
    await spawnRoot(h);

    submit(h, "/help");
    await flush();

    const systemTurn = h.root.querySelector(".turn-system");
    expect(systemTurn?.textContent).toContain("/sm   Sugar Maple filestore");
  });

  test("/clear empties the rendered transcript and sends nothing", async () => {
    const h = harness();
    h.app.start();
    await spawnRoot(h);
    h.stream.push({
      version: 1,
      id: "e2",
      timestamp: "2026-01-01T00:00:01Z",
      type: "agent_output",
      agentId: "root-1",
      chunk: "hello",
    });
    await flush();
    expect(h.root.querySelectorAll(".turn-assistant")).toHaveLength(1);
    const bodiesBefore = h.commandBodies.length;

    submit(h, "/clear");
    await flush();

    expect(h.commandBodies).toHaveLength(bodiesBefore);
    expect(h.root.querySelectorAll(".turn-assistant, .turn-user, .turn-system")).toHaveLength(0);
  });

  test("/model with no args fetches list_models and opens the picker", async () => {
    const h = harness({
      commandResponse: (body) => {
        const b = body as { type?: string };
        if (b.type === "list_models") {
          return new Response(
            JSON.stringify({
              ok: true,
              models: [
                {
                  name: "sonnet",
                  provider: "anthropic",
                  model: "claude-sonnet",
                  isDefault: true,
                  isActive: true,
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    h.app.start();
    await spawnRoot(h);

    submit(h, "/model");
    await flush();

    expect(h.commandBodies).toContainEqual({ type: "list_models" });
    expect(h.app.getState().modelPickerOpen).toBe(true);
    expect(h.root.querySelector(".model-picker-overlay.hidden")).toBeNull();
    expect(h.root.querySelector(".model-picker-name")?.textContent).toBe("sonnet");
  });

  test("/model <name> switches directly, without opening the picker", async () => {
    const h = harness();
    h.app.start();
    await spawnRoot(h);

    submit(h, "/model haiku");
    await flush();

    expect(h.commandBodies).toContainEqual({
      type: "switch_model",
      agentId: "root-1",
      model: "haiku",
    });
    expect(h.app.getState().modelPickerOpen).toBe(false);
  });

  test("picker: selecting a row switches the model and closes the picker", async () => {
    const h = harness({
      commandResponse: (body) => {
        const b = body as { type?: string };
        if (b.type === "list_models") {
          return new Response(
            JSON.stringify({
              ok: true,
              models: [
                {
                  name: "haiku",
                  provider: "anthropic",
                  model: "claude-haiku",
                  isDefault: false,
                  isActive: false,
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    h.app.start();
    await spawnRoot(h);
    submit(h, "/model");
    await flush();

    const row = h.root.querySelector(".model-picker-row") as HTMLElement;
    h.dispatch(row, "click");
    await flush();

    expect(h.app.getState().modelPickerOpen).toBe(false);
    expect(h.commandBodies).toContainEqual({
      type: "switch_model",
      agentId: "root-1",
      model: "haiku",
    });
  });

  test("picker: Escape closes it without sending a command", async () => {
    const h = harness({
      commandResponse: (body) => {
        const b = body as { type?: string };
        if (b.type === "list_models") {
          return new Response(JSON.stringify({ ok: true, models: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    h.app.start();
    await spawnRoot(h);
    submit(h, "/model");
    await flush();
    expect(h.app.getState().modelPickerOpen).toBe(true);

    h.dispatchKey(h.document, "keydown", { key: "Escape" });
    expect(h.app.getState().modelPickerOpen).toBe(false);
  });

  test("model_switched updates the visible model badge", async () => {
    const h = harness();
    h.app.start();
    await spawnRoot(h);

    h.stream.push({
      version: 1,
      id: "e2",
      timestamp: "2026-01-01T00:00:01Z",
      type: "model_switched",
      agentId: "root-1",
      from: "sonnet",
      to: "opus",
    });
    await flush();

    expect(h.root.querySelector(".agent-header-model")?.textContent).toBe("opus");
  });

  test("a skill-command name invokes the skill: local echo + invoke_skill, nothing else", async () => {
    const h = harness({
      skillsResponse: () =>
        new Response(
          JSON.stringify({
            ok: true,
            skills: [{ name: "sm", description: "Sugar Maple filestore" }],
          }),
          { status: 200 },
        ),
    });
    h.app.start();
    await spawnRoot(h);

    submit(h, "/sm write a doc");
    await flush();

    expect(h.commandBodies).toContainEqual({
      type: "invoke_skill",
      agentId: "root-1",
      skill: "sm",
      args: "write a doc",
    });
    const userTurns = h.root.querySelectorAll(".turn-user");
    expect(userTurns[userTurns.length - 1]?.querySelector(".turn-text")?.textContent).toBe(
      "/sm write a doc",
    );
  });

  test("an unknown command shows a local system error entry and sends nothing", async () => {
    const h = harness();
    h.app.start();
    await spawnRoot(h);
    const bodiesBefore = h.commandBodies.length;

    submit(h, "/nope");
    await flush();

    expect(h.commandBodies).toHaveLength(bodiesBefore);
    expect(h.root.querySelector(".turn-system .turn-text")?.textContent).toBe(
      "Unknown command: /nope",
    );
  });

  test("a built-in name shadows a same-named skill", async () => {
    const h = harness({
      skillsResponse: () =>
        new Response(
          JSON.stringify({
            ok: true,
            skills: [{ name: "help", description: "a skill that happens to be named help" }],
          }),
          { status: 200 },
        ),
    });
    h.app.start();
    await spawnRoot(h);

    submit(h, "/help");
    await flush();

    // Built-in /help wins: renders the canned help text, not an invoke_skill call.
    expect(h.commandBodies.some((b) => (b as { type?: string }).type === "invoke_skill")).toBe(
      false,
    );
    expect(h.root.querySelector(".turn-system")?.textContent).toContain("/model [name]");
  });
});
