# Resume.World — World Simulation and Ambient Events

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** WSM

---

## Purpose

This document specifies the World Simulation System: the deterministic scheduler that keeps background life happening — machines stirring, something passing through, ambient activity — even while the player stands still. It is the mechanism behind the Vision's first pillar: the world must feel alive whether or not the player is doing anything.

## Overview

The System owns one small world-state slice: a countdown to the next ambient event. Each fixed simulation step the countdown advances by `dt`; when it lapses, the System draws the next interval and the event's shape from the Core RNG service — the seedable randomness source — and announces `ambient.event { kind, x, y, targetId }` as a deferred event. Because every draw flows through the seeded service and happens inside fixed-step simulation, identical seeds and `dt` sequences reproduce identical ambient life under replay (NFR-ARCH-001, FR-ARCH-025).

Event placement is the density rule: markers (characters, buildings) within a radius of the player are preferred, so there is always something happening nearby; any marker in the region is the fallback; a region with no markers at all still gets positional events somewhere in the space. Ambient life never simply stops (FR-ARCH-008).

The System ships rhythm, not meaning. `kind` is a closed generic vocabulary — `pulse` (machinery stirring), `drift` (something passing through), `stir` (background activity) — and what each looks or sounds like is presentation and content. Consumers subscribe: rendering and audio interpret events as they see fit, and each targeted event additionally requests the Animation System's generic one-shot channel with an `ambient.<kind>` clip, so a pack makes ambient activity *visible* purely by defining manifest frames for those clips. No engine change, no coupling, no career fact.

## Goals

- Ambient life while idle: background events fire on a steady, tunable rhythm without any player action (Vision pillar 1).
- Determinism: identical seeds replay identical ambient schedules, targets, and kinds (NFR-ARCH-001).
- No dead space: event placement biases toward the player's surroundings; sparse regions still breathe.
- Zero coupling: one announced event type plus the existing generic animation channel; consumers subscribe, nobody is called (FR-ARCH-005).

## Non-Goals

