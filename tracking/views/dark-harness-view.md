---
spile: view
project: Dark Harness
source: tracking/
---

<!-- GENERATED — do not hand-edit. Regenerate whenever a ticket's front matter changes.
     Built from tracking/DH-*.md. -->

# Dark Harness — tracker view

## Needs Attention

| ID | Title | Blocked by |
| --- | --- | --- |
| [DH-0001](../DH-0001-task-failed-marker-reliability.md) | `TASK_FAILED` marker is not reliably emitted despite being taught | owner/architect decision needed on structured self-report mechanism (same question as DH-0050) |
| [DH-0004](../DH-0004-npm-packaging-single-platform.md) | npm package only ships a single-platform binary | owner triage: packaging-shape decision needed before dispatch |
| [DH-0010](../DH-0010-no-context-window-compaction-or-cache-control.md) | No context-window compaction/token-budget handling, and no prompt caching (`cache_control`) | owner triage: needs input before dispatch (ticket-triage-workflow bucket B) |
| [DH-0012](../DH-0012-unbounded-memory-growth-across-harness.md) | Unbounded in-memory growth across the harness for long/wide-fanout runs | owner triage: needs input before dispatch (ticket-triage-workflow bucket B) |
| [DH-0020](../DH-0020-jsonl-logger-robustness-and-secrets-redaction.md) | JSONL logger has no write-error handling, no fsync, and no awareness of secrets in tool call I/O | owner triage: needs input before dispatch (ticket-triage-workflow bucket B) |
| [DH-0025](../DH-0025-tui-terminal-safety-and-rendering-correctness.md) | TUI writes untrusted agent output straight to the terminal with no ANSI sanitization, and has wide-character/resize rendering bugs | owner triage: needs input before dispatch (ticket-triage-workflow bucket B) |
| [DH-0028](../DH-0028-tui-missing-token-cost-display-and-usage-accounting-mismatch.md) | TUI never displays token/cost data it already tracks, and TUI vs. Web disagree on whether `token_usage` is a delta or a running total | owner triage: needs input before dispatch (ticket-triage-workflow bucket B) |
| [DH-0031](../DH-0031-supply-chain-hardening-gaps.md) | GitHub Actions supply-chain hardening gaps — actions pinned by tag, no artifact signing, no npm provenance | owner triage: needs input before dispatch (ticket-triage-workflow bucket B) |
| [DH-0040](../DH-0040-bash-env-secrets-exposure-and-provider-error-redaction.md) | Bash tool's full-environment inheritance and unredacted provider error messages are undocumented secrets-exposure vectors | owner triage: needs input before dispatch (ticket-triage-workflow bucket B) |
| [DH-0044](../DH-0044-no-streaming-partial-output.md) | No streaming of partial model output — `agent_output` events only fire once per completed turn | owner triage: needs input before dispatch (ticket-triage-workflow bucket B) |
| [DH-0047](../DH-0047-no-checkpointing-or-rewind-of-file-edits.md) | No checkpointing/rewind of file edits — an off-the-rails unattended run has no automatic rollback | owner triage: needs input before dispatch (ticket-triage-workflow bucket B) |
| [DH-0050](../DH-0050-no-structured-final-output-or-headless-json-progress.md) | No structured final-result convention beyond the `TASK_FAILED` text marker, and no machine-readable progress stream for `--job` | owner triage: needs input before dispatch (ticket-triage-workflow bucket B) |

## Board

