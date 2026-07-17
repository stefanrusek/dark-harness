// React migration of render.ts's renderComposer (DH-0135, first migrated section — the
// proven DH-0117 focus/text-loss bug site). The old function needed a hand-written
// idempotency guard (`container.dataset.composerRendered`) because `renderAll()` fires on
// every SSE event and the 1s liveness tick, and an unconditional DOM rebuild would tear down
// the live `<textarea>` (and its focus/unsent text) every time. React's reconciliation makes
// that guard unnecessary: as long as this component keeps returning the same element type in
// the same position, React never recreates the DOM node across `root.render()` calls.
//
// The textarea stays uncontrolled (ref-based, `defaultValue`) rather than a controlled
// `value`/`onChange` pair — this mirrors the old imperative behavior exactly (read `.value`
// on submit, clear it after send) and keeps it directly driveable by tests that set
// `textarea.value` and dispatch a native `submit`/`keydown` event, same as before.
import { type ReactElement, useRef } from "react";
import { type WebState, isRoot, selectedAgent } from "../state.ts";

export interface ComposerProps {
  state: WebState;
  onSend: (message: string) => void;
}

export function Composer({ state, onSend }: ComposerProps): ReactElement | null {
  const agent = selectedAgent(state);
  const shouldShow = Boolean(agent && isRoot(state, agent.agentId));
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  if (!shouldShow) return null;

  const submit = (evt?: { preventDefault(): void }) => {
    evt?.preventDefault();
    const el = textareaRef.current;
    if (!el) return;
    const value = el.value.trim();
    if (!value) return;
    onSend(value);
    el.value = "";
  };

  return (
    <form className="composer" onSubmit={submit}>
      <textarea
        ref={textareaRef}
        className="composer-input"
        placeholder="Message the root agent… (Enter to send, Shift+Enter for newline)"
        rows={2}
        defaultValue=""
        onKeyDown={(evt) => {
          if (evt.key === "Enter" && !evt.shiftKey) {
            evt.preventDefault();
            submit();
          }
        }}
      />
      <button type="submit" className="btn btn-primary composer-send">
        Send
      </button>
    </form>
  );
}
