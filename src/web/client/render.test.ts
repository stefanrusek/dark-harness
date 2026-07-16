import { describe, expect, test } from "bun:test";
import {
  type AppCallbacks,
  appendTranscript,
  buildShell,
  hideError,
  hideGapBanner,
  renderAgentHeader,
  renderComposer,
  renderConnectionStatus,
  renderErrorLog,
  renderSessionSummary,
  renderSidebar,
  renderTranscript,
  showError,
  showGapBanner,
} from "./render.ts";
import {
  type AgentNode,
  type Turn,
  type WebState,
  applyEvent,
  createInitialState,
  logError,
} from "./state.ts";
import { createTestDom } from "./test-dom.ts";

function fakeAgentNode(overrides: Partial<AgentNode> = {}): AgentNode {
  return {
    agentId: "a1",
    parentAgentId: null,
    model: "sonnet",
    status: "running",
    transcript: [],
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    spawnOrder: 0,
    turnOpen: false,
    statusSince: "2026-07-15T00:00:00.000Z",
    ...overrides,
  };
}

function turn(role: Turn["role"], text: string, timestamp = "2026-07-15T00:00:00.000Z"): Turn {
  return { role, text, timestamp };
}

function noopCallbacks(overrides: Partial<AppCallbacks> = {}): AppCallbacks {
  return {
    onSelectAgent: () => {},
    onSendMessage: () => {},
    onDownloadAgentLog: () => {},
    onDownloadSessionBundle: () => {},
    onStopAgent: () => {},
    ...overrides,
  };
}

function stateWithRootAndChild(): WebState {
  let state = createInitialState();
  state = applyEvent(state, {
    version: 1,
    id: "e1",
    timestamp: "2026-01-01T00:00:00Z",
    type: "agent_spawned",
    agentId: "root-1",
    parentAgentId: null,
    model: "sonnet",
  });
  state = applyEvent(state, {
    version: 1,
    id: "e2",
    timestamp: "2026-01-01T00:00:01Z",
    type: "agent_spawned",
    agentId: "child-1",
    parentAgentId: "root-1",
    model: "haiku",
  });
  return state;
}

/** Same shape as `stateWithRootAndChild`, but the child carries a `description` — the
 * DH-0069 case: the primary label should be that description, not `model · shortAgentId`. */
function stateWithDescribedChild(): WebState {
  let state = createInitialState();
  state = applyEvent(state, {
    version: 1,
    id: "e1",
    timestamp: "2026-01-01T00:00:00Z",
    type: "agent_spawned",
    agentId: "root-1",
    parentAgentId: null,
    model: "sonnet",
  });
  state = applyEvent(state, {
    version: 1,
    id: "e2",
    timestamp: "2026-01-01T00:00:01Z",
    type: "agent_spawned",
    agentId: "child-1",
    parentAgentId: "root-1",
    model: "haiku",
    description: "Fix flaky retry test",
  });
  return state;
}

describe("buildShell", () => {
  test("builds the full static shell exactly once, replacing prior root content", () => {
    const { document, root } = createTestDom();
    root.textContent = "stale content";
    const shell = buildShell(document, root);

    expect(root.className).toBe("dh-app");
    expect(root.querySelector(".sidebar")).not.toBeNull();
    expect(root.querySelector(".main-pane")).not.toBeNull();
    expect(shell.jumpToLatest.classList.contains("hidden")).toBe(true);
    expect(shell.errorBanner.classList.contains("hidden")).toBe(true);
    expect(shell.gapBanner.classList.contains("hidden")).toBe(true);
    expect(shell.errorLogPanel.classList.contains("hidden")).toBe(true);
  });

  test("DH-0029 (#39): wires ARIA live regions onto the connection pill, transcript, and error banner", () => {
    const { document, root } = createTestDom();
    const shell = buildShell(document, root);

    expect(shell.connectionPill.getAttribute("role")).toBe("status");
    expect(shell.connectionPill.getAttribute("aria-live")).toBe("polite");
    expect(shell.output.getAttribute("role")).toBe("log");
    expect(shell.output.getAttribute("aria-live")).toBe("polite");
    expect(shell.errorBanner.getAttribute("role")).toBe("alert");
    expect(shell.gapBanner.getAttribute("role")).toBe("status");
  });
});

