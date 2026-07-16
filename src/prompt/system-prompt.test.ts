import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILD_INFO } from "../config/build-info.ts";
import type { DhConfig, ModelConfig } from "../contracts/index.ts";
import type { Skill } from "./skills.ts";
import {
  CLAUDE_MD_MAX_BYTES,
  CLI_TOOLS_SKILL,
  REQUIRED_CONTRACT,
  buildDefaultSystemPrompt,
  loadSystemPrompt,
  readProjectClaudeMd,
  renderSelfInfoSection,
  renderSkillsSection,
} from "./system-prompt.ts";

function baseConfig(overrides: Partial<DhConfig> = {}): DhConfig {
  return {
    options: { defaultModel: "sonnet" },
    models: [],
    provider: [],
    ...overrides,
  };
}

describe("CLI_TOOLS_SKILL", () => {
  test("is parsed from the real bundled SKILL.md, not the fallback", () => {
    expect(CLI_TOOLS_SKILL.name).toBe("cli-tools");
    expect(CLI_TOOLS_SKILL.source).toBe("builtin");
    expect(CLI_TOOLS_SKILL.description.length).toBeGreaterThan(0);
    // Confirms the frontmatter actually parsed (not the shorter, hand-written fallback text).
    expect(CLI_TOOLS_SKILL.description).toContain("git");
  });
});

describe("renderSkillsSection", () => {
  test("sorts skills alphabetically and formats as a bullet list", () => {
    const skills: Skill[] = [
      { name: "zeta", description: "does zeta things", source: "builtin" },
      { name: "alpha", description: "does alpha things", source: "builtin" },
    ];
    const section = renderSkillsSection(skills);
    expect(section).toBe(
      [
        "## Available skills",
        "",
        "- **alpha**: does alpha things",
        "- **zeta**: does zeta things",
      ].join("\n"),
    );
  });

  test("still renders a header with no bullets when given no skills", () => {
    expect(renderSkillsSection([])).toBe("## Available skills\n");
  });
});

describe("renderSelfInfoSection", () => {
  const sonnet: ModelConfig = { name: "sonnet", provider: "anthropic", model: "claude-sonnet-5" };
  const haiku: ModelConfig = { name: "haiku", provider: "anthropic", model: "claude-haiku-5" };
  const opus: ModelConfig = { name: "opus", provider: "anthropic", model: "claude-opus-5" };

  test("states the running dh version from BUILD_INFO", () => {
    const config = baseConfig({ models: [sonnet] });
    const section = renderSelfInfoSection(config, sonnet);
    expect(section).toContain(`version ${BUILD_INFO.version}`);
  });

  test("states the current model's config name and provider model id", () => {
    const config = baseConfig({ models: [sonnet, haiku] });
    const section = renderSelfInfoSection(config, sonnet);
    expect(section).toContain("**sonnet**");
    expect(section).toContain("`claude-sonnet-5`");
  });

  test("lists other configured models, excluding the current one", () => {
    const config = baseConfig({ models: [sonnet, haiku, opus] });
    const section = renderSelfInfoSection(config, sonnet);
    expect(section).toContain("- **haiku** -> provider model `claude-haiku-5`");
    expect(section).toContain("- **opus** -> provider model `claude-opus-5`");
    // The current model itself must not appear in the "other models" list.
    expect(section).not.toContain("- **sonnet** ->");
  });

  test("says explicitly when no other models are configured", () => {
    const config = baseConfig({ models: [sonnet] });
    const section = renderSelfInfoSection(config, sonnet);
    expect(section).toContain("(no other models are configured in this session's dh.json)");
  });

  test("includes git sha (clean) when BUILD_INFO reports one", () => {
    const config = baseConfig({ models: [sonnet] });
    const section = renderSelfInfoSection(config, sonnet, {
      version: "1.2.3",
      gitSha: "abc1234",
      dirty: false,
      releaseTag: null,
    });
    expect(section).toContain("git sha abc1234");
    expect(section).not.toContain("dirty working tree");
  });

  test("flags a dirty working tree when BUILD_INFO reports one", () => {
    const config = baseConfig({ models: [sonnet] });
    const section = renderSelfInfoSection(config, sonnet, {
      version: "1.2.3",
      gitSha: "abc1234",
      dirty: true,
      releaseTag: null,
    });
    expect(section).toContain("git sha abc1234 (dirty working tree)");
  });

  test("includes the release tag when BUILD_INFO reports one", () => {
    const config = baseConfig({ models: [sonnet] });
    const section = renderSelfInfoSection(config, sonnet, {
      version: "1.2.3",
      gitSha: null,
      dirty: false,
      releaseTag: "v1.2.3",
    });
    expect(section).toContain("release v1.2.3");
  });

  test("differs per model, so a sub-agent on a different model gets different self-facts", () => {
    const config = baseConfig({ models: [sonnet, haiku] });
    const sonnetSection = renderSelfInfoSection(config, sonnet);
    const haikuSection = renderSelfInfoSection(config, haiku);
    expect(sonnetSection).not.toBe(haikuSection);
    expect(sonnetSection).toContain("running as model config **sonnet**");
    expect(haikuSection).toContain("running as model config **haiku**");
    expect(haikuSection).toContain("- **sonnet** -> provider model `claude-sonnet-5`");
  });
});

