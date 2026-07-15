// Pure helper for flattening the agent tree into a navigable, indented list.

import type { AgentTreeNode } from "../contracts/index.ts";

export interface FlatTreeEntry {
  node: AgentTreeNode;
  depth: number;
}

/** Depth-first, pre-order flatten so parent/child adjacency reads top-to-bottom. */
export function flattenTree(nodes: AgentTreeNode[], depth = 0): FlatTreeEntry[] {
  const out: FlatTreeEntry[] = [];
  for (const node of nodes) {
    out.push({ node, depth });
    out.push(...flattenTree(node.children, depth + 1));
  }
  return out;
}
