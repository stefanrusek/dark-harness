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
| [DH-0004](../DH-0004-npm-packaging-single-platform.md) | npm package only ships a single-platform binary | owner decision on packaging shape |

## Board

### draft

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0002](../DH-0002-full-mcp-client-support.md) | Full MCP client support | feature | stefan |
| [DH-0003](../DH-0003-sendmessage-resume-finished-conversation.md) | `SendMessage` should resume a finished agent's conversation | feature | stefan |
| [DH-0004](../DH-0004-npm-packaging-single-platform.md) | npm package only ships a single-platform binary 🔒 | feature | stefan |
| [DH-0009](../DH-0009-provider-retry-backoff-and-error-taxonomy.md) | No provider-level retry/backoff, and no error taxonomy, for transient failures | bug | stefan |
| [DH-0010](../DH-0010-no-context-window-compaction-or-cache-control.md) | No context-window compaction/token-budget handling, and no prompt caching | feature | stefan |
| [DH-0011](../DH-0011-no-signal-handling-or-process-group-reaping.md) | No SIGTERM/SIGINT handling, and Bash tool doesn't reap grandchild processes | bug | stefan |
| [DH-0012](../DH-0012-unbounded-memory-growth-across-harness.md) | Unbounded in-memory growth across the harness for long/wide-fanout runs | bug | stefan |
| [DH-0013](../DH-0013-no-cost-turn-time-or-fanout-budgets.md) | No wall-clock, cost/token, or sub-agent fan-out budget | feature | stefan |
| [DH-0014](../DH-0014-read-tool-unbounded-memory-for-large-files.md) | `Read` tool buffers entire file into memory before size/line limiting applies | bug | stefan |
| [DH-0015](../DH-0015-config-validation-gaps.md) | Several `dh.json` config-loading edge cases are unhandled or under-validated | bug | stefan |
| [DH-0016](../DH-0016-skill-system-loading-and-discovery-gaps.md) | Bundled `cli-tools` skill is unreachable via the `Skill` tool, plus other skill-system gaps | bug | stefan |
| [DH-0017](../DH-0017-error-swallowing-and-status-inconsistencies.md) | Harness-level errors silently discarded; "stopped" vs "failed" status can flip | bug | stefan |
| [DH-0018](../DH-0018-system-prompt-discipline-gaps.md) | `systemPrompt` override silently drops discipline contract; missing unattended guidance | bug | stefan |
| [DH-0019](../DH-0019-sse-event-buffer-robustness.md) | SSE/EventBuffer has no backpressure handling and silently serves a gap on evicted `Last-Event-ID` | bug | stefan |
| [DH-0020](../DH-0020-jsonl-logger-robustness-and-secrets-redaction.md) | JSONL logger has no write-error handling, no fsync, no secrets redaction | bug | stefan |
| [DH-0022](../DH-0022-default-server-bind-address-not-loopback.md) | `Bun.serve()` never sets `hostname`; server defaults to binding all interfaces | bug | stefan |
| [DH-0023](../DH-0023-web-ui-token-leak-cors-csp-clickjacking.md) | Web UI's own HTTP port leaks the bearer token; CORS/CSP/clickjacking gaps | bug | stefan |
| [DH-0024](../DH-0024-sse-reconnect-lacks-backoff-and-gap-indication.md) | TUI/Web SSE clients reconnect on fixed delay with no backoff or gap indication | bug | stefan |
| [DH-0025](../DH-0025-tui-terminal-safety-and-rendering-correctness.md) | TUI writes untrusted agent output with no ANSI sanitization; wide-char rendering bugs | bug | stefan |
| [DH-0026](../DH-0026-tui-input-editing-gaps.md) | TUI input box has no cursor movement, no bracketed-paste support, two dead keys | bug | stefan |
| [DH-0028](../DH-0028-tui-missing-token-cost-display-and-usage-accounting-mismatch.md) | TUI never displays token/cost data; TUI vs Web disagree on usage-event semantics | bug | stefan |
| [DH-0029](../DH-0029-web-accessibility-and-error-surfacing-gaps.md) | Web UI keyboard/ARIA gaps; both clients drop errors after a few seconds | bug | stefan |
| [DH-0030](../DH-0030-ci-coverage-gate-text-parsing-fragility.md) | CI's coverage/completeness/e2e gates rely on fragile text-parsing and fail-open logic | bug | stefan |
| [DH-0031](../DH-0031-supply-chain-hardening-gaps.md) | GitHub Actions supply-chain hardening gaps | feature | stefan |
| [DH-0032](../DH-0032-release-binaries-untested-on-real-target-os.md) | Windows/macOS release binaries cross-compiled but never executed anywhere | bug | stefan |
| [DH-0033](../DH-0033-mock-provider-cannot-simulate-errors-or-streaming.md) | Mock provider can't simulate provider errors or streaming | bug | stefan |
| [DH-0034](../DH-0034-e2e-flakiness-risks-and-missing-connect-web-coverage.md) | E2E port-allocation race, cleanup ordering, and missing `--connect --web` coverage | bug | stefan |
| [DH-0035](../DH-0035-first-run-friction-no-init-doctor-dry-run.md) | No `dh init`/`dh doctor`/`--dry-run`; cold error messages give no path forward | feature | stefan |
| [DH-0036](../DH-0036-no-container-deployment-reference.md) | No reference Dockerfile or container/deployment documentation | feature | stefan |
| [DH-0037](../DH-0037-no-log-rotation-or-run-summary-or-log-analysis-tool.md) | No log rotation, no structured run-summary artifact, no log-analysis tooling | feature | stefan |
| [DH-0038](../DH-0038-no-crash-recovery-or-session-resume.md) | No crash-recovery/session-resume; standalone job silently starts fresh session | feature | stefan |
| [DH-0039](../DH-0039-git-credentials-and-workspace-convention-undocumented.md) | Git credential provisioning and workspace convention entirely undocumented | feature | stefan |
| [DH-0040](../DH-0040-bash-env-secrets-exposure-and-provider-error-redaction.md) | Bash env inheritance and unredacted provider error messages are undocumented risks | bug | stefan |
| [DH-0041](../DH-0041-missing-user-facing-docs-bundle.md) | A cluster of user-facing documentation is entirely missing | feature | stefan |
| [DH-0043](../DH-0043-no-prompt-caching.md) | No prompt caching — a major cost lever for an agentic loop is unused | feature | stefan |
| [DH-0044](../DH-0044-no-streaming-partial-output.md) | No streaming of partial model output | feature | stefan |
| [DH-0045](../DH-0045-no-extended-thinking-support.md) | No extended-thinking support | feature | stefan |
| [DH-0046](../DH-0046-no-multimodal-image-input-or-screenshot-tool.md) | No image/multimodal input, no screenshot tool | feature | stefan |
| [DH-0047](../DH-0047-no-checkpointing-or-rewind-of-file-edits.md) | No checkpointing/rewind of file edits | feature | stefan |
| [DH-0048](../DH-0048-no-telemetry-metrics-endpoint.md) | No telemetry/metrics endpoint for fleet-level observability | feature | stefan |
| [DH-0049](../DH-0049-no-rate-limit-aware-request-scheduling.md) | No rate-limit-aware request scheduling across concurrent sub-agents | feature | stefan |
| [DH-0050](../DH-0050-no-structured-final-output-or-headless-json-progress.md) | No structured final-result convention; no machine-readable `--job` progress stream | feature | stefan |
| [DH-0051](../DH-0051-no-git-native-artifacts-or-log-replay-tooling.md) | No git-native session artifacts; no evaluation/replay tooling from JSONL logs | feature | stefan |
| [DH-0052](../DH-0052-windows-console-support-unverified.md) | Windows console/TUI support is unverified | bug | stefan |
| [DH-0053](../DH-0053-no-model-provider-fallback-chains.md) | No model/provider fallback chains | feature | stefan |
| [DH-0054](../DH-0054-no-first-class-grep-glob-tools.md) | No first-class Grep/Glob tools | feature | stefan |

