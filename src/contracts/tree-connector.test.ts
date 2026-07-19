import { describe, expect, test } from "bun:test";
import { treeChildPrefix, treeConnector } from "./tree-connector.ts";

describe("treeConnector", () => {
  test("root has no connector", () => {
    expect(treeConnector(true, false)).toBe("");
    expect(treeConnector(true, true)).toBe("");
  });

  test("last non-root child uses the corner glyph", () => {
    expect(treeConnector(false, true)).toBe("└─ ");
  });

  test("non-last non-root child uses the tee glyph", () => {
    expect(treeConnector(false, false)).toBe("├─ ");
  });
});

describe("treeChildPrefix", () => {
  test("root passes the prefix through unchanged", () => {
    expect(treeChildPrefix(true, "│  ", false)).toBe("│  ");
    expect(treeChildPrefix(true, "", true)).toBe("");
  });

  test("last non-root child pads with blank columns", () => {
    expect(treeChildPrefix(false, "│  ", true)).toBe("│     ");
  });

  test("non-last non-root child continues the vertical bar", () => {
    expect(treeChildPrefix(false, "│  ", false)).toBe("│  │  ");
  });
});