describe("renderSidebar", () => {
  test("renders one row per agent in spawn order, marking root and selection", () => {
    const { document, root } = createTestDom();
    const state = stateWithRootAndChild();
    renderSidebar(document, root, state, () => {});

    const rows = root.querySelectorAll(".agent-row");
    expect(rows.length).toBe(2);
    expect(rows[0]?.classList.contains("root")).toBe(true);
    expect(rows[0]?.classList.contains("selected")).toBe(true);
    expect(rows[1]?.classList.contains("root")).toBe(false);
    expect(rows[1]?.textContent).toContain("haiku");
  });

  test("clicking a row invokes onSelect with that agent's id", () => {
    const { document, root, dispatch } = createTestDom();
    const state = stateWithRootAndChild();
    const selected: string[] = [];
    renderSidebar(document, root, state, (id) => selected.push(id));

    const rows = root.querySelectorAll(".agent-row");
    dispatch(rows[1] as HTMLElement, "click");
    expect(selected).toEqual(["child-1"]);
  });

  test("re-rendering replaces prior rows rather than accumulating them", () => {
    const { document, root } = createTestDom();
    renderSidebar(document, root, stateWithRootAndChild(), () => {});
    renderSidebar(document, root, stateWithRootAndChild(), () => {});
    expect(root.querySelectorAll(".agent-row").length).toBe(2);
  });

  test("renders an empty list before any agent has spawned", () => {
    const { document, root } = createTestDom();
    renderSidebar(document, root, createInitialState(), () => {});
    expect(root.querySelectorAll(".agent-row").length).toBe(0);
  });

  test("DH-0029 (#38): rows are keyboard-focusable and reachable list options", () => {
    const { document, root } = createTestDom();
    renderSidebar(document, root, stateWithRootAndChild(), () => {});

    const list = root.querySelector(".agent-tree");
    expect(list?.getAttribute("role")).toBe("listbox");

    const rows = root.querySelectorAll(".agent-row");
    for (const row of rows) {
      expect((row as HTMLElement).tabIndex).toBe(0);
      expect(row.getAttribute("role")).toBe("option");
    }
    expect(rows[0]?.getAttribute("aria-selected")).toBe("true");
    expect(rows[1]?.getAttribute("aria-selected")).toBe("false");
  });

  test("DH-0029 (#38): pressing Enter or Space on a focused row selects it", () => {
    const { document, root, dispatchKey } = createTestDom();
    const selected: string[] = [];
    renderSidebar(document, root, stateWithRootAndChild(), (id) => selected.push(id));

    const rows = root.querySelectorAll(".agent-row");
    dispatchKey(rows[1] as HTMLElement, "keydown", { key: "Enter", cancelable: true });
    dispatchKey(rows[1] as HTMLElement, "keydown", { key: " ", cancelable: true });
    expect(selected).toEqual(["child-1", "child-1"]);
  });

  test("pressing an unrelated key does nothing", () => {
    const { document, root, dispatchKey } = createTestDom();
    const selected: string[] = [];
    renderSidebar(document, root, stateWithRootAndChild(), (id) => selected.push(id));

    const rows = root.querySelectorAll(".agent-row");
    dispatchKey(rows[1] as HTMLElement, "keydown", { key: "Tab", cancelable: true });
    expect(selected).toEqual([]);
  });

  test("DH-0029 (#40): the status dot is aria-hidden and the row carries an aria-label naming the status", () => {
    const { document, root } = createTestDom();
    renderSidebar(document, root, stateWithRootAndChild(), () => {});

    const rows = root.querySelectorAll(".agent-row");
    const dot = rows[0]?.querySelector(".status-dot");
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
    expect(rows[0]?.getAttribute("aria-label")).toContain("status:");
  });

  // DH-0069: a sub-agent's `description` (from the Agent tool's now-required parameter) is
  // the primary label — `model · shortAgentId` is only the fallback for entries without one
  // (the root row, which always keeps its "root" label regardless).
  test("prefers a child agent's description over 'model · shortAgentId' when present", () => {
    const { document, root } = createTestDom();
    renderSidebar(document, root, stateWithDescribedChild(), () => {});

    const rows = root.querySelectorAll(".agent-row");
    const childLabel = rows[1]?.querySelector(".agent-label")?.textContent;
    expect(childLabel).toBe("Fix flaky retry test");
    expect(rows[1]?.getAttribute("aria-label")).toContain("Fix flaky retry test");
    // Root keeps its "root" label even though it never has a description.
    expect(rows[0]?.querySelector(".agent-label")?.textContent).toBe("root");
  });
});

