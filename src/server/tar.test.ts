import { describe, expect, test } from "bun:test";
import { buildTar } from "./tar.ts";

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

  test("throws when an entry name exceeds the 100-byte ustar name field", () => {
    const longName = `${"a".repeat(101)}.jsonl`;
    expect(() => buildTar([{ name: longName, data: new Uint8Array(0) }])).toThrow(RangeError);
  });

  test("archive length is always a multiple of the 512-byte block size", () => {
    const archive = buildTar([{ name: "odd.jsonl", data: new Uint8Array(17) }]);
    expect(archive.length % BLOCK_SIZE).toBe(0);
  });
});