### draft

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0002](../DH-0002-full-mcp-client-support.md) | Full MCP client support | feature | stefan |
| [DH-0003](../DH-0003-sendmessage-resume-finished-conversation.md) | `SendMessage` should resume a finished agent's conversation, not just error cleanly | feature | stefan |
| [DH-0004](../DH-0004-npm-packaging-single-platform.md) | npm package only ships a single-platform binary 🔒 | feature | stefan |
| [DH-0010](../DH-0010-no-context-window-compaction-or-cache-control.md) | No context-window compaction/token-budget handling, and no prompt caching (`cache_control`) 🔒 | feature | stefan |
| [DH-0012](../DH-0012-unbounded-memory-growth-across-harness.md) | Unbounded in-memory growth across the harness for long/wide-fanout runs 🔒 | bug | stefan |
| [DH-0020](../DH-0020-jsonl-logger-robustness-and-secrets-redaction.md) | JSONL logger has no write-error handling, no fsync, and no awareness of secrets in tool call I/O 🔒 | bug | stefan |
| [DH-0025](../DH-0025-tui-terminal-safety-and-rendering-correctness.md) | TUI writes untrusted agent output straight to the terminal with no ANSI sanitization, and has wide-character/resize rendering bugs 🔒 | bug | stefan |
| [DH-0028](../DH-0028-tui-missing-token-cost-display-and-usage-accounting-mismatch.md) | TUI never displays token/cost data it already tracks, and TUI vs. Web disagree on whether `token_usage` is a delta or a running total 🔒 | bug | stefan |
| [DH-0031](../DH-0031-supply-chain-hardening-gaps.md) | GitHub Actions supply-chain hardening gaps — actions pinned by tag, no artifact signing, no npm provenance 🔒 | feature | stefan |
| [DH-0035](../DH-0035-first-run-friction-no-init-doctor-dry-run.md) | No `dh init`/`dh doctor`/`--dry-run`, and cold error messages give a first-time operator no path forward | feature | stefan |
| [DH-0037](../DH-0037-no-log-rotation-or-run-summary-or-log-analysis-tool.md) | No log rotation/disk-growth caps, no structured final run-summary artifact, and no log-analysis tooling | feature | stefan |
| [DH-0038](../DH-0038-no-crash-recovery-or-session-resume.md) | No crash-recovery/session-resume across a process restart, and a completed standalone job silently starts a fresh, disconnected interactive session | feature | stefan |
| [DH-0040](../DH-0040-bash-env-secrets-exposure-and-provider-error-redaction.md) | Bash tool's full-environment inheritance and unredacted provider error messages are undocumented secrets-exposure vectors 🔒 | bug | stefan |
| [DH-0043](../DH-0043-no-prompt-caching.md) | No prompt caching — one of the largest cost levers for an agentic loop is unused | feature | stefan |
| [DH-0044](../DH-0044-no-streaming-partial-output.md) | No streaming of partial model output — `agent_output` events only fire once per completed turn 🔒 | feature | stefan |
| [DH-0045](../DH-0045-no-extended-thinking-support.md) | No extended-thinking (interleaved/extended thinking blocks) support | feature | stefan |
| [DH-0046](../DH-0046-no-multimodal-image-input-or-screenshot-tool.md) | No image/multimodal input, and no screenshot tool — blocks visual web-testing/verification workflows | feature | stefan |
| [DH-0047](../DH-0047-no-checkpointing-or-rewind-of-file-edits.md) | No checkpointing/rewind of file edits — an off-the-rails unattended run has no automatic rollback 🔒 | feature | stefan |
| [DH-0048](../DH-0048-no-telemetry-metrics-endpoint.md) | No telemetry/metrics endpoint for fleet-level observability | feature | stefan |
| [DH-0049](../DH-0049-no-rate-limit-aware-request-scheduling.md) | No rate-limit-aware request scheduling across concurrently-spawned sub-agents | feature | stefan |
| [DH-0050](../DH-0050-no-structured-final-output-or-headless-json-progress.md) | No structured final-result convention beyond the `TASK_FAILED` text marker, and no machine-readable progress stream for `--job` 🔒 | feature | stefan |
| [DH-0051](../DH-0051-no-git-native-artifacts-or-log-replay-tooling.md) | No git-native session artifacts, and no evaluation/replay tooling built on the JSONL logs | feature | stefan |
| [DH-0052](../DH-0052-windows-console-support-unverified.md) | Windows console/TUI support is unverified — no Windows-specific console-mode handling found, and no Windows execution anywhere in CI | bug | stefan |
| [DH-0053](../DH-0053-no-model-provider-fallback-chains.md) | No model/provider fallback chains — a down or rate-limited primary model has no automatic substitute | feature | stefan |

