// React migration of render.ts's renderTranscript/appendTranscript (DH-0135), folding in:
// - DH-0127 (flicker/no-vdom): each turn is a keyed <TurnRow>, so an unrelated re-render no
//   longer replaces DOM nodes for turns whose content hasn't changed — React's reconciliation
//   does this for free, closing DH-0127 without a hand-written diff.
// - DH-0129 (auto-scroll only when at bottom): an effect below scrolls to the bottom on new
//   content only when the region was already scrolled to (near) the bottom before the update;
//   otherwise it reveals the jump-to-latest button instead of yanking the view.
// - DH-0130 (per-agent terminal-status transcript marker): render-side plumbing is included
//   (see `TERMINAL_MARKER_ROLE` handling below) but state.ts does not yet derive a terminal
//   marker Turn — that reducer-side half is still unimplemented upstream (out of scope for
//   this ticket per the "state.ts stays as-is" constraint), so this story remains unproven
//   until state.ts grows it.
import { type ReactElement, useEffect, useRef, useState } from "react";
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

function TurnRow({ turn }: { turn: Turn }): ReactElement {
  if (turn.role === "tool") {
    return (
      <div className={`turn turn-tool${turn.toolError ? " turn-tool-error" : ""}`}>
        <div className="turn-text">{turn.toolError ? `⚙ ${turn.text} ✗` : `⚙ ${turn.text}`}</div>
      </div>
    );
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
      <div className="turn-text thinking-dots" aria-label="Agent is thinking">
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

  const isNearBottom = () => {
    const region = scrollRegionRef.current;
    if (!region) return true;
    return region.scrollHeight - region.scrollTop - region.clientHeight < NEAR_BOTTOM_THRESHOLD_PX;
  };

  const scrollToBottom = () => {
    const region = scrollRegionRef.current;
    if (!region) return;
    region.scrollTop = region.scrollHeight;
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
    const wasNearBottom = isNearBottom();
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
  // transcript is append-only (never reordered/spliced), so an index is a stable identity
  // for each turn.
  // biome-ignore lint/suspicious/noArrayIndexKey: see comment above.
  const turnRows = transcript.map((turn, i) => <TurnRow key={i} turn={turn} />);

  return (
    <>
      <div
        className="output-scroll"
        ref={scrollRegionRef}
        onScroll={() => isNearBottom() && setJumpVisible(false)}
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
