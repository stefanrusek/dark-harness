#!/bin/sh
# Installs scripts/hooks/post-commit into .git/hooks/post-commit for the main
# checkout only. Copies (not symlinks) the file, since symlinks into
# .git/hooks/ don't survive `git worktree add` cleanly. Refuses to run (no-op,
# non-fatal) when the current checkout is a linked worktree rather than the
# main one. See tracking/DH-0141-formalize-a-periodic-refactoring-round-mechanism.md.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)
GIT_DIR=$(git -C "$REPO_ROOT" rev-parse --git-dir)
GIT_COMMON_DIR=$(git -C "$REPO_ROOT" rev-parse --git-common-dir)

# Resolve both to absolute paths for a reliable comparison.
GIT_DIR_ABS=$(CDPATH= cd -- "$REPO_ROOT/$GIT_DIR" 2>/dev/null && pwd || (CDPATH= cd -- "$GIT_DIR" && pwd))
GIT_COMMON_DIR_ABS=$(CDPATH= cd -- "$REPO_ROOT/$GIT_COMMON_DIR" 2>/dev/null && pwd || (CDPATH= cd -- "$GIT_COMMON_DIR" && pwd))

if [ "$GIT_DIR_ABS" != "$GIT_COMMON_DIR_ABS" ]; then
	echo "install-git-hooks: this checkout is a linked worktree, not the main checkout -- refusing to install (no-op)." >&2
	exit 0
fi

HOOKS_DIR="$GIT_DIR_ABS/hooks"
mkdir -p "$HOOKS_DIR"
cp "$SCRIPT_DIR/hooks/post-commit" "$HOOKS_DIR/post-commit"
chmod +x "$HOOKS_DIR/post-commit"

echo "install-git-hooks: installed post-commit hook into $HOOKS_DIR/post-commit"
