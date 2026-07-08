> **Phase:** 2 - **Area:** `quest` - **Size:** L - **Parallel-safe:** yes

## Context
Restoration is the core narrative act (Vision FR-VIS-004). Data-driven from quest content in `docs/03`. Author `docs/20-Quest-Engine.md`.

Read `docs/00-README.md`, `docs/01-Vision.md`, `docs/02-System-Architecture.md`, and `docs/03-Data-Model-and-Content-Pipeline.md` before starting. Follow the build loop in `CLAUDE.md`.

## Deliverables
- Quest state machine driven by content: objectives, completion, bypass path (FR-VIS-010).
- Emits `SystemRestored` and applies world effects (region offline -> online) on completion.
- Progress tracking persisted via save/load.
- `docs/20-Quest-Engine.md`.

## Interface contract
Loads quests from the content graph; subscribes to gameplay events to advance objectives; emits restoration events.

## Acceptance criteria
- [ ] Completing a quest transitions its region to online and emits `SystemRestored`.
- [ ] The bypass path reveals the career meaning without solving the puzzle (FR-VIS-010).
- [ ] Quest progress survives save/load.

## Dependencies
Depends on: #103, #106, #109

## Out of scope
Specific quest content (Phase 3); mini-game mechanics (host issue).

## Definition of Done
- [ ] Every Acceptance Criterion above is met and covered by a test where testable.
- [ ] CI green: build, unit tests, lint/format, JSON schema validation, and the "no career literals in engine" check.
- [ ] No career-specific literals in engine code; new player-visible text is a locale key, not an inline string.
- [ ] New Systems honor the System interface/lifecycle in `docs/02-System-Architecture.md` and communicate only via the event bus and shared world state.
- [ ] Determinism preserved: no direct wall-clock or unseeded randomness in simulation code.
- [ ] PR body maps each Acceptance Criterion to its implementation and tests, and includes `Closes #<this-issue>`.

