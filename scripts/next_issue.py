#!/usr/bin/env python3
"""Select the next issue the autonomous loop should build.

Encodes CLAUDE.md's "How you pick work" rules so the loop never guesses:

  - Only open ``type:build`` issues labelled ``status:ready`` are eligible.
  - Earliest open phase wins: a Phase N issue is never returned while the
    Phase N-1 epic is still open.
  - Phase 0 is strictly sequential: a Phase 0 issue is only returned when no
    other Phase 0 build issue is already in progress (assignee set or has an
    open PR), so the loop never opens parallel Phase 0 work.
  - Among the eligible issues in the earliest open phase, the LOWEST numbered
    one wins.

On success prints a JSON object describing the chosen issue and exits 0.
When nothing is ready, prints nothing and exits 3 (the loop's clean-exit
"backlog drained" signal). Any other error exits 1.

Reuses conventions emitted by ``bootstrap_issues.py``:
  - phase membership via the ``phase:N`` label,
  - dependency edges via a ``Depends on: #N, #M`` line in the body.

Read-only: this script never mutates GitHub state.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_NONE_READY = 3

DEPENDS_RE = re.compile(r"Depends on:\s*(.+)", re.IGNORECASE)
ISSUE_REF_RE = re.compile(r"#(\d+)")
SLUG_RE = re.compile(r"^\s*>\s*\*\*Phase")  # header marker; slug derived from title fallback


def gh_json(args: list[str]) -> object:
    """Run a ``gh`` command that emits JSON and return the parsed result."""
    result = subprocess.run(
        args,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def label_names(issue: dict) -> set[str]:
    return {lbl["name"] for lbl in issue.get("labels", [])}


def phase_of(issue: dict) -> int | None:
    for name in label_names(issue):
        if name.startswith("phase:"):
            try:
                return int(name.split(":", 1)[1])
            except ValueError:
                return None
    return None


def area_of(issue: dict) -> str | None:
    for name in sorted(label_names(issue)):
        if name.startswith("area:"):
            return name.split(":", 1)[1]
    return None


def size_of(issue: dict) -> str | None:
    for name in label_names(issue):
        if name.startswith("size:"):
            return name.split(":", 1)[1]
    return None


def deps_of(issue: dict) -> list[int]:
    body = issue.get("body") or ""
    for line in body.splitlines():
        m = DEPENDS_RE.search(line)
        if m:
            return [int(n) for n in ISSUE_REF_RE.findall(m.group(1))]
    return []


def slug_of(issue: dict) -> str:
    """Derive a branch-friendly slug from the issue title."""
    title = issue.get("title", "")
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return slug[:50] or f"issue-{issue.get('number')}"


def is_build(issue: dict) -> bool:
    return "type:build" in label_names(issue)


def is_epic(issue: dict) -> bool:
    return "type:epic" in label_names(issue)


def has_open_pr(issue_number: int, repo_args: list[str]) -> bool:
    """True if a PR whose body/head references this issue is open.

    We approximate by searching open PRs whose head branch starts with the
    issue number (the loop names branches ``feat/<n>-<slug>``) or whose body
    contains ``#<n>``. Cheap and good enough to prevent double-picking.
    """
    try:
        prs = gh_json(
            ["gh", "pr", "list", "--state", "open", "--json",
             "number,headRefName,body"] + repo_args
        )
    except (subprocess.CalledProcessError, json.JSONDecodeError):
        return False
    needle_branch = re.compile(rf"^(feat|fix|chore)/{issue_number}-")
    needle_body = re.compile(rf"#{issue_number}\b")
    for pr in prs:
        if needle_branch.match(pr.get("headRefName", "")):
            return True
        if needle_body.search(pr.get("body") or ""):
            return True
    return False


def phase0_in_progress(issues: list[dict], repo_args: list[str]) -> bool:
    """True if any Phase 0 build issue is already being worked (guards P0 serial)."""
    for issue in issues:
        if phase_of(issue) != 0 or not is_build(issue):
            continue
        if issue.get("assignees"):
            return True
        if has_open_pr(issue["number"], repo_args):
            return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", help="owner/name (defaults to the cwd repo)")
    args = parser.parse_args()
    repo_args = ["--repo", args.repo] if args.repo else []

    try:
        open_issues = gh_json(
            ["gh", "issue", "list", "--state", "open", "--limit", "300",
             "--json", "number,title,labels,milestone,body,assignees"] + repo_args
        )
    except subprocess.CalledProcessError as exc:
        print(exc.stderr or "gh issue list failed", file=sys.stderr)
        return EXIT_ERROR
    except json.JSONDecodeError as exc:
        print(f"could not parse gh output: {exc}", file=sys.stderr)
        return EXIT_ERROR

    # Which phases still have an open epic? A phase is "open" while its epic
    # is open; we must not start phase N while phase N-1's epic is open.
    open_epic_phases = {
        phase_of(i) for i in open_issues if is_epic(i) and phase_of(i) is not None
    }
    earliest_open_phase = min(open_epic_phases) if open_epic_phases else None

    ready = [
        i for i in open_issues
        if is_build(i) and "status:ready" in label_names(i)
    ]
    if not ready:
        return EXIT_NONE_READY

    # Restrict to the earliest phase that still has an open epic, honoring the
    # "never start a new phase until the previous phase's epic is closed" rule.
    if earliest_open_phase is not None:
        ready = [i for i in ready if (phase_of(i) or 0) <= earliest_open_phase]
    if not ready:
        return EXIT_NONE_READY

    ready.sort(key=lambda i: ((phase_of(i) if phase_of(i) is not None else 99), i["number"]))
    chosen = ready[0]

    # Phase 0 strictly sequential: skip if any P0 work is already in flight.
    if phase_of(chosen) == 0 and phase0_in_progress(open_issues, repo_args):
        return EXIT_NONE_READY

    labels = sorted(label_names(chosen))
    print(json.dumps({
        "number": chosen["number"],
        "title": chosen["title"],
        "slug": slug_of(chosen),
        "phase": phase_of(chosen),
        "area": area_of(chosen),
        "size": size_of(chosen),
        "labels": labels,
        "gate_human": "gate:human" in labels,
        "parallel_safe": "parallel-safe" in labels,
        "deps": deps_of(chosen),
    }, indent=2))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
