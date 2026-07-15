"""Shared helpers for spile-ops scripts. No third-party deps — stdlib only,
so these run under any python3 without a venv."""
import os
import re
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
TRACKING_DIR = os.path.join(REPO_ROOT, "tracking")
VIEWS_DIR = os.path.join(TRACKING_DIR, "views")
README_PATH = os.path.join(TRACKING_DIR, "README.md")

STATUS_ORDER = ["draft", "refining", "ready", "implementing", "verifying", "closed"]

FRONT_MATTER_RE = re.compile(r"\A---\n(.*?)\n---\n(.*)\Z", re.DOTALL)


def die(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def split_front_matter(text):
    """Return (front_matter_lines, body) for a ticket file's raw text.
    front_matter_lines is a list of the raw lines between the --- markers,
    in order, so we can edit them in place without a full YAML parser
    (front matter here is a simple, non-nested subset of YAML)."""
    m = FRONT_MATTER_RE.match(text)
    if not m:
        die("file does not start with a --- front matter block")
    fm_text, body = m.group(1), m.group(2)
    return fm_text.split("\n"), body


def join_front_matter(fm_lines, body):
    return "---\n" + "\n".join(fm_lines) + "\n---\n" + body


def get_field(fm_lines, key):
    """Return the scalar value of a top-level `key: value` line, or None."""
    prefix = key + ":"
    for line in fm_lines:
        if line.startswith(prefix):
            return line[len(prefix):].strip()
    return None


def set_field(fm_lines, key, value):
    """Set a top-level scalar `key: value` line in place. Errors if missing —
    spile-ops edits existing fields, it never invents schema."""
    prefix = key + ":"
    for i, line in enumerate(fm_lines):
        if line.startswith(prefix):
            fm_lines[i] = f"{key}: {value}"
            return
    die(f"front matter has no top-level '{key}:' field to set")


def list_tickets():
    """Return [(path, fm_lines, body)] for every DH-NNNN-*.md ticket file,
    sorted by ID."""
    out = []
    for name in os.listdir(TRACKING_DIR):
        if not re.match(r"^DH-\d{4}-.*\.md$", name):
            continue
        path = os.path.join(TRACKING_DIR, name)
        with open(path, encoding="utf-8") as f:
            text = f.read()
        fm_lines, body = split_front_matter(text)
        if get_field(fm_lines, "spile") != "ticket":
            continue
        out.append((path, fm_lines, body))
    out.sort(key=lambda t: get_field(t[1], "id") or "")
    return out


def slugify(title):
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return re.sub(r"-+", "-", slug)
