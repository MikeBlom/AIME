# Resume.World — Day/Night and Weather

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** DNW

---

## Purpose

This document specifies the Environment System: the deterministic world clock that cycles day and night, the weather driver that follows each region's content profile, and the hooks through which time and sky reach everything else — lighting for rendering, phase events for NPC routines and audio beds. It delivers the Vision's first pillar's temporal half: the world has a clock and a sky, whether or not the player is doing anything.

## Overview

The System owns one ENVIRONMENT world-state slice: seconds into the day/night cycle, the derived phase, the current weather state, and the countdown to the next weather draw. Each fixed simulation step the clock advances by `dt`. Crossing a phase boundary publishes the shared `time.phase-changed { phase }` event — the `TimeOfDayChanged` shape `02-System-Architecture.md` names — which the Audio System already consumes for bed selection and the NPC System for routine shifts; neither knows this System exists (FR-ARCH-005).

Lighting is a hook, not a call: the System writes the render layer's `ENVIRONMENT_LIGHT` component (a translucent tint, null by day) and rendering overlays it above the world, below UI. Night is visible the moment the phase flips, and a world without a renderer simply carries the value.

Weather follows content. A region document's `ambient` block declares a `weatherProfile` (and whether `dayNight` runs at all — the clock is content's opt-in, never an engine assumption). The profile names a closed set of generic weather states the System cycles through on intervals drawn from the seeded Core RNG service, announcing `weather.changed` as states flip. Same seed, same skies (NFR-ARCH-001); an unknown profile degrades to a steady default state rather than faulting (FR-ARCH-008).

## Goals

- A world clock: day and night alternate on a documented cycle, visibly (lighting) and behaviorally (routines, audio) — Vision pillar 1.
- Content-driven skies: which weather a region can have is the region's declaration; the engine ships the cycling, never the meaning.
- Determinism: identical seeds and `dt` sequences reproduce identical phases and weather under replay (NFR-ARCH-001, FR-ARCH-025).
- Zero coupling: two published events plus one written lighting component; every consumer subscribes or reads world state (FR-ARCH-005).

## Non-Goals

