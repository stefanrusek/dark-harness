#!/usr/bin/env python3
"""Transition a ticket's status (and optionally owner/resolution/blocked_by),
then regenerate the view doc.

Usage:
  transition.py DH-0008 implementing
  transition.py DH-0008 closed --resolution done
  transition.py DH-0004 draft --blocked-by "owner decision on packaging shape"
  transition.py DH-0004 ready --clear-blocked-by

Per SPILE-SPEC.md, the lifecycle is advisory: an out-of-order transition
still succeeds, but this script prints a warning so the operator notices.
"""
import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from common import STATUS_ORDER, TRACKING_DIR, die, get_field, join_front_matter, list_tickets, set_field


def find_ticket_path(ticket_id):
    for name in os.listdir(TRACKING_DIR):
        if name.startswith(ticket_id + "-") and name.endswith(".md"):
            return os.path.join(TRACKING_DIR, name)
    die(f"no ticket file found for {ticket_id} in tracking/")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ticket_id")
    ap.add_argument("new_status", choices=STATUS_ORDER)
    ap.add_argument("--resolution", default=None,
                    choices=["done", "wontfix", "duplicate", "superseded"])
    ap.add_argument("--blocked-by", default=None,
                    help="set blocked_by to this single reason/ticket-id")
    ap.add_argument("--clear-blocked-by", action="store_true")
    ap.add_argument("--owner", default=None)
    ap.add_argument("--no-regen", action="store_true")
    args = ap.parse_args()

    path = find_ticket_path(args.ticket_id)
    with open(path, encoding="utf-8") as f:
        text = f.read()
    fm_lines, body = None, None
    from common import split_front_matter
    fm_lines, body = split_front_matter(text)

    old_status = get_field(fm_lines, "status")
    if old_status is None:
        die(f"{path} has no status field")

    old_idx = STATUS_ORDER.index(old_status) if old_status in STATUS_ORDER else -1
    new_idx = STATUS_ORDER.index(args.new_status)
    if old_idx != -1 and new_idx not in (old_idx, old_idx + 1, old_idx - 1) and args.new_status != "draft":
        print(
            f"warning: non-adjacent transition {old_status} -> {args.new_status} "
            f"for {args.ticket_id} (advisory lifecycle — proceeding anyway)",
            file=sys.stderr,
        )

    set_field(fm_lines, "status", args.new_status)

    if args.new_status == "closed":
        if not args.resolution:
            die("closing a ticket requires --resolution done|wontfix|duplicate|superseded")
        set_field(fm_lines, "resolution", args.resolution)
    elif args.resolution:
        set_field(fm_lines, "resolution", args.resolution)

    if args.owner:
        set_field(fm_lines, "owner", args.owner)

    if args.clear_blocked_by:
        set_field(fm_lines, "blocked_by", "[]")
    elif args.blocked_by:
        set_field(fm_lines, "blocked_by", f'["{args.blocked_by}"]')

    with open(path, "w", encoding="utf-8") as f:
        f.write(join_front_matter(fm_lines, body))

    print(f"{args.ticket_id}: {old_status} -> {args.new_status}")

    if not args.no_regen:
        import subprocess
        subprocess.run(
            [sys.executable, os.path.join(os.path.dirname(__file__), "regen_view.py")],
            check=True,
        )


if __name__ == "__main__":
    main()
