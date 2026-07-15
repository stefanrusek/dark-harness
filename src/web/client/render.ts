// DOM rendering. Every function here takes an explicit container element and state/props —
// no reliance on globals — so it's testable with happy-dom in addition to a real browser.
// See docs/handoffs/web.md status log for the "joy to use" design notes.

import {
  agentStatusStyle,
  connectionStatusLabel,
  formatCostUsd,
  formatElapsed,
  formatExitCode,
  formatTokenCount,
  shortAgentId,
} from "./format.ts";
import {
  type AgentNode,
  type Turn,
  type WebState,
  isRoot,
  orderedAgents,
  selectedAgent,
  sessionTotals,
} from "./state.ts";

export interface AppCallbacks {
  onSelectAgent(agentId: string): void;
  onSendMessage(message: string): void;
  onDownloadAgentLog(agentId: string): void;
  onDownloadSessionBundle(): void;
  onStopAgent(agentId: string): void;
}

export interface ShellRefs {
  sidebar: HTMLElement;
  connectionPill: HTMLElement;
  sessionSummary: HTMLElement;
  agentHeader: HTMLElement;
  output: HTMLElement;
  scrollRegion: HTMLElement;
  jumpToLatest: HTMLElement;
  composer: HTMLElement;
  errorBanner: HTMLElement;
}

/**
 * Builds the static page shell once. Subsequent state changes only touch the pieces
 * returned here, keeping the sidebar/header/output update paths independently cheap.
 */
export function buildShell(doc: Document, root: HTMLElement): ShellRefs {
  root.textContent = "";
  root.className = "dh-app";

  const sidebarPane = el(doc, "nav", "sidebar");
  const brand = el(doc, "div", "brand");
  brand.textContent = "Dark Harness";
  sidebarPane.appendChild(brand);

  const connectionPill = el(doc, "div", "connection-pill");
  sidebarPane.appendChild(connectionPill);

  const sidebar = el(doc, "div", "sidebar-tree");
  sidebarPane.appendChild(sidebar);

  const sessionSummary = el(doc, "div", "session-summary");
  sidebarPane.appendChild(sessionSummary);

  const main = el(doc, "main", "main-pane");
  const agentHeader = el(doc, "div", "agent-header");
  main.appendChild(agentHeader);

  const scrollRegion = el(doc, "div", "output-scroll");
  const output = el(doc, "div", "agent-transcript");
  scrollRegion.appendChild(output);
  main.appendChild(scrollRegion);

  const jumpToLatest = el(doc, "button", "jump-to-latest hidden");
  jumpToLatest.type = "button";
  jumpToLatest.textContent = "↓ Jump to latest";
  main.appendChild(jumpToLatest);

  const composer = el(doc, "div", "composer-region");
  main.appendChild(composer);

  const errorBanner = el(doc, "div", "error-banner hidden");
  main.appendChild(errorBanner);

  root.appendChild(sidebarPane);
  root.appendChild(main);

  return {
    sidebar,
    connectionPill,
    sessionSummary,
    agentHeader,
    output,
    scrollRegion,
    jumpToLatest,
    composer,
    errorBanner,
  };
}

/** Shows a transient error message. Caller (AppView) owns hide-timer scheduling. */
export function showError(banner: HTMLElement, message: string): void {
  banner.textContent = message;
  banner.classList.remove("hidden");
}

export function hideError(banner: HTMLElement): void {
  banner.classList.add("hidden");
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  return node;
}

/** Renders the left-hand agent tree list into `container` (its content is fully replaced). */
export function renderSidebar(
  doc: Document,
  container: HTMLElement,
  state: WebState,
  onSelect: (agentId: string) => void,
  now: number = Date.now(),
): void {
  container.textContent = "";
  const list = el(doc, "ul", "agent-tree");

  for (const agent of orderedAgents(state)) {
    const style = agentStatusStyle(agent.status);
    const item = el(doc, "li", "agent-row");
    item.dataset.agentId = agent.agentId;
    item.dataset.status = agent.status;
    if (agent.agentId === state.selectedAgentId) item.classList.add("selected");
    if (isRoot(state, agent.agentId)) item.classList.add("root");

    const dot = el(doc, "span", `status-dot status-${style.token}`);
    dot.title = style.label;
    item.appendChild(dot);

    const label = el(doc, "span", "agent-label");
    label.textContent = isRoot(state, agent.agentId)
      ? "root"
      : `${agent.model || "agent"} · ${shortAgentId(agent.agentId)}`;
    item.appendChild(label);

    const elapsed = el(doc, "span", "agent-elapsed");
    elapsed.textContent = formatElapsed(now - Date.parse(agent.statusSince));
    elapsed.title = `Time in "${style.label}"`;
    item.appendChild(elapsed);

    const tokens = el(doc, "span", "agent-tokens");
    tokens.textContent = formatTokenCount(agent.inputTokens + agent.outputTokens);
    item.appendChild(tokens);

    item.addEventListener("click", () => onSelect(agent.agentId));
    list.appendChild(item);
  }

  container.appendChild(list);
}

