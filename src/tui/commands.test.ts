import { describe, expect, test } from "bun:test";
import { BUILTIN_COMMAND_NAMES, isBuiltinCommandName, parseSlashCommand } from "./commands.ts";

// DH-0093: same test-vector table used to verify src/web/client/commands.ts (or its
// equivalent parser) so both surfaces agree on the grammar — see the ticket's "shared parser"
// fallback note.
describe("parseSlashCommand", () => {
  test("parses a bare command name with no args", () => {
    expect(parseSlashCommand("/help")).toEqual({ name: "help", args: "" });
  });

  test("parses a command with args, splitting on the first run of whitespace", () => {
    expect(parseSlashCommand("/model sonnet")).toEqual({ name: "model", args: "sonnet" });
  });

  test("keeps the rest of the args verbatim, including extra internal whitespace", () => {
    expect(parseSlashCommand("/deploy   staging   now")).toEqual({
      name: "deploy",
      args: "staging   now",
    });
  });

  test("args can carry embedded newlines", () => {
    expect(parseSlashCommand("/skill line one\nline two")).toEqual({
      name: "skill",
      args: "line one\nline two",
    });
  });

  test("a bare slash alone is not a command", () => {
    expect(parseSlashCommand("/")).toBeNull();
  });

  test("slash-space is ordinary chat, not a command", () => {
    expect(parseSlashCommand("/ hello there")).toBeNull();
  });

  test("plain text with no leading slash is not a command", () => {
    expect(parseSlashCommand("hello /model")).toBeNull();
  });

  test("empty input is not a command", () => {
    expect(parseSlashCommand("")).toBeNull();
  });
});

describe("isBuiltinCommandName", () => {
  test("recognizes every built-in", () => {
    for (const name of BUILTIN_COMMAND_NAMES) {
      expect(isBuiltinCommandName(name)).toBe(true);
    }
  });

  test("rejects a non-builtin name", () => {
    expect(isBuiltinCommandName("deploy")).toBe(false);
  });
});
