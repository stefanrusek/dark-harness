// DH-0174 (Core, extracted from cli.ts): `dh init` subcommand.
import { DEFAULT_CONFIG_PATH } from "../config/index.ts";
import type { ExitCode as ExitCodeType } from "../contracts/index.ts";
import { ExitCode } from "../contracts/index.ts";
import type { CliDeps } from "./deps.ts";
import { fail } from "./deps.ts";
import { cliDim, cliSuccessGlyph } from "./styling.ts";

/** DH-0035/DH-0096: the `dh.json` scaffolded by `dh init` — kept byte-for-byte in sync with
 * README.md's own sample config so the two never drift apart.
 *
 * DH-0096: every model id below was verified live against the real provider APIs (Bedrock
 * `ListFoundationModels`/`ListInferenceProfiles` + a smoke-test `Converse` call; Anthropic-
 * direct ids cross-checked against the Claude API skill's model catalog) rather than typed
 * from memory — see DH-0092, the incident this ticket exists to prevent from recurring at
 * larger scale. The Bedrock model/inference-profile ids are verified correct for the
 * `us-east-1` region specifically (via cross-region `us.*` inference profiles for the Claude
 * tiers) — Bedrock catalogs are region-specific and change over time, so a scaffold that's
 * correct here may 404 in another region; re-verify before relying on this list elsewhere.
 * This is a menu of working entries to trim to what you actually use, not a recommendation
 * to run `dh doctor` against all of them by default (see the `dh init` stdout note below). */
export const SAMPLE_DH_JSON = Object.freeze(`{
  "options": { "defaultModel": "haiku-bedrock", "runInBackgroundDefault": true, "maxTurns": 100 },
  "models": [
    { "name": "fable-anthropic", "provider": "anthropic", "model": "claude-fable-5" },
    { "name": "fable-bedrock", "provider": "bedrock", "model": "us.anthropic.claude-fable-5" },
    { "name": "opus-anthropic", "provider": "anthropic", "model": "claude-opus-4-8" },
    { "name": "opus-bedrock", "provider": "bedrock", "model": "us.anthropic.claude-opus-4-8" },
    {
      "name": "sonnet-anthropic",
      "provider": "anthropic",
      "model": "claude-sonnet-5",
      "inputPricePerMToken": 3,
      "outputPricePerMToken": 15
    },
    { "name": "sonnet-bedrock", "provider": "bedrock", "model": "us.anthropic.claude-sonnet-5" },
    { "name": "haiku-anthropic", "provider": "anthropic", "model": "claude-haiku-4-5" },
    {
      "name": "haiku-bedrock",
      "provider": "bedrock",
      "model": "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    },
    { "name": "gemma4", "provider": "mantle-openai", "model": "google.gemma-4-31b" },
    {
      "name": "haiku-mantle",
      "provider": "mantle-anthropic",
      "model": "anthropic.claude-haiku-4-5"
    },
    { "name": "gpt-oss-20b", "provider": "bedrock", "model": "openai.gpt-oss-20b-1:0" },
    { "name": "gpt-oss-120b", "provider": "bedrock", "model": "openai.gpt-oss-120b-1:0" },
    {
      "name": "llama3-3-70b",
      "provider": "bedrock",
      "model": "us.meta.llama3-3-70b-instruct-v1:0"
    },
    {
      "name": "mistral-large-3",
      "provider": "bedrock",
      "model": "mistral.mistral-large-3-675b-instruct"
    }
  ],
  "provider": [
    { "name": "anthropic", "type": "anthropic", "apiKey": "$(ANTHROPIC_API_KEY)" },
    { "name": "bedrock", "type": "bedrock", "region": "$(AWS_REGION)" },
    {
      "name": "mantle-anthropic",
      "type": "anthropic",
      "baseURL": "https://bedrock-mantle.$(AWS_REGION).api.aws/anthropic",
      "apiKey": "$(BEDROCK_MANTLE_API_KEY)"
    },
    {
      "name": "mantle-openai",
      "type": "openai-compatible",
      "baseURL": "https://bedrock-mantle.$(AWS_REGION).api.aws/openai/v1",
      "apiKey": "$(BEDROCK_MANTLE_API_KEY)"
    },
    { "name": "local", "type": "anthropic", "baseURL": "$(LOCAL_AI_PROVIDER)" }
  ],
  "skillPaths": ["./skills"],
  "mcpServers": {},
  "systemPrompt": null,
  "security": { "token": null, "tls": null }
}
`);

