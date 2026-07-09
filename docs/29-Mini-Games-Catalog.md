# Resume.World — Mini-Games Catalog (Mechanic Types)

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** MGC

---

## Purpose

This document specifies the engine's mechanic-type catalog: the named `engine.mechanic.*` plugins content binds accomplishments to (DATA-FR-009), built on the host contract in `28-Mini-Games-Framework.md`. Each type is a metaphor *primitive* — a small, legible rule set a pack can frame as any accomplishment it fits.

## Overview

Three mechanic types ship in v1, each a plugin on the host's factory. **Route-and-balance** distributes a load across capacity-limited channels — the primitive for distributed-systems, logistics, and scaling stories. **Assembly** builds a whole by placing the right part in each ordered slot — the primitive for construction, pipelines, and craftsmanship stories. **Orchestrate** activates cycling tracks by acting inside each one's timing window until everything runs at once — the primitive for coordination, leadership, and integration stories. All three share one control vocabulary (move edges select, interact acts) read from the input-intent slice (`14-Input-and-Controls.md`), keep their play state in a mechanic-owned world slice UI can draw, announce every beat as `minigame.feedback`, and offer the uniform bypass: holding interact for a configurable span resolves the session as `bypass`, and the quest reveals its meaning immediately (FR-VIS-010 via FR-QST-006).

## Goals

- Primitives, not puzzles: each type is one clear rule a two-minute visitor grasps without instruction (NFR-VIS-006).
- Fully data-configurable: a metaphor's `params` shape every playthrough; the schemas are published for load-time validation (FR-MGF-007).
- Comprehension never gated: every type carries the same bypass affordance (FR-VIS-010).
- Polish hooks everywhere: every progress and setback is an event presentation layers can score and light (NFR-VIS-001).

## Non-Goals

- Career framing — `framingKey` and all player-visible text are pack locale keys (DATA-FR-011).
- Mini-game rendering/HUD treatment — UI consumes the state slices and feedback events (`18-UI-UX-and-HUD.md`).
- Difficulty tuning and scoring; v1 mechanics complete or bypass, nothing else persists.
- More types (timing rhythms, negotiation, exploration) — added per the framework's extension path when the pack needs them.

## User Stories

- *As a visitor,* I shift units between channels until everything fits, and the metaphor lands: this person balances load across systems.
- *As a visitor who cannot solve it,* I hold the action key and the world tells me what it meant anyway.
- *As a content author,* I bind `engine.mechanic.assembly` with `slots: [1, 0, 2]` and my three-step story plays without engine changes; validation rejects params my mechanic cannot honor.
- *As a presentation developer,* every routed unit and mistimed press arrives as one `minigame.feedback` event with a completion ratio, so meters and cues need no mechanic knowledge.

## Functional Requirements

- **FR-MGC-001** The catalog MUST register `engine.mechanic.route-and-balance`, `engine.mechanic.assembly`, and `engine.mechanic.orchestrate` as plugins on the host contract (FR-MGF-001); each MUST appear in the engine mechanic catalog and publish a params schema (DATA-FR-009, FR-MGF-007).
- **FR-MGC-002** Route-and-balance: `params.channels` (positive capacities) and `params.load` (units) define the puzzle. Left/right edges select a channel; interact routes one unit into it. A unit into a full channel MUST be rejected as a setback; routing the whole load MUST resolve `success`. A load exceeding total capacity MUST be clamped so the puzzle stays solvable.
- **FR-MGC-003** Assembly: `params.slots` (the correct offered-part index per ordered slot) and `params.choices` (parts offered) define the puzzle. Up/down edges cycle the offered part; interact places it. A wrong part MUST be rejected as a setback with the slot left open; filling every slot MUST resolve `success`. Slot indexes MUST be normalized into the offered range.
- **FR-MGC-004** Orchestrate: `params.tracks` (`{ periodSeconds, windowSeconds }` in simulation seconds) defines the puzzle. Every track's phase cycles on simulation time; the first inactive track is armed; interact inside the armed track's open window activates it, outside is a setback. Every track active MUST resolve `success`. A window spanning its whole period MUST be clamped so it closes.
- **FR-MGC-005** Every catalog mechanic MUST resolve `bypass` after interact is held continuously for `params.bypassHoldSeconds` (default 3) simulation seconds, releasing MUST reset the hold, and the affordance MUST NOT be removable by params (FR-VIS-010).
- **FR-MGC-006** Every progress and setback MUST be announced as a deferred `minigame.feedback { mechanicId, questId, kind, ratio }` with `ratio` the 0..1 completion, so presentation polish needs no mechanic coupling (FR-ARCH-012, NFR-VIS-001).
- **FR-MGC-007** Each mechanic MUST keep its play state in a mechanic-owned, queryable world slice (FR-ARCH-015), reset on session enter and cleared on session exit; the slice MUST NOT be save-captured (a mid-game save resumes at the quest).
- **FR-MGC-008** Absent or partially invalid params MUST degrade to documented defaults rather than fault (FR-ARCH-008); validation with the published schemas remains the authoring-time guard.

