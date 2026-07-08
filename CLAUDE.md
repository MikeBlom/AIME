# Resume.World — Operating Protocol for Claude Code

**Audience:** the Claude Code CLI agent (Fable) building this repository.
**Authority:** this file governs *how* you work. The specs in `/docs` govern *what* you build. When they conflict, `/docs/01-Vision.md` wins and you open an issue to fix the discrepancy.

---

## What this project is

Resume.World is a data-driven game engine plus a swappable content pack. The software itself is an engineering resume: visitors explore a living world and restore offline systems, learning about the creator through gameplay rather than text. Read `/docs/00-README.md` first, then `01-Vision.md`, `02-System-Architecture.md`, `03-Data-Model-and-Content-Pipeline.md`. These four documents are the contracts every issue honors.

## The two hard invariants

1. **Engine holds zero career facts.** All career/world specifics live in the content pack as JSON + assets. Never hardcode a name, job, metaphor, or string into engine code. CI enforces a "no career literals" check.
2. **Composition and events, not coupling.** Systems talk through the event bus and shared world state, never by direct reference. Data is data; behavior is code; they never mix.

## How you pick work

Work is GitHub issues, grouped into five phase milestones and organized by a dependency graph. Each issue lists `Depends on:` other issues.

- An issue is **ready** when every issue it depends on is closed. Ready issues carry the `status:ready` label; blocked ones carry `status:blocked`.
- Always take the lowest-numbered `status:ready` issue in the earliest open phase, unless told otherwise.
- **Phase 0 (Foundations) is strictly sequential.** Take one issue, finish it, get it merged, then take the next. Do not open parallel Phase 0 work.
- **Phases 1–4 fan out.** Within a phase you may work issues in parallel *only* when they are both ready and their `area:` labels indicate disjoint file ownership. Never start a new phase until the previous phase's epic issue is closed.

Do not invent work. If something seems missing, open a new issue describing it rather than silently expanding an existing one.

## The build loop (per issue)

1. **Claim.** Assign yourself, move the issue to in-progress, read it and every `/docs` file it references by requirement ID.
2. **Branch.** Create `feat/<issue-number>-<slug>` from the default branch.
3. **Implement.** Build only what the issue's Deliverables and Interface Contract require. Honor the two invariants. Keep the change scoped to one PR; if it is growing past one reviewable PR, stop and split the issue.
4. **Test.** Write tests as specified in the issue's Acceptance Criteria. Run the full CI gate locally: build, unit tests, lint/format, schema validation, and the "no career literals" check. Everything must be green.
5. **Open PR.** Title `<issue-number>: <title>`, body includes `Closes #<issue-number>` and a checklist mapping each Acceptance Criterion to where it is satisfied.
6. **Self-review.** Re-read your own diff against the issue's Acceptance Criteria and Definition of Done. For any issue touching engine boundaries, input handling, content loading, or persistence, run a security-review pass. Fix what you find before proceeding.
7. **Merge policy.**
   - **Phase 0 issues and any issue labeled `gate:human`:** request human review and wait. Do not self-merge.
   - **All other issues:** if CI is green and self-review is clean, squash-merge your own PR and let it close the issue.
8. **Unblock.** After merge, for every issue that depended on the one you just closed, if all of *its* dependencies are now closed, flip `status:blocked` to `status:ready`. (Run `scripts/refresh_status.py` if present.)

## Definition of Done (applies to every issue)

- All Acceptance Criteria in the issue are demonstrably met, each covered by a test where testable.
- CI is green: build, unit tests, lint/format, JSON schema validation, and the "no career literals in engine" check.
- No career-specific literals in engine code; any new player-visible text is a locale key, not an inline string.
- New Systems honor the System interface and lifecycle in `/docs/02-System-Architecture.md` and communicate only via the event bus and shared world state.
- Determinism preserved: no direct wall-clock or unseeded randomness in simulation code; use the Core time/RNG services.
- The PR description maps every Acceptance Criterion to its implementation and tests.

## Conventions

- **Branches:** `feat/<n>-<slug>`, `fix/<n>-<slug>`, `chore/<n>-<slug>`.
- **Commits:** imperative, reference the issue (`#<n>`).
- **Specs live in `/docs`.** If an issue asks you to author a system spec (e.g., `docs/20-Quest-Engine.md`), write it before or alongside the code, following the section skeleton in `/docs/00-README.md`.
- **Stack:** the specs are stack-agnostic. The stack is fixed by the Phase 0 `repo-scaffold` issue; once set, do not change it without an issue and human approval.

## When you are unsure

Ask, in this order of preference: (1) check `/docs` for a requirement ID that answers it; (2) if the answer is a genuine product decision, open an issue tagged `question` and leave the current issue blocked on it rather than guessing; (3) never resolve ambiguity by inventing a feature. The test from the Vision applies: if it does not make the experience more delightful, the architecture cleaner, or the engineering more clearly excellent, remove it.

---

**Version 1.0 — Mike Blom.**
