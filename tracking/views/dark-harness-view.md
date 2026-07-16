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
| [DH-0031](../DH-0031-supply-chain-hardening-gaps.md) | GitHub Actions supply-chain hardening gaps — actions pinned by tag, no artifact signing, no npm provenance | deferred (owner decision 2026-07-15): no incident behind this, revisit near real release cut |
| [DH-0047](../DH-0047-no-checkpointing-or-rewind-of-file-edits.md) | No checkpointing/rewind of file edits — an off-the-rails unattended run has no automatic rollback | deferred (owner decision 2026-07-15): sweep-sourced idea, not a real requested need |
| [DH-0048](../DH-0048-no-telemetry-metrics-endpoint.md) | No telemetry/metrics endpoint for fleet-level observability | deferred (2026-07-15): sweep-sourced, no observed fleet-ops need |
| [DH-0049](../DH-0049-no-rate-limit-aware-request-scheduling.md) | No rate-limit-aware request scheduling across concurrently-spawned sub-agents | deferred (2026-07-15): reactive retry sufficient so far |
| [DH-0051](../DH-0051-no-git-native-artifacts-or-log-replay-tooling.md) | No git-native session artifacts, and no evaluation/replay tooling built on the JSONL logs | deferred (2026-07-15): sweep-sourced, no observed need |
| [DH-0052](../DH-0052-windows-console-support-unverified.md) | Windows console/TUI support is unverified — no Windows-specific console-mode handling found, and no Windows execution anywhere in CI | deferred, revisit soon (2026-07-15) |
| [DH-0053](../DH-0053-no-model-provider-fallback-chains.md) | No model/provider fallback chains — a down or rate-limited primary model has no automatic substitute | deferred (2026-07-15): no observed sustained-outage incident, same as DH-0049 |
| [DH-0060](../DH-0060-tui-overnight-behavioral-test-agent-tmux-text-screenshot-verification-suite.md) | TUI overnight behavioral test agent: tmux text-screenshot verification suite | status: verifying |
| [DH-0061](../DH-0061-web-overnight-behavioral-test-agent-playwright-screenshot-verification-suite.md) | Web overnight behavioral test agent: Playwright screenshot verification suite | status: verifying |
| [DH-0071](../DH-0071-monitor-tool-is-a-status-snapshot-poll-not-a-live-event-stream-like-claude-code-s-monitor.md) | Monitor tool is a status-snapshot poll, not a live event stream like Claude Code's Monitor | architect design pass in progress |

## Board

