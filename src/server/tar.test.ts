import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { buildHeader, buildTar } from "./tar.ts";

const BLOCK_SIZE = 512;

/** Minimal ustar reader, local to this test file, used only to verify buildTar's output
 * round-trips correctly (name, size, data, and the header checksum). */
function parseTar(archive: Uint8Array): Array<{ name: string; data: Uint8Array }> {
  const decoder = new TextDecoder();
  const entries: Array<{ name: string; data: Uint8Array }> = [];
  let offset = 0;
  while (offset + BLOCK_SIZE <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK_SIZE);
    if (header.every((byte) => byte === 0)) break; // terminating zero block

    const name = decoder.decode(header.subarray(0, 100)).replace(/\0.*$/s, "");
    const sizeField = decoder.decode(header.subarray(124, 136)).replace(/\0.*$/s, "");
    const size = Number.parseInt(sizeField, 8);
    const storedChecksumField = decoder.decode(header.subarray(148, 156)).replace(/[\0 ].*$/s, "");
    const storedChecksum = Number.parseInt(storedChecksumField, 8);

    const recomputed = new Uint8Array(header);
    recomputed.fill(0x20, 148, 156);
    let checksum = 0;
    for (const byte of recomputed) checksum += byte;
    expect(checksum).toBe(storedChecksum);

    const dataStart = offset + BLOCK_SIZE;
    const data = archive.slice(dataStart, dataStart + size);
    entries.push({ name, data });

    const padded = Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
    offset = dataStart + padded;
  }
  return entries;
}

