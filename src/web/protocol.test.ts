import { describe, expect, test } from "bun:test";
import { commandUrl, sseUrl } from "./protocol.ts";

describe("sseUrl", () => {
  test("builds the events URL against the target base, no query params (auth travels via header)", () => {
    const url = sseUrl({ baseUrl: "http://localhost:4000" });
    expect(url).toBe("http://localhost:4000/api/events");
  });

  test("token configuration does not leak into the URL", () => {
    const url = sseUrl({ baseUrl: "http://localhost:4000", token: "secret" });
    expect(url).toBe("http://localhost:4000/api/events");
    expect(url).not.toContain("secret");
  });
});

describe("commandUrl", () => {
  test("builds the command endpoint URL against the target base", () => {
    expect(commandUrl({ baseUrl: "http://localhost:4000" })).toBe(
      "http://localhost:4000/api/commands",
    );
  });

  test("respects a non-default base URL (e.g. --connect <host>)", () => {
    expect(commandUrl({ baseUrl: "http://10.0.0.5:4000" })).toBe(
      "http://10.0.0.5:4000/api/commands",
    );
  });
});
