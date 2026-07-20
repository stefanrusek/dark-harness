// DH-0174 (Core, extracted from cli.ts): `dh doctor` / `--check` subcommand.
import type { ProviderToolDefinition } from "../agent/providers/types.ts";
import type { DhConfig, ExitCode as ExitCodeType } from "../contracts/index.ts";
import { ExitCode } from "../contracts/index.ts";
import { wrapSgr } from "../design-tokens.ts";
import { SPINNER_FRAME_MS, SPINNER_FRAMES } from "../terminal.constant.ts";
import { printAppHeader } from "./activity-feed.ts";
import type { CliDeps } from "./deps.ts";
import { CLI_DIM, CLI_GREEN, CLI_RED } from "./styling.ts";

/**
 * `dh doctor` / `--check` (DH-0035): for each configured model, makes one cheap no-op provider
 * call (a 1-token completion, no tools) and reports pass/fail — never enters the real agent
 * loop, so a broken credential/model-access problem surfaces before an operator commits to a
 * real (possibly costly, possibly unattended) run.
 *
 * DH-0106: on top of that connectivity check, a model that connects also gets a second, cheap
 * probe request that offers it one trivial no-op tool and instructs it to call it — this is a
 * distinct capability from "the API call succeeds" (DH-0106's root cause: a Bedrock model that
 * connects fine but responds with prose/fake fenced pseudo-tool-call text instead of a real
 * `tool_use` content block). `toolUse` is `undefined` when the connectivity check itself
 * failed (no point probing a model we can't even reach) or when the model reference doesn't
 * resolve to a provider at all; `false` means it connected but never emitted a real tool-use
 * block; `true` means it did.
 */
interface DoctorResult {
  modelName: string;
  ok: boolean;
  detail: string;
  toolUse?: boolean;
}

/** DH-0106: the trivial no-op tool offered to every model during the doctor tool-use capability
 * probe — deliberately as simple as a tool definition gets (no inputs) so a "can't call tools"
 * result reflects the model's own capability/willingness, not a schema it couldn't parse. */
const DOCTOR_TOOL_PROBE_DEFINITION: ProviderToolDefinition = Object.freeze<ProviderToolDefinition>({
  name: "noop",
  description: "A no-op probe tool. Call it with no arguments to confirm you can call tools.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
});

// DH-0101: aliases onto the shared CLI styling constants (was its own copy) — dim still
// distinguishes "still checking" from a resolved verdict, per style-guide §1.1.
const DOCTOR_PASS_COLOR = Object.freeze(CLI_GREEN);
const DOCTOR_FAIL_COLOR = Object.freeze(CLI_RED);
const DOCTOR_PENDING_COLOR = Object.freeze(CLI_DIM);

// DH-0102: verdict word is always 4 chars ("PASS"/"FAIL"); the colorized (TTY) verdict field
// additionally carries a one-glyph + one-space prefix ("✓ "/"✗ "). The pending row's spinner
// frame is padded out to this same plain-text width so the name column starts at the same
// screen position whether a row is still pending or already resolved — cosmetic (the
// `\r\x1b[K` rewrite clears the whole line regardless), but it keeps a multi-model run's rows
// from visibly shifting left/right as each one resolves.
const DOCTOR_VERDICT_WORD_WIDTH = 4;
const DOCTOR_VERDICT_LABEL_WIDTH = Object.freeze(2 + DOCTOR_VERDICT_WORD_WIDTH);

/** Formats one resolved (pass/fail) row — shared by `formatDoctorReport` (the non-TTY /
 * final-summary path) and `runDoctor`'s TTY live-update path, so both agree on alignment and
 * colorization instead of drifting into two subtly different renderings of the same result.
 * DH-0102: on the colorized (TTY) path, prepends the canonical `✓`/`✗` verdict glyph (style
 * guide §5) before the PASS/FAIL word; the plain (non-TTY) path is untouched — just the bare
 * word, per the ticket's non-TTY contract. */
