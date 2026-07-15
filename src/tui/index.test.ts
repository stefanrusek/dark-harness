import { describe, expect, test } from "bun:test";
import * as tui from "./index.ts";

describe("index", () => {
  test("re-exports startTui", () => {
    expect(typeof tui.startTui).toBe("function");
  });
});
