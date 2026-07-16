// Thin I/O shell: wires the pure reducer/render/parse modules (state.ts, render.ts,
// keys.ts) to real terminal + network I/O (sse-client.ts, http-client.ts). Every
// side-effecting dependency is injectable via `TuiIO` so this module's *wiring logic* is
// unit-testable with fakes; only the real `process.stdin` raw-mode/PTY behavior itself
// (setRawMode, real SIGWINCH delivery) requires an actual terminal — that's covered by the
// E2E domain's PTY harness (ADR 0008), not here. See docs/handoffs/tui.md status log for
// the exact list of lines left to E2E.

import { sendCommand } from "./http-client.ts";
import { parseKeys } from "./keys.ts";
import { frameToAnsi, renderFrame } from "./render.ts";
import { runSseClient } from "./sse-client.ts";
import { initialState, reducer } from "./state.ts";
import type { Action, Effect, TuiState } from "./types.ts";

const ALT_SCREEN_ENTER = "\x1b[?1049h";
const ALT_SCREEN_EXIT = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
// Bracketed-paste mode (DH-0026): while enabled, a terminal-initiated paste arrives wrapped
// in \x1b[200~ / \x1b[201~ markers (parsed by keys.ts into a single "paste" KeyEvent) instead
// of as a stream of ordinary characters/enters indistinguishable from real typing. Without
// this, a multi-line paste gets parsed as individual `enter` keystrokes mid-paste, sending
// the partial input as a separate message and fragmenting one paste into several sends.
const BRACKETED_PASTE_ENABLE = "\x1b[?2004h";
const BRACKETED_PASTE_DISABLE = "\x1b[?2004l";

export interface StdinLike {
  on(event: "data", listener: (chunk: string) => void): unknown;
  setEncoding?(encoding: BufferEncoding): unknown;
  setRawMode?(mode: boolean): unknown;
  resume?(): unknown;
  pause?(): unknown;
  removeAllListeners?(event?: string): unknown;
}

export interface StdoutLike {
  write(data: string): unknown;
  on?(event: "resize", listener: () => void): unknown;
  removeAllListeners?(event?: string): unknown;
  columns?: number;
  rows?: number;
}

export interface TuiIO {
  stdin: StdinLike;
  stdout: StdoutLike;
  fetchImpl: typeof fetch;
}

function defaultIO(): TuiIO {
  return {
    stdin: process.stdin,
    stdout: process.stdout,
    fetchImpl: fetch,
  };
}

/** How often the frame is force-redrawn purely to advance the liveness indicator (Round 5,
 * docs/handoffs/tui.md) — no state.ts field but `now` changes on a tick, so a long-silent
 * `running` agent visibly keeps counting up even with no new SSE events arriving. */
const TICK_INTERVAL_MS = 1000;

/** Debounce window for terminal resize events (DH-0025): a rapid drag-resize can fire many
 * `resize` events in quick succession, and redrawing a full frame on every single one causes
 * visible flicker. Coalescing to the last event in this window keeps the frame in sync with
 * the final terminal size without a full-clear-and-rewrite per intermediate size. */
const RESIZE_DEBOUNCE_MS = 50;

/** DH-0059: how long an operator-initiated shutdown (Ctrl+C, `ownsServer: true`) waits for
 * `session_ended` to arrive before force-quitting anyway — the escape hatch for a stop that
 * never completes (e.g. `stopRoot()` deliberately doesn't interrupt a tool call already in
 * progress). A second Ctrl+C forces the same outcome sooner; this is only the backstop. */
export const SHUTDOWN_FALLBACK_MS = 5000;

export interface StartTuiOptions {
  /** DH-0059: true when this process also constructed the `DhServer` this TUI talks to
   * (local mode) — passed by `src/cli.ts`, which is the only place that knows. Defaults to
   * `false`, preserving `--connect` mode's existing "Ctrl+C just detaches" behavior. */
  ownsServer?: boolean;
  /** Lets tests inject fake stdin/stdout/fetch; production callers (Core's `src/cli.ts`)
   * can omit it to use the real terminal and network. */
  io?: Partial<TuiIO>;
}

/**
 * Start the console TUI against the server at `baseUrl`. Resolves once the user quits
 * (Ctrl+C).
 *
 * `token`, when the target server has `security.token` configured (ADR 0004), is sent as a
 * real `Authorization: Bearer <token>` header on every HTTP/SSE request the client makes —
 * never as a URL query parameter (same constraint as the Web client, see
 * `src/web/client/commands.ts` / `sse.ts`). Pass `undefined` (or omit) against an
 * unauthenticated server.
 */
