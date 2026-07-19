// React migration of render.ts's renderTranscript/appendTranscript (DH-0135), folding in:
// - DH-0127 (flicker/no-vdom): each turn is a keyed <TurnRow>, so an unrelated re-render no
//   longer replaces DOM nodes for turns whose content hasn't changed — React's reconciliation
//   does this for free, closing DH-0127 without a hand-written diff.
// - DH-0129 (auto-scroll only when at bottom): an effect below scrolls to the bottom on new
//   content only when the region was already scrolled to (near) the bottom before the update;
//   otherwise it reveals the jump-to-latest button instead of yanking the view.
// - DH-0130 (per-agent terminal-status transcript marker): state.ts now derives a
//   `terminalStatus`-tagged marker Turn when an agent reaches done/failed/stopped (mirroring
//   src/tui/state.ts's appendTerminalMarker) -- styled here via DH-0137's shared STATUS_TOKENS.
import { type ReactElement, useEffect, useRef, useState } from "react";
import { STATUS_TOKENS } from "../../../design-tokens.ts";
import { formatExitCode } from "../format.ts";
import type { AgentNode, Turn } from "../state.ts";
import { JumpToLatestButton } from "./JumpToLatestButton.tsx";
import { MarkdownContent } from "./MarkdownContent.tsx";

const NEAR_BOTTOM_THRESHOLD_PX = 48;

/** DH-0199: `groupTranscript`'s output — either a single turn to render as-is, or a run of
 * 2+ consecutive plain tool-call turns to render as one collapsible `ToolCallGroup`.
 * `startIndex` is the transcript index of the item's first turn, used as its React key (see
 * the transcript-append-only-index-stability comment above `turnRows`'s definition). */
type RenderItem =
  | { kind: "turn"; startIndex: number; turn: Turn }
  | { kind: "group"; startIndex: number; turns: Turn[] };

/** Whether `turn` is a plain tool-call marker eligible for grouping — a `role: "tool"` turn
 * that is NOT a terminal-status marker (DH-0130's "Agent done/failed/stopped" turns stay
 * standalone and visually distinct; grouping them with ordinary tool calls would bury the
 * one event an operator scanning the transcript most needs to notice). */
function isGroupableToolTurn(turn: Turn): boolean {
  return turn.role === "tool" && !turn.terminalStatus;
}

/**
 * DH-0199: scans `transcript` for maximal runs of consecutive groupable tool-call turns (see
 * `isGroupableToolTurn`) — any other-role turn (including a terminal-status marker) breaks a
 * run. A run of 2+ becomes one `"group"` item; a lone tool call (run length 1) renders
 * standalone via `"turn"`, unchanged from pre-DH-0199 behavior, so a single tool call between
 * two agent turns doesn't get wrapped in a pointless one-item expando.
 */
function groupTranscript(transcript: Turn[]): RenderItem[] {
  const items: RenderItem[] = [];
  let i = 0;
  while (i < transcript.length) {
    // `i < transcript.length` guarantees a value here; `noUncheckedIndexedAccess` can't see
    // that invariant across the loop bound, hence the assertion rather than an unreachable
    // (and therefore uncoverable) defensive branch.
    const turn = transcript[i] as Turn;
    if (!isGroupableToolTurn(turn)) {
      items.push({ kind: "turn", startIndex: i, turn });
      i++;
      continue;
    }
    const run: Turn[] = [];
    const startIndex = i;
    while (i < transcript.length) {
      const candidate = transcript[i] as Turn;
      if (!isGroupableToolTurn(candidate)) break;
      run.push(candidate);
      i++;
    }
    if (run.length >= 2) {
      items.push({ kind: "group", startIndex, turns: run });
    } else {
      // run.length === 1 here: the while loop above always pushes at least one turn before
      // `i` can have advanced past `startIndex` (the branch above already excluded the
      // non-groupable case), so `run[0]` is always defined.
      items.push({ kind: "turn", startIndex, turn: run[0] as Turn });
    }
  }
  return items;
}

function turnRoleLabel(role: Turn["role"]): string {
  if (role === "user") return "You";
  if (role === "system") return "System";
  return "Agent";
}

/**
 * DH-0199: a single tool call/result pair's expandable detail — shown together (input +
 * result status/duration) once the row is clicked, instead of the input-only summary line
 * that's always visible. `ToolResultEvent` deliberately carries no output content (see its
 * doc comment in src/contracts/events.type.ts), so "output" here is limited to what the wire
 * actually sends: success/failure and duration.
 */
