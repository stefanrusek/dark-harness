import { describe, expect, test } from "bun:test";
import type { AgentTreeNode } from "../contracts/index.ts";
import { flattenTree } from "./tree.ts";

function node(agentId: string, children: AgentTreeNode[] = []): AgentTreeNode {
  return { agentId, parentAgentId: null, model: "sonnet", status: "running", children };
}

describe("flattenTree", () => {
  test("returns an empty list for an empty tree", () => {
    expect(flattenTree([])).toEqual([]);
  });

  test("flattens a flat list of roots at depth 0, with no connector prefix", () => {
    const a = node("a");
    const b = node("b");
    expect(flattenTree([a, b])).toEqual([
      { node: a, depth: 0, prefix: "" },
      { node: b, depth: 0, prefix: "" },
    ]);
  });

  test("flattens nested children depth-first, pre-order", () => {
    const grandchild = node("c");
    const child = node("b", [grandchild]);
    const root = node("a", [child]);
    const result = flattenTree([root]);
    expect(result.map((entry) => entry.node.agentId)).toEqual(["a", "b", "c"]);
    expect(result.map((entry) => entry.depth)).toEqual([0, 1, 2]);
  });

  test("visits siblings before descending into the next root's children", () => {
    const tree = [node("a", [node("a1")]), node("b", [node("b1")])];
    const result = flattenTree(tree);
    expect(result.map((entry) => entry.node.agentId)).toEqual(["a", "a1", "b", "b1"]);
  });

  test("a single child of a depth-0 root gets a '└─ ' connector (last/only sibling)", () => {
    const tree = [node("a", [node("a1")])];
    const result = flattenTree(tree);
    expect(result.map((entry) => entry.prefix)).toEqual(["", "└─ "]);
  });

  test("a non-last child gets '├─ ' and its descendants continue with a '│  ' bar", () => {
    const tree = [node("a", [node("a1", [node("a1a")]), node("a2")])];
    const result = flattenTree(tree);
    expect(result.map((entry) => `${entry.node.agentId}:${entry.prefix}`)).toEqual([
      "a:",
      "a1:├─ ",
      "a1a:│  └─ ",
      "a2:└─ ",
    ]);
  });
});