describe("buildDefaultSystemPrompt", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dh-prompt-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("includes the working-discipline text, logging statement, and skill enumeration", async () => {
    const skillDir = join(root, "custom-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: custom-skill\ndescription: a project-specific skill\n---\n\nbody\n",
    );

    const prompt = await buildDefaultSystemPrompt(baseConfig({ skillPaths: [root] }));

    expect(prompt).toContain("Escalate, don't guess.");
    expect(prompt).toContain("Commit before you yield.");
    expect(prompt).toContain("Status supersedes.");
    expect(prompt).toContain("Write self-contained handoffs.");
    expect(prompt).toContain("No silent truncation.");
    expect(prompt).toContain("A tool call is never fire-and-forget.");
    expect(prompt).toContain("Pace your polling.");
    expect(prompt).toContain(
      "Report failure with the exact literal text `TASK_FAILED` — every time, no exceptions.",
    );
    expect(prompt).toContain("TASK_FAILED");
    expect(prompt).toMatch(/re-read\s+your own final response/);
    expect(prompt).toMatch(/logged\s+automatically/);
    expect(prompt).toContain("Redirect or stop a stuck sub-agent — don't just keep polling it.");
    expect(prompt).toContain("SendMessage");
    expect(prompt).toContain("TaskStop");
    expect(prompt).toMatch(/unattended/);
    expect(prompt).toContain("## Output format");
    expect(prompt).toMatch(/rendered as Markdown by every Dark Harness client/);
    expect(prompt).toContain("stripped before rendering");
    expect(prompt).toContain("## Available skills");
    expect(prompt).toContain("- **cli-tools**:");
    expect(prompt).toContain("- **custom-skill**: a project-specific skill");
  });

  test("enumerates only the bundled skill when skillPaths is unset", async () => {
    const prompt = await buildDefaultSystemPrompt(baseConfig());
    expect(prompt).toContain("- **cli-tools**:");
    // Skill bullets ("- **name**: description") are the only lines matching this shape;
    // the working-discipline bullets above them are "- **Phrase.** ..." (period, no colon).
    expect(prompt.match(/^- \*\*[^*]+\*\*:/gm)).toEqual(["- **cli-tools**:"]);
  });
});

describe("loadSystemPrompt", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dh-prompt-override-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("builds the default prompt when systemPrompt is unset", async () => {
    // Uses `root` (an empty temp dir with no CLAUDE.md) as cwd, not the real process cwd —
    // this repo's own CLAUDE.md would otherwise get injected and break the exact-equality
    // check below (see the CLAUDE.md-specific describe block for that behavior).
    const config = baseConfig();
    const [loaded, built] = await Promise.all([
      loadSystemPrompt(config, root),
      buildDefaultSystemPrompt(config),
    ]);
    expect(loaded).toBe(built);
  });

  test("reads and trims an override file, but always appends the TASK_FAILED/logging contract", async () => {
    const overridePath = join(root, "custom-prompt.txt");
    await writeFile(overridePath, "\n  You are a custom agent.  \n");

    const prompt = await loadSystemPrompt(baseConfig({ systemPrompt: overridePath }), root);

    expect(prompt).toBe(`You are a custom agent.\n\n${REQUIRED_CONTRACT}`);
    expect(prompt).not.toContain("Available skills");
  });

  test("REQUIRED_CONTRACT carries the TASK_FAILED marker and the logging notice on its own", () => {
    expect(REQUIRED_CONTRACT).toContain("TASK_FAILED");
    expect(REQUIRED_CONTRACT).toMatch(/logged\s+automatically/);
  });

  test("REQUIRED_CONTRACT carries the Output format Markdown instruction, unconditionally appended", () => {
    expect(REQUIRED_CONTRACT).toContain("## Output format");
    expect(REQUIRED_CONTRACT).toMatch(/rendered as Markdown by every Dark Harness client/);
    expect(REQUIRED_CONTRACT).toContain("stripped before rendering");
  });

  test("override still gets the Output format contract appended", async () => {
    const overridePath = join(root, "custom-prompt2.txt");
    await writeFile(overridePath, "You are a custom agent.");

    const prompt = await loadSystemPrompt(baseConfig({ systemPrompt: overridePath }), root);

    expect(prompt).toContain("## Output format");
  });
});

