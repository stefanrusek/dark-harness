#!/usr/bin/env python3
"""Mint a new Spile ticket: allocate the next ID from tracking/README.md's
counter, bump the counter, and write a skeleton ticket file per
tracking/SPILE-SPEC.md. Regenerates the view doc afterward.

Usage:
  new_ticket.py --title "Some title" --type feature|bug [--owner NAME]
                [--status draft|refining|ready] [--summary "..."]
                [--depends-on ID,ID] [--relates-to ID,ID]
                [--blocked-by "reason"]

Prints the created ticket path on success.
"""
import argparse
import datetime
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from common import README_PATH, TRACKING_DIR, die, get_field, slugify, split_front_matter

VALID_TYPES = {"feature", "bug"}
VALID_INITIAL_STATUSES = {"draft", "refining", "ready"}


def read_counter():
    with open(README_PATH, encoding="utf-8") as f:
        text = f.read()
    fm_lines, body = split_front_matter(text)
    prefix = get_field(fm_lines, "prefix")
    counter = get_field(fm_lines, "counter")
    if prefix is None or counter is None:
        die("tracking/README.md front matter is missing prefix/counter")
    return fm_lines, body, prefix, int(counter)


def bump_counter(fm_lines, body, new_counter):
    for i, line in enumerate(fm_lines):
        if line.startswith("counter:"):
            fm_lines[i] = f"counter: {new_counter}"
            break
    else:
        die("could not find counter: line to bump")
    with open(README_PATH, "w", encoding="utf-8") as f:
        f.write("---\n" + "\n".join(fm_lines) + "\n---\n" + body)


def render_ticket(ticket_id, ticket_type, title, owner, status, summary,
                   depends_on, relates_to, blocked_by, created):
    depends_on_yaml = "[" + ", ".join(depends_on) + "]" if depends_on else "[]"
    relates_to_yaml = "[" + ", ".join(relates_to) + "]" if relates_to else "[]"
    blocked_by_yaml = ('["' + blocked_by + '"]') if blocked_by else "[]"
    summary_text = summary or "TODO: what this is and why."
    front = f"""---
spile: ticket
id: {ticket_id}
type: {ticket_type}
status: {status}
owner: {owner}
resolution:
blocked_by: {blocked_by_yaml}
created: {created}
relations:
  depends_on: {depends_on_yaml}
  relates_to: {relates_to_yaml}
  supersedes: []
implementation:
  - repo: dark-harness
---
"""
    body = f"""
# {ticket_id}: {title}

## Summary

{summary_text}

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
"""
    return front + body


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--title", required=True)
    ap.add_argument("--type", required=True, choices=sorted(VALID_TYPES))
    ap.add_argument("--owner", default="stefan")
    ap.add_argument("--status", default="draft", choices=sorted(VALID_INITIAL_STATUSES))
    ap.add_argument("--summary", default="")
    ap.add_argument("--depends-on", default="")
    ap.add_argument("--relates-to", default="")
    ap.add_argument("--blocked-by", default="")
    ap.add_argument("--no-regen", action="store_true",
                     help="skip regenerating the view doc (mainly for tests)")
    args = ap.parse_args()

    fm_lines, body, prefix, counter = read_counter()
    new_num = counter + 1
    ticket_id = f"{prefix}-{new_num:04d}"
    slug = slugify(args.title)
    filename = f"{ticket_id}-{slug}.md"
    path = os.path.join(TRACKING_DIR, filename)
    if os.path.exists(path):
        die(f"{path} already exists")

    created = datetime.date.today().isoformat()
    depends_on = [x.strip() for x in args.depends_on.split(",") if x.strip()]
    relates_to = [x.strip() for x in args.relates_to.split(",") if x.strip()]

    content = render_ticket(
        ticket_id, args.type, args.title, args.owner, args.status,
        args.summary, depends_on, relates_to, args.blocked_by, created,
    )
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

    # Bump the counter last, only once the file write succeeded — the
    # counter is the serialization point per SPILE-SPEC.md, so a failed
    # ticket write should not burn an ID.
    bump_counter(fm_lines, body, new_num)

    print(path)

    if not args.no_regen:
        import subprocess
        subprocess.run(
            [sys.executable, os.path.join(os.path.dirname(__file__), "regen_view.py")],
            check=True,
        )


if __name__ == "__main__":
    main()
