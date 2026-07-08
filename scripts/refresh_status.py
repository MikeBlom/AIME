#!/usr/bin/env python3
"""Re-evaluate issue dependencies and unblock anything now eligible.

This is the ``scripts/refresh_status.py`` that CLAUDE.md (the build loop,
step 8 "Unblock") refers to. Run it after every merge — it is idempotent and
safe to run repeatedly.

For every open ``type:build`` issue labelled ``status:blocked`` it parses the
``Depends on: #N, #M`` line from the body; if EVERY referenced dependency is
closed, it flips the label ``status:blocked`` -> ``status:ready``.

It also closes a phase epic once all of that epic's build issues are closed,
which is how ``next_issue.py`` learns the next phase has opened.

Dependency edges and the ``phase:N`` label convention come from
``bootstrap_issues.py``. Use ``--dry-run`` to preview without mutating.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys

DEPENDS_RE = re.compile(r"Depends on:\s*(.+)", re.IGNORECASE)
ISSUE_REF_RE = re.compile(r"#(\d+)")


def gh_json(args: list[str]) -> object:
    result = subprocess.run(args, capture_output=True, text=True, check=True)
    return json.loads(result.stdout or "[]")


def gh_run(args: list[str], dry_run: bool) -> None:
    if dry_run:
        print("  DRY-RUN would run:", " ".join(args))
        return
    subprocess.run(args, capture_output=True, text=True, check=True)


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


def deps_of(issue: dict) -> list[int]:
    body = issue.get("body") or ""
    for line in body.splitlines():
        m = DEPENDS_RE.search(line)
        if m:
            return [int(n) for n in ISSUE_REF_RE.findall(m.group(1))]
    return []


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", help="owner/name (defaults to the cwd repo)")
    parser.add_argument("--dry-run", action="store_true",
                        help="print intended changes without mutating GitHub")
    args = parser.parse_args()
    repo_args = ["--repo", args.repo] if args.repo else []

    try:
        all_issues = gh_json(
            ["gh", "issue", "list", "--state", "all", "--limit", "400",
             "--json", "number,title,state,labels,body"] + repo_args
        )
    except subprocess.CalledProcessError as exc:
        print(exc.stderr or "gh issue list failed", file=sys.stderr)
        return 1
    except json.JSONDecodeError as exc:
        print(f"could not parse gh output: {exc}", file=sys.stderr)
        return 1

    state_by_number = {i["number"]: i["state"].upper() for i in all_issues}

    flipped: list[int] = []
    still_blocked: list[int] = []
    for issue in all_issues:
        if issue["state"].upper() != "OPEN":
            continue
        labels = label_names(issue)
        if "type:build" not in labels or "status:blocked" not in labels:
            continue
        deps = deps_of(issue)
        unmet = [d for d in deps if state_by_number.get(d, "OPEN") != "CLOSED"]
        if unmet:
            still_blocked.append(issue["number"])
            continue
        print(f"unblock #{issue['number']}: {issue['title']} (deps {deps} all closed)")
        gh_run(
            ["gh", "issue", "edit", str(issue["number"]),
             "--add-label", "status:ready",
             "--remove-label", "status:blocked"] + repo_args,
            args.dry_run,
        )
        flipped.append(issue["number"])

    # Close phase epics whose every build child is closed.
    closed_epics: list[int] = []
    for issue in all_issues:
        if issue["state"].upper() != "OPEN":
            continue
        if "type:epic" not in label_names(issue):
            continue
        phase = phase_of(issue)
        if phase is None:
            continue
        children = [
            i for i in all_issues
            if "type:build" in label_names(i) and phase_of(i) == phase
        ]
        if children and all(c["state"].upper() == "CLOSED" for c in children):
            print(f"close epic #{issue['number']}: all Phase {phase} build issues closed")
            gh_run(
                ["gh", "issue", "close", str(issue["number"]),
                 "--comment", f"All Phase {phase} build issues closed."] + repo_args,
                args.dry_run,
            )
            closed_epics.append(issue["number"])

    print(
        f"\nsummary: flipped {len(flipped)} to ready {flipped or ''}; "
        f"{len(still_blocked)} still blocked; closed {len(closed_epics)} epics {closed_epics or ''}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
