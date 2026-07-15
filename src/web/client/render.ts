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
  const output = el(doc, "pre", "agent-output");
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
 * Renders the selected agent's output. Returns the number of characters now rendered so the
 * caller (AppView) can append-only on the next call instead of replacing the whole pane.
 */
export function renderOutput(pre: HTMLElement, agent: AgentNode | null): number {
  const text = agent?.output ?? "";
  pre.textContent = text;
  return text.length;
}

/** Appends only the new suffix of output to an already-rendered pane (streaming fast path). */
export function appendOutput(
  doc: Document,
  pre: HTMLElement,
  fullText: string,
  fromIndex: number,
): number {
  if (fromIndex >= fullText.length) return fromIndex;
  pre.appendChild(doc.createTextNode(fullText.slice(fromIndex)));
  return fullText.length;
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
