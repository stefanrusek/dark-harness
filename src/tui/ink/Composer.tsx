// DH-0136: root view's input box, migrated from render.ts's `renderRoot` footer to an Ink
// component. Prop-driven from `TuiState` only (`input`/`inputCursor`/`statusMessage`) — a
// background liveness tick (state.now advancing) never touches these fields, so re-rendering
// on a tick naturally preserves in-progress typed text (the regression this ticket's first
// User Story guards against, restated from DH-0133/DH-0135's Web equivalent).
import { Box, Text } from "ink";
import { visibleAutocomplete } from "../state.ts";
import type { TuiState } from "../types.type.ts";
import { CURSOR_MARKER } from "./tokens.ts";

export interface ComposerProps {
  state: TuiState;
}

const DEFAULT_HINT = "[Enter] send   [←] agent tree   [Ctrl+C] quit";

export function Composer({ state }: ComposerProps) {
  const hint = state.statusMessage ?? DEFAULT_HINT;
  // Embedded newlines from a bracketed-paste (DH-0026) are shown as a visible "⏎" glyph
  // on this one-line display only — `state.input` itself keeps the real newline characters.
  const before = state.input.slice(0, state.inputCursor).replace(/\n/g, "⏎");
  const after = state.input.slice(state.inputCursor).replace(/\n/g, "⏎");
  // DH-0142: dropdown contents derived straight from state — no local component state, so
  // this stays a pure function of props like the rest of the composer.
  const dropdown = visibleAutocomplete(state);
  return (
    <Box flexDirection="column">
      {/* height=1: Ink collapses an empty-string <Text> to zero height, and
       * `state.statusMessage` can be set to "" — see App.tsx's equivalent comment. */}
      <Box height={1}>
        <Text>{hint}</Text>
      </Box>
      <Box height={1}>
        <Text>{`> ${before}${CURSOR_MARKER}${after}`}</Text>
      </Box>
      {dropdown && dropdown.length > 0 ? (
        <Box flexDirection="column">
          {dropdown.map((entry, index) => (
            <Text key={entry.name} inverse={index === state.dropdownIndex}>
              {`  /${entry.name} — ${entry.description}`}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