describe("readProjectClaudeMd / DH-0055 CLAUDE.md injection", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dh-claude-md-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("returns null (silent no-op) when no CLAUDE.md exists", async () => {
    expect(await readProjectClaudeMd(root)).toBeNull();
  });

  test("reads and trims CLAUDE.md content when present", async () => {
    await writeFile(join(root, "CLAUDE.md"), "\n  Always say hi.  \n");
    expect(await readProjectClaudeMd(root)).toBe("Always say hi.");
  });

  test("truncates a CLAUDE.md larger than the cap and appends an explicit, non-silent marker", async () => {
    const big = "x".repeat(CLAUDE_MD_MAX_BYTES + 500);
    await writeFile(join(root, "CLAUDE.md"), big);

    const result = await readProjectClaudeMd(root);

    expect(result).not.toBeNull();
    expect(result?.length).toBeLessThan(big.length);
    expect(result).toContain("truncated");
    expect(result).toContain(String(big.length));
    expect(result).toContain(String(CLAUDE_MD_MAX_BYTES));
  });

  test("a CLAUDE.md exactly at the cap is not truncated", async () => {
    const exact = "y".repeat(CLAUDE_MD_MAX_BYTES);
    await writeFile(join(root, "CLAUDE.md"), exact);

    const result = await readProjectClaudeMd(root);

    expect(result).toBe(exact);
    expect(result).not.toContain("truncated");
  });

  test("loadSystemPrompt: no CLAUDE.md leaves the default prompt unchanged", async () => {
    const config = baseConfig();
    const prompt = await loadSystemPrompt(config, root);
    const built = await buildDefaultSystemPrompt(config);
    expect(prompt).toBe(built);
    expect(prompt).not.toContain("Project instructions");
  });

  test("loadSystemPrompt: injects CLAUDE.md additively on top of the default prompt", async () => {
    await writeFile(join(root, "CLAUDE.md"), "Always end every response with FOOBAR_MARKER.");

    const prompt = await loadSystemPrompt(baseConfig(), root);

    // Additive: the default discipline/skills content is still present...
    expect(prompt).toContain("## Available skills");
    expect(prompt).toContain(REQUIRED_CONTRACT);
    // ...and the project's CLAUDE.md content is appended on top of it.
    expect(prompt).toContain("## Project instructions");
    expect(prompt).toContain("Always end every response with FOOBAR_MARKER.");
    expect(prompt.indexOf("## Project instructions")).toBeGreaterThan(
      prompt.indexOf("## Available skills"),
    );
  });

  test("loadSystemPrompt: injects CLAUDE.md additively on top of a config.systemPrompt override", async () => {
    const overridePath = join(root, "custom-prompt.txt");
    await writeFile(overridePath, "You are a custom persona agent.");
    await writeFile(join(root, "CLAUDE.md"), "Project rule: always use tabs.");

    const prompt = await loadSystemPrompt(baseConfig({ systemPrompt: overridePath }), root);

    expect(prompt).toContain("You are a custom persona agent.");
    expect(prompt).toContain(REQUIRED_CONTRACT);
    expect(prompt).toContain("Project rule: always use tabs.");
    expect(prompt.indexOf("Project rule")).toBeGreaterThan(prompt.indexOf(REQUIRED_CONTRACT));
  });

  test("loadSystemPrompt defaults cwd to process.cwd() when not passed", async () => {
    // Sanity check the default-parameter wiring itself, independent of file content: calling
    // with an explicit cwd equal to process.cwd() must match calling with no second arg.
    const config = baseConfig();
    const [withDefault, withExplicitCwd] = await Promise.all([
      loadSystemPrompt(config),
      loadSystemPrompt(config, process.cwd()),
    ]);
    expect(withDefault).toBe(withExplicitCwd);
  });
});