describe("renderConnectionStatus", () => {
  test("sets the label and a status-specific class", () => {
    const { document, root } = createTestDom();
    let state = createInitialState();
    renderConnectionStatus(root, state);
    expect(root.textContent).toBe("Connecting…");
    expect(root.className).toBe("connection-pill connection-connecting");

    state = { ...state, connectionStatus: "live" };
    renderConnectionStatus(root, state);
    expect(root.textContent).toBe("Live");
    expect(root.className).toBe("connection-pill connection-live");
  });
});

describe("renderSessionSummary", () => {
  test("shows aggregate token/cost stats with no banner mid-session", () => {
    const { document, root } = createTestDom();
    let state = stateWithRootAndChild();
    state = applyEvent(state, {
      version: 1,
      id: "e3",
      timestamp: "2026-01-01T00:00:02Z",
      type: "token_usage",
      agentId: "root-1",
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.05,
    });
    renderSessionSummary(document, root, state);
    expect(root.querySelector(".session-stats")?.textContent).toContain("100");
    expect(root.querySelector(".session-banner")).toBeNull();
  });

  test("shows a success banner once the session ends with exit code 0", () => {
    const { document, root } = createTestDom();
    let state = createInitialState();
    state = applyEvent(state, {
      version: 1,
      id: "e1",
      timestamp: "2026-01-01T00:00:00Z",
      type: "session_ended",
      exitCode: 0,
    });
    renderSessionSummary(document, root, state);
    const banner = root.querySelector(".session-banner");
    expect(banner?.classList.contains("session-banner-ok")).toBe(true);
  });

  test("shows a failure banner for a non-zero exit code", () => {
    const { document, root } = createTestDom();
    let state = createInitialState();
    state = applyEvent(state, {
      version: 1,
      id: "e1",
      timestamp: "2026-01-01T00:00:00Z",
      type: "session_ended",
      exitCode: 1,
    });
    renderSessionSummary(document, root, state);
    const banner = root.querySelector(".session-banner");
    expect(banner?.classList.contains("session-banner-fail")).toBe(true);
  });
});

