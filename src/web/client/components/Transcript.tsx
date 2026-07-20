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
import { groupTranscript } from "../../../transcript-grouping.ts";
import { formatExitCode } from "../format.ts";
import type { AgentNode, Turn } from "../state.ts";
import { JumpToLatestButton } from "./JumpToLatestButton.tsx";
import { MarkdownContent } from "./MarkdownContent.tsx";

const NEAR_BOTTOM_THRESHOLD_PX = 48;

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

function TurnRow({
  turn,
  queuedIds,
  onCancelQueuedMessage,
}: {
  turn: Turn;
  /** DH-0207: ids currently present in the agent's `agent_queue` snapshot — a turn whose
   * `queuedMessageId` is a member of this set hasn't been delivered into the agent's
   * conversation yet. See `Turn.queuedMessageId`'s doc comment (state.ts) for why membership,
   * not the field's mere presence, is what "currently queued" means. */
  queuedIds: ReadonlySet<string>;
  onCancelQueuedMessage: (messageId: string) => void;
}): ReactElement {
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
  // DH-0207: distinct visual state for a "user" turn still sitting in the not-yet-delivered
  // queue — the "UX gaps" this ticket exists to close (no way to tell queued from sent, no
  // way to cancel). Every other role/case is unaffected (queuedMessageId is only ever set on
  // "user" turns — see correlateQueuedMessages in state.ts).
  const queuedMessageId = turn.queuedMessageId;
  const isQueued = queuedMessageId !== undefined && queuedIds.has(queuedMessageId);
  return (
    <div className={`turn turn-${turn.role}${isQueued ? " turn-queued" : ""}`}>
      <div className="turn-role">
        {turnRoleLabel(turn.role)}
        {isQueued ? <span className="turn-queued-badge">queued</span> : null}
      </div>
      {turn.role === "assistant" ? (
        <MarkdownContent text={turn.text} />
      ) : (
        <div className="turn-text">{turn.text}</div>
      )}
      {isQueued && queuedMessageId !== undefined ? (
        <button
          type="button"
          className="turn-queued-cancel"
          aria-label="Cancel queued message"
          onClick={() => onCancelQueuedMessage(queuedMessageId)}
        >
          Cancel
        </button>
      ) : null}
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
  onCancelQueuedMessage: (agentId: string, messageId: string) => void;
}

export function Transcript({
  agent,
  sessionEnded,
  exitCode,
  onCancelQueuedMessage,
}: TranscriptProps): ReactElement {
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
    // DH-0129 undershoot fix: `.output-scroll` has `scroll-behavior: smooth` (styles.css) so a
    // plain `scrollTop` assignment animates over several frames rather than landing instantly.
    // While that animation is in flight, the browser fires real native `scroll` events on every
    // frame — and `onScroll` below (added for DH-0200) treats every such event as user-driven,
    // recomputing `isNearBottom()` against the (already-grown) `scrollHeight` but the
    // (not-yet-arrived) mid-animation `scrollTop`. That almost always reads as "not near
    // bottom," which clears `stickToBottomRef` and strands the animation wherever it happened
    // to be mid-flight — visibly undershooting the true bottom. This was the actual mechanism
    // behind the 2026-07-19 live-retest report ("partially follows, stops short"): it hit
    // hardest on operator sends (local echo + a fast-following `agent_status: running` each
    // grow the region, racing the still-animating prior scroll) but the same race is possible
    // for tool-call turns and any other content growth close on the heels of a scroll.
    // Force an instant jump here by disabling `scroll-behavior` for the duration of this one
    // assignment, restoring it immediately after -- CSS smooth-scrolling stays intact for any
    // other scroll source (e.g. keyboard/touch), it's specifically this component's own
    // "chase the bottom" writes that must land synchronously and can't be second-guessed by an
    // in-flight animation's own scroll events.
    const previousScrollBehavior = region.style.scrollBehavior;
    region.style.scrollBehavior = "auto";
    region.scrollTop = region.scrollHeight;
    region.style.scrollBehavior = previousScrollBehavior;
    stickToBottomRef.current = true;
    setJumpVisible(false);
  };

  const lastTurnTextLength = transcript.at(-1)?.text.length ?? 0;

  const showThinking = agent && agent.status === "running" && !agent.turnOpen;
  const lastTurn = transcript.at(-1);
  const thinking = showThinking && lastTurn?.role !== "assistant";

  // Re-runs on every transcript-affecting change (agent identity, turn count, last turn's
  // text length) rather than depending on `transcript`/`agent` object identity, matching the
  // old imperative code's "did rendered content grow" check (DH-0129). `isNearBottom`/
  // `scrollToBottom` read `scrollRegionRef.current` fresh on every call rather than closing
  // over state, so they're intentionally omitted from the dependency list; `lastTurnTextLength`
  // is intentionally included even though the body doesn't read it directly — it's what makes
  // the effect re-fire when a streaming chunk extends the current turn without changing
  // `transcript.length`.
  //
  // `thinking` is ALSO intentionally included even though the body doesn't read it directly
  // (DH-0129 undershoot fix): `ThinkingIndicator` is rendered outside `turnRows`/`transcript`
  // (see below), gated on `agent.status`/`agent.turnOpen`/last-turn-role rather than anything
  // this effect otherwise watches. For an operator-sent message, the sequence is (1) the local
  // echo appends a user turn -> this effect fires and scrolls to the *current* scrollHeight,
  // then (2) the next `agent_status: "running"` SSE event mounts `ThinkingIndicator`, growing
  // scrollHeight further -- but without `thinking` as a dependency, that DOM growth never
  // re-triggered scrollToBottom(), so the view visibly stopped short of the true bottom until
  // the first real output chunk arrived (which happens to touch `lastTurnTextLength` and
  // papers over the gap for agent-streamed replies, which is why only the operator-message
  // path showed the undershoot). Including `thinking` makes the effect re-fire exactly when
  // the indicator mounts/unmounts, closing the gap for both paths.
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
  }, [agent?.agentId, transcript.length, lastTurnTextLength, thinking]);
  const queuedIds = new Set((agent?.queuedMessages ?? []).map((entry) => entry.id));
  // transcript is append-only (never reordered/spliced), so each item's `startIndex` (a
  // transcript index) is a stable identity — see `groupTranscript`/`RenderItem` above.
  const cancelQueuedMessage = (messageId: string) => {
    if (agent) onCancelQueuedMessage(agent.agentId, messageId);
  };
  const turnRows = groupTranscript(transcript).map((item) =>
    item.kind === "group" ? (
      <ToolCallGroup key={item.startIndex} turns={item.turns} />
    ) : (
      <TurnRow
        key={item.startIndex}
        turn={item.turn}
        queuedIds={queuedIds}
        onCancelQueuedMessage={cancelQueuedMessage}
      />
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
