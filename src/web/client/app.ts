// Wires state (state.ts) + transport (sse.ts, commands.ts, download.ts) + rendering
// (render.ts) into a running app. This is the one place with side effects and mutable
// instance state; everything it delegates to is pure/injectable, which is what keeps this
// class itself cheap to test (fake DOM, fake fetch/streams — no `EventSource`, see sse.ts).

import type { ServerSentEvent } from "../../contracts/index.ts";
import type { ServerTarget } from "../protocol.ts";
import {
  CommandError,
  type FetchLike,
  requestAgentTree,
  sendMessage,
  stopAgent,
} from "./commands.ts";
import { type DownloadEnv, downloadLogs } from "./download.ts";
import {
  type AppCallbacks,
  type ShellRefs,
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
import { type SseConnection, connectEvents } from "./sse.ts";
import {
  type ConnectionStatus,
  type WebState,
  applyEvent,
  createInitialState,
  seedFromTree,
  selectAgent,
  selectedAgent,
  setConnectionStatus,
} from "./state.ts";

const NEAR_BOTTOM_THRESHOLD_PX = 48;
const ERROR_BANNER_DURATION_MS = 5000;

export interface AppDeps {
  doc: Document;
  target: ServerTarget;
  downloadEnv: DownloadEnv;
  fetchImpl?: FetchLike;
  /** Injectable for tests; defaults to the real `setTimeout`/`clearTimeout`. Threaded through
   *  to both the SSE reconnect backoff (sse.ts) and the error-banner hide timer below. */
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
}

export class AppView {
  private state: WebState = createInitialState();
  private readonly shell: ShellRefs;
  private connection: SseConnection | null = null;
  private renderedOutputLength = 0;
  private renderedOutputForAgentId: string | null = null;
  private errorTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly callbacks: AppCallbacks = {
    onSelectAgent: (agentId) => {
      this.state = selectAgent(this.state, agentId);
      this.renderedOutputForAgentId = null;
      this.renderAll();
    },
    onSendMessage: (message) => {
      const agent = selectedAgent(this.state);
      if (!agent) return;
      sendMessage(this.deps.target, agent.agentId, message, this.deps.fetchImpl).catch((err) =>
        this.reportError(err),
      );
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
      stopAgent(this.deps.target, agentId, this.deps.fetchImpl).catch((err) =>
        this.reportError(err),
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
      },
      {
        fetchImpl: this.deps.fetchImpl,
        setTimeoutImpl: this.deps.setTimeoutImpl,
        clearTimeoutImpl: this.deps.clearTimeoutImpl,
      },
    );
    this.bootstrapAgentTree();
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
    requestAgentTree(this.deps.target, this.deps.fetchImpl)
      .then((res) => {
        this.state = seedFromTree(this.state, res.tree);
        this.renderAll();
      })
      .catch((err) => this.reportError(err));
  }

  stop(): void {
    this.connection?.close();
    this.connection = null;
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

  private reportError(err: unknown): void {
    const message = err instanceof CommandError ? err.message : "Request failed.";
    showError(this.shell.errorBanner, message);
    const setTimeoutFn = this.deps.setTimeoutImpl ?? setTimeout;
    const clearTimeoutFn = this.deps.clearTimeoutImpl ?? clearTimeout;
    if (this.errorTimer) clearTimeoutFn(this.errorTimer);
    this.errorTimer = setTimeoutFn(() => {
      hideError(this.shell.errorBanner);
    }, ERROR_BANNER_DURATION_MS);
  }

  private renderAll(): void {
    const { doc } = this.deps;
    renderSidebar(doc, this.shell.sidebar, this.state, this.callbacks.onSelectAgent);
    renderConnectionStatus(this.shell.connectionPill, this.state);
    renderSessionSummary(doc, this.shell.sessionSummary, this.state);
    renderAgentHeader(doc, this.shell.agentHeader, this.state, this.callbacks);
    renderComposer(doc, this.shell.composer, this.state, this.callbacks.onSendMessage);
    this.updateOutput();
  }

  private updateOutput(): void {
    const agent = selectedAgent(this.state);
    const currentAgentId = agent?.agentId ?? null;

    if (currentAgentId !== this.renderedOutputForAgentId) {
      this.renderedOutputLength = renderOutput(this.shell.output, agent);
      this.renderedOutputForAgentId = currentAgentId;
      this.scrollToBottom();
      return;
    }
    if (!agent) return;

    const wasNearBottom = this.isNearBottom();
    this.renderedOutputLength = appendOutput(
      this.deps.doc,
      this.shell.output,
      agent.output,
      this.renderedOutputLength,
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
