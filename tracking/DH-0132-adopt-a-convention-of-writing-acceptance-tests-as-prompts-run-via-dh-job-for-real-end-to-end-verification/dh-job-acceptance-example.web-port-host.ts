// DH-0132 prototype: one real acceptance criterion, written as a literal prompt run via
// `dh --job --json` against a real compiled `dh` binary, instead of only a unit/e2e test in
// the traditional sense.
//
// Criterion under test (chosen from two recently-closed tickets naturally suited to
// end-to-end prompt verification — both are "does the real OS actually bind where we told
// it to", which no mocked unit test can observe):
//   - DH-0168 (`--web-port <N>`): the web UI's static server listens on the requested port,
//     not a random ephemeral one.
//   - DH-0182 (`--host <name>`): the same server binds to the requested host, not whatever
//     `security.hostname`/Bun's default would otherwise pick.
// Composed criterion: `dh --web --web-port <N> --host 127.0.0.1` must be reachable at
// exactly `http://127.0.0.1:<N>/`.
//
// How this differs from a normal e2e test (e2e/web.test.ts, e2e/exit-codes.test.ts etc, both
// of which this script's plumbing is deliberately modeled on): instead of a `bun:test` file
// asserting against the *outer* process's own stdout/exit code, the verification itself is
// the PROMPT — a real `dh --job` agent run, with the mock provider scripting the model to
// spawn a *second*, child `dh --web --web-port --host` process via its own Bash tool, curl
// it for real, and self-report success/failure via `ReportOutcome` based on what actually
// happened. The outer job's exit code (0/1) and `--json` `job_result` line are therefore
// genuine proof the child process really bound where asked — not a scripted/hardcoded
// outcome. The mock provider below is intentionally NOT the shared, purely-positional
// `e2e/support/mock-provider.ts` (whose turns are consumed in a fixed order regardless of
// what a tool call actually returned) — it inspects the real conversation history sent back
// on the second `/v1/messages` call (specifically the prior turn's `tool_result` content /
// `is_error` flag) and only returns a `ReportOutcome(success)` turn if the Bash tool's own
// verification script reported success. A real LLM would reason about the tool result the
// same way; this reproduces that reasoning deterministically so the example is safe to run
// in CI without real model calls or API cost.
//
// Usage:
//   bun run tracking/DH-0132-.../dh-job-acceptance-example.web-port-host.ts
// Exit code mirrors the outer `dh --job` run: 0 if the criterion verified true end-to-end,
// 1 if the child process's real HTTP binding check failed (the criterion is false), 2+ for
// any harness-level problem (build failure, mock provider error, etc).
//
// Pattern for future tickets to copy: pick one acceptance criterion that's genuinely
// end-to-end (spawns a process, hits real network, reads real files — not just "the mock
// returned what I told it to"), write the Bash command that performs the real check with an
// unambiguous VERIFIED/FAILED marker + matching exit code, and script a two-turn mock
// provider: turn 1 always requests the Bash tool call, turn 2 branches on the real tool
// result to decide which `ReportOutcome` to emit. Everything else (spawning the real
// compiled binary, writing `dh.json` against the mock's `baseURL`, reading `--json`'s
// NDJSON `job_result` line, checking `proc.exitCode`) is the same shape as any e2e test in
// this repo.

import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureBuilt } from "../../e2e/support/build.ts";

const CHILD_WEB_PORT = 47_591;
const CHILD_HOST = "127.0.0.1";

/** Builds one Anthropic-shaped SSE response for a single assistant turn that makes exactly
 * one tool call. Mirrors `e2e/support/mock-provider.ts`'s `turnToStreamResponse` (kept
 * separate/simplified here since this script needs conditional branching that shared helper
 * doesn't support — see file header). */
function toolUseSseResponse(toolName: string, input: unknown, text: string): Response {
  const toolUseId = `toolu_${randomUUID()}`;
  const events: { type: string; [key: string]: unknown }[] = [
    {
      type: "message_start",
      message: {
        id: `msg_${randomUUID()}`,
        type: "message",
        role: "assistant",
        model: "mock-model",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "", citations: null },
    },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    {
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: toolUseId, name: toolName, input: {} },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(input) },
    },
    { type: "content_block_stop", index: 1 },
    {
      type: "message_delta",
      delta: { stop_reason: "tool_use", sequence: null },
      usage: { output_tokens: 10 },
    },
    { type: "message_stop" },
  ];
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

/** The real end-to-end check: spawn a *child* `dh --web --web-port --host` and confirm it is
 * reachable at exactly the requested host:port. `$DH_BINARY` is set on the outer job's own
 * env (below) so the Bash tool — which runs in that same process's environment — can find
 * the same compiled binary without needing its own build step. Uses an explicit
 * VERIFIED/FAILED marker + matching exit code so the mock provider's second turn (and, in a
 * real-model version of this pattern, the model itself) can act on the real outcome. */