function ToolCallDetail({ turn }: { turn: Turn }): ReactElement {
  const resolved = turn.durationMs !== undefined || turn.toolError;
  return (
    <div className="tool-call-detail">
      <div className="tool-call-detail-row">
        <span className="tool-call-detail-label">Input</span>
        <span className="tool-call-detail-value">{turn.text}</span>
      </div>
      <div className="tool-call-detail-row">
        <span className="tool-call-detail-label">Result</span>
        <span className="tool-call-detail-value">
          {resolved
            ? `${turn.toolError ? "✗ error" : "✓ ok"}${
                turn.durationMs !== undefined ? ` · ${turn.durationMs}ms` : ""
              }`
            : "pending…"}
        </span>
      </div>
    </div>
  );
}

/** DH-0199: a single tool-call marker turn, clickable to toggle `ToolCallDetail` below it.
 * Used both standalone (a lone tool call between other turns) and as a row inside a
 * `ToolCallGroup`. Each instance owns its own expanded/collapsed state, keyed by its stable
 * transcript-index `key` at the call site — matches `ToolCallGroup`'s own collapsed state. */
function ToolCallRow({ turn }: { turn: Turn }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const toggle = () => setExpanded((v) => !v);
  return (
    <div
      className={`turn turn-tool${turn.toolError ? " turn-tool-error" : ""}`}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      }}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
    >
      <div className="turn-text">{turn.toolError ? `⚙ ${turn.text} ✗` : `⚙ ${turn.text}`}</div>
      {expanded ? <ToolCallDetail turn={turn} /> : null}
    </div>
  );
}

/** DH-0199: a collapsed-by-default expando wrapping a run of 2+ consecutive tool-call marker
 * turns with no other-role turn between them — see `groupTranscript` for how runs are found.
 * Collapsed state defaults to `true` (closed) per the ticket; expanding reveals each grouped
 * turn as its own independently-clickable `ToolCallRow`. */
function ToolCallGroup({ turns }: { turns: Turn[] }): ReactElement {
  const [collapsed, setCollapsed] = useState(true);
  const errorCount = turns.filter((t) => t.toolError).length;
  return (
    <div className="turn turn-tool-group">
      <button
        type="button"
        className="tool-group-toggle"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        <span className="tool-group-caret">{collapsed ? "▸" : "▾"}</span>
        <span className="tool-group-summary">
          {turns.length} tool calls{errorCount > 0 ? ` (${errorCount} failed)` : ""}
        </span>
      </button>
      {collapsed ? null : (
        <div className="tool-group-items">
          {/* `turns` is a fixed-at-mount slice of the append-only transcript, so index is a
              stable identity here too (same reasoning as the top-level `turnRows` map below). */}
          {turns.map((turn, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: see comment above the map call.
            <ToolCallRow key={i} turn={turn} />
          ))}
        </div>
      )}
    </div>
  );
}

function TurnRow({ turn }: { turn: Turn }): ReactElement {
  if (turn.role === "tool") {
    if (turn.terminalStatus) {
      const token = STATUS_TOKENS[turn.terminalStatus];
      return (
        <div className="turn turn-terminal-status" style={{ color: token.webHex }}>
          <div className="turn-text">
            {token.glyph} {turn.text}
          </div>
        </div>
      );
    }
    return <ToolCallRow turn={turn} />;
  }
  return (
    <div className={`turn turn-${turn.role}`}>
      <div className="turn-role">{turnRoleLabel(turn.role)}</div>
      {turn.role === "assistant" ? (
        <MarkdownContent text={turn.text} />
      ) : (
        <div className="turn-text">{turn.text}</div>
      )}
    </div>
  );
}

function ThinkingIndicator(): ReactElement {
  return (
    <div className="turn turn-assistant turn-thinking">
      <div className="turn-role">{turnRoleLabel("assistant")}</div>
      <div className="turn-text thinking-dots" role="status" aria-label="Agent is thinking">
        <span className="thinking-dot" />
        <span className="thinking-dot" />
        <span className="thinking-dot" />
      </div>
    </div>
  );
}

export interface TranscriptProps {
  agent: AgentNode | null;
  sessionEnded: boolean;
  exitCode: number | null;
}