- Specific ambient content — which machines, what art, what sounds — arrives with the content pack and the Phase 3 catalog issues (#35, #36).
- The day/night clock and weather — `23-Day-Night-and-Weather.md` (issue #29). This scheduler is time-of-day agnostic; phase-aware ambience can layer on later.
- NPC routines — `22-NPC-and-Behavior.md` owns character behavior; this System never moves an entity.
- Gameplay consequences: ambient events are cosmetic by contract; quests and progression never depend on them.

## User Stories

- *As a player,* I stop walking and the world keeps going — something hums by the control house, a character stirs — so the place feels inhabited, not paused.
- *As a content author,* I make ambient activity visible by adding `ambient.pulse` frames to my asset manifest; I never touch engine code.
- *As a tester,* I replay a recorded session and every ambient event fires at the same step, at the same place, with the same kind.
- *As a system author (audio, rendering),* I subscribe to `ambient.event` and interpret it however my layer wants.

## Functional Requirements

- **FR-WSM-001** The System MUST schedule ambient events on intervals drawn from the Core RNG service; no other randomness source is permitted (NFR-ARCH-001).
- **FR-WSM-002** Intervals MUST fall inside a documented tuning window (`AMBIENT_MIN_INTERVAL`..`AMBIENT_MAX_INTERVAL`) so ambient life is steady but never metronomic; the window is engine tuning data, adjustable without behavior change elsewhere.
- **FR-WSM-003** Every RNG draw MUST happen inside fixed-step simulation (`update`), never in `init` or presentation, so replays reproduce the schedule exactly (FR-ARCH-025).
- **FR-WSM-004** Each event MUST be announced as the deferred `ambient.event { kind, x, y, targetId }` (FR-ARCH-012); `kind` MUST come from the closed generic vocabulary this document defines.
- **FR-WSM-005** Target selection MUST prefer markers within the nearby radius of the player, fall back to any marker in ascending entity order, and degrade to a positional event (null target) in a markerless region — ambient life MUST NOT stop (FR-ARCH-008).
- **FR-WSM-006** Targeted events MUST also request the Animation System's generic one-shot channel with the `ambient.<kind>` clip, so packs bind visible ambience through the asset manifest alone (DATA-FR-027).
- **FR-WSM-007** The countdown slice MUST live in a System-owned, serializable world-state component adopted across re-init (FR-ARCH-014/015/016); this System is its sole writer.
- **FR-WSM-008** The scheduler MUST hold no gameplay authority: no other System's slice is written, no progression is affected, and a world without this System remains fully playable (FR-ARCH-008).

## Non-Functional Requirements

- **NFR-WSM-001 (Determinism):** identical initial state, seed, and `dt` sequence produce an identical event log (NFR-ARCH-001, FR-ARCH-025).
- **NFR-WSM-002 (Isolation):** unit-testable with a fake Context; no System references, no platform access (NFR-ARCH-002/004).
- **NFR-WSM-003 (Cost):** at most one event per step; per-step work is linear in the number of markers only on the steps an event fires (NFR-ARCH-003).

## Acceptance Criteria

- With the player idle, ambient events fire repeatedly within the tuning window, and two same-seed runs produce identical sequences (kinds, targets, positions, steps) — ambient life visible while idle and reproducible under replay.
- With markers near the player, every event lands within the nearby radius — no region reads as static during normal play; with none nearby, events still fire on more distant markers; with no markers, positional events continue.
- Each targeted event carries a matching `ambient.<kind>` one-shot request consumable by the real Animation System.
- The slice survives re-init without duplication, and a world without the System boots and plays normally.

## Dependencies

- `02-System-Architecture.md` — System lifecycle, slice ownership, deferred events, determinism, the seedable RNG service.
- `16-Animation.md` (issue #21) — the generic one-shot channel targeted events request.
- `22-NPC-and-Behavior.md` (issue #27) — a future consumer; characters may react to ambient events.
- `23-Day-Night-and-Weather.md` (issue #29, future) — phase-aware ambience layering and region ambient profiles.

## Implementation Notes (non-normative)

- The fresh slice is created unscheduled (`nextIn: -1`) at init and draws its first interval on the first update — keeping every RNG call inside simulation is what makes the schedule replay-exact regardless of init ordering.
- The interval window (1.5–4 s) is the "always something nearby" density default for the walking-skeleton region size; `33-Performance-Budgets.md` may retune it per profiling.
- Region-specific density (a per-region ambient profile from content) is deliberately deferred to issue #29, which lands the region's `ambient` block into world state for weather; this scheduler reads engine tuning until then.
- `pulse`/`drift`/`stir` deliberately name *shapes* of activity, not things — content decides that a `pulse` on the control house means its stacks vent steam.

## Edge Cases

- **A markerless region.** Positional events with a null target keep firing; renderers may show distant motion, or nothing — the schedule itself never stalls.
- **No player entity** (menu worlds, tests). The nearby filter is skipped and all markers are candidates; the scheduler runs unchanged.
- **A very long frame.** The loop clamps catch-up (FR-ARCH-022); at most one event fires per fixed step, so a stall cannot burst-flood the bus.
- **Save/resume.** The countdown is engine state, not progression; a resumed world reschedules from its slice value (or redraws when the save predates this System), which is cosmetically invisible.
- **Two Systems drawing from the RNG in one step.** Draw order is System order, which the registry keeps stable (FR-ARCH-026/027) — replays hold.

## Risks

- **Ambient noise becoming gameplay.** If quests ever key off ambient events, replay and balance couple to cosmetic rhythm. Mitigation: FR-WSM-008 makes cosmetic-only a contract; gameplay triggers belong to quests and the world clock.
- **Event-bus volume.** A too-aggressive window could flood the log. Mitigation: one event per step maximum plus the documented window; budgets own retuning.
- **Vocabulary sprawl.** Ad-hoc kinds would leak meaning into the engine. Mitigation: the closed list lives here; new kinds are a spec change, not a code drive-by.

## Open Questions

- **OQ-WSM-1:** Should regions carry a content-defined density/profile for ambient events? Expected yes, landing with issue #29's region ambient state.
- **OQ-WSM-2:** Should ambient events pause while a modal surface is open? Currently they continue (the world staying alive behind a conversation is the point); revisit with onboarding (#44).

## Future Considerations

- Phase-aware ambience (different rhythm and kinds at night) once `23` publishes the world clock.
- Weighted target selection (busier buildings stir more) from content profiles.
- A "burst" grammar (clustered events, e.g. a passing convoy) if the flat rhythm reads too uniform after art lands.

## Version / Author

Version 1.0 — Mike Blom.