const VERIFICATION_SCRIPT = `
set -e
LOG="$PWD/child-web.log"
"$DH_BINARY" --web --web-port ${CHILD_WEB_PORT} --host ${CHILD_HOST} > "$LOG" 2>&1 &
CHILD_PID=$!
trap 'kill "$CHILD_PID" 2>/dev/null || true' EXIT

ready=0
for _ in $(seq 1 50); do
  if grep -q "web UI ready" "$LOG" 2>/dev/null; then ready=1; break; fi
  sleep 0.2
done
if [ "$ready" -ne 1 ]; then
  echo "FAILED: child dh --web --web-port ${CHILD_WEB_PORT} --host ${CHILD_HOST} never became ready"
  cat "$LOG"
  exit 1
fi

if curl -sf -o /dev/null "http://${CHILD_HOST}:${CHILD_WEB_PORT}/"; then
  echo "VERIFIED: dh --web --web-port ${CHILD_WEB_PORT} --host ${CHILD_HOST} is reachable at http://${CHILD_HOST}:${CHILD_WEB_PORT}/"
else
  echo "FAILED: http://${CHILD_HOST}:${CHILD_WEB_PORT}/ was not reachable"
  exit 1
fi
`.trim();

interface MockRequestBody {
  messages: {
    role: string;
    content: string | { type: string; is_error?: boolean; content?: unknown }[];
  }[];
}

function startConditionalMockProvider(): { baseURL: string; stop(): void } {
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname !== "/v1/messages" || req.method !== "POST") {
        return new Response("not found", { status: 404 });
      }
      const body = (await req.json()) as MockRequestBody;
      const lastMessage = body.messages[body.messages.length - 1];
      const toolResultBlock = Array.isArray(lastMessage?.content)
        ? lastMessage.content.find((b) => b.type === "tool_result")
        : undefined;

      if (!toolResultBlock) {
        // First call: no tool result in the conversation yet -> ask the model's stand-in to
        // run the real verification.
        return toolUseSseResponse(
          "Bash",
          // run_in_background: false (Bash tool default is true — HANDOFF.md §4) — the whole
          // point of this example is that the mock's *next* turn genuinely depends on this
          // command's real exit code, which requires waiting for it synchronously rather than
          // getting an immediate "started in background" success back.
          { command: VERIFICATION_SCRIPT, run_in_background: false, timeout: 20_000 },
          "Verifying DH-0168/DH-0182: spawning a child `dh --web --web-port --host` and " +
            "confirming it binds where requested.",
        );
      }

      // Second call: branch on the REAL result of the Bash tool call above.
      const verified = toolResultBlock.is_error !== true;
      return toolUseSseResponse(
        "ReportOutcome",
        {
          status: verified ? "success" : "failure",
          summary: verified
            ? "Confirmed dh --web --web-port/--host bind exactly where requested (DH-0168, DH-0182)."
            : "dh --web --web-port/--host did NOT bind where requested — see child-web.log.",
        },
        verified ? "Verification passed." : "Verification failed.",
      );
    },
  });
  return { baseURL: `http://localhost:${server.port}`, stop: () => server.stop(true) };
}

async function main(): Promise<number> {
  const binaryPath = await ensureBuilt();
  const provider = startConditionalMockProvider();
  const workDir = mkdtempSync(join(tmpdir(), "dh-dh0132-example-"));
  try {
    writeFileSync(
      join(workDir, "dh.json"),
      `${JSON.stringify(
        {
          options: { defaultModel: "mock" },
          provider: [
            {
              name: "mock-provider",
              type: "anthropic",
              baseURL: provider.baseURL,
              apiKey: "test-key",
            },
          ],
          models: [{ name: "mock", provider: "mock-provider", model: "mock-model" }],
        },
        null,
        2,
      )}\n`,
    );
    const instructionsPath = join(workDir, "instructions.txt");
    writeFileSync(
      instructionsPath,
      "Verify that `dh --web --web-port <N> --host <H>` (DH-0168, DH-0182) actually binds " +
        "the web UI's static server to the requested host and port. Use Bash to spawn a " +
        "child dh --web process with a pinned port/host, curl it, and report the outcome.",
    );

    const proc = Bun.spawn({
      cmd: [binaryPath, "--instructions", instructionsPath, "--job", "--json"],
      cwd: workDir,
      env: { ...process.env, DH_BINARY: binaryPath },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const jobResultLine = stdout
      .trim()
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((line) => line?.type === "job_result");

    console.log("--- dh --job --json stdout (NDJSON) ---");
    console.log(stdout);
    if (stderr.trim().length > 0) {
      console.log("--- stderr ---");
      console.log(stderr);
    }
    console.log("--- child-web.log (from the verification Bash call, if it ran) ---");
    try {
      console.log(readFileSync(join(workDir, "child-web.log"), "utf8"));
    } catch {
      console.log("(not written — the Bash tool call may not have run)");
    }

    console.log("--- job_result ---");
    console.log(JSON.stringify(jobResultLine, null, 2));
    console.log(`--- outer process exit code: ${exitCode} ---`);

    if (!jobResultLine) {
      console.error("FAIL: no job_result NDJSON line found in --json output");
      return exitCode === 0 ? 2 : exitCode;
    }
    if (jobResultLine.success === true && exitCode === 0) {
      console.log("PASS: DH-0168/DH-0182 verified end-to-end via a real dh --job run.");
    } else {
      console.error(
        "FAIL: the real child dh --web --web-port/--host process did not bind as expected.",
      );
    }
    return exitCode;
  } finally {
    provider.stop();
    rmSync(workDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("harness error:", err);
      process.exit(2);
    });
}
