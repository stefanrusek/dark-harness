import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DhConfig } from "../contracts/index.ts";
import type { Skill } from "./skills.ts";
import {
  CLI_TOOLS_SKILL,
  REQUIRED_CONTRACT,
  buildDefaultSystemPrompt,
  loadSystemPrompt,
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
    const config = baseConfig();
    const [loaded, built] = await Promise.all([
      loadSystemPrompt(config),
      buildDefaultSystemPrompt(config),
    ]);
    expect(loaded).toBe(built);
  });

  test("reads and trims an override file, but always appends the TASK_FAILED/logging contract", async () => {
    const overridePath = join(root, "custom-prompt.txt");
    await writeFile(overridePath, "\n  You are a custom agent.  \n");

    const prompt = await loadSystemPrompt(baseConfig({ systemPrompt: overridePath }));

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

    const prompt = await loadSystemPrompt(baseConfig({ systemPrompt: overridePath }));

    expect(prompt).toContain("## Output format");
  });
});
