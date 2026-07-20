"""Shared helpers for spile-ops scripts. No third-party deps — stdlib only,
so these run under any python3 without a venv."""
import glob
import os
import re
import subprocess
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


def die_if_linked_worktree(action):
    """Refuse to run a counter-mutating action (currently: minting a new
    ticket ID) from inside a linked git worktree — see DH-0217.

    tracking/README.md's `counter:` field is a tracked file with one
    physical copy per worktree. Two isolated worktrees (the project's
    standard parallel-domain-lead isolation pattern) each read the same
    counter value, each mint the same DH-NNNN ID, and nothing collides
    until the branches are merged back onto the shared branch — at which
    point two tickets claim the same ID. This is not a same-filesystem
    race a lock would fix (the writers are on physically separate
    checkouts), so the fix is a guard at the point of mint: refuse unless
    this is the repo's primary checkout.

    Detection: `git rev-parse --git-common-dir` and `--git-dir` are equal
    for the primary checkout and differ for any linked worktree (the
    standard, documented way to detect this — see `git worktree` docs).
    """
    try:
        common_dir = subprocess.run(
            ["git", "rev-parse", "--git-common-dir"],
            cwd=REPO_ROOT, capture_output=True, text=True, check=True,
        ).stdout.strip()
        git_dir = subprocess.run(
            ["git", "rev-parse", "--git-dir"],
            cwd=REPO_ROOT, capture_output=True, text=True, check=True,
        ).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        # Not a git repo / git unavailable — nothing to guard against,
        # let the caller proceed rather than failing mechanics that don't
        # depend on git.
        return
    if os.path.abspath(os.path.join(REPO_ROOT, common_dir)) != os.path.abspath(os.path.join(REPO_ROOT, git_dir)):
        die(
            f"refusing to {action} from a linked git worktree (this checkout's "
            "--git-dir differs from its --git-common-dir). tracking/README.md's "
            "counter is per-worktree, so minting here risks a DH-NNNN ID "
            "collision with another isolated worktree once branches merge "
            "(see tracking/DH-0217-*.md). Run this from the coordinator's "
            "primary checkout instead."
        )


def resolve_ticket_path(ticket_id):
    """Resolve a ticket ID like 'DH-0028' to its file path by globbing
    tracking/DH-NNNN-*.md — the one shared lookup mechanism every script
    uses, so a ticket can always be found by ID alone without knowing (or
    guessing) its current filename slug.

    Errors loudly if there isn't exactly one match: zero means the ID
    doesn't exist, more than one means real data corruption (two files
    claiming the same ticket ID) worth surfacing rather than silently
    picking one.
    """
    matches = sorted(glob.glob(os.path.join(TRACKING_DIR, f"{ticket_id}-*.md")))
    if not matches:
        die(f"no ticket file found for {ticket_id} in tracking/")
    if len(matches) > 1:
        die(
            f"multiple ticket files found for {ticket_id} in tracking/ "
            f"(data corruption — expected exactly one): {matches}"
        )
    return matches[0]