- Weather visuals and audio — rain particles, wind beds — are presentation and content (Phase 3: #35, #36; audio binds beds through its manifest keys already).
- Gameplay consequences of weather (slippery ground, gated quests) — future extensions declared in content, not implied here.
- Ambient event scheduling — `24-World-Simulation-and-Ambient-Events.md`; phase-aware ambience layering is its future consideration.
- Astronomical fidelity: the cycle is two phases; dawn/dusk gradients are a future refinement of the same contract.

## User Stories

- *As a player,* the light dims as night falls, characters head off their day rounds, and the soundscape shifts — the place has a pulse.
- *As a content author,* I give a region weather by writing `"ambient": { "weatherProfile": "temperate", "dayNight": true }`; a region that should never darken simply omits the flag.
- *As a tester,* I replay a session and the sun sets on the same step with the same sky every time.
- *As a system author,* I subscribe to `time.phase-changed` or `weather.changed` and never import the environment.

## Functional Requirements

- **FR-DNW-001** The System MUST advance a day/night clock by `dt` inside fixed-step simulation only, with documented phase durations (`DAY_SECONDS`, `NIGHT_SECONDS`); no wall-clock time may influence it (NFR-ARCH-001).
- **FR-DNW-002** The cycle MUST run only when the active region's content ambient block sets `dayNight: true`; otherwise the world holds a steady `day` phase.
- **FR-DNW-003** Every phase transition MUST publish the shared `time.phase-changed { phase }` event, deferred (FR-ARCH-012), using the engine phase vocabulary (`day`, `night`) that NPC routines and audio beds target.
- **FR-DNW-004** The System MUST expose lighting as data: the `ENVIRONMENT_LIGHT` tint component (null by day, the documented tint by night), which rendering overlays above the world; rendering MUST tolerate the component's absence (FR-ARCH-008).
- **FR-DNW-005** Weather states MUST be selected from the profile the region's content `weatherProfile` names; an unknown or absent profile MUST degrade to the steady default state without faulting (FR-ARCH-008).
- **FR-DNW-006** Weather redraws MUST occur on intervals drawn from the Core RNG service within the documented window, changing to a different state of the profile and publishing `weather.changed { weather }`, deferred; a single-state profile never announces changes.
- **FR-DNW-007** All RNG draws MUST happen inside `update`, never `init`, so replays reproduce the schedule regardless of init ordering (FR-ARCH-025).
- **FR-DNW-008** The ENVIRONMENT slice MUST live in a System-owned, serializable world-state component adopted across re-init (FR-ARCH-014/015/016); this System is its sole writer, and it writes no other System's slice.

## Non-Functional Requirements

- **NFR-DNW-001 (Determinism):** identical initial state, seed, and `dt` sequence produce identical phases, tints, weather states, and event logs (NFR-ARCH-001).
- **NFR-DNW-002 (Isolation):** unit-testable with a fake Context; no System references, no platform access (NFR-ARCH-002/004).
- **NFR-DNW-003 (Cost):** constant per-step work; at most one phase event and one weather event per step (NFR-ARCH-003).

## Acceptance Criteria

- Time progresses: the phase flips at the documented boundaries, each flip publishes `time.phase-changed`, the night tint lands in `ENVIRONMENT_LIGHT`, and rendering draws the overlay — visible lighting change driving NPC routine shifts through the real NPC System.
- Weather follows the region's content profile: every state the System holds belongs to the declared profile, changes announce `weather.changed`, and two same-seed runs produce identical sequences — reproducible under replay.
- A region without `dayNight` holds a steady day with no phase events; an unknown profile holds the steady default with no weather events; neither faults.
- The slice survives re-init without duplication.

## Dependencies

- `02-System-Architecture.md` — System lifecycle, slice ownership, deferred events, determinism, the seedable RNG service.
- `03-Data-Model-and-Content-Pipeline.md` — the region schema's `ambient` block this System reads (landed into world state at spawn).
- `17-Audio.md` (issue #22) — the consumer of `time.phase-changed` for bed selection; the event type's shared vocabulary lives with it today.
- `22-NPC-and-Behavior.md` (issue #27) — routines shift on the phase events this System publishes.
- `30-Rendering.md` (issue #16) — the `ENVIRONMENT_LIGHT` overlay hook.
- `24-World-Simulation-and-Ambient-Events.md` (issue #28) — future phase-aware ambience layering.

## Implementation Notes (non-normative)

- The 60 s day / 60 s night default is walking-skeleton pacing — long enough to explore, short enough that a two-minute visit (FR-VIS-008) sees both phases; `33-Performance-Budgets.md` and playtesting own retuning.
- `ENVIRONMENT_LIGHT` is defined in the render module alongside CAMERA — rendering owns the vocabulary it consumes; this System owns the value. The overlay draws above the world and below UI.
- The `time.phase-changed` event type currently lives with the Audio System's vocabulary (it consumed the shape first); re-homing it into a shared environment vocabulary module is cosmetic and can ride any later refactor issue.
- The ENVIRONMENT slice is engine ambience, not progression: it is not in the save's progression slices, so a resumed world starts its day fresh — cosmetically invisible and always safe. If persistence is ever wanted, it is one slice-list entry away (`32-Save-Load-and-Persistence.md`).
- Weather redraws pick among the profile's *other* states, so every draw is a visible change and single-state profiles stay silent.

## Edge Cases

- **`dayNight` flips off mid-night** (content hot-reload): the phase forces back to `day`, publishing the transition once — no stuck darkness.
- **A profile removed mid-run** (hot-reload): the held state falls back to the new profile's first state on the next step.
- **A very long frame:** catch-up is clamped by the loop (FR-ARCH-022); the clock advances at most the clamped steps and each step fires at most one transition.
- **Two regions with ambient blocks** (future multi-region worlds): the first by entity order applies today; per-region environment is a future consideration.
- **No region entity at all** (bare test worlds): steady day, default weather, zero events — the System idles harmlessly.

## Risks

- **Phase-vocabulary drift.** Content routines target `day`/`night` strings; renaming phases would silently orphan routines. Mitigation: the vocabulary is normative here (FR-DNW-003) and shared as exported constants.
- **Cycle timing as gameplay.** If quests ever gate on night, cycle retuning changes difficulty. Mitigation: gameplay gating belongs to quest content referencing phase events, and any such coupling is reviewed there.
- **Overlay double-darkening** with future per-screen art. Mitigation: one overlay, owned here; art direction (#36) restyles the tint value, not the mechanism.

## Open Questions

- **OQ-DNW-1:** Dawn/dusk transition phases (and gradient tints) — worth it once art direction lands? Deferred to #36.
- **OQ-DNW-2:** Should weather bias by phase (rain more likely at night)? Deferred until the full reference pack demonstrates need.
- **OQ-DNW-3:** Per-region environment state for multi-region worlds — owned by the buildings/interiors and world-design tracks.

## Future Considerations

- Weather particle/audio bindings from content manifests as Phase 3 art lands.
- Phase-aware ambient scheduling in `24`.
- Seasonal or scripted sky events as declared content, reusing `weather.changed`.

## Version / Author

Version 1.0 — Mike Blom.
