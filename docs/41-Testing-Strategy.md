# Resume.World — Testing Strategy

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** TEST

---

## Purpose

This document specifies the safety net that makes autonomous, auto-merged development trustworthy: what kinds of tests the repository carries, what each layer is responsible for catching, and which gates CI enforces before any change reaches `main`.

## Overview

The strategy is a pyramid with two invariant nets wrapped around it:

- **Unit tests** live next to what they test (`src/**/*.test.ts` for engine code, `scripts/**/*.test.mjs` for tooling) and prove each System, service, and script in isolation.
- **Integration tests** boot the real composition root (`bootWorld`) on the headless platform adapter and drive it frame by frame: the boot suite, the reference-pack arc suite, and the pack-swap suite.
- **Determinism/replay tests** record a live session (initial RNG state plus each frame's elapsed time and input snapshot) and replay it into a freshly booted world, requiring the identical final state. `replay.test.ts` proves the movement/render path on desktop and mobile viewports; `replay-arc.test.ts` proves it across the integrated stack — NPC interaction, dialogue, quests, restorations, progression, achievements, analytics, and autosave — driven by input alone.
- **The end-to-end smoke path** (`smoke.test.ts`) is the shortest full slice of the real experience: boot the shipped pack, walk to a character, resolve a quest through dialogue, and watch the first restoration, autosave, and render output land inside one simulated minute. If it fails, a visitor's first minute is broken and nothing else matters.
- **The content-invariant net** (`content-invariants.test.mjs` plus the standalone checkers) asserts the engine/content seam on every run: zero career literals anywhere in engine source, and every shipped Content Pack validating whole through the real pipeline.
- **Coverage gates** hold the net at its current strength: `vitest run --coverage` enforces minimum thresholds over `src/**`, so a change that lands untested code below the bar fails locally and in CI alike.

Everything CI runs is one command — `npm run check` — so green locally means green in CI (docs/40).

## Goals

- A regression in any System, in determinism, or in the engine/content seam is caught by CI before merge, without human review in the loop.
- Tests exercise the real artifacts: the shipped packs, the real composition root, the real schemas — fixtures prove tools, real-tree suites prove the product.
- The whole gate stays fast enough to run on every change (seconds, not minutes, for the test suite).

## Non-Goals

- Exhaustive fuzzing and property-based testing (explicitly future work in issue #43).
- Visual/pixel-diff testing of rendered output; the render command stream is asserted as data instead.
- Real-browser end-to-end automation; the platform seam (docs/02, NFR-ARCH-004) is the tested boundary and the browser adapter stays thin.

## User Stories

- *As the autonomous build loop,* I need a gate strict enough that a green run is sufficient evidence to self-merge.
- *As an engine developer,* when I break determinism with a stray wall-clock read or unseeded random, I want a replay test to fail loudly the same day.
- *As a content author,* when my pack references a missing region or drops a locale key, I want validation to fail in CI with an actionable diagnostic, before any visitor sees it.
- *As the creator,* if my name ever leaks into engine code, I want the build to refuse to ship it.

## Functional Requirements

- **FR-TEST-001** — The repository MUST carry unit tests colocated with engine source and tooling, runnable by a single command.
- **FR-TEST-002** — Integration suites MUST boot the real composition root on the headless platform and drive it through scripted frames; they MUST NOT stub Systems or bypass the event bus.
- **FR-TEST-003** — A determinism suite MUST record a live session and replay it into a fresh world, requiring the identical final state — including world components, RNG state, the event log, and the render command stream.
- **FR-TEST-004** — The determinism suite MUST cover the integrated stack: a recorded session resolving quests through NPC dialogue, with progression, achievements, analytics, and autosave all compared (issue #43 AC1).
- **FR-TEST-005** — An end-to-end smoke test MUST drive boot-to-first-restoration through player input alone, inside one simulated minute, with zero System faults (FR-VIS-008).
- **FR-TEST-006** — A content-invariant test MUST assert, against the real repository on every test run, that engine source holds zero career literals (DATA-FR-027) and that every shipped Content Pack validates with zero diagnostics (DATA-FR-013).
- **FR-TEST-007** — The test command MUST enforce minimum coverage thresholds over engine source; a change dropping below them fails the run (issue #43 AC2).
- **FR-TEST-008** — CI MUST run the full gate — build, tests with coverage, lint, format, schema validation, the career-literals check, and the host-coupling check — on every pull request, and merges are permitted only when all of it is green.

## Non-Functional Requirements

- **NFR-TEST-001** — The unit-plus-integration suite SHOULD complete in under a minute on developer hardware; the smoke path alone in under a second.
- **NFR-TEST-002** — Tests MUST be deterministic: fixed seeds, scripted timers, no wall-clock or network dependence — flaky tests are treated as failures of this document.
- **NFR-TEST-003** — Coverage thresholds are a ratchet: they MAY be raised as coverage grows and MUST NOT be lowered to admit a change.

## Acceptance Criteria

- Replay reproduces identical state across the integrated systems (`replay-arc.test.ts` passes).
- Coverage thresholds and the content-invariant test are enforced in CI: lowering coverage below the thresholds, seeding a career literal in `src/`, or corrupting a shipped pack each turn CI red.
- The smoke path passes on the shipped pack from a cold boot.

## Dependencies

- `docs/01-Vision.md` — the short-visit bar (FR-VIS-008) the smoke path enforces.
- `docs/02-System-Architecture.md` — determinism and replay requirements (FR-ARCH-025, NFR-ARCH-001/002), fault isolation.
- `docs/03-Data-Model-and-Content-Pipeline.md` — validation and the engine/content seam (DATA-FR-013/027).
- `docs/40-Developer-Experience.md` — the `npm run check` gate and branch-protection notes CI builds on.

## Implementation Notes

- Coverage uses the V8 provider over `src/**` with thresholds set a few points below measured reality (statements 85, branches 80, functions 85, lines 87 at adoption) so the gate binds without being brittle; ratchet upward as the tail is covered.
- `npm run test` runs with coverage so the local gate and CI enforce identical thresholds; `npm run test:fast` skips instrumentation for tight loops.
- The replay-arc route is empirically scripted against the shipped pack's deterministic NPC motion (patrol deadlocks included); if pack layout changes, re-derive the route rather than weakening the final-state comparison.
- Checker tools are themselves unit-tested on fixtures (temp trees, synthetic packs) so a checker that silently breaks cannot hollow out the net.

## Edge Cases

- A pack added under `content/` is picked up by discovery automatically; an empty discovery result fails the invariant test rather than passing vacuously.
- A System fault during any driven suite surfaces through the loop's bounded fault log; suites assert zero faults so isolation cannot hide a regression.
- Replay comparison serializes event payloads to JSON first, so payload object identity differences cannot mask or fake divergence.

## Risks

- **Threshold theater.** Coverage numbers can be gamed with shallow tests. Mitigation: the load-bearing suites are behavioral (replay, smoke, invariants); thresholds only hold the floor.
- **Route brittleness.** The replay-arc input script depends on pack geometry. Mitigation: the script asserts the arc actually happened (quests completed, regions restored) before comparing, so drift fails loudly and locally.
- **Gate drift.** CI and local commands could diverge. Mitigation: CI jobs wrap `npm run check`'s parts verbatim (docs/40).

## Open Questions

- **OQ-TEST-1:** When the mini-game catalog grows, whether the smoke path should rotate through mechanics or stay on the dialogue route (owner: whoever lands the next mechanic).

## Future Considerations

- Property-based/fuzz testing over content validation and the event bus.
- A replay-corpus regression suite: recorded sessions checked in and replayed against every engine change.
- Perf smoke (docs/33) and visual regression as separate, later gates.

## Version / Author

Version 1.0 — Mike Blom.
