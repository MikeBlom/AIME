# Resume.World — Quest Engine (Restoration)

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** QST

---

## Purpose

This document specifies the Quest Engine: the data-driven state machine behind the core narrative act — bringing offline systems back online (FR-VIS-004). It defines how quest content becomes live quest state, how gameplay outcomes advance objectives, what completion does to the world, and how the bypass path keeps comprehension ungated (FR-VIS-010).

## Overview

A quest is a content document (`03-Data-Model-and-Content-Pipeline.md`, schema `quest`): a title key, the region it restores, a list of objectives, a completion declaration (which engine events to emit, which locale key reveals the career meaning), and a bypass declaration. The composition root spawns one entity per quest in the active region, carrying the immutable `Quest` definition plus the mutable `QuestState` progress slice this System owns (FR-ARCH-015).

The engine never decides *what* an objective means — mechanics do. Gameplay Systems (the mini-games host, dialogue, interactions) publish `objective.resolved` with an outcome of **solved** or **bypassed** when a mechanic bound to an objective finishes. The Quest Engine records the outcome, announces `quest.advanced`, and when no objective remains pending, completes the quest: it publishes `quest.completed`, emits the content-declared completion events (the vocabulary maps `SystemRestored` → `system.restored`), reveals the meaning as a locale key on `quest.revealed`, and flips the quest's region live state to `online`, announcing `region.state.changed`. Progress is plain world-state data captured by the save envelope (`32-Save-Load-and-Persistence.md`), and restoration triggers an autosave.

## Goals

- Restoration as narrative: completing a quest is the beat that re-energizes a region and reveals a career chapter — through mechanics, never exposition (Vision pillar 3).
- Quests as pure content: the engine holds the state machine; every id, key, and binding arrives from the pack (FR-VIS-007).
- One standardized result feed: any mechanic can advance any quest by publishing one event shape — mini-games, dialogue, and future systems compose without touching this System.
- Comprehension never gated: the bypass path reveals meaning the moment a player takes it (FR-VIS-010).
- Progress that survives: quest state round-trips through save/load (FR-ARCH-016).

## Non-Goals

- Mechanics themselves — mini-game types and their rules are `28-Mini-Games-Framework.md` / `29-Mini-Games-Catalog.md`.
- Quest *content* — the actual quests, objectives, and reveal copy are the pack's (Phase 3).
- Dialogue trees — `21-Dialogue-System.md`; dialogue advances quests only through the standard result feed.
- Quest UI (journals, markers) — surfaced by UI/HUD consumers of this System's events and slices.
- Branching quest graphs, timers, or failure states — v1 quests are objective sets; richer topologies are future work.

## User Stories

- *As a player,* finishing the routing puzzle makes the district hum back to life — lights, motion, sound — and I understand what it stood for without reading a wall of text.
- *As a player who cannot solve the puzzle,* I take the bypass and still learn what this system represents about the creator; the world does not lock its meaning behind my skill.
- *As a content author,* I add a quest by writing a JSON document binding objectives to metaphors; no engine change, no code.
- *As a mini-game author,* I publish one `objective.resolved` event when my mechanic ends and the quest machinery does the rest.
- *As a returning visitor,* the systems I restored are still online and my half-done quest is exactly where I left it.

## Functional Requirements

- **FR-QST-001** Quest definitions MUST come entirely from content documents; the System MUST hold no quest-specific knowledge (FR-VIS-007, NFR-VIS-005). Player-visible meaning travels only as locale keys.
- **FR-QST-002** Quest progress MUST live in a System-owned, serializable world-state slice (`QuestState`): per-objective status (`pending`/`solved`/`bypassed`) plus lifecycle (`active`/`completed`) (FR-ARCH-014..016).
- **FR-QST-003** Objectives MUST advance only via the standardized result event `objective.resolved { questId, objectiveId, outcome }` published by gameplay Systems — the request channel of FR-ARCH-015. Each advance MUST be announced as `quest.advanced`.
- **FR-QST-004** A quest MUST complete exactly once, when its last pending objective resolves. Completion MUST publish `quest.completed`, emit every recognized event named in the content's `onComplete.emits` (engine vocabulary: `SystemRestored` → `system.restored { questId, regionId }`), and reveal `onComplete.revealsKey` via `quest.revealed`.
- **FR-QST-005** Completion MUST apply the restoration world effect: the region entity whose content id matches the quest's `regionRef` transitions to live state `online`, announced as `region.state.changed` (FR-VIS-004). The Quest Engine owns region live-state transitions.
- **FR-QST-006** The bypass path (FR-VIS-010): a `bypassed` outcome MUST resolve the objective and MUST reveal the quest's `bypass.revealsKey` immediately — not deferred to completion — so comprehension is never gated behind the puzzle. A bypass on a quest whose content sets `bypass.allowed: false` MUST be ignored.
- **FR-QST-007** All quest events MUST be published deferred (FR-ARCH-012) and delivered in the bus's deterministic order (FR-ARCH-010).
- **FR-QST-008** Unknown quest ids, unknown objective ids, already-resolved objectives, completed quests, and unrecognized `onComplete.emits` vocabulary MUST degrade silently — no fault, no state change beyond what is valid (FR-ARCH-008, FR-ARCH-029).
- **FR-QST-009** Quest state MUST be captured in the save envelope's progression slices and MUST round-trip through save/load; a restoration MUST trigger an autosave so a completed quest is never lost to a closed tab (FR-ARCH-016).