### draft

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0031](../DH-0031-supply-chain-hardening-gaps.md) | GitHub Actions supply-chain hardening gaps — actions pinned by tag, no artifact signing, no npm provenance 🔒 | feature | stefan |
| [DH-0047](../DH-0047-no-checkpointing-or-rewind-of-file-edits.md) | No checkpointing/rewind of file edits — an off-the-rails unattended run has no automatic rollback 🔒 | feature | stefan |
| [DH-0048](../DH-0048-no-telemetry-metrics-endpoint.md) | No telemetry/metrics endpoint for fleet-level observability 🔒 | feature | stefan |
| [DH-0049](../DH-0049-no-rate-limit-aware-request-scheduling.md) | No rate-limit-aware request scheduling across concurrently-spawned sub-agents 🔒 | feature | stefan |
| [DH-0051](../DH-0051-no-git-native-artifacts-or-log-replay-tooling.md) | No git-native session artifacts, and no evaluation/replay tooling built on the JSONL logs 🔒 | feature | stefan |
| [DH-0052](../DH-0052-windows-console-support-unverified.md) | Windows console/TUI support is unverified — no Windows-specific console-mode handling found, and no Windows execution anywhere in CI 🔒 | bug | stefan |
| [DH-0053](../DH-0053-no-model-provider-fallback-chains.md) | No model/provider fallback chains — a down or rate-limited primary model has no automatic substitute 🔒 | feature | stefan |
| [DH-0057](../DH-0057-mcp-oauth-support-via-mcpauth-tool.md) | MCP OAuth support via McpAuth tool | feature | stefan |
| [DH-0065](../DH-0065-tui-visual-polish-inline-style-bleed-word-wrap-transcript-identity-liveness.md) | TUI visual polish: inline style bleed, word wrap, transcript identity, liveness | feature | stefan |
| [DH-0066](../DH-0066-web-ui-visual-polish-markdown-surface-styling-sidebar-hierarchy-transcript-details.md) | Web UI visual polish: Markdown surface styling, sidebar hierarchy, transcript details | feature | stefan |
| [DH-0067](../DH-0067-server-mode-operator-ux-startup-summary-runtime-activity-feed-cli-output-polish.md) | Server-mode operator UX: startup summary, runtime activity feed, CLI output polish | feature | stefan |
| [DH-0068](../DH-0068-readme-hero-compelling-promo-screenshot-and-visual-identity-for-the-landing-page.md) | README hero: compelling promo screenshot and visual identity for the landing page | feature | stefan |
| [DH-0073](../DH-0073-read-tool-has-no-jupyter-notebook-or-pdf-awareness-and-there-is-no-notebookedit-equivalent.md) | Read tool has no Jupyter-notebook or PDF awareness, and there is no NotebookEdit equivalent | feature | stefan |
| [DH-0074](../DH-0074-no-webfetch-websearch-equivalent-tool-for-an-autonomous-coding-agent-to-look-up-docs-or-errors-online.md) | No WebFetch/WebSearch-equivalent tool for an autonomous coding agent to look up docs or errors online | feature | stefan |
| [DH-0075](../DH-0075-no-askuserquestion-equivalent-tool-for-human-in-the-loop-clarification-in-interactive-tui-web-sessions.md) | No AskUserQuestion-equivalent tool for human-in-the-loop clarification in interactive TUI/Web sessions | feature | stefan |
| [DH-0076](../DH-0076-no-taskcreate-tasklist-taskget-taskupdate-equivalent-structured-todo-plan-tracking-for-the-main-agent.md) | No TaskCreate/TaskList/TaskGet/TaskUpdate-equivalent structured todo/plan tracking for the main agent | feature | stefan |
| [DH-0077](../DH-0077-no-enterworktree-exitworktree-equivalent-for-isolating-a-spawned-sub-agent-s-working-directory.md) | No EnterWorktree/ExitWorktree-equivalent for isolating a spawned sub-agent's working directory | feature | stefan |
| [DH-0078](../DH-0078-sendmessage-monitor-can-only-address-a-task-by-task-id-not-by-the-human-readable-name-claude-code-allows.md) | SendMessage/Monitor can only address a task by task_id, not by the human-readable name Claude Code allows | feature | stefan |
| [DH-0079](../DH-0079-read-tool-s-truncation-model-diverges-from-real-claude-code-line-cap-notice-vs-byte-cap-hard-error.md) | Read tool's truncation model diverges from real Claude Code: line-cap+notice vs byte-cap+hard-error | bug | stefan |
| [DH-0080](../DH-0080-bash-output-capping-shape-diverges-from-real-claude-code-tail-cut-inline-notice-vs-head-preview-plus-saved-file.md) | Bash output-capping shape diverges from real Claude Code: tail-cut inline notice vs head-preview-plus-saved-file | bug | stefan |

### refining

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0071](../DH-0071-monitor-tool-is-a-status-snapshot-poll-not-a-live-event-stream-like-claude-code-s-monitor.md) | Monitor tool is a status-snapshot poll, not a live event stream like Claude Code's Monitor 🔒 | bug | stefan |

