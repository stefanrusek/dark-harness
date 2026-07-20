// Wires state (state.ts) + transport (sse.ts, commands.ts, download.ts) into a running app,
// owning the SSE subscription and a single React root render of <App> (DH-0135). This is the
// one place with side effects and mutable instance state; everything it delegates to is
// pure/injectable, which is what keeps this class itself cheap to test (fake DOM, fake
// fetch/streams — no `EventSource`, see sse.ts).

import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseSlashCommand } from "../../client-core/slash-command-parser.ts";
import type { ServerSentEvent } from "../../contracts/index.ts";
import type { HeaderInfo } from "../../header-info.ts";
import type { ServerTarget } from "../protocol.ts";
import {
  CommandError,
  cancelQueuedMessage,
  type FetchLike,
  invokeSkill,
  listModels,
  listSkills,
  requestAgentTree,
  type SendCommandOptions,
  sendMessage,
  stopAgent,
  switchModel,
} from "./commands.ts";
import { App } from "./components/App.tsx";
import { type DownloadEnv, downloadLogs } from "./download.ts";
import { connectEvents, type SseConnection } from "./sse.ts";
import {
  addSystemTurn,
  addUserTurn,
  applyEvent,
  type ConnectionStatus,
  clearAllTranscripts,
  closeModelPicker,
  createInitialState,
  dismissPossibleGap,
  documentTitle,
  logError,
  markPossibleGap,
  seedFromTree,
  selectAgent,
  selectedAgent,
  setConnectionStatus,
  setModelsAndOpenPicker,
  setSkills,
  type WebState,
} from "./state.ts";

const ERROR_BANNER_DURATION_MS = 5000;
/** How often the "time in current status" indicator ticks forward with no new event. */
const LIVENESS_TICK_MS = 1000;

/** DH-0044 D9 (Web/Susan): default `requestAnimationFrame`/`cancelAnimationFrame`, falling
 *  back to an immediate-macrotask `setTimeout` when no real rAF exists (headless test
 *  environments — `bun test` has no DOM globals). Production (a real browser) always has
 *  `requestAnimationFrame`; the fallback only exists so this module has a sensible default
 *  without forcing every test to inject one. */
function defaultRaf(cb: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(cb);
  return setTimeout(() => cb(Date.now()), 0) as unknown as number;
}

function defaultCancelRaf(handle: number): void {
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(handle);
    return;
  }
  clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
}

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
  /** DH-0044 D9: injectable `requestAnimationFrame`/`cancelAnimationFrame`, used to batch
   *  SSE-driven DOM updates (see `scheduleRenderAll`). Defaults to the real rAF (falling back
   *  to an immediate macrotask outside a browser — see `defaultRaf`). */
  rafImpl?: (cb: FrameRequestCallback) => number;
  cancelRafImpl?: (handle: number) => void;
  /** DH-0122: app name/version/build identity + `dh.json` config-status summary, fetched
   *  from `WEB_CONFIG_PATH` alongside `target` (see main.ts) — static for the process
   *  lifetime, so it's threaded straight into every render rather than through `WebState`. */
  headerInfo?: HeaderInfo;
}

export class AppView {
  private state: WebState = createInitialState();
  private errorMessage: string | null = null;
  /** DH-0135: single `react-dom` root for the whole app — replaces the per-section
   *  imperative render functions in the old render.ts. */
  private readonly root: Root;
  /** Guards the root from being rendered into after `stop()` — a coalesced render scheduled
   *  just before `stop()` (see `scheduleRenderAll`) can still fire after the root is
   *  unmounted if the injected `rafImpl`/timer implementation doesn't cancel synchronously;
   *  `react-dom` throws on `Root.render()` after `unmount()`. */
  private stopped = false;
  private connection: SseConnection | null = null;
  private errorTimer: ReturnType<typeof setTimeout> | undefined;
  private livenessTimer: ReturnType<typeof setInterval> | undefined;
  /** DH-0044 D9: batches SSE-driven `renderAll()` calls to at most one per animation frame —
   *  see `scheduleRenderAll`. */
  private renderRafHandle: number | undefined;