### ready

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0005](../DH-0005-npm-token-secret.md) | `NPM_TOKEN` repository secret not yet set 🔒 | feature | stefan |
| [DH-0021](../DH-0021-tar-bundle-name-length-limit-breaks-download.md) | `buildTar` throws and kills the entire bundle download past 100-byte names | bug | stefan |
| [DH-0027](../DH-0027-tui-tree-view-scroll-follows-selection-bug.md) | TUI's agent tree view doesn't scroll to follow selection | bug | stefan |
| [DH-0042](../DH-0042-readme-config-reference-gaps.md) | README's config reference omits `maxTurns` and per-model pricing fields | bug | stefan |

### implementing

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0001](../DH-0001-task-failed-marker-reliability.md) | `TASK_FAILED` marker not reliably emitted despite being taught | bug | stefan |
| [DH-0006](../DH-0006-e2e-multiturn-conversation-coverage.md) | No dedicated e2e test for plain multi-turn conversation continuity | bug | stefan |
| [DH-0007](../DH-0007-server-round1-open-threads-verification.md) | Server's three Round-1 open threads — likely stale, unverified | bug | stefan |
| [DH-0008](../DH-0008-adopt-spile-ops-skill.md) | Adopt (or build) a `spile-ops` skill for mechanical ticket operations | feature | stefan |

## Recently Closed

*(none yet)*
