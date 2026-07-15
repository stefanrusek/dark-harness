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

/**
 * Start the console TUI against the server at `baseUrl`. Resolves once the user quits
 * (Ctrl+C). `io` lets tests inject fake stdin/stdout/fetch; production callers (Core's
 * `src/cli.ts`) can omit it to use the real terminal and network.
 */
export async function startTui(baseUrl: string, io: Partial<TuiIO> = {}): Promise<void> {
  const resolved: TuiIO = { ...defaultIO(), ...io };
  const { stdin, stdout, fetchImpl } = resolved;

  let state: TuiState = initialState({
    rows: stdout.rows ?? 24,
    cols: stdout.columns ?? 80,
  });

  return new Promise<void>((resolve) => {
    const abortController = new AbortController();

    function draw(): void {
      stdout.write(frameToAnsi(renderFrame(state)));
    }

    function dispatch(action: Action): void {
      const result = reducer(state, action);
      state = result.state;
      for (const effect of result.effects) {
        void runEffect(effect);
      }
      draw();
    }

    async function runEffect(effect: Effect): Promise<void> {
      if (effect.type === "quit") {
        cleanup();
        resolve();
        return;
      }
      try {
        const response = await sendCommand(baseUrl, effect.command, { fetchImpl });
        if (effect.command.type === "request_agent_tree" && "tree" in response) {
          dispatch({ type: "tree_response", tree: response.tree });
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

    function cleanup(): void {
      abortController.abort();
      stdout.write(SHOW_CURSOR + ALT_SCREEN_EXIT);
      stdin.setRawMode?.(false);
      stdin.pause?.();
      stdin.removeAllListeners?.("data");
      stdout.removeAllListeners?.("resize");
    }

    stdout.write(ALT_SCREEN_ENTER + HIDE_CURSOR);
    stdin.setRawMode?.(true);
    stdin.setEncoding?.("utf8");
    stdin.resume?.();

    stdin.on("data", (chunk: string) => {
      for (const key of parseKeys(chunk)) {
        dispatch({ type: "key", key });
      }
    });

    stdout.on?.("resize", () => {
      dispatch({
        type: "resize",
        rows: stdout.rows ?? state.size.rows,
        cols: stdout.columns ?? state.size.cols,
      });
    });

    // initialState() already reflects "connecting"; runSseClient reports its own
    // transitions (connecting -> open/error) as they happen.
    void runSseClient({
      baseUrl,
      fetchImpl,
      signal: abortController.signal,
      onEvent: (event) => dispatch({ type: "sse_event", event }),
      onConnectionChange: (status) => dispatch({ type: "connection", status }),
    });

    draw();
  });
}