function formatDoctorRow(r: DoctorResult, nameWidth: number, color: boolean): string {
  // DH-0106: a model that connects (r.ok) but never emitted a real tool-use block in the
  // capability probe gets a distinct verdict word — "PASS (no tool-use)" — rather than a
  // plain PASS indistinguishable from a model that's actually reliable for agentic tool use.
  // Still green/✓ on the TTY path: it *did* pass connectivity, which is what that glyph means;
  // the qualifier text itself is what carries the "but not agentic-capable" distinction.
  const verdict = r.ok ? (r.toolUse === false ? "PASS (no tool-use)" : "PASS") : "FAIL";
  const coloredVerdict = color
    ? wrapSgr(r.ok ? DOCTOR_PASS_COLOR : DOCTOR_FAIL_COLOR, `${r.ok ? "✓" : "✗"} ${verdict}`)
    : verdict;
  // A detail starting with ":" (the "no provider named..." case) reads as
  // "<name>: <message>", not "<name> : <message>" — every other detail ("(provider ...)")
  // gets a space before it as usual.
  const separator = r.detail.startsWith(":") ? "" : " ";
  return `${coloredVerdict} ${r.modelName.padEnd(nameWidth)}${separator}${r.detail}`;
}

/** DH-0099/DH-0102: the in-flight row shown the moment a model's check starts, before its
 * `provider.complete()` call resolves — same column alignment as the resolved row so the
 * later `\r` + clear-to-end-of-line rewrite lands in exactly the same place. Never used
 * outside a TTY (there's no "in flight" concept for a piped/CI run that only prints once at
 * the end). DH-0102: the marker is now the canonical braille spinner frame (shared with the
 * TUI via `../terminal.constant.ts`, not a bespoke `....`) and the wording is present-progressive
 * ("checking…") per the style guide's pending-state vocabulary (§1.1). `frame` is supplied by
 * the caller so `runDoctor` can advance it on a timer while a single check is outstanding. */
function formatDoctorPendingRow(
  modelName: string,
  nameWidth: number,
  color: boolean,
  frame: string,
): string {
  const label = frame.padEnd(DOCTOR_VERDICT_LABEL_WIDTH);
  const coloredVerdict = color ? wrapSgr(DOCTOR_PENDING_COLOR, label) : label;
  return `${coloredVerdict} ${modelName.padEnd(nameWidth)} checking… (query sent)`;
}

/** DH-0067: unaligned `PASS <name> (provider "...")` lines with no summary read as a raw
 * dump, not a report an operator could paste into an incident/status update. Pads every
 * model name to the widest one in this run (so the `PASS`/`FAIL` word and the following
 * detail line up in a column) and colorizes the verdict word on a TTY — same gate as `dh
 * logs`' status colorization, same reasoning (a piped/redirected run stays plain text). */
export function formatDoctorReport(results: DoctorResult[], color: boolean): string[] {
  const nameWidth = Math.max(0, ...results.map((r) => r.modelName.length));
  const lines = results.map((r) => formatDoctorRow(r, nameWidth, color));
  const passCount = results.filter((r) => r.ok).length;
  const failCount = results.length - passCount;
  const summaryText = `${results.length} model${results.length === 1 ? "" : "s"}: ${passCount} pass, ${failCount} fail`;
  // DH-0102: colorize the summary line on the TTY path too (green all-pass / red any-fail)
  // so the overall result reads at a glance; the plain (non-TTY) path stays bare text.
  lines.push(
    color
      ? wrapSgr(failCount === 0 ? DOCTOR_PASS_COLOR : DOCTOR_FAIL_COLOR, summaryText)
      : summaryText,
  );
  return lines;
}

/** DH-0099: on a real terminal, each model's row appears the instant its check starts (a
 * dim "...." pending row) and is then rewritten in place — `\r` back to column 0, `\x1b[K` to
 * clear whatever pending text was there, then the resolved PASS/FAIL row — once
 * `provider.complete()` settles, so an operator watching a multi-model config never stares at
 * a blank terminal wondering whether anything is happening. Piped/non-TTY output (CI, logs)
 * is untouched: no row is printed until every model has been checked, and the whole report is
 * printed once via the ordinary `io.stdout` path exactly as before this ticket. */
