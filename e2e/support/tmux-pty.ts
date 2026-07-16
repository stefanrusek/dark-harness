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
    async waitFor(predicate, timeoutMs = 10_000) {
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
    async waitForExit(timeoutMs = 10_000) {
      const start = Date.now();
      while (!this.isProcessExited()) {
        if (Date.now() - start > timeoutMs) {
          throw new Error(`timed out after ${timeoutMs}ms waiting for tmux pane process to exit`);
        }
        await Bun.sleep(150);
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
