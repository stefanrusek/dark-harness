// DH-0181: shared box-drawing tree-connector helper. Extracted because `dh logs`'s offline
// dump (src/server/log-analysis.ts's formatNode) and the TUI's interactive tree
// (src/tui/tree.ts's flattenTree) independently computed the identical connector glyphs —
// tree.ts already documented that it mirrors formatNode. Pure and identical, so one helper
// now feeds both. Lives in contracts/ as the shared cross-domain location both call sites
// already import from.

/** The box-drawing connector glyph for one row of a tree dump: `""` for a root (nothing to
 * branch off of), `"└─ "` for the last child at its depth, `"├─ "` otherwise. */
export function treeConnector(isRoot: boolean, isLast: boolean): string {
  if (isRoot) return "";
  return isLast ? "└─ " : "├─ ";
}

/** The prefix contribution a node adds for its *children's* rows: unchanged at the root,
 * three blank columns (`"   "`) under a last child, or a continuing vertical bar (`"│  "`)
 * under one that still has later siblings. */
export function treeChildPrefix(isRoot: boolean, prefix: string, isLast: boolean): string {
  if (isRoot) return prefix;
  return `${prefix}${isLast ? "   " : "│  "}`;
}