  constructor(
    readonly container: HTMLElement,
    private readonly deps: AppDeps,
  ) {
    this.root = createRoot(container);
    deps.doc.addEventListener("keydown", (evt: KeyboardEvent) => {
      if (evt.key !== "Escape") return;
      if (this.state.modelPickerOpen) {
        this.closeModelPicker();
        return;
      }
      // DH-0211: Escape stops the currently-selected/focused agent, mirroring the TUI's
      // Ctrl+C convention (DH-0059) — a stop is recoverable, not destructive to data, so no
      // confirmation prompt is required (same call the TUI makes; see state.ts's handleCtrlC
      // doc comment). Only fires when nothing higher-priority already consumed the key (the
      // model picker check above) and there's actually something running/waiting to stop.
      const agent = selectedAgent(this.state);
      if (!agent) return;
      if (agent.status !== "running" && agent.status !== "waiting") return;
      stopAgent(this.deps.target, agent.agentId, this.deps.fetchImpl, this.commandOptions()).catch(
        (err) => this.reportError(err),
      );
    });
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
    this.bootstrapSkills();
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

  /** DH-0093: fetches the skill list once at startup, alongside the tree bootstrap above, so
   *  `/help` and `/<skillname>` resolve locally with zero per-keystroke round-trips. */
  private bootstrapSkills(): void {
    listSkills(this.deps.target, this.deps.fetchImpl, this.commandOptions())
      .then((res) => {
        this.state = setSkills(this.state, res.skills);
      })
      .catch((err) => this.reportError(err));
  }

  /** Local, never-sent transcript entry text for `/help` (DH-0093 design §3) — mirrors the
   *  TUI's `helpText` content exactly (see src/tui/state.ts) so the two clients don't drift
   *  on the disclosed built-in set or the "does NOT reset context" honesty note. */
  private helpText(): string {
    const lines = [
      "Available commands:",
      "  /model [name]   show/switch the active model (no arg opens a picker)",
      "  /help           show this message",
      "  /clear          clear the local transcript view (does NOT reset the agent's context)",
    ];
    if (this.state.skills.length > 0) {
      lines.push("");
      lines.push("Skill commands:");
      for (const skill of this.state.skills) {
        lines.push(`  /${skill.name}   ${skill.description}`);
      }
    }
    return lines.join("\n");
  }

  /** Dispatch a parsed slash command (DH-0093 design §1-4) — never produces a `sendMessage`
   *  call, which is the whole point of interception in `onSendMessage` above. */
  private handleSlashCommand(name: string, args: string): void {
    const nowFn = this.deps.nowFn ?? Date.now;
    const now = () => new Date(nowFn()).toISOString();

    if (name === "help") {
      const agent = selectedAgent(this.state);
      if (agent) {
        this.state = addSystemTurn(this.state, agent.agentId, this.helpText(), now());
      }
      this.renderAll();
      return;
    }

    if (name === "clear") {
      this.state = clearAllTranscripts(this.state);
      this.renderAll();
      return;
    }

    const agent = selectedAgent(this.state);
    if (!agent) return;

    if (name === "model") {
      const trimmedArgs = args.trim();
      if (trimmedArgs === "") {
        listModels(this.deps.target, this.deps.fetchImpl, this.commandOptions())
          .then((res) => {
            this.state = setModelsAndOpenPicker(this.state, res.models);
            this.renderAll();
          })
          .catch((err) => this.reportError(err));
        return;
      }
      switchModel(
        this.deps.target,
        agent.agentId,
        trimmedArgs,
        this.deps.fetchImpl,
        this.commandOptions(),
      ).catch((err) => this.reportError(err));
      return;
    }

    // Not a built-in — try a skill command. Built-in names shadow same-named skills (design
    // §4); reaching here already means `name` isn't one of the three built-ins.
    const skill = this.state.skills.find((s) => s.name === name);
    if (skill) {
      const echo = args.trim() === "" ? `/${name}` : `/${name} ${args}`;
      this.state = addUserTurn(this.state, agent.agentId, echo, now());
      this.renderAll();
      invokeSkill(
        this.deps.target,
        agent.agentId,
        name,
        args,
        this.deps.fetchImpl,
        this.commandOptions(),
      ).catch((err) => this.reportError(err));
      return;
    }

    this.state = addSystemTurn(this.state, agent.agentId, `Unknown command: /${name}`, now());
    this.renderAll();
  }

  /** `/model` picker: Enter/click on a row. */
  private selectModel(name: string): void {
    const agent = selectedAgent(this.state);
    this.state = closeModelPicker(this.state);
    this.renderAll();
    if (!agent) return;
    switchModel(
      this.deps.target,
      agent.agentId,
      name,
      this.deps.fetchImpl,
      this.commandOptions(),
    ).catch((err) => this.reportError(err));
  }

  private closeModelPicker(): void {
    this.state = closeModelPicker(this.state);
    this.renderAll();
  }

  private onSendMessage = (message: string): void => {
    // DH-0093 design §1: a recognized slash command never becomes a chat message —
    // intercepted here, the one place a `send_message` call is built from the composer's
    // submitted text. A leading space before the slash, or a bare "/" alone, deliberately
    // fails to match and falls through to ordinary chat (see client-core/slash-command-parser.ts).
    const parsed = parseSlashCommand(message);
    if (parsed) {
      this.handleSlashCommand(parsed.name, parsed.args);
      return;
    }
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
  };

  stop(): void {
    this.connection?.close();
    this.connection = null;
    if (this.livenessTimer !== undefined) {
      const clearIntervalFn = this.deps.clearIntervalImpl ?? clearInterval;
      clearIntervalFn(this.livenessTimer);
      this.livenessTimer = undefined;
    }
    if (this.renderRafHandle !== undefined) {
      const cancelRaf = this.deps.cancelRafImpl ?? defaultCancelRaf;
      cancelRaf(this.renderRafHandle);
      this.renderRafHandle = undefined;
    }
    this.stopped = true;
    this.root.unmount();
  }

  getState(): WebState {
    return this.state;
  }

  private handleEvent(event: ServerSentEvent): void {
    this.state = applyEvent(this.state, event);
    this.scheduleRenderAll();
  }

  /**
   * DH-0044 D9: coalesces `renderAll()` calls triggered by SSE events (streaming turns can
   * arrive at ~20 `agent_output` events/second per agent) into at most one full state->DOM
   * pass per animation frame, rather than rebuilding on every single event. State
   * (`this.state`) is always updated synchronously in `handleEvent` above — only the React
   * render pass is deferred, so a render that does fire always reflects every event received
   * so far, never a stale intermediate state.
   */
  private scheduleRenderAll(): void {
    if (this.renderRafHandle !== undefined) return;
    const raf = this.deps.rafImpl ?? defaultRaf;
    this.renderRafHandle = raf(() => {
      this.renderRafHandle = undefined;
      this.renderAll();
    });
  }

  private handleStatus(status: ConnectionStatus): void {
    this.state = setConnectionStatus(this.state, status);
    this.renderAll();
  }

  /** DH-0024: fires on every SSE reconnect (not the initial connect) — see sse.ts's
   *  `onReconnected` for why this is treated as a possible gap. Shows the dismissible
   *  banner; the operator dismisses it once they've seen it (`dismissGapBanner`).
   *
   *  DH-0202: also re-fetches the agent tree, the same bootstrap call used on initial
   *  connect. A reconnect's `Last-Event-ID` resume only redelivers events *after* the
   *  resume point — if that skips an agent's original `agent_spawned` event (the only place
   *  its model name is ever sent), the agent's model would otherwise stay unknown forever.
   *  `seedFromTree`'s merge (state.ts) patches in a missing `model` on an already-known
   *  agent without disturbing any other live field, so this is safe to call repeatedly. */
  private handleReconnected(): void {
    this.state = markPossibleGap(this.state);
    this.renderAll();
    this.bootstrapAgentTree();
  }

  private dismissGapBanner = (): void => {
    this.state = dismissPossibleGap(this.state);
    this.renderAll();
  };

  private reportError(err: unknown): void {
    const message = err instanceof CommandError ? err.message : "Request failed.";
    this.errorMessage = message;
    const nowFn = this.deps.nowFn ?? Date.now;
    this.state = logError(this.state, message, new Date(nowFn()).toISOString());
    this.renderAll();
    const setTimeoutFn = this.deps.setTimeoutImpl ?? setTimeout;
    const clearTimeoutFn = this.deps.clearTimeoutImpl ?? clearTimeout;
    if (this.errorTimer) clearTimeoutFn(this.errorTimer);
    this.errorTimer = setTimeoutFn(() => {
      this.errorMessage = null;
      this.renderAll();
    }, ERROR_BANNER_DURATION_MS);
  }

  private renderAll(): void {
    const { doc } = this.deps;
    const nowFn = this.deps.nowFn ?? Date.now;
    const now = nowFn();
    if (!this.stopped) {
      this.root.render(
        createElement(App, {
          state: this.state,
          ...(this.deps.headerInfo ? { headerInfo: this.deps.headerInfo } : {}),
          now,
          errorMessage: this.errorMessage,
          onSelectAgent: (agentId) => {
            this.state = selectAgent(this.state, agentId);
            this.renderAll();
          },
          onSendMessage: this.onSendMessage,
          onDownloadAgentLog: (agentId) => {
            downloadLogs(
              this.deps.target,
              agentId,
              this.deps.downloadEnv,
              this.deps.fetchImpl,
            ).catch((err) => this.reportError(err));
          },
          onDownloadSessionBundle: () => {
            downloadLogs(
              this.deps.target,
              undefined,
              this.deps.downloadEnv,
              this.deps.fetchImpl,
            ).catch((err) => this.reportError(err));
          },
          onStopAgent: (agentId) => {
            stopAgent(this.deps.target, agentId, this.deps.fetchImpl, this.commandOptions()).catch(
              (err) => this.reportError(err),
            );
          },
          onCancelQueuedMessage: (agentId, messageId) => {
            cancelQueuedMessage(
              this.deps.target,
              agentId,
              messageId,
              this.deps.fetchImpl,
              this.commandOptions(),
            ).catch((err) => this.reportError(err));
          },
          onSelectModel: (name) => this.selectModel(name),
          onCloseModelPicker: () => this.closeModelPicker(),
          onDismissGapBanner: this.dismissGapBanner,
        }),
      );
    }
    // DH-0066: keep the browser tab itself informative (running/ended/idle) — see
    // `documentTitle`'s doc comment for why this matters with the tab backgrounded.
    doc.title = documentTitle(this.state);
  }
}
