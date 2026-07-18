// Per-test scratch directory + dh.json fixture writer. Every e2e scenario gets its own
// isolated cwd so parallel test files never share `.dh-logs/`, a `dh.json`, or a downloaded
// log bundle.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
      // Synchronous, fully-flushed-before-return write (DH-0165): the previous fire-and-forget
      // `Bun.write(...)` (its returned promise never awaited) let the caller proceed — and, in
      // these e2e tests, immediately spawn the real `dh` binary against this workspace — before
      // the write was guaranteed to have landed on disk. Invisible on a fast local SSD where
      // the write completes well within the time spent waiting for the binary to build/start,
      // but a real, deterministically-losing race on CI's slower disk, especially for
      // `writeFile`'s nested-directory case below (mkdir + write vs. a single flat write here).
      writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
      return path;
    },
    writeFile(relativePath, contents) {
      const path = join(dir, relativePath);
      // Same synchronous-write rationale as writeConfig above, plus: relativePath may include
      // subdirectories that don't exist yet (e.g. "skills/greet/SKILL.md") — create them first
      // rather than relying on Bun.write's implicit (and, per the race above, unawaited) mkdir.
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents);
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
