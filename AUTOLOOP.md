# AUTOLOOP.md — Autonomous Build Loop Runbook

**Read this first, then run the loop.** This is the single entrypoint for driving
Resume.World's GitHub-issue backlog autonomously. It is self-contained: everything a fresh
Fable session needs to start building is here or linked from here.

- **Authority:** this file governs *the loop*. `CLAUDE.md` governs *per-issue craft* (the
  build loop steps, the two hard invariants, conventions). `/docs/01-Vision.md` wins any
  spec conflict.
- **Who runs this:** a **Fable** session (interactive or the scheduled cloud routine). The
  session that *authored* this harness does not run the loop.

---

## The autonomy override (important)

This loop runs at **maximum autonomy**: it **self-merges every issue**, including issues
labelled `gate:human` and all of Phase 0. This **supersedes** `CLAUDE.md`'s merge policy,
which requires human review for those. The safety net is not a human — it is the
**CI-green-before-merge** gate plus the guardrails below. Everything else in `CLAUDE.md`
(the invariants, determinism, scope discipline, "don't invent work") still fully applies.

Accepted risk: **#6 (repo scaffold / stack choice)** and **#7 (CI itself)** merge before any
CI exists. That is why step 2 below (a supervised trial on #6) is strongly recommended
before you enable the cron routine.

---

## The pieces

| File | Role |
|------|------|
| `.claude/commands/next-issue.md` | `/next-issue` — builds exactly one issue end-to-end |
| `scripts/next_issue.py` | Picks the next issue to build (read-only). Exit 3 = backlog drained |
| `scripts/refresh_status.py` | Flips `status:blocked`→`status:ready` when deps close; closes finished epics |
| `.claude/settings.json` | Committed command allowlist so runs don't stall on prompts |

Work selection and unblocking are deterministic and live in the two Python scripts, so both
interactive and cron runs behave identically. `/next-issue` is the per-issue driver.

---

## How to run the loop

### Option A — interactive, in a Fable session
```
/loop /next-issue
```
`/loop` re-invokes `/next-issue` each iteration; each iteration builds one issue and stops,
so the loop advances one issue at a time. It ends cleanly when `next_issue.py` exits 3
(backlog drained). Watch it; interrupt anytime with Ctrl-C. Best for building confidence.

### Option B — scheduled cloud routine (hands-off)
Create a scheduled cloud agent (use the `schedule` skill / CronCreate) with **cadence every
3 hours** and this prompt:

> Run the Resume.World autonomous build loop. Repeatedly invoke `/next-issue` until one of:
> (a) `python3 scripts/next_issue.py` exits 3 (backlog drained), (b) you have completed a
> per-run cap of **K = 3 issues**, or (c) a guardrail trips (see AUTOLOOP.md). Then exit and
> post a one-paragraph summary (issues merged, PRs opened, anything sent to `needs-human`).

Cron re-firing is what drains the rest of the frontier and retries transient failures across
runs. Raise K or shorten the cadence once you trust it.

---

## Bootstrapping order (do these in sequence)

1. **Commit this harness.** One `chore: autonomous loop harness` commit on `main` adding
   `scripts/`, `.claude/`, and `AUTOLOOP.md`. This is the repo's first commit; the existing
   `docs/`, `CLAUDE.md`, and `bootstrap_issues.py` become the base. Do **not** fold in #6's
   deliverables (`.gitignore`, PR template, `CODEOWNERS`, moving specs) — those belong to
   issue #6's own PR.
2. **Supervised trial on #6.** Run `/next-issue` once, by hand, and watch the whole loop:
   select → branch → build → PR → self-review → self-merge. Confirm `refresh_status.py`
   flips **#7** to `status:ready` afterward. No CI exists yet, so the gate here is the local
   build/test the scaffold defines.
3. **Append stack commands to `.claude/settings.json`.** Using the runner #6 chose (e.g.
   `Bash(pnpm run *)`), so later unattended runs don't stall on permission prompts.
4. **Enable the cron routine** (Option B). From #7 onward, real CI gates every merge and the
   loop is genuinely hands-off.

---

## Guardrails (load-bearing — the human checkpoints are gone)

- **CI-green-before-merge is absolute.** Once `.github/workflows/` exists (after #7), merge a
  PR only when required checks pass. Red checks → never merge; comment, add `status:blocked`
  + `needs-human`, move on.
- **One reviewable PR per issue.** If a change outgrows one PR, stop, open a follow-up issue
  describing the split, don't force a mega-merge.
- **Failure budget.** An issue whose gate fails after **2 attempts** gets `needs-human` + a
  diagnostic comment and is skipped. **3 consecutive** failed issues → halt the routine and
  notify the user.
- **No parallel Phase 0** — enforced by `next_issue.py`; never override.
- **Enforce the invariants every iteration** — the no-career-literals check (grep-based until
  #7's real check exists) and event-bus-only System communication, before any merge.
- **Never re-pick** an issue that already has an open PR (anti-loop / idempotency).
- **Per-run cap** (K issues) so a bad run can't drain the whole backlog unattended.

---

## Quick reference

```bash
python3 scripts/next_issue.py            # → JSON of next issue, or exit 3 if none ready
python3 scripts/refresh_status.py        # unblock dependents after a merge
python3 scripts/refresh_status.py --dry-run   # preview flips without mutating
```