export function Transcript({ agent, sessionEnded, exitCode }: TranscriptProps): ReactElement {
  const transcript = agent?.transcript ?? [];
  const scrollRegionRef = useRef<HTMLDivElement | null>(null);
  const [jumpVisible, setJumpVisible] = useState(false);
  const lastTurnCount = useRef(0);
  const lastAgentId = useRef<string | null>(null);
  // Tracks "was the user at the bottom" independent of content growth. Updated ONLY by the
  // onScroll handler (real user-driven scroll), never read-and-recomputed after new content
  // has already grown scrollHeight -- see DH-0129 bug notes: isNearBottom() called from the
  // content-update effect runs after React commits the taller DOM, so scrollHeight already
  // reflects the new content while scrollTop hasn't moved, making any turn taller than the
  // threshold look like "user scrolled away."
  const stickToBottomRef = useRef(true);

  const isNearBottom = () => {
    const region = scrollRegionRef.current;
    if (!region) return true;
    return region.scrollHeight - region.scrollTop - region.clientHeight < NEAR_BOTTOM_THRESHOLD_PX;
  };

  const scrollToBottom = () => {
    const region = scrollRegionRef.current;
    if (!region) return;
    region.scrollTop = region.scrollHeight;
    stickToBottomRef.current = true;
    setJumpVisible(false);
  };

  const lastTurnTextLength = transcript.at(-1)?.text.length ?? 0;

  // Re-runs on every transcript-affecting change (agent identity, turn count, last turn's
  // text length) rather than depending on `transcript`/`agent` object identity, matching the
  // old imperative code's "did rendered content grow" check (DH-0129). `isNearBottom`/
  // `scrollToBottom` read `scrollRegionRef.current` fresh on every call rather than closing
  // over state, so they're intentionally omitted from the dependency list; `lastTurnTextLength`
  // is intentionally included even though the body doesn't read it directly — it's what makes
  // the effect re-fire when a streaming chunk extends the current turn without changing
  // `transcript.length`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above.
  useEffect(() => {
    const agentChanged = agent?.agentId !== lastAgentId.current;
    lastAgentId.current = agent?.agentId ?? null;
    if (agentChanged) {
      lastTurnCount.current = transcript.length;
      scrollToBottom();
      return;
    }
    const wasNearBottom = stickToBottomRef.current;
    lastTurnCount.current = transcript.length;
    if (wasNearBottom) {
      scrollToBottom();
    } else if (transcript.length > 0) {
      setJumpVisible(true);
    }
  }, [agent?.agentId, transcript.length, lastTurnTextLength]);

  const showThinking = agent && agent.status === "running" && !agent.turnOpen;
  const lastTurn = transcript.at(-1);
  const thinking = showThinking && lastTurn?.role !== "assistant";
  // transcript is append-only (never reordered/spliced), so each item's `startIndex` (a
  // transcript index) is a stable identity — see `groupTranscript`/`RenderItem` above.
  const turnRows = groupTranscript(transcript).map((item) =>
    item.kind === "group" ? (
      <ToolCallGroup key={item.startIndex} turns={item.turns} />
    ) : (
      <TurnRow key={item.startIndex} turn={item.turn} />
    ),
  );

  return (
    <>
      <div
        className="output-scroll"
        ref={scrollRegionRef}
        onScroll={() => {
          // DH-0200: track show/hide symmetrically with the actual scroll position, not just
          // hide-on-near-bottom. Previously this handler only ever cleared jumpVisible; it never
          // set it, relying entirely on the content-update effect to reveal the button. A manual
          // mouse-wheel scroll up (no new content involved) could leave the button stuck hidden
          // if it happened to fire while a prior scroll/render cycle had already cleared it, and
          // scrolling further away afterward did nothing to bring it back since only new content
          // landing re-evaluates visibility. Now the scroll handler is itself the source of truth
          // for the button's visibility whenever the user is the one moving the scroll position.
          const nearBottom = isNearBottom();
          stickToBottomRef.current = nearBottom;
          if (nearBottom) {
            setJumpVisible(false);
          } else if (transcript.length > 0) {
            setJumpVisible(true);
          }
        }}
      >
        <div className="agent-transcript" role="log" aria-live="polite">
          {transcript.length === 0 ? (
            <div className="empty-state">
              {agent
                ? `No output yet — spawned just now, model ${agent.model || "unknown"}.`
                : "Waiting for an agent to spawn…"}
            </div>
          ) : (
            turnRows
          )}
          {thinking ? <ThinkingIndicator /> : null}
          {sessionEnded && exitCode !== null ? (
            <div
              className={`session-end-echo ${exitCode === 0 ? "session-banner-ok" : "session-banner-fail"}`}
            >
              {`Session ended — ${formatExitCode(exitCode)}`}
            </div>
          ) : null}
        </div>
      </div>
      <JumpToLatestButton visible={jumpVisible} onClick={scrollToBottom} />
    </>
  );
}