## Non-Functional Requirements

- **NFR-QST-001 (Determinism):** State transitions are a pure function of the event sequence; identical scripts reproduce identical state and event logs (NFR-ARCH-001, FR-ARCH-025). No wall clock, no randomness.
- **NFR-QST-002 (Isolation):** The System is unit-testable with a fake Context; it references no other System and touches no platform interface (NFR-ARCH-002/004).
- **NFR-QST-003 (Polish hook):** Completion emits everything presentation needs (restoration, region state change, reveal key) so the four-part polish gate (NFR-VIS-001) can be satisfied by consumers without this System knowing about rendering or audio.

## Acceptance Criteria

- Completing a quest transitions its region to online and emits `SystemRestored` (FR-QST-004/005) — covered end to end with the reference pack.
- The bypass path reveals the career meaning without solving the puzzle (FR-QST-006); a forbidden bypass is ignored.
- Quest progress survives save/load: mid-progress and completed states round-trip and resume exactly (FR-QST-009).
- A multi-objective quest stays active until every objective resolves; replayed resolutions and unknown ids change nothing (FR-QST-003/008).
- Identical resolution scripts reproduce identical state and event sequences (NFR-QST-001).

## Dependencies

- `02-System-Architecture.md` — System lifecycle, slice ownership, deferred events, determinism.
- `03-Data-Model-and-Content-Pipeline.md` — the `quest` schema, locale keys, and reference resolution this System's data arrives through.
- `32-Save-Load-and-Persistence.md` — the envelope that persists `QuestState` and the autosave the restoration event triggers.
- Producers: Mini-Games host (`28`), Dialogue (`21`), interaction Systems — publish `objective.resolved`.
- Consumers: UI/HUD (`18`) surfaces reveals and progress; Rendering/Audio react to `region.state.changed`/`system.restored`; Achievements (`27`) and Inventory/Progression (`26`) subscribe to the same beats.

## Implementation Notes (non-normative)

- Transitions run in event handlers at the tick boundary (the bus's flush), not in `update` — the System's `update` is a no-op. Handlers are subscribed in `init` and released in `teardown`, so hot-reload re-init is clean.
- Events the System publishes from inside a flush deliver on the next flush (the bus never chases its own tail); consumers observe restoration one tick after the resolving outcome — imperceptible and deterministic.
- `onComplete.worldEffect` in the current schema is a human-readable placeholder; the normative world effect is FR-QST-005's region transition. If content ever needs richer effects, they become schema, not prose.
- The completion vocabulary is deliberately a one-entry map today. It is data in code — extending it is adding an entry, not redesigning the machine.
- A fully bypassed quest still completes and restores (FR-VIS-010 extended to progression: difficulty gates neither comprehension *nor* the arc). The distinction is preserved in `QuestState` per objective, so analytics or achievements can honor "solved honestly" if content cares.

## Edge Cases

- **A quest for a region that is not spawned.** The quest completes and announces; the world effect has no target and is skipped without fault (partial-world loading stays possible).
- **Duplicate resolution events** (a mechanic double-fires). The objective resolves once; replays are ignored (FR-QST-008).
- **Bypass after solve, or solve after bypass.** First outcome wins; the objective is settled.
- **A save from a world with different quest content.** The envelope is pack-gated upstream (`32`); within a matching pack, unknown entity ids in the slice are skipped safely.
- **Region already online** (content spawned it online, or a restored save). The transition is a no-op and `region.state.changed` is not re-announced.
- **Content declares no objectives.** The quest can never advance and never completes — visible immediately in authoring; validation may warn (see Open Questions).

## Risks

- **Vocabulary creep.** `onComplete.emits` could grow into a scripting language. Mitigation: the vocabulary is a reviewed engine contract; content requests events, never behavior.
- **Result-feed abuse.** Any System can publish `objective.resolved`, including nonsense. Mitigation: strict validation against the definition (unknown ids ignored), and the event log makes every advance auditable (FR-ARCH-013).
- **Reveal without polish.** A reveal key with no UI treatment lands flat, violating the polish gate. Mitigation: `quest.revealed` is a single, well-known event the UI issue owns surfacing; the launch sweep (#45) checks the beat.

## Open Questions

- **OQ-QST-1:** Should pack validation warn on quests with zero objectives or a missing `onComplete.revealsKey`? Owner: content pipeline (#12 follow-up).
- **OQ-QST-2:** Do restorations need ordering constraints (quest B requires region A online)? Deferred until the full reference pack (#35) shows whether content wants prerequisites.
- **OQ-QST-3:** Whether bypassed-vs-solved should affect achievements or analytics funnels. Owner: `27-Achievements.md` / `36-Analytics-and-Telemetry.md`.

## Future Considerations

- Objective progress with counts (repair 3 relays) — `QuestState` statuses would gain a numeric form behind the same events.
- Quest prerequisites and arcs expressed as content references, once the reference pack demonstrates the need.
- Timed or reactive world effects beyond the online transition (staged power-up sequences) driven by presentation Systems listening to the same events.

## Version / Author

Version 1.0 — Mike Blom.