### ready

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0005](../DH-0005-npm-token-secret.md) | `NPM_TOKEN` repository secret not yet set | feature | stefan |
| [DH-0022](../DH-0022-default-server-bind-address-not-loopback.md) | Add a `dh.json` field to configure the server/web bind address (default unchanged) | feature | stefan |
| [DH-0023](../DH-0023-web-ui-token-leak-cors-csp-clickjacking.md) | Web UI CORS/Host-header/CSP/clickjacking hardening | bug | stefan |
| [DH-0055](../DH-0055-dh-doesn-t-read-a-project-s-claude-md-into-the-system-prompt.md) | dh doesn't read a project's CLAUDE.md into the system prompt | feature | stefan |

### implementing

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0001](../DH-0001-task-failed-marker-reliability.md) | `TASK_FAILED` marker is not reliably emitted despite being taught 🔒 | bug | stefan |

## Recently Closed

| ID | Title | Resolution |
| --- | --- | --- |
| [DH-0054](../DH-0054-no-first-class-grep-glob-tools.md) | No first-class Grep/Glob tools — all search is delegated informally to Bash | done |
| [DH-0042](../DH-0042-readme-config-reference-gaps.md) | README's config reference omits `options.maxTurns` and per-model pricing fields, with no automated check against `src/contracts/config.ts` | done |
| [DH-0041](../DH-0041-missing-user-facing-docs-bundle.md) | A cluster of user-facing documentation is entirely missing | done |
| [DH-0039](../DH-0039-git-credentials-and-workspace-convention-undocumented.md) | Git credential provisioning and workspace-directory convention are entirely undocumented | done |
| [DH-0036](../DH-0036-no-container-deployment-reference.md) | No reference Dockerfile or container/deployment documentation for the canonical dark-factory use case | done |
| [DH-0034](../DH-0034-e2e-flakiness-risks-and-missing-connect-web-coverage.md) | E2E has a port-allocation race, an ordering-dependent cleanup convention, and no coverage of `dh --connect --web` | done |
| [DH-0033](../DH-0033-mock-provider-cannot-simulate-errors-or-streaming.md) | The e2e mock provider can't simulate provider errors or streaming, so the harness's failure-handling path is completely untested end-to-end | done |
| [DH-0032](../DH-0032-release-binaries-untested-on-real-target-os.md) | Windows and macOS release binaries are cross-compiled but never actually executed anywhere, and the e2e-tested binary isn't the same artifact as what ships | done |
| [DH-0030](../DH-0030-ci-coverage-gate-text-parsing-fragility.md) | CI's coverage/completeness/e2e gates rely on fragile text-parsing and a fail-open conditional, not structured checks | done |
| [DH-0029](../DH-0029-web-accessibility-and-error-surfacing-gaps.md) | Web UI has no keyboard-reachable agent list, no ARIA live regions, a missing "stopped" status color, and both clients drop errors after a few seconds with no history | done |
| [DH-0027](../DH-0027-tui-tree-view-scroll-follows-selection-bug.md) | TUI's agent tree view doesn't scroll to follow selection — the highlighted entry can scroll off-screen with no way to see it | done |
| [DH-0026](../DH-0026-tui-input-editing-gaps.md) | TUI's input box has no cursor movement, no bracketed-paste support, and two dead keys | done |
| [DH-0024](../DH-0024-sse-reconnect-lacks-backoff-and-gap-indication.md) | Both TUI and Web SSE clients reconnect on a fixed delay with no backoff, and give no indication of a missed-event gap or session restart | done |
| [DH-0021](../DH-0021-tar-bundle-name-length-limit-breaks-download.md) | `buildTar` throws and kills the entire session-bundle download if any single agent's encoded id exceeds 100 bytes | done |
| [DH-0019](../DH-0019-sse-event-buffer-robustness.md) | SSE/EventBuffer has no backpressure handling and silently serves a gap when `Last-Event-ID` was evicted | done |
