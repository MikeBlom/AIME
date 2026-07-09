# Resume.World — Inventory and Progression

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** INV

---

## Purpose

This document specifies the progression model: the authoritative world-state record of what the player has restored, which quests they completed, and the capabilities and inventory items those completions granted. Progression is restoration (`01-Vision.md`); this is the ledger of it.

## Overview

The Progression System owns one **progression slice** in world state: four ascending, duplicate-free id lists — restored regions, completed quests, unlocked capabilities, held items. It writes that slice only in response to events the quest engine announces (`system.restored`, `quest.completed`), and nothing else writes it. What a completion *grants* is content: the quest document's `onComplete.grants` block names capability and item ids, so tools and keys are tied to quests as pure data. Consumers — UI, achievements, future gating logic — read the slice or subscribe to the change events; they never ask the System.

## Goals

- One authoritative, serializable record of progression, owned by exactly one System (FR-ARCH-014/015).
- Strictly event-driven mutation, so progression can never drift from what the world actually announced.
- Inventory as content-declared grants: adding a tool or key to the game is a data edit, not code.
- Full persistence: progression survives save/load without loss (FR-ARCH-016).

## Non-Goals

- Economy, currency, crafting, or item consumption (future considerations).
- Deciding what capabilities *do* — gating logic lives with the systems that honor a capability.
- Achievement rules (`27-Achievements.md` consumes this system's events).

## User Stories

- *As a visitor,* the systems I restore stay restored, across the session and across visits.
- *As a visitor,* completing a restoration can hand me a tool or key that later content recognizes, so progress feels earned and cumulative.
- *As a content author,* I declare `onComplete.grants` on a quest document and the engine records the capability or item with no code change.
- *As an engine developer,* I build achievements by subscribing to `progression.changed` and reading one slice, not by asking every gameplay system.

## Functional Requirements

- **FR-INV-001** The Progression System MUST own a single progression slice in world state recording restored region ids, completed quest ids, unlocked capability ids, and held item ids; each list MUST be kept ascending and duplicate-free so the record is canonical.
- **FR-INV-002** The slice MUST be mutated only in response to events (`system.restored`, `quest.completed`); no other System writes the slice, and the Progression System writes no other slice (FR-ARCH-015).
- **FR-INV-003** Capabilities and items MUST come from the completing quest's content (`onComplete.grants` in the `quest` schema), read from the spawned quest definition; the engine holds no capability or item names (DATA-FR-027).
- **FR-INV-004** New grants MUST be announced (`progression.capability-unlocked`, `progression.item-added`) and every slice change summarized on `progression.changed`, the deferred read feed for UI and achievements (FR-ARCH-012).
- **FR-INV-005** The slice MUST serialize with the persisted progression slices and round-trip losslessly across save/load (FR-ARCH-016).
- **FR-INV-006** Repeated announcements MUST be idempotent: a re-announced restoration or completion changes nothing and re-grants nothing.
- **FR-INV-007** The System MUST degrade gracefully (FR-ARCH-008): a completed quest whose definition is not spawned is still recorded (with no grants); a world without a quest engine simply accumulates nothing.

## Non-Functional Requirements

- **NFR-INV-001 (Determinism):** Buffered events apply in arrival order at the fixed step; no wall clock, no randomness (NFR-ARCH-001).
- **NFR-INV-002 (Legibility):** The slice is plain data with grep-able content ids, inspectable in the debug overlay and in saves.

## Acceptance Criteria

- Restoring a system updates progression and persists across save/load (issue #31 AC1): `system.restored` lands in `restored`, and capture → apply reproduces the slice exactly.
- Progression is event-driven; no System writes another's slice directly (issue #31 AC2): the only writer is the Progression System's own event-consuming update, verified end-to-end through the real quest engine.
- A quest with `onComplete.grants` unlocks its capabilities and items exactly once, with unlock events published.
- A quest without grants records only the completion; an unknown quest id records the completion and grants nothing.

## Dependencies

- `20-Quest-Engine.md` — the announcer of `system.restored` and `quest.completed`.
- `03-Data-Model-and-Content-Pipeline.md` — the `quest` schema this document extends with `onComplete.grants`.
- `32-Save-Load-and-Persistence.md` — the persisted slice list this slice joins.
- `27-Achievements.md` (future) — the primary consumer of the change events.

## Implementation Notes (non-normative)

- Sorted-unique lists rather than sets or maps keep the slice JSON-stable: identical progression always serializes to identical bytes, which makes save diffs and replay assertions trivial.
- Grants ride on the spawned QUEST definition (immutable content data) rather than a separate lookup, so the Progression System needs no access to the content graph.
- Capability semantics are deliberately open: a capability id is a fact other systems may honor (e.g., a door that requires `capability.x`); this System only records truth.

## Edge Cases

- **The same quest completes twice** (a replayed event, a hot-reload). `quests` already contains the id: nothing changes, nothing re-grants (FR-INV-006).
- **Two quests grant the same capability.** The second grant is a no-op on the list and publishes no duplicate unlock.
- **A save from a world with grants loads into a pack without them.** The slice is data; it applies as-is. Stale ids are inert facts no system honors.
- **`system.restored` for a region no quest tracks.** Recorded verbatim; the slice trusts the announcer.

## Risks

- **Slice sprawl.** Progression could accrete unrelated state (settings, tutorial flags). Mitigation: the slice records only the four lists; anything else needs its own owner.
- **Grant misuse as scripting.** Content might try to encode behavior in grant ids. Mitigation: grants are inert facts; behavior stays in Systems (NFR-DATA-004).

## Open Questions

- **OQ-INV-1:** Whether items are ever consumed/removed (keys that expire). Deferred until a mechanic needs it; removal events would mirror the add events.
- **OQ-INV-2:** Whether capabilities gate movement/traversal in v1 (e.g., unlocking a region) — decided by the content pack's arc (issue #35).

## Future Considerations

- Item metadata (icons, display names as locale keys) once UI surfaces an inventory screen.
- Consumable items and capability revocation, mirrored by `progression.item-removed` / `capability-revoked` events.
- An economy layer, explicitly out of scope for v1.

## Version / Author

Version 1.0 — Mike Blom.
