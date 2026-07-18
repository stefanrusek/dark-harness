import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError } from "./errors.ts";
import { loadConfig } from "./load.ts";
import { withProcessMutationLock } from "../test-process-lock.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dh-config-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeConfig(name: string, contents: string): Promise<string> {
  const path = join(dir, name);
  await Bun.write(path, contents);
  return path;
}

describe("loadConfig", () => {
  test("loads and validates a real config file from disk", async () => {
    const path = await writeConfig(
      "dh.json",
      JSON.stringify({
        options: { defaultModel: "sonnet" },
        models: [{ name: "sonnet", provider: "anthropic", model: "sonnet-5" }],
        provider: [{ name: "anthropic", type: "anthropic" }],
      }),
    );
    const config = await loadConfig(path);
    expect(config.options.defaultModel).toBe("sonnet");
  });

  test("resolves $(VAR) against the provided env before validating", async () => {
    const path = await writeConfig(
      "dh.json",
      JSON.stringify({
        options: { defaultModel: "sonnet" },
        models: [{ name: "sonnet", provider: "anthropic", model: "sonnet-5" }],
        provider: [{ name: "anthropic", type: "anthropic", apiKey: "$(MY_API_KEY)" }],
      }),
    );
    const config = await loadConfig(path, { env: { MY_API_KEY: "sk-test-123" } });
    expect(config.provider[0]?.apiKey).toBe("sk-test-123");
  });

  test("defaults to reading process.env when no env override is given", async () => {
    const path = await writeConfig(
      "dh.json",
      JSON.stringify({
        options: { defaultModel: "sonnet" },
        models: [{ name: "sonnet", provider: "anthropic", model: "sonnet-5" }],
        provider: [{ name: "anthropic", type: "anthropic", apiKey: "$(DH_TEST_PROCESS_ENV_VAR)" }],
      }),
    );
    process.env.DH_TEST_PROCESS_ENV_VAR = "from-process-env";
    try {
      const config = await loadConfig(path);
      expect(config.provider[0]?.apiKey).toBe("from-process-env");
    } finally {
      process.env.DH_TEST_PROCESS_ENV_VAR = undefined;
    }
  });

  test("throws ConfigError when the file does not exist", async () => {
    await expect(loadConfig(join(dir, "missing.json"))).rejects.toThrow(ConfigError);
    await expect(loadConfig(join(dir, "missing.json"))).rejects.toThrow(/not found/);
  });

  test("throws ConfigError on invalid JSON", async () => {
    const path = await writeConfig("dh.json", "{ not valid json");
    await expect(loadConfig(path)).rejects.toThrow(ConfigError);
    await expect(loadConfig(path)).rejects.toThrow(/failed to read config file/);
  });

  test("throws ConfigError when interpolation references an unset variable", async () => {
    const path = await writeConfig(
      "dh.json",
      JSON.stringify({
        options: { defaultModel: "sonnet" },
        models: [{ name: "sonnet", provider: "anthropic", model: "sonnet-5" }],
        provider: [{ name: "anthropic", type: "anthropic", apiKey: "$(TOTALLY_UNSET_VAR)" }],
      }),
    );
    await expect(loadConfig(path, { env: {} })).rejects.toThrow(ConfigError);
    await expect(loadConfig(path, { env: {} })).rejects.toThrow(/TOTALLY_UNSET_VAR/);
  });

  test("throws ConfigError with a file-prefixed message on schema validation failure", async () => {
    const path = await writeConfig(
      "dh.json",
      JSON.stringify({ options: {}, models: [], provider: [] }),
    );
    await expect(loadConfig(path)).rejects.toThrow(ConfigError);
    await expect(loadConfig(path)).rejects.toThrow(
      new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });

  test("uses DEFAULT_CONFIG_PATH (dh.json in cwd) when no path is given", async () => {
    await withProcessMutationLock(async () => {
      const originalCwd = process.cwd();
      process.chdir(dir);
      try {
        await writeConfig(
          "dh.json",
          JSON.stringify({
            options: { defaultModel: "sonnet" },
            models: [{ name: "sonnet", provider: "anthropic", model: "sonnet-5" }],
            provider: [{ name: "anthropic", type: "anthropic" }],
          }),
        );
        const config = await loadConfig();
        expect(config.options.defaultModel).toBe("sonnet");
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});
