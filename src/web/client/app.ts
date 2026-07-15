// Wires state (state.ts) + transport (sse.ts, commands.ts, download.ts) + rendering
// (render.ts) into a running app. This is the one place with side effects and mutable
// instance state; everything it delegates to is pure/injectable, which is what keeps this
// class itself cheap to test (fake DOM, fake fetch/streams — no `EventSource`, see sse.ts).

import type { ServerSentEvent } from "../../contracts/index.ts";
import type { ServerTarget } from "../protocol.ts";
import {
  CommandError,
  type FetchLike,
  type SendCommandOptions,
  requestAgentTree,
  sendMessage,
  stopAgent,
} from "./commands.ts";
import { type DownloadEnv, downloadLogs } from "./download.ts";
import {
  type AppCallbacks,
  type ShellRefs,
  type TranscriptRenderState,
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
import { type SseConnection, connectEvents } from "./sse.ts";
import {
  type ConnectionStatus,
  type WebState,
  addUserTurn,
  applyEvent,
  createInitialState,
  dismissPossibleGap,
  logError,
  markPossibleGap,
  seedFromTree,
  selectAgent,
  selectedAgent,
  setConnectionStatus,
} from "./state.ts";

const NEAR_BOTTOM_THRESHOLD_PX = 48;
const ERROR_BANNER_DURATION_MS = 5000;
/** How often the "time in current status" indicator ticks forward with no new event. */
const LIVENESS_TICK_MS = 1000;

export interface AppDeps {
  doc: Document;
  target: ServerTarget;
  downloadEnv: DownloadEnv;
  fetchImpl?: FetchLike;
  /** Injectable for tests; defaults to the real `setTimeout`/`clearTimeout`. Threaded through
   *  to both the SSE reconnect backoff (sse.ts) and the error-banner hide timer below. */
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
  /** Injectable clock for the liveness indicator (docs/handoffs/web.md Round 3); defaults to
   *  `Date.now`. Tests supply a fake clock instead of sleeping in real time. */
  nowFn?: () => number;
  /** Injectable interval timer driving the liveness indicator's live tick; defaults to the
   *  real `setInterval`/`clearInterval`. */
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
}

export class AppView {
  private state: WebState = createInitialState();
  private readonly shell: ShellRefs;
  private connection: SseConnection | null = null;
  private renderedTranscript: TranscriptRenderState = { turnCount: 0, lastTurnTextLength: 0 };
  private renderedTranscriptForAgentId: string | null = null;
  private errorTimer: ReturnType<typeof setTimeout> | undefined;
  private livenessTimer: ReturnType<typeof setInterval> | undefined;

  private readonly callbacks: AppCallbacks = {
    onSelectAgent: (agentId) => {
      this.state = selectAgent(this.state, agentId);
      this.renderedTranscriptForAgentId = null;
      this.renderAll();
    },
    onSendMessage: (message) => {
      const agent = selectedAgent(this.state);
      if (!agent) return;
      // Local echo, same as any real chat UI: the operator's own turn appears immediately,
      // client-side — it never arrives over SSE, so waiting for a server round-trip would
      // mean the conversation view never showed what was actually sent (docs/handoffs/web.md
      // Round 4).
      const nowFn = this.deps.nowFn ?? Date.now;
      this.state = addUserTurn(this.state, agent.agentId, message, new Date(nowFn()).toISOString());
      this.renderAll();
      sendMessage(
        this.deps.target,
        agent.agentId,
        message,
        this.deps.fetchImpl,
        this.commandOptions(),
      ).catch((err) => this.reportError(err));
    },
    onDownloadAgentLog: (agentId) => {
      downloadLogs(this.deps.target, agentId, this.deps.downloadEnv, this.deps.fetchImpl).catch(
        (err) => this.reportError(err),
      );
    },
    onDownloadSessionBundle: () => {
      downloadLogs(this.deps.target, undefined, this.deps.downloadEnv, this.deps.fetchImpl).catch(
        (err) => this.reportError(err),
      );
    },
    onStopAgent: (agentId) => {
      stopAgent(this.deps.target, agentId, this.deps.fetchImpl, this.commandOptions()).catch(
        (err) => this.reportError(err),
      );
    },
  };

  constructor(
    private readonly root: HTMLElement,
    private readonly deps: AppDeps,
  ) {
    this.shell = buildShell(deps.doc, root);
    this.shell.jumpToLatest.addEventListener("click", () => this.scrollToBottom());
    this.shell.scrollRegion.addEventListener("scroll", () => this.handleScroll());
    this.renderAll();
  }

  /** Opens the SSE connection. Separated from construction so tests can render without it. */
  start(): void {
    this.connection = connectEvents(
      this.deps.target,
      {
        onEvent: (event) => this.handleEvent(event),
        onStatusChange: (status) => this.handleStatus(status),
        onReconnected: () => this.handleReconnected(),
      },
      {
        fetchImpl: this.deps.fetchImpl,
        setTimeoutImpl: this.deps.setTimeoutImpl,
        clearTimeoutImpl: this.deps.clearTimeoutImpl,
      },
    );
    this.bootstrapAgentTree();
    this.startLivenessTicker();
  }

  /** Options threaded into every command send so a hung request reports a timeout instead
   *  of hanging silently forever (DH-0029 #37) — shares the same injectable timer deps used
   *  elsewhere in this class. */
  private commandOptions(): SendCommandOptions {
    const options: SendCommandOptions = {};
    if (this.deps.setTimeoutImpl) options.setTimeoutImpl = this.deps.setTimeoutImpl;
    if (this.deps.clearTimeoutImpl) options.clearTimeoutImpl = this.deps.clearTimeoutImpl;
    return options;
  }

  /**
   * Keeps the "time in current status" indicator (docs/handoffs/web.md Round 3) advancing
   * even when no new SSE event arrives — the whole point is showing a silent, stalled
   * `running` turn as visibly aging in real time rather than looking identical to a fresh
   * one. Re-renders on a fixed tick; injectable clock/timer so tests never sleep for real.
   */
  private startLivenessTicker(): void {
    const setIntervalFn = this.deps.setIntervalImpl ?? setInterval;
    this.livenessTimer = setIntervalFn(() => this.renderAll(), LIVENESS_TICK_MS);
  }

  /**
   * Learns the root agent's id via `request_agent_tree` (Server synthesizes a pre-start
   * root node — `status: "waiting"`, `parentAgentId: null` — before any message is ever
   * sent). This is the *only* bootstrap path for a fresh session: `agent_spawned` (the SSE
   * event that would otherwise seed `rootAgentId`) never fires until the agent loop starts,
   * which never happens until someone sends the first message through the composer — which
   * the composer can't render without already knowing the root's id. Without this call, a
   * fresh `dh --web` session deadlocks: nothing to select, no composer, no way in.
   * Runs independently of (and races harmlessly with) the SSE connection above — whichever
   * resolves first wins; `seedFromTree`/`applyEvent` are both idempotent about it.
   */
  private bootstrapAgentTree(): void {
    requestAgentTree(this.deps.target, this.deps.fetchImpl, this.commandOptions())
      .then((res) => {
        const nowFn = this.deps.nowFn ?? Date.now;
        this.state = seedFromTree(this.state, res.tree, new Date(nowFn()).toISOString());
        this.renderAll();
      })
      .catch((err) => this.reportError(err));
  }

  stop(): void {
    this.connection?.close();
    this.connection = null;
    if (this.livenessTimer !== undefined) {
      const clearIntervalFn = this.deps.clearIntervalImpl ?? clearInterval;
      clearIntervalFn(this.livenessTimer);
      this.livenessTimer = undefined;
    }
  }

  getState(): WebState {
    return this.state;
  }

  private handleEvent(event: ServerSentEvent): void {
    this.state = applyEvent(this.state, event);
    this.renderAll();
  }

  private handleStatus(status: ConnectionStatus): void {
    this.state = setConnectionStatus(this.state, status);
    renderConnectionStatus(this.shell.connectionPill, this.state);
  }

  /** DH-0024: fires on every SSE reconnect (not the initial connect) — see sse.ts's
   *  `onReconnected` for why this is treated as a possible gap. Shows the dismissible
   *  banner; the operator dismisses it once they've seen it (`dismissGapBanner`). */
  private handleReconnected(): void {
    this.state = markPossibleGap(this.state);
    this.renderAll();
  }

  private dismissGapBanner(): void {
    this.state = dismissPossibleGap(this.state);
    hideGapBanner(this.shell.gapBanner);
  }

  private reportError(err: unknown): void {
    const message = err instanceof CommandError ? err.message : "Request failed.";
    showError(this.shell.errorBanner, message);
    const nowFn = this.deps.nowFn ?? Date.now;
    this.state = logError(this.state, message, new Date(nowFn()).toISOString());
    renderErrorLog(this.deps.doc, this.shell.errorLogPanel, this.state);
    const setTimeoutFn = this.deps.setTimeoutImpl ?? setTimeout;
    const clearTimeoutFn = this.deps.clearTimeoutImpl ?? clearTimeout;
    if (this.errorTimer) clearTimeoutFn(this.errorTimer);
    this.errorTimer = setTimeoutFn(() => {
      hideError(this.shell.errorBanner);
    }, ERROR_BANNER_DURATION_MS);
  }

  private renderAll(): void {
    const { doc } = this.deps;
    const nowFn = this.deps.nowFn ?? Date.now;
    const now = nowFn();
    renderSidebar(doc, this.shell.sidebar, this.state, this.callbacks.onSelectAgent, now);
    renderConnectionStatus(this.shell.connectionPill, this.state);
    renderSessionSummary(doc, this.shell.sessionSummary, this.state);
    renderAgentHeader(doc, this.shell.agentHeader, this.state, this.callbacks, now);
    renderComposer(doc, this.shell.composer, this.state, this.callbacks.onSendMessage);
    if (this.state.possibleGap) {
      showGapBanner(this.shell.gapBanner, () => this.dismissGapBanner());
    } else {
      hideGapBanner(this.shell.gapBanner);
    }
    renderErrorLog(doc, this.shell.errorLogPanel, this.state);
    this.updateOutput();
  }

  private updateOutput(): void {
    const agent = selectedAgent(this.state);
    const currentAgentId = agent?.agentId ?? null;

    if (currentAgentId !== this.renderedTranscriptForAgentId) {
      this.renderedTranscript = renderTranscript(this.deps.doc, this.shell.output, agent);
      this.renderedTranscriptForAgentId = currentAgentId;
      this.scrollToBottom();
      return;
    }
    if (!agent) return;

    const wasNearBottom = this.isNearBottom();
    this.renderedTranscript = appendTranscript(
      this.deps.doc,
      this.shell.output,
      agent,
      this.renderedTranscript,
    );
    if (wasNearBottom) {
      this.scrollToBottom();
    } else {
      this.shell.jumpToLatest.classList.remove("hidden");
    }
  }

  private isNearBottom(): boolean {
    const region = this.shell.scrollRegion;
    return region.scrollHeight - region.scrollTop - region.clientHeight < NEAR_BOTTOM_THRESHOLD_PX;
  }

  private scrollToBottom(): void {
    this.shell.scrollRegion.scrollTop = this.shell.scrollRegion.scrollHeight;
    this.shell.jumpToLatest.classList.add("hidden");
  }

  private handleScroll(): void {
    if (this.isNearBottom()) this.shell.jumpToLatest.classList.add("hidden");
  }
}