/** Renders the connection status pill. */
export function renderConnectionStatus(container: HTMLElement, state: WebState): void {
  container.textContent = connectionStatusLabel(state.connectionStatus);
  container.className = `connection-pill connection-${state.connectionStatus}`;
}

/** Renders the session-total token/cost strip and the end-of-session banner, if any. */
export function renderSessionSummary(doc: Document, container: HTMLElement, state: WebState): void {
  container.textContent = "";
  const totals = sessionTotals(state);

  const stats = el(doc, "div", "session-stats");
  stats.textContent = `${formatTokenCount(totals.inputTokens)} in / ${formatTokenCount(
    totals.outputTokens,
  )} out · ${formatCostUsd(totals.costUsd)}`;
  container.appendChild(stats);

  if (state.sessionEnded && state.exitCode !== null) {
    const banner = el(
      doc,
      "div",
      `session-banner ${state.exitCode === 0 ? "session-banner-ok" : "session-banner-fail"}`,
    );
    banner.textContent = `Session ended — ${formatExitCode(state.exitCode)}`;
    container.appendChild(banner);
  }
}

/** Renders the detail header for the selected agent (status, model, per-agent stats, actions). */
export function renderAgentHeader(
  doc: Document,
  container: HTMLElement,
  state: WebState,
  callbacks: AppCallbacks,
  now: number = Date.now(),
): void {
  container.textContent = "";
  const agent = selectedAgent(state);
  if (!agent) {
    const empty = el(doc, "div", "empty-state");
    empty.textContent = "Waiting for an agent to spawn…";
    container.appendChild(empty);
    return;
  }

  const style = agentStatusStyle(agent.status);
  const title = el(doc, "div", "agent-header-title");
  const dot = el(doc, "span", `status-dot status-${style.token}`);
  title.appendChild(dot);
  const name = el(doc, "span", "agent-header-name");
  name.textContent = isRoot(state, agent.agentId)
    ? "Root agent"
    : `${agent.model || "agent"} (${shortAgentId(agent.agentId)})`;
  title.appendChild(name);
  const badge = el(doc, "span", `status-badge status-${style.token}`);
  badge.textContent = style.label;
  title.appendChild(badge);
  const elapsed = el(doc, "span", "status-elapsed");
  elapsed.textContent = `for ${formatElapsed(now - Date.parse(agent.statusSince))}`;
  elapsed.title = `Time since this agent last changed status — helps tell "still thinking" from "stalled" during a long turn`;
  title.appendChild(elapsed);
  container.appendChild(title);

  const stats = el(doc, "div", "agent-header-stats");
  stats.textContent = `${formatTokenCount(agent.inputTokens)} in / ${formatTokenCount(
    agent.outputTokens,
  )} out · ${formatCostUsd(agent.costUsd)}`;
  container.appendChild(stats);

  const actions = el(doc, "div", "agent-header-actions");

  const downloadBtn = el(doc, "button", "btn btn-secondary");
  downloadBtn.type = "button";
  downloadBtn.textContent = "Download log";
  downloadBtn.addEventListener("click", () => callbacks.onDownloadAgentLog(agent.agentId));
  actions.appendChild(downloadBtn);

  const bundleBtn = el(doc, "button", "btn btn-secondary");
  bundleBtn.type = "button";
  bundleBtn.textContent = "Download session bundle";
  bundleBtn.addEventListener("click", () => callbacks.onDownloadSessionBundle());
  actions.appendChild(bundleBtn);

  if (agent.status === "running" || agent.status === "waiting") {
    const stopBtn = el(doc, "button", "btn btn-danger");
    stopBtn.type = "button";
    stopBtn.textContent = "Stop";
    stopBtn.addEventListener("click", () => callbacks.onStopAgent(agent.agentId));
    actions.appendChild(stopBtn);
  }

  container.appendChild(actions);
}

/**
 * Snapshot of how much of a transcript has been rendered into the DOM, so `appendTranscript`
 * can extend the existing nodes instead of re-rendering every turn on each event (the
 * streaming fast path — matters once a turn's text is large).
 */
export interface TranscriptRenderState {
  /** How many turns have a DOM element in the container. */
  turnCount: number;
  /** Rendered text length of the last of those turns (it may still be growing — an
   *  assistant turn accumulates more `agent_output` chunks without opening a new turn). */
  lastTurnTextLength: number;
}

