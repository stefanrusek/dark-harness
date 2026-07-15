#!/usr/bin/env python3
"""Regenerate tracking/views/dark-harness-view.md from the current state of
every ticket in tracking/, per SPILE-SPEC.md's "Views" section:
  1. Needs Attention — refining, verifying, and anything blocked.
  2. Board — open (non-closed) tickets grouped by status.
  3. Recently Closed — last 15 closed tickets.

This is idempotent and safe to run any time; it fully rewrites the view
file each time rather than patching it.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from common import STATUS_ORDER, TRACKING_DIR, VIEWS_DIR, get_field, list_tickets

VIEW_PATH = os.path.join(VIEWS_DIR, "dark-harness-view.md")


def title_from_body(body):
    m = re.search(r"^#\s+(?:\S+:\s*)?(.+)$", body.strip(), re.MULTILINE)
    return m.group(1).strip() if m else "(untitled)"


def rel_link(path):
    return "../" + os.path.basename(path)


def format_blocked_reasons(raw):
    """blocked_by is stored as a bracketed, comma-separated list of quoted
    strings/IDs, e.g. ["owner decision on packaging shape"] or [DH-0002]."""
    raw = raw.strip()
    if raw in ("", "[]"):
        return []
    inner = raw.strip("[]")
    items = []
    for part in re.findall(r'"[^"]*"|\'[^\']*\'|[^,]+', inner):
        part = part.strip().strip('"').strip("'").strip()
        if part:
            items.append(part)
    return items


def build():
    tickets = list_tickets()
    rows = []
    for path, fm_lines, body in tickets:
        rows.append({
            "id": get_field(fm_lines, "id"),
            "title": title_from_body(body),
            "type": get_field(fm_lines, "type"),
            "owner": get_field(fm_lines, "owner"),
            "status": get_field(fm_lines, "status"),
            "resolution": get_field(fm_lines, "resolution") or "",
            "blocked_by": format_blocked_reasons(get_field(fm_lines, "blocked_by") or "[]"),
            "path": path,
        })

    lines = []
    lines.append("---")
    lines.append("spile: view")
    lines.append("project: Dark Harness")
    lines.append("source: tracking/")
    lines.append("---")
    lines.append("")
    lines.append("<!-- GENERATED — do not hand-edit. Regenerate whenever a ticket's front matter changes.")
    lines.append("     Built from tracking/DH-*.md. -->")
    lines.append("")
    lines.append("# Dark Harness — tracker view")
    lines.append("")
    lines.append("## Needs Attention")
    lines.append("")

    needs_attention = [r for r in rows if r["status"] in ("refining", "verifying") or r["blocked_by"]]
    if needs_attention:
        lines.append("| ID | Title | Blocked by |")
        lines.append("| --- | --- | --- |")
        for r in needs_attention:
            blocked = "; ".join(r["blocked_by"]) if r["blocked_by"] else (
                f"status: {r['status']}" if r["status"] in ("refining", "verifying") else ""
            )
            lines.append(f"| [{r['id']}]({rel_link(r['path'])}) | {r['title']} | {blocked} |")
    else:
        lines.append("*(nothing needs attention)*")
    lines.append("")

    lines.append("## Board")
    lines.append("")
    open_statuses = [s for s in STATUS_ORDER if s != "closed"]
    any_open_section = False
    for status in open_statuses:
        status_rows = [r for r in rows if r["status"] == status]
        if not status_rows:
            continue
        any_open_section = True
        lines.append(f"### {status}")
        lines.append("")
        lines.append("| ID | Title | Type | Owner |")
        lines.append("| --- | --- | --- | --- |")
        for r in status_rows:
            badge = " \U0001F512" if r["blocked_by"] else ""
            lines.append(f"| [{r['id']}]({rel_link(r['path'])}) | {r['title']}{badge} | {r['type']} | {r['owner']} |")
        lines.append("")
    if not any_open_section:
        lines.append("*(no open tickets)*")
        lines.append("")

    lines.append("## Recently Closed")
    lines.append("")
    closed_rows = [r for r in rows if r["status"] == "closed"]
    closed_rows = closed_rows[-15:]
    closed_rows.reverse()
    if closed_rows:
        lines.append("| ID | Title | Resolution |")
        lines.append("| --- | --- | --- |")
        for r in closed_rows:
            lines.append(f"| [{r['id']}]({rel_link(r['path'])}) | {r['title']} | {r['resolution']} |")
    else:
        lines.append("*(none yet)*")

    return "\n".join(lines) + "\n"


def main():
    os.makedirs(VIEWS_DIR, exist_ok=True)
    content = build()
    with open(VIEW_PATH, "w", encoding="utf-8") as f:
        f.write(content)
    print(VIEW_PATH)


if __name__ == "__main__":
    main()
