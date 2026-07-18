// PTY harness for the console TUI (docs/handoffs/e2e.md scope item 3). Bun has no built-in
// PTY module and this environment has no working `node-pty` native-build toolchain readily
// available, so this shells out to `tmux` (present in the environment, verified interactively
// before writing this file): `tmux new-session -d` allocates a real pseudo-terminal of a
// chosen size for the wrapped process — `dist/dh`'s own `process.stdout.columns/rows` and
// raw-mode stdin handling (src/tui/app.ts) see a genuine terminal, not a pipe — and
// `send-keys`/`capture-pane` drive and read it like a real user/operator would. This is the
// "shell out to a PTY-capable wrapper" option flagged as acceptable by the handoff; documented
// here per its "document whichever approach you land on and why" instruction.

import { randomUUID } from "node:crypto";

export interface TmuxSessionOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
}

export interface TmuxSession {
  sessionName: string;
  /** Current visible screen content (plain text, no ANSI), like a real terminal snapshot. */
  capture(): string;
  /** Current visible screen content *with* the escape sequences tmux's own terminal emulation
   * applied to it (`capture-pane -e`) — i.e. the literal bytes tmux would draw with. Used by
   * hostile-input tests (DH-0056) to assert the only ANSI ever present is the client's
   * allowlisted SGR output, never a raw OSC/DCS/cursor-movement/DA-DSR sequence that made it
   * through from model text unsanitized. */
  captureRaw(): string;
  /** Sends one or more literal tmux key names (e.g. "Enter", "Left", "C-c", "Tab"). */
  sendKeys(...keys: string[]): void;
  /** Sends literal text as if typed (tmux `send-keys -l`). */
  sendText(text: string): void;
  /** Polls `capture()` until `predicate` matches or `timeoutMs` elapses. */
  waitFor(predicate: (screen: string) => boolean, timeoutMs?: number): Promise<string>;
  /** True once the wrapped process has actually exited (tmux's pane is dead), as opposed to
   * merely being off-screen or the tmux session still existing. Used to confirm a real
   * process exit after a quit/stop sequence, not just a rendered "session ended" string. */
  isProcessExited(): boolean;
  /** Polls `isProcessExited()` until it's true or `timeoutMs` elapses. */
  waitForExit(timeoutMs?: number): Promise<void>;
  /** DH-0025 resize-behavior spike support: resizes the pane's underlying pseudo-terminal
   * (`tmux resize-window -x/-y`), which delivers a real `SIGWINCH` to the wrapped process —
   * same signal a real terminal emulator sends on a user resize. `dh`'s TUI (src/tui/app.ts)
   * reacts to this exactly as it would in a real terminal. */
  resize(cols: number, rows: number): void;
  kill(): void;
}

function run(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = Bun.spawnSync({ cmd: args, stdout: "pipe", stderr: "pipe" });
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

export function startTmuxSession(command: string[], options: TmuxSessionOptions = {}): TmuxSession {
  const sessionName = `dh-e2e-${randomUUID().slice(0, 8)}`;
  const cols = options.cols ?? 100;
  const rows = options.rows ?? 30;

  const envAssignments = Object.entries(options.env ?? {}).map(([k, v]) => `${k}=${v}`);
  const shellCommand = [...envAssignments, ...command.map((part) => shellQuote(part))].join(" ");

  const args = [
    "tmux",
    "new-session",
    "-d",
    "-s",
    sessionName,
    "-x",
    String(cols),
    "-y",
    String(rows),
  ];
  if (options.cwd) args.push("-c", options.cwd);
  args.push(shellCommand);

  const started = run(args);
  if (!started.ok) {
    throw new Error(`tmux new-session failed: ${started.stderr || started.stdout}`);
  }

  // DH-0164: without this, tmux's default behavior tears the pane (and, since it's the only
  // pane, the whole session) down the moment the wrapped process exits for ANY reason —
  // including a crash — so a real CI-only startup failure surfaces only as a much later,
  // opaque "can't find pane"/"no server running" from a subsequent capture-pane call, with
  // no way to see what the process actually printed before dying. Keeping the pane around
  // turns that into an observable dead-pane capture instead of a silent session disappearance.
  run(["tmux", "set-option", "-t", sessionName, "remain-on-exit", "on"]);

  return {
    sessionName,
    capture() {
      const result = run(["tmux", "capture-pane", "-t", sessionName, "-p"]);
      if (!result.ok) {
        throw new Error(`tmux capture-pane failed: ${result.stderr}`);
      }
      return result.stdout;
    },
    captureRaw() {
      const result = run(["tmux", "capture-pane", "-t", sessionName, "-e", "-p"]);
      if (!result.ok) {
        throw new Error(`tmux capture-pane -e failed: ${result.stderr}`);
      }
      return result.stdout;
    },
    sendKeys(...keys: string[]) {
      const result = run(["tmux", "send-keys", "-t", sessionName, ...keys]);
      if (!result.ok) {
        throw new Error(`tmux send-keys failed: ${result.stderr}`);
      }
    },
    sendText(text: string) {
      const result = run(["tmux", "send-keys", "-t", sessionName, "-l", text]);
      if (!result.ok) {
        throw new Error(`tmux send-keys -l failed: ${result.stderr}`);
      }
    },
    // DH-0164: 10s was fine on a dev machine but real GitHub Actions runners are meaningfully
    // slower/more resource-constrained for real tmux+PTY+process interaction -- this only
    // surfaced once e2e's PTY-based tests actually got to run against real CI for the first
    // time (every earlier gate run failed on an upstream step first). Same class of CI-only
    // timing gap as DH-0145/DH-0146; bumped generously rather than chasing an exact number.
    async waitFor(predicate, timeoutMs = 30_000) {
      const start = Date.now();
      for (;;) {
        const screen = this.capture();
        if (predicate(screen)) return screen;
        if (Date.now() - start > timeoutMs) {
          throw new Error(
            `timed out after ${timeoutMs}ms waiting for tmux screen condition. Last screen:\n${screen}`,
          );
        }
        await Bun.sleep(150);
      }
    },
    isProcessExited() {
      // Once the wrapped process exits, tmux marks its pane dead (still capturable, but no
      // longer running) rather than immediately tearing down the session — check that flag
      // rather than whether the session itself still exists.
      const result = run(["tmux", "list-panes", "-t", sessionName, "-F", "#{pane_dead}"]);
      if (!result.ok) {
        // The session itself is gone — the process is certainly no longer running.
        return true;
      }
      return result.stdout.trim() === "1";
    },
    async waitForExit(timeoutMs = 30_000) {
      const start = Date.now();
      while (!this.isProcessExited()) {
        if (Date.now() - start > timeoutMs) {
          throw new Error(`timed out after ${timeoutMs}ms waiting for tmux pane process to exit`);
        }
        await Bun.sleep(150);
      }
    },
    resize(cols: number, rows: number) {
      const result = run([
        "tmux",
        "resize-window",
        "-t",
        sessionName,
        "-x",
        String(cols),
        "-y",
        String(rows),
      ]);
      if (!result.ok) {
        throw new Error(`tmux resize-window failed: ${result.stderr}`);
      }
    },
    kill() {
      run(["tmux", "kill-session", "-t", sessionName]);
    },
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
