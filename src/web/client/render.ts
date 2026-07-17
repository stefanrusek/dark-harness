// DOM rendering. Every function here takes an explicit container element and state/props —
// no reliance on globals — so it's testable with happy-dom in addition to a real browser.
// See docs/handoffs/web.md status log for the "joy to use" design notes.

import { parseMarkdown } from "../../markdown/index.ts";
import {
  agentStatusStyle,
  connectionStatusLabel,
  formatCostUsd,
  formatElapsed,
  formatExitCode,
  formatStatusElapsed,
  formatTokenCount,
  formatTokenLabel,
  shortAgentId,
} from "./format.ts";
import { renderMarkdownInto } from "./markdown-dom.ts";
import {
  type AgentNode,
  type Turn,
  type WebState,
  agentDepth,
  isRoot,
  orderedAgents,
  selectedAgent,
  sessionTotals,
} from "./state.ts";

// DH-0093: `/model` picker modal — a dropdown/modal over the composer per the design's
// Web UX contract. Exact widget styling is Susan's call (per the ticket); implemented as a
// simple centered modal following the style guide's "focus/selection always visible" rule
// (§6) rather than a dropdown anchored to the composer, since the composer only exists for
// the root agent and the picker needs to work regardless of which agent is selected.

/** Indent step per tree depth (DH-0066: the sidebar was a flat list with no hierarchy at
 *  all — a fixed per-level indent is the minimal change that makes parent/child legible). */
const SIDEBAR_INDENT_PX = 16;

export interface AppCallbacks {
  onSelectAgent(agentId: string): void;
  onSendMessage(message: string): void;
  onDownloadAgentLog(agentId: string): void;
  onDownloadSessionBundle(): void;
  onStopAgent(agentId: string): void;
}

export interface ShellRefs {
  /** DH-0135: reserved top-of-page mount point for the React `<AppHeader>` slot (see
   *  components/AppHeader.tsx) — mounted above the sidebar/main row per style-guide.md §5. */
  appHeaderSlot: HTMLElement;
  sidebar: HTMLElement;
  connectionPill: HTMLElement;
  sessionSummary: HTMLElement;
  agentHeader: HTMLElement;
  output: HTMLElement;
  scrollRegion: HTMLElement;
  jumpToLatest: HTMLElement;
  /** DH-0135: mount point for the React `<Composer>` component (see
   *  components/Composer.tsx) — owned/rendered by AppView via a `react-dom` root, not by
   *  this module's imperative render functions. */
  composer: HTMLElement;
  errorBanner: HTMLElement;
  /** DH-0024: dismissible "reconnected — history may be incomplete" banner. */
  gapBanner: HTMLElement;
  /** DH-0029: persistent, reviewable log of past errors (the banner above auto-hides). */
  errorLogPanel: HTMLElement;
  /** DH-0093: `/model` picker modal overlay. */
  modelPicker: HTMLElement;
}

/**
 * Builds the static page shell once. Subsequent state changes only touch the pieces
 * returned here, keeping the sidebar/header/output update paths independently cheap.
 */