describe("renderAgentHeader", () => {
  test("shows an empty-state message when nothing is selected yet", () => {
    const { document, root } = createTestDom();
    renderAgentHeader(document, root, createInitialState(), noopCallbacks());
    expect(root.querySelector(".empty-state")?.textContent).toBe("Waiting for an agent to spawn…");
  });

  test("shows root-agent framing, status badge, and stats for the root agent", () => {
    const { document, root } = createTestDom();
    renderAgentHeader(document, root, stateWithRootAndChild(), noopCallbacks());
    expect(root.querySelector(".agent-header-name")?.textContent).toBe("Root agent");
    expect(root.querySelector(".status-badge")?.textContent).toBe("Waiting");
  });

  test("shows model + id framing for a non-root agent", () => {
    const { document, root } = createTestDom();
    let state = stateWithRootAndChild();
    state = { ...state, selectedAgentId: "child-1" };
    renderAgentHeader(document, root, state, noopCallbacks());
    expect(root.querySelector(".agent-header-name")?.textContent).toContain("haiku");
  });

  // DH-0069: a described sub-agent's header name is that description, not `model (id)`.
  test("shows a described sub-agent's description instead of 'model (id)'", () => {
    const { document, root } = createTestDom();
    let state = stateWithDescribedChild();
    state = { ...state, selectedAgentId: "child-1" };
    renderAgentHeader(document, root, state, noopCallbacks());
    expect(root.querySelector(".agent-header-name")?.textContent).toBe("Fix flaky retry test");
  });

  test("shows a Stop button for running/waiting agents but not for done/failed", () => {
    const { document, root } = createTestDom();
    let state = stateWithRootAndChild();
    renderAgentHeader(document, root, state, noopCallbacks());
    expect(root.querySelector(".btn-danger")).not.toBeNull();

    state = applyEvent(state, {
      version: 1,
      id: "e3",
      timestamp: "2026-01-01T00:00:02Z",
      type: "agent_status",
      agentId: "root-1",
      status: "done",
    });
    renderAgentHeader(document, root, state, noopCallbacks());
    expect(root.querySelector(".btn-danger")).toBeNull();
  });

  test("download-log button invokes onDownloadAgentLog with the selected agent's id", () => {
    const { document, root, dispatch } = createTestDom();
    const downloaded: string[] = [];
    renderAgentHeader(
      document,
      root,
      stateWithRootAndChild(),
      noopCallbacks({ onDownloadAgentLog: (id) => downloaded.push(id) }),
    );
    const buttons = [...root.querySelectorAll("button")];
    const logBtn = buttons.find((b) => b.textContent === "Download log");
    if (logBtn) dispatch(logBtn, "click");
    expect(downloaded).toEqual(["root-1"]);
  });

  test("stop button invokes onStopAgent with the selected agent's id", () => {
    const { document, root, dispatch } = createTestDom();
    const stopped: string[] = [];
    renderAgentHeader(
      document,
      root,
      stateWithRootAndChild(),
      noopCallbacks({ onStopAgent: (id) => stopped.push(id) }),
    );
    const buttons = [...root.querySelectorAll("button")];
    const stopBtn = buttons.find((b) => b.textContent === "Stop");
    if (stopBtn) dispatch(stopBtn, "click");
    expect(stopped).toEqual(["root-1"]);
  });

  test("bundle button invokes onDownloadSessionBundle", () => {
    const { document, root, dispatch } = createTestDom();
    let called = 0;
    renderAgentHeader(
      document,
      root,
      stateWithRootAndChild(),
      noopCallbacks({ onDownloadSessionBundle: () => called++ }),
    );
    const buttons = [...root.querySelectorAll("button")];
    const bundleBtn = buttons.find((b) => b.textContent === "Download session bundle");
    if (bundleBtn) dispatch(bundleBtn, "click");
    expect(called).toBe(1);
  });
});

