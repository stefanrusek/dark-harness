// Pure helper for flattening the agent tree into a navigable, indented list.

import type { AgentTreeNode } from "../contracts/index.ts";
// DH-0181: box-drawing connector glyphs are shared with `dh logs`'s offline dump
// (src/server/log-analysis.ts's formatNode) via this pure helper.
import { treeChildPrefix, treeConnector } from "../contracts/tree-connector.ts";

export interface FlatTreeEntry {
  node: AgentTreeNode;
  depth: number;
  /** Tree-connector prefix for this entry's row (DH-0065) — e.g. `"├─ "` or `"│  └─ "` for a
   * nested entry, `""` for a depth-0 root (no connector needed, nothing to branch off of).
   * Mirrors `dh logs`'s offline tree dump (`src/server/log-analysis.ts`'s `formatNode`) so the
   * interactive tree view reads at least as clearly as that dump, per the review's finding
   * that the TUI's plain-indent tree looked worse than the CLI's own log output. */
  prefix: string;
}

/** Depth-first, pre-order flatten so parent/child adjacency reads top-to-bottom. `prefix`
 * accumulates the connector string for descendants exactly the way `formatNode` does: a
 * continuing vertical bar (`"│  "`) under any ancestor that still has later siblings, three
 * blank columns (`"   "`) under one that doesn't. */
export function flattenTree(nodes: AgentTreeNode[], depth = 0, prefix = ""): FlatTreeEntry[] {
  const out: FlatTreeEntry[] = [];
  nodes.forEach((node, i) => {
    const isLast = i === nodes.length - 1;
    const isRoot = depth === 0;
    const connector = treeConnector(isRoot, isLast);
    out.push({ node, depth, prefix: `${prefix}${connector}` });
    const childPrefix = treeChildPrefix(isRoot, prefix, isLast);
    out.push(...flattenTree(node.children, depth + 1, childPrefix));
  });
  return out;
}
