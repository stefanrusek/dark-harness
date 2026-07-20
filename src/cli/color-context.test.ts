import { describe, expect, test } from "bun:test";
import { detectColorLevel } from "./color-context.ts";

const TTY = { isTTY: true, env: {}, plain: false };

describe("detectColorLevel", () => {
  test("--plain forces none even on a TTY with truecolor support", () => {
    expect(detectColorLevel({ isTTY: true, env: { COLORTERM: "truecolor" }, plain: true })).toBe(
      "none",
    );
  });

  test("NO_COLOR presence forces none regardless of its value", () => {
    expect(detectColorLevel({ ...TTY, env: { NO_COLOR: "" } })).toBe("none");
    expect(detectColorLevel({ ...TTY, env: { NO_COLOR: "0" } })).toBe("none");
    expect(detectColorLevel({ ...TTY, env: { NO_COLOR: "1" } })).toBe("none");
  });

  test("NO_COLOR unset leaves color enabled", () => {
    expect(detectColorLevel({ ...TTY, env: {} })).toBe("ansi256");
  });

  test("non-TTY forces none", () => {
    expect(detectColorLevel({ isTTY: false, env: {}, plain: false })).toBe("none");
  });

  test("TTY + COLORTERM=truecolor -> truecolor", () => {
    expect(detectColorLevel({ ...TTY, env: { COLORTERM: "truecolor" } })).toBe("truecolor");
  });

  test("TTY + COLORTERM=24bit -> truecolor", () => {
    expect(detectColorLevel({ ...TTY, env: { COLORTERM: "24bit" } })).toBe("truecolor");
  });

  test("TTY + COLORTERM unset -> ansi256", () => {
    expect(detectColorLevel({ ...TTY, env: {} })).toBe("ansi256");
  });

  test("TTY + COLORTERM set to something else -> ansi256", () => {
    expect(detectColorLevel({ ...TTY, env: { COLORTERM: "yes" } })).toBe("ansi256");
  });
});
