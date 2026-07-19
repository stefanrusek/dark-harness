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
//
// DH-0143: the `/`-command autocomplete dropdown layers local component state (`useState`)
// on top of this — the highlighted index, whether the dropdown was explicitly dismissed, and
// a copy of the textarea's current value used only to compute matches. None of that touches
// the uncontrolled `value`/focus behavior above: the textarea's `value` prop is still never
// set by React, so DH-0117's regression coverage stays intact.
import { type ReactElement, useEffect, useRef, useState } from "react";
import {
  autocompleteMatches,
  buildCommandList,
  type CommandEntry,
} from "../../../client-core/command-list.ts";
import { isRoot, selectedAgent, type WebState } from "../state.ts";

export interface ComposerProps {
  state: WebState;
  onSend: (message: string) => void;
}

export function Composer({ state, onSend }: ComposerProps): ReactElement | null {
  const agent = selectedAgent(state);
  const shouldShow = Boolean(agent && isRoot(state, agent.agentId));
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const [inputValue, setInputValue] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const commands = buildCommandList(state.skills);
  const dropdown = dismissed ? null : autocompleteMatches(commands, inputValue);

  // DH-0143: click-outside closes the dropdown, per the ticket's third User Story (Web-only
  // — the TUI has no notion of "outside"). Listens on `mousedown`, not `click`, so the close
  // happens before a click on some other control fires its own handler.
  useEffect(() => {
    if (!dropdown) return;
    const onMouseDown = (evt: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(evt.target as Node)) {
        setDismissed(true);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [dropdown]);

  if (!shouldShow) return null;

  const submit = (evt?: { preventDefault(): void }) => {
    evt?.preventDefault();
    const el = textareaRef.current;
    if (!el) return;
    const value = el.value.trim();
    if (!value) return;
    onSend(value);
    el.value = "";
    setInputValue("");
    setHighlightedIndex(0);
    setDismissed(false);
  };

  const syncInputValue = () => {
    const el = textareaRef.current;
    setInputValue(el ? el.value : "");
    setHighlightedIndex(0);
    setDismissed(false);
  };

  const selectEntry = (entry: CommandEntry) => {
    const el = textareaRef.current;
    if (!el) return;
    const next = `/${entry.name} `;
    el.value = next;
    el.focus();
    el.setSelectionRange(next.length, next.length);
    setInputValue(next);
    setHighlightedIndex(0);
    setDismissed(false);
  };

  return (
    <div ref={wrapperRef} className="composer-wrapper">
      <form className="composer" onSubmit={submit}>
        <textarea
          ref={textareaRef}
          className="composer-input"
          placeholder="Message the root agent… (Enter to send, Shift+Enter for newline)"
          rows={2}
          defaultValue=""
          onInput={syncInputValue}
          onKeyDown={(evt) => {
            if (dropdown && dropdown.length > 0) {
              if (evt.key === "Escape") {
                evt.preventDefault();
                setDismissed(true);
                return;
              }
              if (evt.key === "ArrowDown") {
                evt.preventDefault();
                setHighlightedIndex((i) => (i + 1) % dropdown.length);
                return;
              }
              if (evt.key === "ArrowUp") {
                evt.preventDefault();
                setHighlightedIndex((i) => (i - 1 + dropdown.length) % dropdown.length);
                return;
              }
              if (evt.key === "Enter" || evt.key === "Tab") {
                const entry = dropdown[Math.min(highlightedIndex, dropdown.length - 1)];
                // `key === "Enter"` on an already-fully-typed command name is the ordinary
                // "submit this message" case, not a completion — the dropdown showing a
                // single exact match is incidental (mirrors DH-0142's TUI equivalent fix).
                // `Tab` never submits, so it always completes/selects instead.
                const alreadyComplete =
                  evt.key === "Enter" && entry !== undefined && inputValue === `/${entry.name}`;
                if (entry && !alreadyComplete) {
                  evt.preventDefault();
                  selectEntry(entry);
                  return;
                }
              }
            }
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
      {dropdown && dropdown.length > 0 ? (
        <ul className="composer-autocomplete">
          {dropdown.map((entry, index) => (
            <li
              key={entry.name}
              className={index === highlightedIndex ? "composer-autocomplete-active" : ""}
              onMouseDown={(evt) => {
                // `mousedown` (not `click`): fires before the textarea's blur/the
                // document-level click-outside listener above, so selecting an entry by
                // mouse doesn't race the dropdown closing itself first.
                evt.preventDefault();
                selectEntry(entry);
              }}
            >
              <span className="composer-autocomplete-name">/{entry.name}</span>
              <span className="composer-autocomplete-desc"> — {entry.description}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