export async function startTui(
  baseUrl: string,
  token?: string,
  opts: StartTuiOptions = {},
): Promise<void> {
  const resolved: TuiIO = { ...defaultIO(), ...opts.io };
  const { stdin, stdout, fetchImpl } = resolved;
  const authHeaders: Record<string, string> | undefined = token
    ? { Authorization: `Bearer ${token}` }
    : undefined;

  let state: TuiState = initialState(
    {
      rows: stdout.rows ?? 24,
      cols: stdout.columns ?? 80,
    },
    { ownsServer: opts.ownsServer ?? false },
  );

  return new Promise<void>((resolve) => {
    const abortController = new AbortController();

    // DH-0025: skip the write entirely when the rendered frame hasn't actually changed since
    // the last draw — the once-per-second liveness tick previously forced a full clear-and-
    // rewrite unconditionally, which is wasteful and can flicker over a high-latency
    // connection even though nothing visible changed (elapsed-time labels round to whole
    // seconds, so most ticks produce byte-identical frames).
    let lastFrame: string | null = null;

    function draw(): void {
      const frame = frameToAnsi(renderFrame(state));
      if (frame === lastFrame) return;
      lastFrame = frame;
      stdout.write(frame);
    }

    // DH-0059: once the reducer sets `shutdownRequested` (Ctrl+C's rule 3 — first press,
    // ownsServer, root active), start the hard fallback timer here rather than inside the
    // reducer (which is pure and has no timers) — if `session_ended` never arrives (wire
    // failure, or a blocking tool call `stopRoot()` deliberately doesn't interrupt), this
    // forces the same outcome a second Ctrl+C would. `finish()` (below) is idempotent, so
    // this racing with a normal completion is harmless either way.
    let shutdownFallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;

    function finish(): void {
      if (finished) return;
      finished = true;
      if (shutdownFallbackTimer !== undefined) clearTimeout(shutdownFallbackTimer);
      cleanup();
      resolve();
    }

    function dispatch(action: Action): void {
      const wasShutdownRequested = state.shutdownRequested;
      const result = reducer(state, action);
      state = result.state;
      if (!wasShutdownRequested && state.shutdownRequested && shutdownFallbackTimer === undefined) {
        shutdownFallbackTimer = setTimeout(finish, SHUTDOWN_FALLBACK_MS);
        shutdownFallbackTimer.unref?.();
      }
      for (const effect of result.effects) {
        void runEffect(effect);
      }
      draw();
    }

    async function runEffect(effect: Effect): Promise<void> {
      if (effect.type === "quit") {
        // DH-0059: the effects loop above runs before `draw()` is called in `dispatch()` —
        // an immediate `finish()` here (the `afterMs`-less case, unchanged from before this
        // round) still tears the terminal down ahead of that trailing `draw()`, exactly as
        // it always has. The deferred case (`afterMs` set, from the `session_ended`
        // completion of an operator-initiated shutdown) deliberately does NOT call `finish()`
        // synchronously — it schedules it, so this tick's `draw()` gets to paint the final
        // "session ended (exit N)" frame first, and only after `afterMs` does the terminal
        // actually get torn down.
        if (effect.afterMs !== undefined) {
          setTimeout(finish, effect.afterMs);
        } else {
          finish();
        }
        return;
      }
      try {
        const response = await sendCommand(baseUrl, effect.command, {
          fetchImpl,
          ...(authHeaders ? { headers: authHeaders } : {}),
        });
        if (effect.command.type === "request_agent_tree" && "tree" in response) {
          dispatch({ type: "tree_response", tree: response.tree });
        } else if (effect.command.type === "list_models" && "models" in response) {
          dispatch({ type: "models_response", models: response.models });
        } else if (effect.command.type === "list_skills" && "skills" in response) {
          dispatch({ type: "skills_response", skills: response.skills });
        } else if (!response.ok) {
          dispatch({ type: "command_error", error: response.error ?? "command failed" });
        }
      } catch (err) {
        dispatch({
          type: "command_error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const tickTimer = setInterval(() => {
      dispatch({ type: "tick", now: Date.now() });
    }, TICK_INTERVAL_MS);
    // Never keep the process alive on its own — real terminal input / the abort signal below
    // are what actually end the session; this timer only redraws in the meantime.
    tickTimer.unref?.();

    function cleanup(): void {
      clearInterval(tickTimer);
      if (resizeDebounceTimer !== undefined) clearTimeout(resizeDebounceTimer);
      abortController.abort();
      stdout.write(BRACKETED_PASTE_DISABLE + SHOW_CURSOR + ALT_SCREEN_EXIT);
      stdin.setRawMode?.(false);
      stdin.pause?.();
      stdin.removeAllListeners?.("data");
      stdout.removeAllListeners?.("resize");
    }

    stdout.write(ALT_SCREEN_ENTER + HIDE_CURSOR + BRACKETED_PASTE_ENABLE);
    stdin.setRawMode?.(true);
    stdin.setEncoding?.("utf8");
    stdin.resume?.();

    stdin.on("data", (chunk: string) => {
      for (const key of parseKeys(chunk)) {
        dispatch({ type: "key", key });
      }
    });

    let resizeDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    stdout.on?.("resize", () => {
      if (resizeDebounceTimer !== undefined) clearTimeout(resizeDebounceTimer);
      resizeDebounceTimer = setTimeout(() => {
        resizeDebounceTimer = undefined;
        dispatch({
          type: "resize",
          rows: stdout.rows ?? state.size.rows,
          cols: stdout.columns ?? state.size.cols,
        });
      }, RESIZE_DEBOUNCE_MS);
    });

    // initialState() already reflects "connecting"; runSseClient reports its own
    // transitions (connecting -> open/error) as they happen.
    void runSseClient({
      baseUrl,
      fetchImpl,
      ...(authHeaders ? { headers: authHeaders } : {}),
      signal: abortController.signal,
      onEvent: (event) => dispatch({ type: "sse_event", event }),
      onConnectionChange: (status) => dispatch({ type: "connection", status }),
      onReconnected: () => dispatch({ type: "reconnected" }),
    });

    // Fire request_agent_tree on startup (not just on left-arrow) so rootAgentId gets
    // seeded from the tree response's root node (state.ts's applyTreeResponse) before the
    // operator ever types anything — otherwise a fresh session can never send its first
    // message, since agent_spawned never fires until the loop starts, which requires a
    // first message (Round 3, docs/handoffs/tui.md). Runs through the same runEffect path
    // as every other command, so a failure here surfaces as an ordinary status message
    // rather than crashing startup.
    void runEffect({ type: "send_command", command: { type: "request_agent_tree" } });

    // DH-0093: fetch the skill list once at startup, alongside the tree bootstrap above, so
    // `/help` and `/<skillname>` resolve locally with zero per-keystroke round-trips.
    void runEffect({ type: "send_command", command: { type: "list_skills" } });

    draw();
  });
}
