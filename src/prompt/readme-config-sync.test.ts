// DH-0042: README's config reference is hand-maintained prose, not generated from
// src/contracts/config.type.ts — the schema's actual source of truth. That's an acknowledged
// maintenance risk (a field added to DhOptions/ModelConfig can silently go undocumented).
// This test is a lightweight drift guard, not a full type-checker: it extracts top-level
// field names from the two interfaces an operator configures directly (DhOptions,
// ModelConfig) and asserts each one is at least mentioned somewhere in README.md. It can't
// catch a field being documented *incorrectly*, only a field going completely unmentioned —
// but that's exactly the failure mode DH-0042 reported (options.maxTurns and the pricing
// fields existed in the contract with zero README mentions).
import { describe, expect, test } from "bun:test";

const CONFIG_SOURCE = await Bun.file(
  new URL("../contracts/config.type.ts", import.meta.url),
).text();
const README_SOURCE = await Bun.file(new URL("../../README.md", import.meta.url)).text();

/**
 * Pulls top-level `name` / `name?` field names out of a single TypeScript interface body by
 * name. Deliberately simple (no TS parser): matches the interface's braces and then any
 * `identifier:` or `identifier?:` at the start of a line within them. Good enough for this
 * project's flat, single-level config interfaces.
 */
function fieldNamesOf(source: string, interfaceName: string): string[] {
  const start = source.indexOf(`interface ${interfaceName} `);
  if (start === -1) {
    throw new Error(`interface ${interfaceName} not found in src/contracts/config.type.ts`);
  }
  const openBrace = source.indexOf("{", start);
  const closeBrace = source.indexOf("\n}", openBrace);
  const body = source.slice(openBrace + 1, closeBrace);
  const matches = body.matchAll(/^\s*(\w+)\??:/gm);
  return [...matches].map((m) => {
    const name = m[1];
    if (!name) throw new Error("unreachable: capture group always matches \\w+");
    return name;
  });
}

describe("README config reference stays in sync with src/contracts/config.type.ts", () => {
  test("every DhOptions field is mentioned in README.md", () => {
    const fields = fieldNamesOf(CONFIG_SOURCE, "DhOptions");
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      expect(README_SOURCE).toContain(field);
    }
  });

  test("every ModelConfig field is mentioned in README.md", () => {
    const fields = fieldNamesOf(CONFIG_SOURCE, "ModelConfig");
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      expect(README_SOURCE).toContain(field);
    }
  });
});

// DH-0227: the README hero (the product screenshot) was buried below a title, badges, and a
// long "Why this exists" essay/prose — below the fold on every viewport. The fix was a
// reorder: the hero <picture> block must sit above that long-form prose. This is a block-order
// assertion (byte offsets), not a rendering test, so a future edit can't silently re-bury the
// screenshot without failing here.
describe("README hero screenshot stays above the fold (DH-0227)", () => {
  const heroOffset = README_SOURCE.indexOf('srcset="docs/media/hero-web-dark.png"');
  const whyThisExistsOffset = README_SOURCE.indexOf("### Why this exists");
  const noDaemonsOffset = README_SOURCE.indexOf("No daemons to install");

  test("hero <picture> block is present", () => {
    expect(heroOffset).toBeGreaterThan(-1);
  });

  test("hero <picture> block appears before the 'Why this exists' section", () => {
    expect(whyThisExistsOffset).toBeGreaterThan(-1);
    expect(heroOffset).toBeLessThan(whyThisExistsOffset);
  });

  test("hero <picture> block appears before the 'No daemons to install' paragraph", () => {
    expect(noDaemonsOffset).toBeGreaterThan(-1);
    expect(heroOffset).toBeLessThan(noDaemonsOffset);
  });
});