const EMPTY_TRANSCRIPT_RENDER_STATE: TranscriptRenderState = {
  turnCount: 0,
  lastTurnTextLength: 0,
};

function turnRoleLabel(role: Turn["role"]): string {
  return role === "user" ? "You" : "Agent";
}

function buildTurnElement(doc: Document, turn: Turn): HTMLElement {
  const wrapper = el(doc, "div", `turn turn-${turn.role}`);
  const role = el(doc, "div", "turn-role");
  role.textContent = turnRoleLabel(turn.role);
  wrapper.appendChild(role);
  const text = el(doc, "div", "turn-text");
  text.textContent = turn.text;
  wrapper.appendChild(text);
  return wrapper;
}

/**
 * Fully rebuilds the transcript pane from scratch — one visually distinct block per turn,
 * clearly separated by role (docs/handoffs/web.md Round 4: the previous flat `<pre>` of
 * concatenated `output` had no turn separation and never showed the operator's own messages
 * at all). Returns a `TranscriptRenderState` snapshot describing what's now rendered, so a
 * subsequent call can use `appendTranscript` instead of paying for a full rebuild again.
 */
export function renderTranscript(
  doc: Document,
  container: HTMLElement,
  agent: AgentNode | null,
): TranscriptRenderState {
  container.textContent = "";
  const transcript = agent?.transcript ?? [];
  for (const turn of transcript) {
    container.appendChild(buildTurnElement(doc, turn));
  }
  return {
    turnCount: transcript.length,
    lastTurnTextLength: transcript.at(-1)?.text.length ?? 0,
  };
}

/**
 * Extends an already-rendered transcript pane with only what's new since `rendered` — the
 * streaming fast path used on every event once the pane is first built. Handles both ways a
 * transcript grows: appending more text to the still-open last turn (an assistant turn
 * absorbing another `agent_output` chunk), and/or adding brand-new turns after it (a fresh
 * user or assistant turn). Falls back to a full `renderTranscript` when there's nothing
 * rendered yet, or the agent has no transcript at all (agent switch, or empty state).
 */
export function appendTranscript(
  doc: Document,
  container: HTMLElement,
  agent: AgentNode | null,
  rendered: TranscriptRenderState,
): TranscriptRenderState {
  const transcript = agent?.transcript ?? [];
  if (transcript.length === 0) {
    return rendered.turnCount === 0
      ? EMPTY_TRANSCRIPT_RENDER_STATE
      : renderTranscript(doc, container, agent);
  }
  if (rendered.turnCount === 0) {
    return renderTranscript(doc, container, agent);
  }

  const lastRenderedTurn = transcript[rendered.turnCount - 1];
  if (lastRenderedTurn && lastRenderedTurn.text.length > rendered.lastTurnTextLength) {
    const lastTurnEl = container.children[rendered.turnCount - 1];
    const textEl = lastTurnEl?.querySelector<HTMLElement>(".turn-text");
    if (textEl) {
      textEl.appendChild(
        doc.createTextNode(lastRenderedTurn.text.slice(rendered.lastTurnTextLength)),
      );
    }
  }

  for (let i = rendered.turnCount; i < transcript.length; i++) {
    const turn = transcript[i];
    if (turn) container.appendChild(buildTurnElement(doc, turn));
  }

  return {
    turnCount: transcript.length,
    lastTurnTextLength: transcript.at(-1)?.text.length ?? 0,
  };
}

/** Renders the root-agent message composer, or nothing when a non-root agent is selected. */
export function renderComposer(
  doc: Document,
  container: HTMLElement,
  state: WebState,
  onSend: (message: string) => void,
): void {
  container.textContent = "";
  const agent = selectedAgent(state);
  if (!agent || !isRoot(state, agent.agentId)) return;

  const form = el(doc, "form", "composer");
  const textarea = el(doc, "textarea", "composer-input");
  textarea.placeholder = "Message the root agent… (Enter to send, Shift+Enter for newline)";
  textarea.rows = 2;
  form.appendChild(textarea);

  const sendBtn = el(doc, "button", "btn btn-primary composer-send");
  sendBtn.type = "submit";
  sendBtn.textContent = "Send";
  form.appendChild(sendBtn);

  const submit = (evt?: Event) => {
    evt?.preventDefault();
    const value = textarea.value.trim();
    if (!value) return;
    onSend(value);
    textarea.value = "";
  };

  form.addEventListener("submit", submit);
  textarea.addEventListener("keydown", (evt: KeyboardEvent) => {
    if (evt.key === "Enter" && !evt.shiftKey) {
      evt.preventDefault();
      submit();
    }
  });

  container.appendChild(form);
}
