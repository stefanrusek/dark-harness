// Loads and validates dh.json (ADR 0007). Default path is "dh.json" in the working
// directory; --config <path> (wired by src/cli.ts) overrides it.

import type { DhConfig } from "../contracts/index.ts";
import { ConfigError } from "./errors.ts";
import { interpolateDeep } from "./interpolate.ts";
import { validateConfig } from "./validate.ts";

export const DEFAULT_CONFIG_PATH = "dh.json";

export interface LoadConfigOptions {
  /** Defaults to process.env; injectable for tests. */
  env?: Record<string, string | undefined>;
}

export async function loadConfig(
  path: string = DEFAULT_CONFIG_PATH,
  options: LoadConfigOptions = {},
): Promise<DhConfig> {
  const env = options.env ?? process.env;

  const file = Bun.file(path);
  if (!(await file.exists())) {
    // DH-0035 fix: the original message ("config file not found: dh.json") gave a first-time
    // operator no path forward — no pointer to `--config`, no mention of `dh init`, no README
    // link. This applies regardless of whether the operator ever discovers `dh init` exists.
    throw new ConfigError(
      `config file not found: ${path}\n  Run "dh init" to scaffold a starter dh.json in the current directory, or pass --config <path> to point at an existing config file. See README.md for the full schema.`,
    );
  }

  let raw: unknown;
  try {
    const text = await file.text();
    raw = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`failed to read config file ${path}: ${(err as Error).message}`);
  }

  let interpolated: unknown;
  try {
    interpolated = interpolateDeep(raw, env);
  } catch (err) {
    throw new ConfigError(`config file ${path}: ${(err as Error).message}`);
  }

  try {
    return validateConfig(interpolated);
  } catch (err) {
    throw new ConfigError(`config file ${path}: ${(err as Error).message}`);
  }
}