### ready

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0001](../DH-0001-task-failed-marker-reliability.md) | `TASK_FAILED` marker is not reliably emitted despite being taught | bug | stefan |
| [DH-0003](../DH-0003-sendmessage-resume-finished-conversation.md) | `SendMessage` should resume a finished agent's conversation, not just error cleanly | feature | stefan |
| [DH-0004](../DH-0004-npm-packaging-single-platform.md) | npm package only ships a single-platform binary | feature | stefan |
| [DH-0005](../DH-0005-npm-token-secret.md) | `NPM_TOKEN` repository secret not yet set | feature | stefan |
| [DH-0010](../DH-0010-no-context-window-compaction-or-cache-control.md) | No context-window compaction/token-budget handling, and no prompt caching (`cache_control`) | feature | stefan |
| [DH-0012](../DH-0012-unbounded-memory-growth-across-harness.md) | Unbounded in-memory growth across the harness for long/wide-fanout runs | bug | stefan |
| [DH-0020](../DH-0020-jsonl-logger-robustness-and-secrets-redaction.md) | JSONL logger has no write-error handling, no fsync, and no awareness of secrets in tool call I/O | bug | stefan |
| [DH-0022](../DH-0022-default-server-bind-address-not-loopback.md) | Add a `dh.json` field to configure the server/web bind address (default unchanged) | feature | stefan |
| [DH-0023](../DH-0023-web-ui-token-leak-cors-csp-clickjacking.md) | Web UI CORS/Host-header/CSP/clickjacking hardening | bug | stefan |
| [DH-0025](../DH-0025-tui-terminal-safety-and-rendering-correctness.md) | TUI wide-character/resize/redraw rendering bugs | bug | stefan |
| [DH-0028](../DH-0028-tui-missing-token-cost-display-and-usage-accounting-mismatch.md) | TUI never displays token/cost data it already tracks, and TUI vs. Web disagree on whether `token_usage` is a delta or a running total | bug | stefan |
| [DH-0040](../DH-0040-bash-env-secrets-exposure-and-provider-error-redaction.md) | Bash tool's full-environment inheritance and unredacted provider error messages are undocumented secrets-exposure vectors | bug | stefan |
| [DH-0044](../DH-0044-no-streaming-partial-output.md) | No streaming of partial model output — `agent_output` events only fire once per completed turn | feature | stefan |
| [DH-0045](../DH-0045-no-extended-thinking-support.md) | No extended-thinking (interleaved/extended thinking blocks) support | feature | stefan |
| [DH-0046](../DH-0046-no-multimodal-image-input-or-screenshot-tool.md) | No image/multimodal input, and no screenshot tool — blocks visual web-testing/verification workflows | feature | stefan |
| [DH-0050](../DH-0050-no-structured-final-output-or-headless-json-progress.md) | No structured final-result convention beyond the `TASK_FAILED` text marker, and no machine-readable progress stream for `--job` | feature | stefan |
| [DH-0055](../DH-0055-dh-doesn-t-read-a-project-s-claude-md-into-the-system-prompt.md) | dh doesn't read a project's CLAUDE.md into the system prompt | feature | stefan |
| [DH-0056](../DH-0056-render-agent-output-as-markdown-not-raw-escape-passthrough-tui-web.md) | Render agent output as Markdown, not raw escape passthrough (TUI+Web) | feature | stefan |
| [DH-0058](../DH-0058-tui-e2e-tests-hang-on-sse-reconnect-banner-never-reach-session-ended.md) | TUI e2e tests hang on SSE-reconnect banner, never reach session-ended | bug | stefan |
| [DH-0070](../DH-0070-bash-tool-s-fresh-shell-per-call-semantics-diverge-from-claude-code-s-persistent-cwd-behavior.md) | Agents don't have their own separate working-directory state | bug | stefan |
| [DH-0072](../DH-0072-grep-tool-likely-missing-context-line-flags-multiline-mode-and-file-type-filter-that-real-claude-code-s-grep-supports.md) | Grep tool likely missing context-line flags, multiline mode, and file-type filter that real Claude Code's Grep supports | feature | stefan |

