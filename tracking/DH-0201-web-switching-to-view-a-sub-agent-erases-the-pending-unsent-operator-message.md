---
spile: ticket
id: DH-0201
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: ["DH-0117", "DH-0135"]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0201: Web switching to view a sub-agent erases the pending unsent operator message

## Summary

Typing text into the composer, then clicking to view a different (non-root) agent's detail
pane, silently discards the unsent text — real data loss. Root cause: `Composer.tsx`
returned `null` whenever the selected agent wasn't the root, which unmounts the (uncontrolled,
ref-based) `<textarea>` DOM node entirely; since the textarea's pending value lives only in
that live DOM node (see the DH-0117 comment block atop `Composer.tsx`), unmounting it
discards whatever was typed.

## User Stories

### As an operator mid-composing a message, I want my draft to survive switching to view a different agent

- Given the operator has typed unsent text into the composer, when they select a non-root
  agent (hiding the composer) and then select the root agent again, then the composer's
  textarea still contains exactly what they typed.
  - Proven by: `src/web/client/components/Composer.test.tsx` — "DH-0201: unsent composer text
    survives switching to view a sub-agent and back".
- Given the composer is hidden because a non-root agent is selected, when it's hidden, then
  it's hidden via a CSS class on a still-mounted `<form>`, not by unmounting the component.
  - Proven by: `src/web/client/components/Composer.test.tsx` — "hides the composer (via the
    .hidden class, not unmounting) when no agent is selected" and "... when a non-root agent
    is selected".
- Given the operator switches away and back to root, when the textarea DOM node is inspected,
  then it is the *same* node (identity-preserved), consistent with the DH-0117
  focus/text-loss fix's approach for unrelated re-renders.
  - Proven by: `src/web/client/components/Composer.test.tsx` — "keeps the same textarea node
    across a show/hide transition (root -> non-root -> root)".

## Functional Requirements

- `Composer` always renders its `<form>`/`<textarea>`; visibility for a non-root/no-agent
  selection is expressed via the existing `.hidden` CSS class (`display: none !important`),
  never by unmounting.

## Assumptions

- None beyond the existing DH-0117 uncontrolled-textarea design (pending text lives only in
  the DOM node, not in React/app state) — preserved rather than replaced, since switching to
  a controlled-input model was a larger, riskier change than keeping the node mounted.

## Risks

- None identified; the `.hidden` class already exists and is used elsewhere in the app
  (e.g. `JumpToLatestButton`).

## Open Questions

- None blocking.

## Notes

- 2026-07-19: Root cause confirmed: `Composer.tsx` computed `shouldShow` and returned `null`
  when false, unmounting the form. Fixed by always rendering the form and toggling
  `className={"composer" + (shouldShow ? "" : " hidden")}` instead — see
  `src/web/client/components/Composer.tsx`. Updated `src/web/client/components/Composer.test.tsx`:
  replaced the two "renders nothing" tests (which asserted `querySelector("form")` was null)
  with assertions that the form exists but carries `.hidden`, replaced the "rebuilds the
  composer on an actual show/hide transition" test (which asserted the textarea was *not* the
  same node — the old, buggy behavior) with an assertion that it *is* the same node, and added
  a dedicated DH-0201 regression test that types into the composer, switches to a sub-agent
  and back, and asserts the typed text is still there (this test fails against the pre-fix
  code — `container.querySelector("textarea")` after the round-trip is a fresh, empty node —
  and passes against the fix). Verified via `bun run typecheck`, `bun run lint`, `bun run
  test:coverage` (2180 pass, 100.00% lines on all changed files), and `bun run e2e` (38 pass).
