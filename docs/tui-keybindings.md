# TUI keybindings reference

`dh` with no flags (or `--connect <host>`, without `--web`) starts the console TUI. There is
no on-screen help — this page is the reference. Keys are read raw (no line editing beyond
what's listed below); behavior depends on which of the three views you're in.

## Root view (the message box)

The default view: an input line where you talk to the root agent, plus its latest output.

| Key | Action |
| --- | --- |
| Any printable character | Appended to the input line. |
| Backspace | Deletes the last character of the input line. |
| Enter | Sends the input line as a message to the root agent (no-op if the line is empty, or if the root agent hasn't been assigned yet — a status message says so). |
| Left arrow (input line empty) | Switches to the agent tree view. |
| Escape | Clears the current status message. |
| Ctrl-C | Quits `dh`. |

Left-arrow only navigates to the tree when the input line is empty, so you can type a literal
left-arrow-adjacent character without accidentally leaving the root view mid-message (not
applicable today since arrow keys aren't inserted as characters, but kept as the documented
rule for the input line's general behavior).

## Agent tree view

A flattened, indented list of every agent in the session (root and all sub-agents,
regardless of nesting depth), reachable from the root view via left-arrow.

| Key | Action |
| --- | --- |
| Up / Down arrow | Move the selection up/down the flattened tree. |
| Enter | Open the selected agent. Selecting the root agent returns you to the root view; selecting anything else opens the read-only agent detail view. |
| Left arrow, or Escape | Return to the root view. |
| Ctrl-C | Quits `dh`. |

## Agent detail view

Read-only output for a single sub-agent (opened from the tree view via Enter on a non-root
entry).

| Key | Action |
| --- | --- |
| Escape, or `q` | Return to the root view. |
| Ctrl-C | Quits `dh`. |

Only the root agent can be sent messages interactively from the TUI — sub-agent views are
observation-only, matching the harness's "coordinator holds the conversation, sub-agents do
the work" model (see `CLAUDE.md`/`PLAYBOOK.md`).
