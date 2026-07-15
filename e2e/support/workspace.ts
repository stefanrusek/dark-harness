// Per-test scratch directory + dh.json fixture writer. Every e2e scenario gets its own
// isolated cwd so parallel test files never share `.dh-logs/`, a `dh.json`, or a downloaded
// log bundle.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DhConfig } from "../../src/contracts/index.ts";

export interface TestWorkspace {
  dir: string;
  /** Writes `dh.json` (or a caller-chosen filename) into the workspace as pretty JSON. */
  writeConfig(config: DhConfig, filename?: string): string;
  /** Writes an arbitrary file (e.g. an `--instructions` file) into the workspace. */
  writeFile(relativePath: string, contents: string): string;
  cleanup(): void;
}

export function createWorkspace(prefix = "dh-e2e-"): TestWorkspace {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return {
    dir,
    writeConfig(config, filename = "dh.json") {
      const path = join(dir, filename);
      Bun.write(path, `${JSON.stringify(config, null, 2)}\n`);
      return path;
    },
    writeFile(relativePath, contents) {
      const path = join(dir, relativePath);
      Bun.write(path, contents);
      return path;
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A minimal valid `dh.json` pointed at a mock provider's baseURL. Callers spread-override. */
export function baseConfig(providerBaseUrl: string, overrides: Partial<DhConfig> = {}): DhConfig {
  return {
    options: { defaultModel: "mock" },
    provider: [
      { name: "mock-provider", type: "anthropic", baseURL: providerBaseUrl, apiKey: "test-key" },
    ],
    models: [{ name: "mock", provider: "mock-provider", model: "mock-model" }],
    ...overrides,
  };
}
