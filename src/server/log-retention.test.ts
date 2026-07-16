import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneLogDirectories } from "./log-retention.ts";

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function makeSession(root: string, id: string, sizeBytes: number, ageMs: number): void {
  const sessionDir = join(root, id);
  mkdirSync(sessionDir, { recursive: true });
  const file = join(sessionDir, "root.jsonl");
  writeFileSync(file, "x".repeat(sizeBytes));
  const time = (Date.now() - ageMs) / 1000;
  utimesSync(file, time, time);
}

describe("pruneLogDirectories", () => {
  test("no-ops when config is undefined", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-logs-test-"));
    makeSession(dir, "s1", 10, 0);
    const result = pruneLogDirectories(dir, undefined, Date.now());
    expect(result.prunedSessionIds).toEqual([]);
    expect(existsSync(join(dir, "s1"))).toBe(true);
  });

  test("no-ops when config sets neither cap", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-logs-test-"));
    makeSession(dir, "s1", 10, 0);
    const result = pruneLogDirectories(dir, {}, Date.now());
    expect(result.prunedSessionIds).toEqual([]);
    expect(existsSync(join(dir, "s1"))).toBe(true);
  });

  test("treats an unreadable logsRootDir as nothing to prune", () => {
    const result = pruneLogDirectories(
      join(tmpdir(), "dh-logs-does-not-exist-xyz"),
      { maxAgeMs: 1 },
      Date.now(),
    );
    expect(result.prunedSessionIds).toEqual([]);
  });

  test("deletes session directories older than maxAgeMs", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-logs-test-"));
    makeSession(dir, "old", 10, 100_000);
    makeSession(dir, "new", 10, 0);
    const result = pruneLogDirectories(dir, { maxAgeMs: 50_000 }, Date.now());
    expect(result.prunedSessionIds).toEqual(["old"]);
    expect(existsSync(join(dir, "old"))).toBe(false);
    expect(existsSync(join(dir, "new"))).toBe(true);
  });

  test("never prunes the excluded (current) session by age", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-logs-test-"));
    makeSession(dir, "current", 10, 999_999);
    const result = pruneLogDirectories(dir, { maxAgeMs: 1 }, Date.now(), "current");
    expect(result.prunedSessionIds).toEqual([]);
    expect(existsSync(join(dir, "current"))).toBe(true);
  });

  test("evicts oldest-first once total size exceeds maxTotalBytes", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-logs-test-"));
    makeSession(dir, "oldest", 100, 3000);
    makeSession(dir, "middle", 100, 2000);
    makeSession(dir, "newest", 100, 1000);
    const result = pruneLogDirectories(dir, { maxTotalBytes: 150 }, Date.now());
    expect(result.prunedSessionIds).toEqual(["oldest", "middle"]);
    expect(existsSync(join(dir, "oldest"))).toBe(false);
    expect(existsSync(join(dir, "middle"))).toBe(false);
    expect(existsSync(join(dir, "newest"))).toBe(true);
  });

  test("never prunes the excluded (current) session by size", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-logs-test-"));
    makeSession(dir, "current", 1000, 5000);
    const result = pruneLogDirectories(dir, { maxTotalBytes: 1 }, Date.now(), "current");
    expect(result.prunedSessionIds).toEqual([]);
  });

  test("applies age pruning before size pruning", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-logs-test-"));
    makeSession(dir, "ancient", 50, 999_999);
    makeSession(dir, "recent", 50, 10);
    const result = pruneLogDirectories(dir, { maxAgeMs: 100_000, maxTotalBytes: 1 }, Date.now());
    expect(result.prunedSessionIds).toEqual(["ancient", "recent"]);
  });

  test("stops early once under the size cap, leaving newer dirs alone", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-logs-test-"));
    makeSession(dir, "a", 100, 3000);
    makeSession(dir, "b", 100, 2000);
    const result = pruneLogDirectories(dir, { maxTotalBytes: 150 }, Date.now());
    expect(result.prunedSessionIds).toEqual(["a"]);
    expect(existsSync(join(dir, "b"))).toBe(true);
  });

  test("ignores a non-directory entry under logsRootDir", () => {
    dir = mkdtempSync(join(tmpdir(), "dh-logs-test-"));
    writeFileSync(join(dir, "stray-file.txt"), "not a session dir");
    makeSession(dir, "s1", 10, 0);
    const result = pruneLogDirectories(dir, { maxAgeMs: 1 }, Date.now());
    expect(result.prunedSessionIds).toEqual([]);
  });
});
