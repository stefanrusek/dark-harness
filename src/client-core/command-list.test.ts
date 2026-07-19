import { describe, expect, test } from "bun:test";
import {
  autocompleteMatches,
  BUILTIN_COMMANDS,
  buildCommandList,
  commandQueryFromInput,
  filterCommands,
} from "./command-list.ts";

describe("BUILTIN_COMMANDS", () => {
  test("has one entry per built-in name, each with a non-empty description", () => {
    expect(BUILTIN_COMMANDS.map((c) => c.name)).toEqual(["model", "help", "clear"]);
    for (const c of BUILTIN_COMMANDS) {
      expect(c.description.length).toBeGreaterThan(0);
    }
  });
});

describe("buildCommandList", () => {
  test("merges built-ins with a skill catalog", () => {
    const list = buildCommandList([{ name: "deploy", description: "deploy the app" }]);
    expect(list.map((c) => c.name)).toEqual(["model", "help", "clear", "deploy"]);
  });

  test("built-in names shadow same-named skills", () => {
    const list = buildCommandList([
      { name: "help", description: "a fake skill named help" },
      { name: "deploy", description: "deploy the app" },
    ]);
    expect(list.filter((c) => c.name === "help")).toHaveLength(1);
    expect(list.find((c) => c.name === "help")?.description).toBe("show available commands");
    expect(list.map((c) => c.name)).toEqual(["model", "help", "clear", "deploy"]);
  });

  test("empty skill list yields just the built-ins", () => {
    expect(buildCommandList([])).toEqual([...BUILTIN_COMMANDS]);
  });
});

describe("filterCommands", () => {
  const commands = buildCommandList([{ name: "deploy", description: "deploy the app" }]);

  test("empty query matches everything", () => {
    expect(filterCommands(commands, "")).toHaveLength(commands.length);
  });

  test("prefix-filters case-insensitively", () => {
    expect(filterCommands(commands, "MOD").map((c) => c.name)).toEqual(["model"]);
    expect(filterCommands(commands, "de").map((c) => c.name)).toEqual(["deploy"]);
  });

  test("no matches returns an empty array", () => {
    expect(filterCommands(commands, "zzz")).toEqual([]);
  });
});

describe("commandQueryFromInput", () => {
  test("non-slash input is not a command attempt", () => {
    expect(commandQueryFromInput("")).toBeNull();
    expect(commandQueryFromInput("hello")).toBeNull();
  });

  test("bare slash matches everything (empty query)", () => {
    expect(commandQueryFromInput("/")).toBe("");
  });

  test("in-progress command name is returned verbatim", () => {
    expect(commandQueryFromInput("/mo")).toBe("mo");
    expect(commandQueryFromInput("/model")).toBe("model");
  });

  test("whitespace after the name means args have started — no longer a query", () => {
    expect(commandQueryFromInput("/model opus")).toBeNull();
    expect(commandQueryFromInput("/model ")).toBeNull();
  });
});

describe("autocompleteMatches", () => {
  const commands = buildCommandList([{ name: "deploy", description: "deploy the app" }]);

  test("returns matches for a live query", () => {
    expect(autocompleteMatches(commands, "/m")?.map((c) => c.name)).toEqual(["model"]);
  });

  test("returns null when input isn't a command attempt", () => {
    expect(autocompleteMatches(commands, "hello")).toBeNull();
  });

  test("returns null when the query matches nothing", () => {
    expect(autocompleteMatches(commands, "/zzz")).toBeNull();
  });

  test("bare slash returns the full list", () => {
    expect(autocompleteMatches(commands, "/")).toHaveLength(commands.length);
  });
});
