import { afterEach, describe, expect, test } from "bun:test";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  capOutput,
  capOutputWithSavedFile,
  HEAD_PREVIEW_CHARS,
  OUTPUT_CAP_CHARS,
  TAIL_PREVIEW_CHARS,
} from "./output-cap.ts";

const SAVE_DIR = join(tmpdir(), "dh-bash-output");

describe("capOutput (tail-keeping, used by TaskOutput)", () => {
  test("returns text unchanged when under the cap", () => {
    const result = capOutput("hello");
    expect(result).toEqual({ text: "hello", truncated: false, totalLength: 5 });
  });

  test("returns text unchanged exactly at the cap boundary", () => {
    const text = "x".repeat(OUTPUT_CAP_CHARS);
    const result = capOutput(text);
    expect(result.truncated).toBe(false);
    expect(result.text).toBe(text);
  });

  test("keeps the tail and prepends a notice when over the cap", () => {
    const text = `${"a".repeat(10)}${"b".repeat(20)}`;
    const result = capOutput(text, 20);
    expect(result.truncated).toBe(true);
    expect(result.totalLength).toBe(30);
    expect(result.text).toContain("[output truncated: showing last 20 of 30 total chars]");
    expect(result.text.endsWith("b".repeat(20))).toBe(true);
    expect(result.text).not.toContain("aaaaaaaaaa");
  });
});

describe("capOutputWithSavedFile (head+tail preview + on-disk save, used by Bash)", () => {
  afterEach(async () => {
    await rm(SAVE_DIR, { recursive: true, force: true });
  });

  test("returns text unchanged, with no save, when under the cap", async () => {
    const result = await capOutputWithSavedFile("hello", 100);
    expect(result).toEqual({ text: "hello", truncated: false, totalLength: 5 });
    expect(result.savedPath).toBeUndefined();
  });

  test("returns text unchanged exactly at the cap boundary", async () => {
    const text = "x".repeat(OUTPUT_CAP_CHARS);
    const result = await capOutputWithSavedFile(text);
    expect(result.truncated).toBe(false);
    expect(result.text).toBe(text);
  });

  test("saves full output to a file and previews head+tail when over the cap", async () => {
    const head = "H".repeat(HEAD_PREVIEW_CHARS);
    const middle = "M".repeat(5_000);
    const tail = "T".repeat(TAIL_PREVIEW_CHARS);
    const text = `${head}${middle}${tail}`;

    const result = await capOutputWithSavedFile(text, 1_000);

    expect(result.truncated).toBe(true);
    expect(result.totalLength).toBe(text.length);
    expect(result.savedPath).toBeDefined();
    expect(result.text).toContain(`Output too large (${text.length} chars)`);
    expect(result.text).toContain(`Full output saved to: ${result.savedPath}`);
    expect(result.text).toContain(`Preview (first ${HEAD_PREVIEW_CHARS} chars)`);
    expect(result.text).toContain(head);
    expect(result.text).toContain(`Tail preview (last ${TAIL_PREVIEW_CHARS} chars)`);
    expect(result.text).toContain(tail);
    // The middle section should not appear in the preview text itself, only be referenced by
    // the omitted-chars count and recoverable via the saved file.
    expect(result.text).not.toContain(middle);

    const savedContent = await Bun.file(result.savedPath as string).text();
    expect(savedContent).toBe(text);
  });

  test("prunes the oldest saved files once more than the max count accumulate", async () => {
    const capChars = 10;
    // Write more than the internal MAX_SAVED_FILES (50) to force pruning.
    for (let i = 0; i < 55; i++) {
      await capOutputWithSavedFile(`output-number-${i}-${"z".repeat(20)}`, capChars);
    }
    const entries = await readdir(SAVE_DIR);
    expect(entries.length).toBeLessThanOrEqual(50);
  });
});