describe("buildTar", () => {
  test("produces an archive with two trailing zero blocks and no entries for an empty input", () => {
    const archive = buildTar([]);
    expect(archive.length).toBe(BLOCK_SIZE * 2);
    expect(archive.every((byte) => byte === 0)).toBe(true);
    expect(parseTar(archive)).toEqual([]);
  });

  test("round-trips a single small entry with a correct header checksum", () => {
    const data = new TextEncoder().encode('{"hello":"world"}\n');
    const archive = buildTar([{ name: "agent-1.jsonl", data }]);
    const entries = parseTar(archive);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("agent-1.jsonl");
    expect(entries[0]?.data).toEqual(data);
  });

  test("round-trips multiple entries, including one requiring block padding and one empty", () => {
    const small = new TextEncoder().encode("x");
    const exact = new Uint8Array(BLOCK_SIZE).fill(7); // exactly one block, no padding needed
    const empty = new Uint8Array(0);
    const archive = buildTar([
      { name: "small.jsonl", data: small },
      { name: "exact.jsonl", data: exact },
      { name: "empty.jsonl", data: empty },
    ]);
    const entries = parseTar(archive);
    expect(entries.map((e) => e.name)).toEqual(["small.jsonl", "exact.jsonl", "empty.jsonl"]);
    expect(entries[0]?.data).toEqual(small);
    expect(entries[1]?.data).toEqual(exact);
    expect(entries[2]?.data).toEqual(empty);
  });

  test("DH-0021: renames (rather than throws for) an entry name exceeding 100 bytes, and records it in a manifest", () => {
    const longName = `${"a".repeat(101)}.jsonl`;
    const data = new TextEncoder().encode("hi");
    const archive = buildTar([{ name: longName, data }]);
    const entries = parseTar(archive);

    expect(entries).toHaveLength(2);
    const renamedEntry = entries.find((e) => e.name !== "00-RENAMED-ENTRIES.txt");
    expect(renamedEntry).toBeDefined();
    expect(new TextEncoder().encode(renamedEntry?.name ?? "").length).toBeLessThanOrEqual(100);
    expect(renamedEntry?.name.endsWith(".jsonl")).toBe(true);
    expect(renamedEntry?.data).toEqual(data);

    const manifestEntry = entries.find((e) => e.name === "00-RENAMED-ENTRIES.txt");
    expect(manifestEntry).toBeDefined();
    const manifestText = new TextDecoder().decode(manifestEntry?.data);
    expect(manifestText).toBe(`${renamedEntry?.name}	${longName}
`);
  });

  test("DH-0021: an entry name at exactly the 100-byte boundary is left untouched", () => {
    const exactName = `${"a".repeat(96)}.txt`; // 100 bytes exactly
    expect(new TextEncoder().encode(exactName).length).toBe(100);
    const archive = buildTar([{ name: exactName, data: new Uint8Array(0) }]);
    const entries = parseTar(archive);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe(exactName);
  });

  test("DH-0021: two oversized names that collide after truncation both survive, distinctly renamed", () => {
    const nameA = `${"a".repeat(101)}.jsonl`;
    const nameB = `${"a".repeat(102)}.jsonl`;
    const archive = buildTar([
      { name: nameA, data: new TextEncoder().encode("A") },
      { name: nameB, data: new TextEncoder().encode("B") },
    ]);
    const entries = parseTar(archive);
    const renamedNames = entries
      .filter((e) => e.name !== "00-RENAMED-ENTRIES.txt")
      .map((e) => e.name);
    expect(new Set(renamedNames).size).toBe(renamedNames.length);
    expect(renamedNames).toHaveLength(2);
  });

  test("DH-0021: preserves a per-entry mtime instead of always using the archive build time", () => {
    const archive = buildTar([
      { name: "old.jsonl", data: new Uint8Array(0), mtimeSeconds: 1000 },
      { name: "new.jsonl", data: new Uint8Array(0), mtimeSeconds: 2000 },
    ]);
    // parseTar (this file's local minimal reader) doesn't currently surface mtime, so read
    // it directly off the header bytes: offset 136, 12-byte octal field, for each entry's
    // 512-byte header block (no data payload, so headers are back-to-back).
    const decoder = new TextDecoder();
    const readMtime = (headerOffset: number) => {
      const field = decoder
        .decode(archive.subarray(headerOffset + 136, headerOffset + 136 + 12))
        .replace(/\0.*$/s, "");
      return Number.parseInt(field, 8);
    };
    expect(readMtime(0)).toBe(1000);
    expect(readMtime(BLOCK_SIZE)).toBe(2000);
  });

  test("defaults an entry's mtime to the archive build time when omitted", () => {
    const before = Math.floor(Date.now() / 1000);
    const archive = buildTar([{ name: "no-mtime.jsonl", data: new Uint8Array(0) }]);
    const after = Math.floor(Date.now() / 1000);
    const decoder = new TextDecoder();
    const field = decoder.decode(archive.subarray(136, 136 + 12)).replace(/\0.*$/s, "");
    const mtime = Number.parseInt(field, 8);
    expect(mtime).toBeGreaterThanOrEqual(before);
    expect(mtime).toBeLessThanOrEqual(after);
  });

  test("buildHeader's own defensive bounds check still rejects an over-long name (DH-0021 belt-and-suspenders)", () => {
    // `buildTar` always sanitizes names via `safeEntryName` before reaching `buildHeader`,
    // so this guard is unreachable through the public API — exercised directly here so it
    // stays covered as a safety net against a future regression in that sanitization step.
    const longName = `${"a".repeat(101)}.jsonl`;
    expect(() => buildHeader(longName, 0, 0)).toThrow(RangeError);
  });

  test("DH-0021: disambiguates two names whose renamed candidates would otherwise collide", () => {
    const longName = `${"a".repeat(101)}.jsonl`;
    const hash = createHash("sha256").update(longName, "utf8").digest("hex").slice(0, 16);
    const collidingCandidate = `${hash}.jsonl`;

    // Seed a normal, already-short entry whose name happens to equal the renamed
    // candidate `longName` would otherwise get, forcing the disambiguation branch.
    const archive = buildTar([
      { name: collidingCandidate, data: new TextEncoder().encode("seed") },
      { name: longName, data: new TextEncoder().encode("long") },
    ]);
    const entries = parseTar(archive);
    const names = entries.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain(collidingCandidate);
    expect(names.some((n) => n !== collidingCandidate && n.startsWith(hash))).toBe(true);
  });

  test("archive length is always a multiple of the 512-byte block size", () => {
    const archive = buildTar([{ name: "odd.jsonl", data: new Uint8Array(17) }]);
    expect(archive.length % BLOCK_SIZE).toBe(0);
  });
});