## Non-Functional Requirements

- **NFR-MGC-001 (Determinism):** Play state advances only on the input-intent slice and simulation `dt`; identical input and `dt` scripts reproduce identical sessions and feedback sequences (NFR-ARCH-001).
- **NFR-MGC-002 (Isolation):** Each mechanic is unit-testable with a fake Context; none references another System or a platform interface (NFR-ARCH-002).
- **NFR-MGC-003 (Legibility):** Each primitive is playable without text: selection, acceptance, and rejection are all announced for presentation to make visible (NFR-VIS-006's spirit).

## Acceptance Criteria

- Each of the three mechanics is playable start to `success` through input intents, advancing and completing a quest through the host's result feed (issue #34 AC1).
- Each mechanic's playthrough shape is changed by its params alone — different channels/load, slots/choices, tracks — with no code change (issue #34 AC1, "fully data-configurable").
- On every mechanic, holding interact for the configured span resolves `bypass` and the quest reveals its meaning immediately (issue #34 AC2, FR-VIS-010).
- A metaphor with params violating a catalog schema is rejected at load with the field path (FR-MGF-007).
- Rejected units, wrong parts, and mistimed presses each emit a `setback` feedback event; accepted ones emit `progress` with a rising ratio (FR-MGC-006).

## Dependencies

- `28-Mini-Games-Framework.md` — the host contract, session slice, launch path, and result events these types implement.
- `14-Input-and-Controls.md` — the input-intent slice and action vocabulary the shared controls read.
- `03-Data-Model-and-Content-Pipeline.md` — the `metaphor` schema whose `params` these schemas constrain (DATA-FR-009).
- Consumers: UI/HUD (`18`) draws the state slices and feedback; Audio (`17`) cues on feedback kinds; the reference pack (#35) binds the catalog.

## Implementation Notes (non-normative)

- All three types share one scaffold: previous-intent edge detection, the bypass hold accumulator, and slice reset/clear live in one place; a mechanic is `reset` (params → initial state) plus `step` (edges + dt + state → state and maybe an outcome). A fourth type is one more pair.
- The launch press is swallowed: the scaffold's baseline treats interact as already held on enter, so the press that opened the session neither acts nor seeds the bypass hold.
- Acting and holding are the same key by design (one action key everywhere, `14`): a press acts immediately, and a deliberate continuous hold — configured well past any tap — reaches the bypass. The one act that precedes a bypass hold is harmless: rejected actions are setbacks, accepted ones progress a session that is about to end anyway.
- `ratio` in feedback is completion, not score: presentation can drive a single meter for any mechanic without a per-type mapping.

## Edge Cases

- **Load exceeds total capacity** (route-and-balance). Clamped at reset; the puzzle asks for a full world, not an impossible one (FR-MGC-002).
- **A slot index outside the offered range** (assembly). Normalized into range at reset (FR-MGC-003); schema validation warns the author first.
- **A window as long as its period** (orchestrate). Clamped to half the period so the window actually closes (FR-MGC-004).
- **Empty or malformed params arrays.** The documented defaults apply (FR-MGC-008); the session plays rather than deadlocks.
- **A press exactly on the hold threshold.** The bypass fires at `holdSeconds >= bypassHoldSeconds`, evaluated before the step's action, so the resolution is unambiguous.

## Risks

- **Primitive fatigue** (three types stretched over many quests feel samey). Mitigation: params meaningfully reshape each playthrough; the framework's extension path keeps new types one plugin away.
- **Metaphor mismatch** (a pack frames a mechanic as something it does not evoke). Validation cannot catch meaning; the content style guide (#35) and playtesting own it.
- **Feedback spam** (rapid presses flood the bus). Each press emits at most one event; presentation coalesces if needed, and the event log keeps volume observable (FR-ARCH-013).

## Open Questions

- **OQ-MGC-1:** Whether the bypass hold should surface a visible charge meter (presentation) so the affordance is discoverable without text. Owner: `18-UI-UX-and-HUD.md` / #35.
- **OQ-MGC-2:** Whether orchestrate should de-activate tracks on mistimed presses at higher difficulty. Deferred until the reference pack shows a need.

## Future Considerations

- Additional primitives (signal-tracing, triage, negotiation trees) as plugins when pack stories demand them.
- Difficulty profiles sourced from the accessibility slice (`34-Accessibility.md`) scaling windows and capacities without new params.
- Session summaries (time, setbacks) feeding analytics funnels (`36-Analytics-and-Telemetry.md`) once that layer exists.

## Version / Author

Version 1.0 — Mike Blom.