### implementing

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0002](../DH-0002-full-mcp-client-support.md) | Full MCP client support (transport discovery) | feature | stefan |
| [DH-0035](../DH-0035-first-run-friction-no-init-doctor-dry-run.md) | No `dh init`/`dh doctor`/`--dry-run`, and cold error messages give a first-time operator no path forward | feature | stefan |
| [DH-0037](../DH-0037-no-log-rotation-or-run-summary-or-log-analysis-tool.md) | No log rotation/disk-growth caps, no structured final run-summary artifact, and no log-analysis tooling | feature | stefan |
| [DH-0038](../DH-0038-no-crash-recovery-or-session-resume.md) | No crash-recovery/session-resume across a process restart, and a completed standalone job silently starts a fresh, disconnected interactive session | feature | stefan |

### verifying

| ID | Title | Type | Owner |
| --- | --- | --- | --- |
| [DH-0060](../DH-0060-tui-overnight-behavioral-test-agent-tmux-text-screenshot-verification-suite.md) | TUI overnight behavioral test agent: tmux text-screenshot verification suite | feature | stefan |
| [DH-0061](../DH-0061-web-overnight-behavioral-test-agent-playwright-screenshot-verification-suite.md) | Web overnight behavioral test agent: Playwright screenshot verification suite | feature | stefan |

## Recently Closed

| ID | Title | Resolution |
| --- | --- | --- |
| [DH-0069](../DH-0069-agent-tool-s-description-should-be-required-and-the-tree-ui-should-actually-use-it.md) | Agent tool's description should be required, and the tree UI should actually use it | done |
| [DH-0064](../DH-0064-e2e-web-test-ts-and-connect-web-test-ts-assert-a-stale-agent-output-selector.md) | e2e/web.test.ts and connect-web.test.ts assert a stale .agent-output selector | done |
| [DH-0063](../DH-0063-spile-ops-skill-id-based-ticket-resolution-rename-on-retitle-tool.md) | spile-ops skill: ID-based ticket resolution + rename-on-retitle tool | done |
| [DH-0062](../DH-0062-e2e-web-test-ts-session-ended-assertions-stale-vs-interactive-waiting-semantics.md) | e2e/web.test.ts session-ended assertions stale vs interactive waiting semantics | done |
| [DH-0059](../DH-0059-interactive-root-agent-never-reaches-session-ended-without-an-explicit-stop.md) | Interactive root agent never reaches session_ended without an explicit stop | done |
| [DH-0054](../DH-0054-no-first-class-grep-glob-tools.md) | No first-class Grep/Glob tools — all search is delegated informally to Bash | done |
| [DH-0043](../DH-0043-no-prompt-caching.md) | No prompt caching — one of the largest cost levers for an agentic loop is unused | superseded |
| [DH-0042](../DH-0042-readme-config-reference-gaps.md) | README's config reference omits `options.maxTurns` and per-model pricing fields, with no automated check against `src/contracts/config.ts` | done |
| [DH-0041](../DH-0041-missing-user-facing-docs-bundle.md) | A cluster of user-facing documentation is entirely missing | done |
| [DH-0039](../DH-0039-git-credentials-and-workspace-convention-undocumented.md) | Git credential provisioning and workspace-directory convention are entirely undocumented | done |
| [DH-0036](../DH-0036-no-container-deployment-reference.md) | No reference Dockerfile or container/deployment documentation for the canonical dark-factory use case | done |
| [DH-0034](../DH-0034-e2e-flakiness-risks-and-missing-connect-web-coverage.md) | E2E has a port-allocation race, an ordering-dependent cleanup convention, and no coverage of `dh --connect --web` | done |
| [DH-0033](../DH-0033-mock-provider-cannot-simulate-errors-or-streaming.md) | The e2e mock provider can't simulate provider errors or streaming, so the harness's failure-handling path is completely untested end-to-end | done |
| [DH-0032](../DH-0032-release-binaries-untested-on-real-target-os.md) | Windows and macOS release binaries are cross-compiled but never actually executed anywhere, and the e2e-tested binary isn't the same artifact as what ships | done |
| [DH-0030](../DH-0030-ci-coverage-gate-text-parsing-fragility.md) | CI's coverage/completeness/e2e gates rely on fragile text-parsing and a fail-open conditional, not structured checks | done |