/** `dh init` (DH-0035): scaffolds README.md's sample `dh.json` into the working directory (or
 * wherever `--config <path>` points). Refuses to overwrite an existing config file — fails
 * loudly rather than clobbering an operator's real config. Only `--config` is a meaningful
 * flag here; anything else is a usage error, same as any other unrecognized flag.
 */
export async function runInit(argv: string[], deps: CliDeps): Promise<ExitCodeType> {
  const { io } = deps;
  let targetPath = DEFAULT_CONFIG_PATH;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") {
      i += 1;
      const value = argv[i];
      if (value === undefined) {
        return fail(io, "--config requires a value");
      }
      targetPath = value;
      continue;
    }
    return fail(io, `unknown flag: ${arg}`);
  }

  let exists: boolean;
  try {
    exists = await deps.fileExists(targetPath);
  } catch (err) {
    return fail(io, `failed to check ${targetPath}: ${(err as Error).message}`);
  }
  if (exists) {
    return fail(
      io,
      `refusing to overwrite existing config file: ${targetPath} (remove it first, or pass --config <path> to scaffold somewhere else)`,
    );
  }

  try {
    await deps.writeFile(targetPath, SAMPLE_DH_JSON);
  } catch (err) {
    return fail(io, `failed to write ${targetPath}: ${(err as Error).message}`);
  }

  // DH-0101: success headline (✓, TTY-gated) + indented dim caveats + a set-off next-step
  // callout, per style-guide §5's "result headline, detail, next step" shape — replaces the
  // prior five equal `dh:` lines. Terse next-step wording per the ticket's own recommendation
  // (Open Questions: "keep terse").
  const initTty = process.stdout.isTTY === true;
  io.stdout(`dh: ${cliSuccessGlyph(initTty)}wrote a starter config to ${targetPath}.`);
  io.stdout(
    cliDim(
      `dh:   the models list is a menu covering every Claude tier on both anthropic and bedrock, plus a few Bedrock OpenAI and open-weight models — trim it down to the ones you'll actually use.`,
      initTty,
    ),
  );
  io.stdout(
    cliDim(
      `dh:   Bedrock model/inference-profile ids are verified for the us-east-1 region; re-verify if you're on a different region.`,
      initTty,
    ),
  );
  // DH-0119: real Amazon Bedrock Mantle is a distinct endpoint with two model-vendor-routed
  // API surfaces, both bearer-apiKey authenticated: "mantle-anthropic" (.../anthropic,
  // Anthropic Messages shape) and "mantle-openai" (.../openai/v1, Chat Completions shape —
  // note the "/openai" prefix: some Mantle models, gemma4 included, live on that prefixed
  // path specifically; the unprefixed path rejects them with a misleading "Berm is not
  // enabled for this account" error that has nothing to do with account access). Both
  // "gemma4" and "haiku-mantle" are live-verified working end to end, tool-use included.
  io.stdout(
    cliDim(
      `dh:   Amazon Bedrock Mantle needs BEDROCK_MANTLE_API_KEY. "haiku-mantle" and "gemma4" are both live-verified working end to end (tool-use included) — see tracking/DH-0119.`,
      initTty,
    ),
  );
  io.stdout(`dh: Next: run "dh doctor" to probe credentials, then "dh" to start.`);
  io.exit(ExitCode.Success);
  return ExitCode.Success;
}
