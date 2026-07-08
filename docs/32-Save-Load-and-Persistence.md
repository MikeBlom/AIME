# Resume.World — Save/Load and Persistence

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** SAVE

---

## Purpose

This document specifies the Save/Load System: how a visitor's progression persists across sessions through the Platform Adapter's storage interface, realizing FR-ARCH-016 (progression-relevant world state round-trips without loss) while keeping the engine/content seam intact — saves carry mutable world state only, never content.

## Overview

A save is a small, versioned **envelope**: the pack's identity plus a set of progression **slices** — declared component types captured as `(entityId, value)` pairs straight from the entity store. Nothing else. The content graph (documents, strings, asset manifests) is never serialized; it reloads from the pack on every boot. Because world spawn is deterministic (DATA-FR-017) and entity ids are stable and serializable (FR-ARCH-001), a resumed session simply re-spawns from the same pack and overlays the saved slice values onto the same entity ids.

Persistence has two faces. **Autosave** is a System like any other: it subscribes to key gameplay events (region entry, coming to rest) and writes a save on its next update — no other System calls it (FR-ARCH-005). **Resume** is composition-root work: after boot starts and Systems have initialized their owned slices, the stored envelope is read, validated structurally, checked against the running pack, migrated forward through registered hooks, and applied — atomically in effect: any failure at any stage leaves the fresh spawn untouched and the world starts cleanly (FR-ARCH-030's spirit).

## Goals

- Round-trip progression exactly: a saved session restores to an identical, playable state.
- Serialize only mutable world state; the content pack remains the single source of content truth.
- Make the save format versioned and forward-migratable so old saves survive engine evolution.
- Autosave on meaningful moments so a visitor never manages saves (no save menus — Vision Non-Goals).
- Treat every stored byte as untrusted input: corrupt, foreign, or future saves are rejected whole.
- Keep all host storage access behind the Platform Adapter (NFR-ARCH-004).

## Non-Goals

- Cloud sync, accounts, or cross-device saves — out of scope for v1.
- Multiple save slots and a load UI; the v1 experience is one implicit slot per pack.
- Serializing core service counters (frame/step totals) — a resumed session is a new Session that continues the same progression, not a frame-exact suspend.
- Replay recordings (`RuntimeLoop` record/replay is a separate testing facility).

## User Stories

- *As a returning visitor,* the world remembers where I was and what I restored, without me touching a save button.
- *As a visitor whose browser cleared storage,* the world starts fresh and never shows an error.
- *As a content author,* shipping a new pack version never half-applies an old save to my new world.
- *As an engine developer,* I add a new progression slice by adding its component type to one declared list.
- *As a tester,* I can capture, inspect, and apply saves as plain JSON through pure functions.

## Functional Requirements

- **FR-SAVE-001** A save MUST contain only: a format tag, a format version, the pack identity (id and version), and the declared progression slices as `(entityId, value)` pairs. The content graph MUST NOT be serialized.
- **FR-SAVE-002** The progression slice set MUST be declared data (a list of component types), extensible without touching the System's logic.
- **FR-SAVE-003** Saving MUST capture values through the entity store's public query API and write through the Platform Adapter's storage interface only (NFR-ARCH-004).
- **FR-SAVE-004** The Autosave System MUST write a save on the update following a subscribed key gameplay event (region entry and movement rest by default; the trigger list is data) and MUST announce each written save as a deferred event (FR-ARCH-012/013).
- **FR-SAVE-005** Resume MUST validate the stored envelope structurally and reject it whole on any mismatch — wrong format tag, malformed slices, non-integer entity ids — never applying a partial save (FR-ARCH-030's spirit).
- **FR-SAVE-006** Resume MUST refuse a save whose pack id or pack version differs from the running pack; a different world's save is never applied.
- **FR-SAVE-007** The envelope MUST carry a format version; saves older than the current version MUST be lifted through registered per-version migration hooks, and a save with no unbroken migration path — including one from a newer engine — MUST be rejected rather than guessed at.
- **FR-SAVE-008** Applying a save MUST only write whitelisted slice types onto entities that exist, skipping unknown slice ids and vanished entity ids without faulting (FR-ARCH-008).
- **FR-SAVE-009** Resume MUST apply after Systems have initialized their owned world-state slices, so System-owned progression (e.g. audio settings) lands on the live slice entities.
- **FR-SAVE-010** A host without storage, or with empty storage, MUST degrade to a fresh start with no fault and no user-facing error (FR-ARCH-008).

## Non-Functional Requirements

- **NFR-SAVE-001 (Integrity):** Stored bytes are untrusted input: parsing is exception-safe, validation is strict, and application is whitelist-only. A hostile or corrupted save can at worst cause a fresh start.
- **NFR-SAVE-002 (Determinism):** Capture reads world state only; identical world state serializes to identical bytes (NFR-ARCH-001). Storage writes never feed back into simulation.
- **NFR-SAVE-003 (Size):** A save is proportional to mutable progression state — kilobytes, not the world; it never grows with content size.
- **NFR-SAVE-004 (Testability):** Capture, parse, migrate, and apply are pure functions testable without a loop; the round trip is testable end to end on the headless platform (NFR-ARCH-002).

## Acceptance Criteria

- Boot → play → autosave → boot again with resume: every progression slice equals the saved session's, and the world remains playable (FR-ARCH-016 round trip).
- The stored envelope contains only whitelisted slice ids — no strings, no manifest, no document content (FR-SAVE-001).
- Corrupt JSON, wrong format tags, malformed rows, foreign packs, and future versions each leave the fresh spawn untouched (FR-SAVE-005..007).
- A registered migration lifts an older envelope to the current version; a missing hop rejects it (FR-SAVE-007).
- The Autosave System saves exactly on its subscribed events and stops after teardown (FR-SAVE-004).

## Dependencies

- `02-System-Architecture.md` — FR-ARCH-001 (serializable ids), FR-ARCH-015/016 (slice ownership, serializable progression), FR-ARCH-030 (atomic rejection).
- `03-Data-Model-and-Content-Pipeline.md` — deterministic spawn (DATA-FR-017) is what lets saves reference entity ids.
- The Platform Adapter's `KeyValueStorage` (issue #14).
- Downstream: Quest/Progression and Achievements Systems add their slices to the declared list as they land.

## Implementation Notes (non-normative)

- The default slice list today is position, motion, region live state, camera, and audio settings — the mutable world state that exists in Phase 1. Gameplay Systems that own future progression (quests, inventory, achievements) extend the list, not the format.
- Deterministic spawn makes id-overlay safe *within one pack version*; the pack-version check (FR-SAVE-006) is what keeps it safe across content changes. If future packs want save continuity across versions, that arrives as a migration concern, not by weakening the check.
- The envelope's `slices` map is keyed by component-type id strings, so a save is human-readable JSON — useful for debugging and for the observability doc's inspection story.
- `JSON.parse` produces plain data; values are applied only through `addComponent` onto whitelisted types, so stored bytes can never smuggle functions or reach host APIs.

## Edge Cases

- **Storage quota exhausted or write fails:** the adapter's storage degrades internally; a failed write costs at most the latest autosave, never the session.
- **Two tabs on the same world:** last write wins on the single slot; no corruption is possible because saves are whole-envelope writes.
- **A save from a renamed component type:** its slice id no longer matches the whitelist and is skipped; the rest of the save still applies (FR-SAVE-008) — add a migration when renames must preserve data.
- **An entity present in the save but absent after spawn** (content shrank within the same pack version — unusual): the row is skipped, never a fault.
- **Empty storage on first visit:** resume returns false, the fresh spawn stands (FR-SAVE-010).

## Risks

- **Slice drift.** A System adds progression state but forgets to declare the slice; saves silently miss it. Mitigation: the round-trip test compares every declared slice on a booted world, and code review treats "new owned slice" as "update the list".
- **Schema-less values.** Slice values are trusted to match their component shape once the envelope validates structurally; a hand-edited save could carry odd values. Mitigation today: consumers already tolerate malformed component data defensively; a per-slice value validator is the escalation path (OQ-SAVE-1).
- **Autosave storms.** Rest-triggered saves are frequent. Mitigation: saves are tiny and writes are cheap; a debounce arrives with profiling evidence (`33-Performance-Budgets.md`), not speculation.

## Open Questions

- **OQ-SAVE-1:** Whether slice values should validate against per-component schemas on load (beyond structural envelope checks), decided when hand-editable saves or cross-version continuity matter.
- **OQ-SAVE-2:** Whether RNG state joins the envelope so random-driven ambient content continues seamlessly across sessions — decided when a System actually consumes the RNG service.
- **OQ-SAVE-3:** Multiple named slots and a continue/new-game affordance — owned by `19-Onboarding-and-First-Session.md` if the experience ever wants it.

## Future Considerations

- Cloud persistence as a Platform Adapter storage backend — no System change by construction (NFR-ARCH-004).
- Save export/import (a shareable world state) building on the same envelope.
- Compression if profiling ever shows saves growing beyond trivial size.

## Version / Author

Version 1.0 — Mike Blom.