describe("renderTranscript / appendTranscript (Round 4 — structured conversation view)", () => {
  test("renderTranscript builds one distinct, role-styled block per turn", () => {
    const { document, root } = createTestDom();
    const state = renderTranscript(
      document,
      root,
      fakeAgentNode({ transcript: [turn("user", "hi there"), turn("assistant", "hello!")] }),
    );

    const turns = root.querySelectorAll(".turn");
    expect(turns.length).toBe(2);
    expect(turns[0]?.classList.contains("turn-user")).toBe(true);
    expect(turns[0]?.textContent).toContain("hi there");
    expect(turns[1]?.classList.contains("turn-assistant")).toBe(true);
    expect(turns[1]?.textContent).toContain("hello!");
    expect(state).toEqual({ turnCount: 2, lastTurnTextLength: 6 });
  });

  test("renderTranscript handles a null agent (empty pane)", () => {
    const { document, root } = createTestDom();
    const state = renderTranscript(document, root, null);
    expect(root.querySelectorAll(".turn").length).toBe(0);
    expect(state).toEqual({ turnCount: 0, lastTurnTextLength: 0 });
  });

  test("appendTranscript extends the still-open last turn's text in place (streaming fast path)", () => {
    const { document, root } = createTestDom();
    let state = renderTranscript(
      document,
      root,
      fakeAgentNode({ transcript: [turn("assistant", "hel")] }),
    );
    state = appendTranscript(
      document,
      root,
      fakeAgentNode({ transcript: [turn("assistant", "hello world")] }),
      state,
    );
    expect(root.querySelectorAll(".turn").length).toBe(1);
    expect(root.querySelector(".turn-text")?.textContent).toBe("hello world");
    expect(state).toEqual({ turnCount: 1, lastTurnTextLength: 11 });
  });

  test("appendTranscript adds a brand-new turn without touching the previous one's DOM node", () => {
    const { document, root } = createTestDom();
    let state = renderTranscript(
      document,
      root,
      fakeAgentNode({ transcript: [turn("user", "hi")] }),
    );
    const firstTurnEl = root.querySelector(".turn");

    state = appendTranscript(
      document,
      root,
      fakeAgentNode({ transcript: [turn("user", "hi"), turn("assistant", "hello!")] }),
      state,
    );

    const turns = root.querySelectorAll(".turn");
    expect(turns.length).toBe(2);
    expect(turns[0]).toBe(firstTurnEl as Element);
    expect(turns[1]?.classList.contains("turn-assistant")).toBe(true);
    expect(state).toEqual({ turnCount: 2, lastTurnTextLength: 6 });
  });

  test("multiple back-to-back assistant turns (e.g. Round 12 push-notification wake-ups) still read as separate turns", () => {
    const { document, root } = createTestDom();
    let state = renderTranscript(
      document,
      root,
      fakeAgentNode({ transcript: [turn("assistant", "first wake-up done")] }),
    );
    state = appendTranscript(
      document,
      root,
      fakeAgentNode({
        transcript: [
          turn("assistant", "first wake-up done"),
          turn("assistant", "second wake-up done"),
        ],
      }),
      state,
    );

    const turns = root.querySelectorAll(".turn");
    expect(turns.length).toBe(2);
    expect(turns[0]?.textContent).toContain("first wake-up done");
    expect(turns[1]?.textContent).toContain("second wake-up done");
    expect(state.turnCount).toBe(2);
  });

  test("appendTranscript is a no-op when there's no new text or turns", () => {
    const { document, root } = createTestDom();
    const agent = fakeAgentNode({ transcript: [turn("assistant", "hello")] });
    let state = renderTranscript(document, root, agent);
    state = appendTranscript(document, root, agent, state);
    expect(root.querySelectorAll(".turn").length).toBe(1);
    expect(state).toEqual({ turnCount: 1, lastTurnTextLength: 5 });
  });

  test("appendTranscript falls back to a full rebuild when nothing was rendered yet", () => {
    const { document, root } = createTestDom();
    const state = appendTranscript(
      document,
      root,
      fakeAgentNode({ transcript: [turn("user", "hi")] }),
      {
        turnCount: 0,
        lastTurnTextLength: 0,
      },
    );
    // The agent's default fixture status is "running" with no open assistant turn yet after
    // the user's message, so a thinking placeholder (also a `.turn`) is expected alongside
    // the one real turn — filtered out here since it isn't what this test is checking.
    expect(root.querySelectorAll(".turn:not(.turn-thinking)").length).toBe(1);
    expect(state).toEqual({ turnCount: 1, lastTurnTextLength: 2 });
  });

  test("appendTranscript stays empty when nothing has ever rendered and there's still nothing", () => {
    const { document, root } = createTestDom();
    const state = appendTranscript(document, root, null, { turnCount: 0, lastTurnTextLength: 0 });
    expect(root.querySelectorAll(".turn").length).toBe(0);
    expect(state).toEqual({ turnCount: 0, lastTurnTextLength: 0 });
  });

  test("appendTranscript clears the pane when the (new) agent has no transcript", () => {
    const { document, root } = createTestDom();
    let state = renderTranscript(
      document,
      root,
      fakeAgentNode({ transcript: [turn("user", "hi")] }),
    );
    state = appendTranscript(document, root, fakeAgentNode({ transcript: [] }), state);
    // Same thinking-placeholder caveat as above: the default fixture is "running" with no
    // transcript at all, so a placeholder `.turn-thinking` is expected even though there's
    // no real turn.
    expect(root.querySelectorAll(".turn:not(.turn-thinking)").length).toBe(0);
    expect(state).toEqual({ turnCount: 0, lastTurnTextLength: 0 });
  });
});