export async function runDoctor(
  config: DhConfig,
  configPath: string,
  deps: CliDeps,
): Promise<ExitCodeType> {
  const { io } = deps;
  printAppHeader(config, configPath, io);
  const providersByName = new Map(config.provider.map((p) => [p.name, p]));
  const results: DoctorResult[] = [];
  const isTTY = process.stdout.isTTY === true;
  const nameWidth = Math.max(0, ...config.models.map((m) => m.name.length));

  for (const model of config.models) {
    // DH-0102: animate the pending row's spinner frame every SPINNER_FRAME_MS while this
    // model's single `provider.complete()` call is outstanding. TTY-gated (no timer, no
    // animation off a TTY) and always torn down in `finally` — on both the normal resolve
    // path and any unexpected throw — so a slow/hanging check can never leave a stray timer
    // running past this iteration, and the last tick can never race the final resolved-row
    // rewrite below (the interval is cleared before that write happens).
    let frameIndex = 0;
    let spinnerTimer: ReturnType<typeof setInterval> | undefined;
    if (isTTY) {
      process.stdout.write(
        formatDoctorPendingRow(model.name, nameWidth, true, SPINNER_FRAMES[0] as string),
      );
      spinnerTimer = setInterval(() => {
        frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
        process.stdout.write(
          `\r\x1b[K${formatDoctorPendingRow(model.name, nameWidth, true, SPINNER_FRAMES[frameIndex] as string)}`,
        );
      }, SPINNER_FRAME_MS);
    }

    let result: DoctorResult;
    try {
      const providerConfig = providersByName.get(model.provider);
      if (!providerConfig) {
        // Shouldn't happen post-validateConfig (models reference known providers), but a
        // provider-agnostic guard costs nothing and keeps this loop crash-free either way.
        result = {
          modelName: model.name,
          ok: false,
          detail: `: no provider named "${model.provider}" in config`,
        };
      } else {
        try {
          const provider = deps.createProvider(providerConfig);
          await provider.complete({
            model: model.model,
            system: "dh doctor: connectivity check.",
            messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
            tools: [],
            maxTokens: 1,
          });
          // DH-0106: connectivity alone doesn't confirm agentic tool use — probe separately
          // with one trivial no-op tool and an instruction to call it. A probe-call throw
          // (rare — connectivity just succeeded above) is treated the same as "no tool-use
          // block observed" rather than flipping the whole model to FAIL: the model
          // demonstrably answers requests, it just didn't produce a real tool call here.
          let toolUse = false;
          try {
            const toolProbe = await provider.complete({
              model: model.model,
              system:
                'dh doctor: tool-use capability probe. You must call the "noop" tool now; do not respond with text describing a call instead of making one.',
              messages: [
                { role: "user", content: [{ type: "text", text: "Call the noop tool now." }] },
              ],
              tools: [DOCTOR_TOOL_PROBE_DEFINITION],
              maxTokens: 64,
            });
            toolUse = toolProbe.content.some((block) => block.type === "tool_use");
          } catch {
            toolUse = false;
          }
          result = {
            modelName: model.name,
            ok: true,
            toolUse,
            detail: `(provider "${providerConfig.name}")`,
          };
        } catch (err) {
          result = {
            modelName: model.name,
            ok: false,
            detail: `(provider "${providerConfig.name}"): ${(err as Error).message}`,
          };
        }
      }
    } finally {
      if (spinnerTimer) {
        clearInterval(spinnerTimer);
      }
    }
    results.push(result);

    if (isTTY) {
      process.stdout.write(`\r\x1b[K${formatDoctorRow(result, nameWidth, true)}\n`);
    }
  }

  if (isTTY) {
    // Every row already streamed live above — only the trailing summary line is left.
    const summaryLine = formatDoctorReport(results, true).at(-1) as string;
    process.stdout.write(`${summaryLine}\n`);
  } else {
    for (const line of formatDoctorReport(results, false)) {
      io.stdout(line);
    }
  }

  const code = results.every((r) => r.ok) ? ExitCode.Success : ExitCode.HarnessError;
  io.exit(code);
  return code;
}
