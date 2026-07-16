#!/usr/bin/env python3
"""Rename a ticket's filename slug (and its H1 heading) to match a new
title, without changing its ID. Use this when a ticket's scope/title has
meaningfully changed since creation and its filename slug has gone stale
(e.g. still reads the old scope after narrowing) — not for every minor
rewording, just called explicitly when warranted.

Usage:
  rename_ticket.py DH-0002 "New Title"

Resolves the current file via resolve_ticket_path (the same ID-based
lookup transition.py uses), computes the new slug with the same
slugify() new_ticket.py uses, refuses to run if a file with that slug
already exists (never overwrites another ticket's file), does a `git mv`
to the new filename, updates the H1 heading line inside the file to match
the new title, and regenerates the view doc afterward.

Prints the new ticket path on success.
"""
import argparse
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(__file__))
from common import TRACKING_DIR, die, resolve_ticket_path, slugify

H1_RE = re.compile(r"^(#\s+)(\S+:\s*)?(.+)$", re.MULTILINE)


def rewrite_h1(body, ticket_id, new_title):
    def replace(m):
        prefix = m.group(2) or f"{ticket_id}: "
        return f"{m.group(1)}{prefix}{new_title}"

    new_body, count = H1_RE.subn(replace, body, count=1)
    if count == 0:
        die("could not find an H1 heading line to update")
    return new_body


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ticket_id")
    ap.add_argument("new_title")
    ap.add_argument("--no-regen", action="store_true",
                     help="skip regenerating the view doc (mainly for tests)")
    args = ap.parse_args()

    old_path = resolve_ticket_path(args.ticket_id)
    new_slug = slugify(args.new_title)
    new_filename = f"{args.ticket_id}-{new_slug}.md"
    new_path = os.path.join(TRACKING_DIR, new_filename)

    if os.path.abspath(new_path) == os.path.abspath(old_path):
        print(f"{old_path}: already matches new title's slug, nothing to do")
        return

    if os.path.exists(new_path):
        die(f"{new_path} already exists — refusing to overwrite")

    # Use `git mv` when the file is tracked (so git records the rename and
    # stages it), but fall back to a plain rename for a freshly-minted
    # ticket that hasn't been committed yet — `git mv` refuses to touch an
    # untracked file, but the rename itself is still exactly what we want.
    is_tracked = subprocess.run(
        ["git", "ls-files", "--error-unmatch", old_path],
        cwd=TRACKING_DIR, capture_output=True,
    ).returncode == 0
    if is_tracked:
        subprocess.run(["git", "mv", old_path, new_path], check=True, cwd=TRACKING_DIR)
    else:
        os.rename(old_path, new_path)

    with open(new_path, encoding="utf-8") as f:
        text = f.read()
    text = rewrite_h1(text, args.ticket_id, args.new_title)
    with open(new_path, "w", encoding="utf-8") as f:
        f.write(text)

    print(new_path)

    if not args.no_regen:
        subprocess.run(
            [sys.executable, os.path.join(os.path.dirname(__file__), "regen_view.py")],
            check=True,
        )


if __name__ == "__main__":
    main()