describe("renderComposer", () => {
  test("renders nothing when no agent is selected", () => {
    const { document, root } = createTestDom();
    renderComposer(document, root, createInitialState(), () => {});
    expect(root.querySelector("form")).toBeNull();
  });

  test("renders nothing when a non-root agent is selected", () => {
    const { document, root } = createTestDom();
    let state = stateWithRootAndChild();
    state = { ...state, selectedAgentId: "child-1" };
    renderComposer(document, root, state, () => {});
    expect(root.querySelector("form")).toBeNull();
  });

  test("renders the composer for the root agent and submits trimmed, non-empty text", () => {
    const { document, root, dispatch } = createTestDom();
    const sent: string[] = [];
    renderComposer(document, root, stateWithRootAndChild(), (msg) => sent.push(msg));

    const form = root.querySelector("form") as HTMLFormElement;
    const textarea = root.querySelector("textarea") as HTMLTextAreaElement;
    expect(form).not.toBeNull();

    textarea.value = "  hello there  ";
    dispatch(form, "submit", { cancelable: true });
    expect(sent).toEqual(["hello there"]);
    expect(textarea.value).toBe("");
  });

  test("does not submit an empty/whitespace-only message", () => {
    const { document, root, dispatch } = createTestDom();
    const sent: string[] = [];
    renderComposer(document, root, stateWithRootAndChild(), (msg) => sent.push(msg));
    const form = root.querySelector("form") as HTMLFormElement;
    const textarea = root.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "   ";
    dispatch(form, "submit", { cancelable: true });
    expect(sent).toEqual([]);
  });

  test("Enter without Shift submits; Shift+Enter does not", () => {
    const { document, root, dispatchKey } = createTestDom();
    const sent: string[] = [];
    renderComposer(document, root, stateWithRootAndChild(), (msg) => sent.push(msg));
    const textarea = root.querySelector("textarea") as HTMLTextAreaElement;

    textarea.value = "shift held";
    dispatchKey(textarea, "keydown", { key: "Enter", shiftKey: true, cancelable: true });
    expect(sent).toEqual([]);

    textarea.value = "plain enter";
    dispatchKey(textarea, "keydown", { key: "Enter", shiftKey: false, cancelable: true });
    expect(sent).toEqual(["plain enter"]);
  });
});

describe("showError / hideError", () => {
  test("showError sets text and reveals the banner; hideError re-hides it", () => {
    const { document, root } = createTestDom();
    const banner = document.createElement("div");
    banner.className = "error-banner hidden";
    root.appendChild(banner);

    showError(banner, "Something broke");
    expect(banner.textContent).toBe("Something broke");
    expect(banner.classList.contains("hidden")).toBe(false);

    hideError(banner);
    expect(banner.classList.contains("hidden")).toBe(true);
  });
});

describe("showGapBanner / hideGapBanner (DH-0024)", () => {
  test("shows a dismissible reconnected-gap message and reveals the banner", () => {
    const { document, root, dispatch } = createTestDom();
    const banner = document.createElement("div");
    banner.className = "gap-banner hidden";
    root.appendChild(banner);

    let dismissed = false;
    showGapBanner(banner, () => {
      dismissed = true;
    });
    expect(banner.classList.contains("hidden")).toBe(false);
    expect(banner.textContent).toContain("Reconnected");

    const dismissBtn = banner.querySelector(".gap-banner-dismiss") as HTMLElement;
    dispatch(dismissBtn, "click");
    expect(dismissed).toBe(true);
  });

  test("hideGapBanner re-hides it", () => {
    const { document, root } = createTestDom();
    const banner = document.createElement("div");
    root.appendChild(banner);
    showGapBanner(banner, () => {});
    hideGapBanner(banner);
    expect(banner.classList.contains("hidden")).toBe(true);
  });
});

describe("renderErrorLog (DH-0029 #34)", () => {
  test("hides the panel when the log is empty", () => {
    const { document, root } = createTestDom();
    const panel = document.createElement("details");
    panel.className = "error-log-panel";
    const list = document.createElement("ul");
    list.className = "error-log-list";
    panel.appendChild(list);
    root.appendChild(panel);

    renderErrorLog(document, panel, createInitialState());
    expect(panel.classList.contains("hidden")).toBe(true);
  });

  test("renders every entry newest-first once the log has entries", () => {
    const { document, root } = createTestDom();
    const panel = document.createElement("details");
    panel.className = "error-log-panel";
    const list = document.createElement("ul");
    list.className = "error-log-list";
    panel.appendChild(list);
    root.appendChild(panel);

    let state = createInitialState();
    state = logError(state, "first error", "2026-01-01T00:00:00Z");
    state = logError(state, "second error", "2026-01-01T00:01:00Z");

    renderErrorLog(document, panel, state);
    expect(panel.classList.contains("hidden")).toBe(false);
    const entries = panel.querySelectorAll(".error-log-entry");
    expect(entries).toHaveLength(2);
    expect(entries[0]?.textContent).toContain("second error");
    expect(entries[1]?.textContent).toContain("first error");
  });
});
