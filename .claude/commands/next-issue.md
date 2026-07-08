---
description: Build one GitHub issue end-to-end — the per-issue autonomous build loop for Resume.World.
---

# /next-issue — one full build-loop iteration

You are running the Resume.World autonomous build loop. Execute **exactly one** issue,
start to finish, then stop. `AUTOLOOP.md` (repo root) is the authority; `CLAUDE.md` holds
the per-issue craft rules and the two hard invariants. Read both if you have not this session.

> **Autonomy override:** this loop self-merges **every** issue, including `gate:human` and
> Phase 0, superseding `CLAUDE.md`'s "request human review and wait" merge policy. Merge only
> when the gate below is green.

## Steps

1. **Select work.**
   - Run `python3 scripts/refresh_status.py` to unblock anything newly eligible.
   - Run `python3 scripts/next_issue.py`.
   - **Exit code 3** (no output) → the backlog is drained. Report "backlog drained" and STOP.
   - Otherwise parse the JSON: `number`, `slug`, `phase`, `area`, `size`, `deps`,
     `gate_human`, `parallel_safe`.

2. **Claim.** `gh issue edit <n> --add-assignee @me`, comment that you are starting, and read
   the full issue body plus **every `/docs` file it cites by requirement ID**. Do not skim.

3. **Branch.** `git switch -c feat/<n>-<slug>` from an up-to-date `main`.

4. **Implement** only the issue's **Deliverables** and **Interface Contract** — nothing more.
   Honor the two invariants without exception:
   - *Engine holds zero career facts.* No name/job/metaphor/string literals in engine code;
     player-visible text is a locale key, never an inline string.
   - *Composition and events, not coupling.* New Systems use the System lifecycle and talk
     only through the event bus and shared world state.
   Preserve determinism: no wall-clock or unseeded randomness in simulation code.

5. **Test + local gate — must be fully green before proceeding.** Run every gate that exists:
   build, unit tests, lint/format, JSON schema validation, and the **no-career-literals**
   check. Until issue #7 lands the real check, approximate it with a grep for career/creator
   literals in the engine layer. If the gate is red after **2 attempts**, add label
   `needs-human` + a diagnostic comment on the issue, leave the branch/PR as-is, and STOP.

6. **Open PR.** `gh pr create` with title `<n>: <title>` and a body containing `Closes #<n>`
   plus a checklist mapping **each Acceptance Criterion** to where it is satisfied.

7. **Self-review.** Re-read your own diff against the Acceptance Criteria and Definition of
   Done. For any issue touching **engine boundaries, input handling, content loading, or
   persistence**, run a security-review pass. Fix findings before merging.

8. **Gate + merge.**
   - If `.github/workflows/` exists, wait for required checks and merge **only when green**.
     Red checks → never merge: comment, add `status:blocked` + `needs-human`, STOP.
   - If no CI exists yet (only true for #6 and #7), the local gate from step 5 is the gate.
   - `gh pr merge <n> --squash --delete-branch`.

9. **Unblock + finish.** Run `python3 scripts/refresh_status.py` so dependents flip to
   `status:ready`. Report the issue number, PR link, and merge result. STOP — the loop
   driver (or the cron routine) decides whether to invoke `/next-issue` again.

## Guardrails (do not violate)

- **One reviewable PR per issue.** If the change outgrows a single PR, STOP, open a follow-up
  issue describing the split, and do not force a mega-merge.
- **Never re-pick** an issue that already has an open PR.
- **No parallel Phase 0** — `next_issue.py` enforces this; do not override it.
- **Do not invent work.** If something seems missing, open a new `question`/issue rather than
  silently expanding the current one.