export function buildShell(doc: Document, root: HTMLElement): ShellRefs {
  root.textContent = "";
  root.className = "dh-app";

  // DH-0135: reserved React-mounted header slot, above the sidebar/main row. Renders
  // nothing until DH-0122 fills it in — see components/AppHeader.tsx.
  const appHeaderSlot = el(doc, "div", "app-header-slot");
  root.appendChild(appHeaderSlot);

  const sidebarPane = el(doc, "nav", "sidebar");
  const brand = el(doc, "div", "brand");
  brand.textContent = "Dark Harness";
  sidebarPane.appendChild(brand);

  const connectionPill = el(doc, "div", "connection-pill");
  // DH-0029 (#39): connection state changes (connecting/reconnecting/open/closed) had no
  // way to reach a screen-reader user — `role="status"` + `aria-live="polite"` announces
  // each change without interrupting whatever the user is doing.
  connectionPill.setAttribute("role", "status");
  connectionPill.setAttribute("aria-live", "polite");
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
  // DH-0029 (#39): streamed agent output previously updated the DOM with no announcement
  // at all — a screen-reader user had no way to know new content had arrived.
  // `role="log"` + `aria-live="polite"` announces additions without re-reading the whole
  // transcript on every chunk.
  output.setAttribute("role", "log");
  output.setAttribute("aria-live", "polite");
  scrollRegion.appendChild(output);
  main.appendChild(scrollRegion);

  const jumpToLatest = el(doc, "button", "jump-to-latest hidden");
  jumpToLatest.type = "button";
  jumpToLatest.textContent = "↓ Jump to latest";
  main.appendChild(jumpToLatest);

  const composer = el(doc, "div", "composer-region");
  main.appendChild(composer);

  // DH-0024: dismissible banner shown after any SSE reconnect, since a reconnect may have
  // missed events (see sse.ts's `onReconnected` doc comment for why this is conservative).
  const gapBanner = el(doc, "div", "gap-banner hidden");
  gapBanner.setAttribute("role", "status");
  gapBanner.setAttribute("aria-live", "polite");
  main.appendChild(gapBanner);

  const errorBanner = el(doc, "div", "error-banner hidden");
  // DH-0029 (#39): an error banner is exactly the kind of urgent, out-of-band change
  // `role="alert"` exists for — announced immediately, unlike `aria-live="polite"`.
  errorBanner.setAttribute("role", "alert");
  main.appendChild(errorBanner);

  // DH-0029 (#34): both clients previously showed only a transient (auto-hiding) error
  // banner with no way to review what was missed. This panel is the persistent history —
  // always in the DOM (collapsed by CSS until there's something to show), listing every
  // reported error with a timestamp, newest first.
  const errorLogPanel = el(doc, "details", "error-log-panel hidden");
  const errorLogSummary = el(doc, "summary", "error-log-summary");
  errorLogSummary.textContent = "Errors";
  errorLogPanel.appendChild(errorLogSummary);
  const errorLogList = el(doc, "ul", "error-log-list");
  errorLogList.setAttribute("role", "log");
  errorLogPanel.appendChild(errorLogList);
  main.appendChild(errorLogPanel);

  root.appendChild(sidebarPane);
  root.appendChild(main);

  // DH-0093: appended at the root level (not inside `main`) so it overlays the whole app,
  // matching a real modal rather than being clipped to the main pane.
  const modelPicker = el(doc, "div", "model-picker-overlay hidden");
  modelPicker.setAttribute("role", "dialog");
  modelPicker.setAttribute("aria-modal", "true");
  modelPicker.setAttribute("aria-label", "Select model");
  root.appendChild(modelPicker);

  return {
    appHeaderSlot,
    sidebar,
    connectionPill,
    sessionSummary,
    agentHeader,
    output,
    scrollRegion,
    jumpToLatest,
    composer,
    errorBanner,
    gapBanner,
    errorLogPanel,
    modelPicker,
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

/** DH-0024: shows the "reconnected — history may be incomplete" banner. */
export function showGapBanner(banner: HTMLElement, onDismiss: () => void): void {
  banner.textContent = "";
  const text = el(banner.ownerDocument, "span");
  text.textContent = "Reconnected — history may be incomplete.";
  banner.appendChild(text);
  const dismiss = el(banner.ownerDocument, "button", "gap-banner-dismiss");
  dismiss.type = "button";
  dismiss.textContent = "Dismiss";
  dismiss.addEventListener("click", onDismiss);
  banner.appendChild(dismiss);
  banner.classList.remove("hidden");
}

export function hideGapBanner(banner: HTMLElement): void {
  banner.classList.add("hidden");
}

/**
 * DH-0029 (#34): renders the persistent error-history panel from `state.errorLog`, newest
 * first. Hidden (via CSS) whenever the log is empty so it never occupies space with nothing
 * to show.
 */
export function renderErrorLog(doc: Document, panel: HTMLElement, state: WebState): void {
  const list = panel.querySelector<HTMLElement>(".error-log-list");
  if (!list) return;
  list.textContent = "";

  if (state.errorLog.length === 0) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");

  for (const entry of [...state.errorLog].reverse()) {
    const item = el(doc, "li", "error-log-entry");
    const time = el(doc, "span", "error-log-time");
    time.textContent = new Date(entry.timestamp).toLocaleTimeString();
    item.appendChild(time);
    const message = el(doc, "span", "error-log-message");
    message.textContent = entry.message;
    item.appendChild(message);
    list.appendChild(item);
  }
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
  // DH-0029 (#38): the agent tree was a plain <ul> of <li>s with only a click handler — no
  // way to reach it from a keyboard at all. `role="listbox"` + per-row `role="option"`
  // (below) with `tabindex="0"` and Enter/Space handling makes it a standard keyboard-
  // operable single-select list.
  const list = el(doc, "ul", "agent-tree");
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Agents");

  for (const agent of orderedAgents(state)) {
    const style = agentStatusStyle(agent.status);
    const item = el(doc, "li", "agent-row");
    item.dataset.agentId = agent.agentId;
    item.dataset.status = agent.status;
    item.setAttribute("role", "option");
    item.tabIndex = 0;
    const selected = agent.agentId === state.selectedAgentId;
    item.setAttribute("aria-selected", String(selected));
    if (selected) item.classList.add("selected");
    if (isRoot(state, agent.agentId)) item.classList.add("root");

    // DH-0066: indent by tree depth so the sidebar reads as a hierarchy, not a flat list —
    // the product's signature "agent tree" (HANDOFF §9) wasn't actually a tree visually.
    const depth = agentDepth(state, agent.agentId);
    if (depth > 0) {
      item.style.paddingLeft = `calc(var(--space-2) + ${depth * SIDEBAR_INDENT_PX}px)`;
    }

    const dot = el(doc, "span", `status-dot status-${style.token}`);
    // DH-0029 (#40): the status dot's only description was a hover-only `title` tooltip —
    // invisible to keyboard/screen-reader users. `aria-label` (plus `aria-hidden` so the
    // dot itself isn't announced as an unlabeled second copy) puts the same text on the row
    // instead, which already carries the accessible name via its own content.
    dot.title = style.label;
    dot.setAttribute("aria-hidden", "true");
    item.appendChild(dot);

    const label = el(doc, "span", "agent-label");
    // DH-0069: prefer the spawning Agent tool call's `description` — a human-readable label
    // ("Fix flaky retry test") — over the raw `model · shortAgentId` fallback, matching the
    // TUI's `renderTree` (src/tui/render.ts). Root never has a description (nothing spawned
    // it via the Agent tool), so it always keeps its "root" label.
    label.textContent = isRoot(state, agent.agentId)
      ? "root"
      : (agent.description ?? `${agent.model || "agent"} · ${shortAgentId(agent.agentId)}`);
    item.appendChild(label);

    const elapsed = el(doc, "span", "agent-elapsed");
    elapsed.textContent = formatElapsed(now - Date.parse(agent.statusSince));
    elapsed.title = `Time in "${style.label}"`;
    item.appendChild(elapsed);

    const tokens = el(doc, "span", "agent-tokens");
    // DH-0066: a bare integer next to an elapsed-time label read as a mystery number — the
    // unit makes it self-explanatory without needing a hover.
    tokens.textContent = formatTokenLabel(agent.inputTokens + agent.outputTokens);
    item.appendChild(tokens);

    item.setAttribute(
      "aria-label",
      `${
        isRoot(state, agent.agentId) ? "root" : (agent.description ?? (agent.model || "agent"))
      }, status: ${style.label}`,
    );

    const select = () => onSelect(agent.agentId);
    item.addEventListener("click", select);
    item.addEventListener("keydown", (evt: KeyboardEvent) => {
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        select();
      }
    });
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
  // DH-0069: same description-first labeling as the sidebar row above.
  name.textContent = isRoot(state, agent.agentId)
    ? "Root agent"
    : (agent.description ?? `${agent.model || "agent"} (${shortAgentId(agent.agentId)})`);
  title.appendChild(name);
  // DH-0093: the root agent's own display previously never showed *which* model it was
  // running (only non-root rows fell back to `model (shortId)` when no description was
  // given) — with `/model` able to switch it mid-session, the header needs to show the
  // current model regardless of role so a switch is actually visible somewhere, not just a
  // silent internal field update. Always shown (not just for root) for consistency.
  const modelBadge = el(doc, "span", "agent-header-model");
  modelBadge.textContent = agent.model || "(unknown model)";
  modelBadge.title = "Active model — /model to switch";
  title.appendChild(modelBadge);
  const badge = el(doc, "span", `status-badge status-${style.token}`);
  badge.textContent = style.label;
  title.appendChild(badge);
  const elapsed = el(doc, "span", "status-elapsed");
  // DH-0066: `formatStatusElapsed` avoids the broken-English "WAITING for just now" — the
  // "for" prefix only makes sense once there's an actual duration to attach it to.
  elapsed.textContent = formatStatusElapsed(now - Date.parse(agent.statusSince));
  elapsed.title = `Time since this agent last changed status — helps tell "still thinking" from "stalled" during a long turn`;
  title.appendChild(elapsed);
  container.appendChild(title);

  const stats = el(doc, "div", "agent-header-stats");
  stats.textContent = `${formatTokenCount(agent.inputTokens)} in / ${formatTokenCount(
    agent.outputTokens,
  )} out · ${formatCostUsd(agent.hasCost ? agent.costUsd : null)}`;
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
  if (role === "user") return "You";
  if (role === "system") return "System";
  return "Agent";
}

/**
 * Renders a turn's text into `container` (its existing content is fully replaced). User and
 * system turns are plain text, not Markdown (DH-0056 D3/D4 parity with the TUI: only
 * assistant output is parsed as Markdown; DH-0093's `system` role — local `/help` entries —
 * follows the same rule, it's composed client-side text, not model output). Assistant turns
 * go through the shared parser (`src/markdown/index.ts`) and the DOM-only renderer
 * (`markdown-dom.ts`) — never `innerHTML`.
 */
function renderTurnText(doc: Document, container: HTMLElement, turn: Turn): void {
  if (turn.role === "user" || turn.role === "system" || turn.role === "tool") {
    container.textContent = turn.text;
    return;
  }
  renderMarkdownInto(doc, container, parseMarkdown(turn.text));
}

/** DH-0089: a `"tool"` turn is a compact, single-row marker for a generic tool call/result
 * (`toolName: inputSummary`) — no "You"/"Agent" role label (per D5, unlike every other
 * role), just a muted `⚙` glyph + text, with a red `✗` appended when `toolError` is set. */
function buildToolTurnElement(doc: Document, turn: Turn): HTMLElement {
  const classes = turn.toolError ? "turn turn-tool turn-tool-error" : "turn turn-tool";
  const wrapper = el(doc, "div", classes);
  const text = el(doc, "div", "turn-text");
  text.textContent = turn.toolError ? `⚙ ${turn.text} ✗` : `⚙ ${turn.text}`;
  wrapper.appendChild(text);
  return wrapper;
}

function buildTurnElement(doc: Document, turn: Turn): HTMLElement {
  if (turn.role === "tool") return buildToolTurnElement(doc, turn);
  const wrapper = el(doc, "div", `turn turn-${turn.role}`);
  const role = el(doc, "div", "turn-role");
  role.textContent = turnRoleLabel(turn.role);
  wrapper.appendChild(role);
  const text = el(doc, "div", "turn-text");
  renderTurnText(doc, text, turn);
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
  sessionEnded = false,
  exitCode: number | null = null,
): TranscriptRenderState {
  container.textContent = "";
  const transcript = agent?.transcript ?? [];
  if (transcript.length === 0) {
    // DH-0066: a genuinely empty transcript pane (no turns yet) previously rendered as
    // blank space with no explanation — indistinguishable from "still loading" or a bug.
    container.appendChild(buildEmptyTranscriptState(doc, agent));
  } else {
    for (const turn of transcript) {
      container.appendChild(buildTurnElement(doc, turn));
    }
  }
  maybeAppendThinkingIndicator(doc, container, agent, transcript);
  maybeAppendSessionEndEcho(doc, container, sessionEnded, exitCode);
  return {
    turnCount: transcript.length,
    lastTurnTextLength: transcript.at(-1)?.text.length ?? 0,
  };
}

/**
 * DH-0066 "cheap delight" nit: echoes the sidebar's end-of-session banner once into
 * whichever transcript pane is currently open, so a session ending is visible without
 * having to glance at the sidebar — the sidebar's own banner (`renderSessionSummary`)
 * stays the source of truth; this is a read-only echo, not a second copy of the state.
 * Idempotent per render call (removes any stale echo first, matching
 * `maybeAppendThinkingIndicator`'s pattern) so both the full-rebuild and incremental-append
 * paths can call it unconditionally without double-appending.
 */
function maybeAppendSessionEndEcho(
  doc: Document,
  container: HTMLElement,
  sessionEnded: boolean,
  exitCode: number | null,
): void {
  container.querySelector(".session-end-echo")?.remove();
  if (!sessionEnded || exitCode === null) return;
  const echo = el(
    doc,
    "div",
    `session-end-echo ${exitCode === 0 ? "session-banner-ok" : "session-banner-fail"}`,
  );
  echo.textContent = `Session ended — ${formatExitCode(exitCode)}`;
  container.appendChild(echo);
}

/** DH-0066: real empty state for an agent that hasn't produced any output yet, instead of
 *  blank space in the transcript pane. */
function buildEmptyTranscriptState(doc: Document, agent: AgentNode | null): HTMLElement {
  const empty = el(doc, "div", "empty-state");
  empty.textContent = agent
    ? `No output yet — spawned just now, model ${agent.model || "unknown"}.`
    : "Waiting for an agent to spawn…";
  return empty;
}

/**
 * DH-0066: a lightweight "thinking" placeholder (pulsing three dots) shown while an agent is
 * `running` but hasn't opened an assistant turn for its *current* turn yet — the architect
 * review's liveness spike found nothing at all in the transcript pane during a slow turn
 * except the header's elapsed timer. `turnOpen` (see state.ts) is exactly "is there an
 * assistant turn currently accumulating for this running turn," so its absence while
 * `running` is precisely the gap this fills.
 */
function maybeAppendThinkingIndicator(
  doc: Document,
  container: HTMLElement,
  agent: AgentNode | null,
  transcript: Turn[],
): void {
  if (!agent || agent.status !== "running" || agent.turnOpen) return;
  const lastTurn = transcript.at(-1);
  if (lastTurn && lastTurn.role === "assistant") return;
  const thinking = el(doc, "div", "turn turn-assistant turn-thinking");
  const role = el(doc, "div", "turn-role");
  role.textContent = turnRoleLabel("assistant");
  thinking.appendChild(role);
  const dots = el(doc, "div", "turn-text thinking-dots");
  dots.setAttribute("aria-label", "Agent is thinking");
  for (let i = 0; i < 3; i++) {
    dots.appendChild(el(doc, "span", "thinking-dot"));
  }
  thinking.appendChild(dots);
  container.appendChild(thinking);
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
  sessionEnded = false,
  exitCode: number | null = null,
): TranscriptRenderState {
  const transcript = agent?.transcript ?? [];
  if (transcript.length === 0) {
    if (rendered.turnCount === 0) {
      maybeAppendSessionEndEcho(doc, container, sessionEnded, exitCode);
      return EMPTY_TRANSCRIPT_RENDER_STATE;
    }
    return renderTranscript(doc, container, agent, sessionEnded, exitCode);
  }
  if (rendered.turnCount === 0) {
    return renderTranscript(doc, container, agent, sessionEnded, exitCode);
  }

  const lastRenderedTurn = transcript[rendered.turnCount - 1];
  if (lastRenderedTurn && lastRenderedTurn.text.length > rendered.lastTurnTextLength) {
    const lastTurnEl = container.children[rendered.turnCount - 1];
    const textEl = lastTurnEl?.querySelector<HTMLElement>(".turn-text");
    // DH-0056 D4: a streamed chunk can retroactively change the last turn's Markdown
    // structure (e.g. close a previously-unterminated fenced code block), so the fast path
    // re-parses and rebuilds the whole turn's text rather than appending a raw text node —
    // appending would be wrong once the turn is rendered as Markdown instead of plain text.
    // Still cheap: one re-parse of one (bounded) turn per event, not the whole transcript.
    if (textEl) {
      renderTurnText(doc, textEl, lastRenderedTurn);
    }
  }

  // The thinking placeholder's visibility depends on live agent state (status, turnOpen),
  // not just transcript length — cheapest correct approach is to drop any stale one before
  // appending new turns (so new turns land before it, not after a stale trailing node) and
  // decide fresh on every call, mirroring what a full renderTranscript would render.
  // `maybeAppendSessionEndEcho` below does its own equivalent stale-node removal for the
  // session-end echo, so new turns always land above it rather than after a stale copy.
  container.querySelector(".turn-thinking")?.remove();

  for (let i = rendered.turnCount; i < transcript.length; i++) {
    const turn = transcript[i];
    if (turn) container.appendChild(buildTurnElement(doc, turn));
  }

  maybeAppendThinkingIndicator(doc, container, agent, transcript);
  maybeAppendSessionEndEcho(doc, container, sessionEnded, exitCode);

  return {
    turnCount: transcript.length,
    lastTurnTextLength: transcript.at(-1)?.text.length ?? 0,
  };
}

/**
 * DH-0093: renders the `/model` picker modal. Content/markers match the TUI picker's spec
 * (design §2: `name  (provider/model)` with active/default tags) — full keyboard support
 * (Tab between rows, Enter/Space selects, Escape closes — Escape is wired at the app level
 * since it isn't scoped to any one row) plus a click-to-select row and a backdrop-click /
 * Cancel-button close, per "full keyboard support (arrows + enter, escape closes)."
 */
export function renderModelPicker(
  doc: Document,
  container: HTMLElement,
  state: WebState,
  onSelect: (name: string) => void,
  onClose: () => void,
): void {
  if (!state.modelPickerOpen) {
    container.classList.add("hidden");
    container.textContent = "";
    container.onclick = null;
    return;
  }
  container.classList.remove("hidden");
  container.textContent = "";
  // Assigning `.onclick` (rather than `addEventListener`) is intentionally idempotent across
  // repeated renders — this function fully rebuilds `container`'s children every call, and an
  // accumulating `addEventListener` here (the container itself is never rebuilt, only its
  // content) would stack a new backdrop-close handler on every open/close cycle.
  container.onclick = (evt) => {
    if (evt.target === container) onClose();
  };

  const panel = el(doc, "div", "model-picker-panel");
  const heading = el(doc, "div", "model-picker-heading");
  heading.textContent = "Select model";
  panel.appendChild(heading);

  if (state.models.length === 0) {
    const empty = el(doc, "div", "empty-state");
    empty.textContent = "No models configured.";
    panel.appendChild(empty);
  } else {
    const list = el(doc, "ul", "model-picker-list");
    list.setAttribute("role", "listbox");
    for (const model of state.models) {
      const item = el(doc, "li", "model-picker-row");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(model.isActive));
      item.tabIndex = 0;
      if (model.isActive) item.classList.add("active");

      const name = el(doc, "span", "model-picker-name");
      name.textContent = model.name;
      item.appendChild(name);

      const detail = el(doc, "span", "model-picker-detail");
      detail.textContent = `(${model.provider}/${model.model})`;
      item.appendChild(detail);

      const tags = [model.isActive ? "active" : null, model.isDefault ? "default" : null].filter(
        (t): t is string => t !== null,
      );
      if (tags.length > 0) {
        const tagEl = el(doc, "span", "model-picker-tags");
        tagEl.textContent = `[${tags.join(", ")}]`;
        item.appendChild(tagEl);
      }

      const select = () => onSelect(model.name);
      item.addEventListener("click", (evt) => {
        evt.stopPropagation();
        select();
      });
      item.addEventListener("keydown", (evt: KeyboardEvent) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          select();
        }
      });
      list.appendChild(item);
    }
    panel.appendChild(list);
  }

  const closeBtn = el(doc, "button", "btn btn-secondary model-picker-close");
  closeBtn.type = "button";
  closeBtn.textContent = "Cancel";
  closeBtn.addEventListener("click", (evt) => {
    evt.stopPropagation();
    onClose();
  });
  panel.appendChild(closeBtn);

  container.appendChild(panel);
}
