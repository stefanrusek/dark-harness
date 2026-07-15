import { describe, expect, test } from "bun:test";
import {
  type AppCallbacks,
  appendOutput,
  buildShell,
  hideError,
  renderAgentHeader,
  renderComposer,
  renderConnectionStatus,
  renderOutput,
  renderSessionSummary,
  renderSidebar,
  showError,
} from "./render.ts";
import { type AgentNode, type WebState, applyEvent, createInitialState } from "./state.ts";
import { createTestDom } from "./test-dom.ts";

function fakeAgentNode(overrides: Partial<AgentNode> = {}): AgentNode {
  return {
    agentId: "a1",
    parentAgentId: null,
    model: "sonnet",
    status: "running",
    output: "",
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    spawnOrder: 0,
    ...overrides,
  };
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
});

describe("renderConnectionStatus", () => {
  test("sets the label and a status-specific class", () => {
    const { document, root } = createTestDom();
    let state = createInitialState();
    renderConnectionStatus(root, state);
    expect(root.textContent).toBe("Connecting…");
    expect(root.className).toBe("connection-pill connection-connecting");

    state = { ...state, connectionStatus: "open" };
    renderConnectionStatus(root, state);
    expect(root.textContent).toBe("Live");
    expect(root.className).toBe("connection-pill connection-open");
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

describe("renderOutput / appendOutput", () => {
  test("renderOutput sets full text and returns its length", () => {
    const { document, root } = createTestDom();
    const pre = document.createElement("pre");
    root.appendChild(pre);
    const len = renderOutput(pre, fakeAgentNode({ output: "hello" }));
    expect(pre.textContent).toBe("hello");
    expect(len).toBe(5);
  });

  test("renderOutput handles a null agent (empty pane)", () => {
    const { document, root } = createTestDom();
    const pre = document.createElement("pre");
    root.appendChild(pre);
    const len = renderOutput(pre, null);
    expect(pre.textContent).toBe("");
    expect(len).toBe(0);
  });

  test("appendOutput appends only the new suffix and returns the new length", () => {
    const { document, root } = createTestDom();
    const pre = document.createElement("pre");
    root.appendChild(pre);
    renderOutput(pre, null);
    const afterFirst = appendOutput(document, pre, "hello", 0);
    expect(pre.textContent).toBe("hello");
    expect(afterFirst).toBe(5);

    const afterSecond = appendOutput(document, pre, "hello world", afterFirst);
    expect(pre.textContent).toBe("hello world");
    expect(afterSecond).toBe(11);
  });

  test("appendOutput is a no-op when there's no new text", () => {
    const { document, root } = createTestDom();
    const pre = document.createElement("pre");
    pre.textContent = "hello";
    root.appendChild(pre);
    const result = appendOutput(document, pre, "hello", 5);
    expect(pre.textContent).toBe("hello");
    expect(result).toBe(5);
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
