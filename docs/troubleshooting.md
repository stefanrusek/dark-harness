# Troubleshooting / FAQ

## The process exited 0/1 but nothing seems to have happened

`--job` exit codes reflect the root agent's *self-report*, scanned from its final response
text (`TASK_FAILED` present → `1`; absent → `0`) — they are not a correctness check on what
actually got done. A `0` exit means the model believed it finished and said so cleanly; it
doesn't mean the result matches what you wanted. Check the session's JSONL logs (see the
[log format reference](jsonl-log-format.md)) or re-run interactively (without `--job`) to
watch it work. If runs are self-reporting success while quietly leaving work undone, see
`tracking/DH-0001` — this is a known reliability gap in small/local models specifically.

## An unattended run wrote a clear "I couldn't do this" message but exited 0

Same root cause as above: the harness only detects failure via the literal `TASK_FAILED`
marker in the final response, not by understanding the model's prose. Round 5 of the Prompt
domain's work hardened the system prompt against this (an explicit worked example plus a
"re-read your own response" self-check), but it's a prompt-level mitigation, not a structural
fix — see `tracking/DH-0001`'s open question about a more reliable, less string-dependent
mechanism.

## `dh --connect <host>` can't reach the server

- Confirm the target is actually running `dh --server` (or the combined local mode) and that
  the port matches (`--port` on both sides, default `4000`).
- `dh` speaks plaintext HTTP by default — if you've since enabled `security.tls` on the
  server, `--connect` needs the matching scheme/cert trust; see the
  [security section](../README.md#optional-bearer-token--tls).
- If `security.token` is set on the server, the connecting client's own `dh.json` must supply
  the same token — a mismatch or missing token is a bare `401`.

## Bedrock gives "invalid model" or "access denied"

Almost always an AWS-account/region issue, not a `dh.json` problem — see the
[Bedrock setup notes](../README.md#aws-bedrock-setup): Bedrock model ids are region- and
account-specific, and a syntactically valid id can be legacy or not enabled for that
account/region. Check model access in the Bedrock console for the exact region configured.

## A skill I added isn't showing up

- Confirm the directory is listed in `dh.json`'s `skillPaths`, and that the `SKILL.md` is one
  level directly under one of those directories (discovery isn't recursive).
- Confirm the frontmatter has both `name` and `description` and matches the flat `key: value`
  shape described in the [skills-authoring guide](skills-authoring-guide.md) — a skill
  missing either field, or with malformed frontmatter, is silently skipped rather than
  erroring.

## MCP server configured but its tools never show up

Expected today — the MCP client isn't wired up yet; configuring `mcpServers` only gets you a
placeholder `ToolSearch` result per server, not real tool access. See the
[MCP server examples](mcp-servers.md) status note and `tracking/DH-0002`.

## Where do the logs live, and how do I read them?

`.dh-logs/<sessionId>/<agentId>.jsonl`, one file per agent — see the
[JSONL log format reference](jsonl-log-format.md) for the schema. The web UI's "Download
log" button fetches a single agent's file directly if you'd rather not dig through the
directory by hand.
