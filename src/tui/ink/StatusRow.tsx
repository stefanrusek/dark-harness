// DH-0125: fills in DH-0136's reserved `<StatusRow>` slot — a single line directly under the
// composer showing the root agent's model, a running/elapsed progress indicator, and the
// git branch + working directory the TUI process was launched from. Status coloring reuses
// the shared `STATUS_TOKENS` table (src/design-tokens.ts) so this never independently
// re-derives the running/done/failed/stopped color mapping (docs/design/style-guide.md §1).
import { execFileSync } from "node:child_process";
import { Box, Text } from "ink";
import { STATUS_TOKENS } from "../../design-tokens.ts";
import type { AgentInfo } from "../types.type.ts";
import { colorizeStatus, dim, formatElapsed, spinnerFrame } from "./tokens.ts";

export interface GitInfo {
  /** `null` when `git rev-parse` fails — not in a git repo, or `git` isn't on PATH. */
  branch: string | null;
  cwd: string;
}

export interface StatusRowProps {
  agentState?: AgentInfo | null;
  gitInfo?: GitInfo;
  /** Epoch ms driving the elapsed/spinner display — defaults to `Date.now()` for production
   * use; tests pass a fixed value for deterministic output (same convention as
   * `state.now`/`tokens.ts`'s other `now`-driven helpers). */
  now?: number;
}

function runGitBranchCommand(): string {
  return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
}

/** Shells out once per process — a git branch doesn't change mid-session, so there is no
 * need to re-invoke `git` on every redraw (this runs at module load, not per render).
 * `runGitBranch` is injectable so tests can exercise the not-a-git-repo fallback without
 * depending on the test runner's own working directory being (or not being) a git repo. */
export function detectGitInfo(runGitBranch: () => string = runGitBranchCommand): GitInfo {
  let branch: string | null = null;
  try {
    branch = runGitBranch();
  } catch {
    branch = null;
  }
  return { branch, cwd: process.cwd() };
}

const DEFAULT_GIT_INFO = detectGitInfo();

function progressText(agentState: AgentInfo | null | undefined, now: number): string {
  if (!agentState) return dim("—");
  if (agentState.status === "running") {
    return colorizeStatus(
      "running",
      `${spinnerFrame(now)} ${formatElapsed(now - agentState.statusSince)}`,
    );
  }
  const token = STATUS_TOKENS[agentState.status];
  return colorizeStatus(agentState.status, `${token.glyph} ${token.word}`);
}

export function StatusRow({ agentState, gitInfo, now }: StatusRowProps) {
  const info = gitInfo ?? DEFAULT_GIT_INFO;
  const resolvedNow = now ?? Date.now();
  const model = agentState?.model ?? dim("—");
  const location = info.branch ? `${info.branch} · ${info.cwd}` : dim(info.cwd);
  return (
    <Box>
      {/* wrap="truncate-end": this row must stay exactly one line — App.tsx's contentRows
       * math reserves exactly one row for it — so a long cwd path truncates instead of
       * wrapping onto a second line and pushing the frame past the terminal's height. */}
      <Text wrap="truncate-end">
        {`${model}   ${progressText(agentState, resolvedNow)}   ${location}`}
      </Text>
    </Box>
  );
}
