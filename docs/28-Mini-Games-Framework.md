# Resume.World — Mini-Games Framework (Host)

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** MGF

---

## Purpose

This document specifies the mini-games host: the plugin contract that lets mechanic-type plugins register with the engine, the launch path that binds a quest objective to its content-declared metaphor, and the standardized result events that feed the Quest Engine (`20-Quest-Engine.md`). Mechanics are metaphors for accomplishments (Vision Metaphor Rule); the host is how they compose without coupling.

## Overview

The host is one System plus a shared vocabulary. A **mechanic type** is an engine-provided plugin (`engine.mechanic.*`) built with the host's factory; registering it is registering a plugin — no Core or host edits (FR-ARCH-018/019). A **metaphor** content document binds an accomplishment to a mechanic type with mechanic-specific `params` (DATA-FR-009); the composition root spawns each binding as an entity carrying the immutable `Metaphor` component. The mini-game lifecycle is expressed as events, never calls: a gameplay System publishes `minigame.launch { questId, objectiveId }`; the host resolves the quest's `metaphorRef` to its binding, confirms the mechanic is registered, opens the single host-owned session slice, and announces `minigame.started` (**enter**). The mechanic System sees its own id in the announcement and plays the session inside its `update` (**play**). When play concludes it publishes `minigame.resolved` with `success` or `bypass` (**resolve**); the host translates that into the Quest Engine's `objective.resolved` feed (`solved`/`bypassed`), closes the session, and announces `minigame.ended` (**exit**).

## Goals

- Mechanics as plugins: a mini-game ships as a plugin registering one System; adding or removing one touches no other module (FR-ARCH-017..019).
- Content configures, engine provides: the mechanic types are code; which accomplishment binds to which mechanic, with what params, is pack data (DATA-FR-009/010).
- One result feed: every mechanic advances quests through the same two events; the Quest Engine never learns mechanic names (FR-QST-003).
- Bypass as a first-class outcome: a mechanic resolves with `bypass` and the quest machinery reveals meaning immediately (FR-VIS-010).
- Deterministic sessions: launch, play, and resolution are pure functions of events, world state, and `dt` (NFR-ARCH-001).

## Non-Goals

- The catalog of mechanic types (route-and-balance, assembly, orchestrate, …) — `29-Mini-Games-Catalog.md` (#34).
- Mini-game presentation (surfaces, framing UI) — UI/HUD (`18`) and the catalog own what a session looks like.
- Career framing — `framingKey` and every player-visible string are pack locale keys (DATA-FR-011).
- Difficulty, scoring, or persistence of in-session state; a session is ephemeral and is not save-captured.

## User Stories

- *As a mini-game author,* I implement `enter`/`play`/`exit` hooks against the host factory, register my plugin, and a quest can launch me — I never import another System.
- *As a content author,* I bind an accomplishment to `engine.mechanic.route-and-balance` with params; validation rejects a mechanic name the engine does not provide and params the mechanic's schema forbids.
- *As a player,* finishing (or bypassing) a puzzle advances the restoration exactly as if any other gameplay had resolved the objective.
- *As an engine developer,* I can query the world for the active session and every registered mechanic while debugging (FR-ARCH-031).

## Functional Requirements

- **FR-MGF-001** Mechanic-type plugins MUST register through the standard module registry as plugins depending on the host plugin; a mechanic plugin loaded without the host MUST fail loudly (FR-ARCH-020). Each mechanic System MUST announce its mechanic id by writing a queryable descriptor into world state at `init` and retracting it at `teardown`.
- **FR-MGF-002** Metaphor bindings MUST spawn as entities carrying `{ metaphorId, mechanicId, params, framingKey }` exactly as validated content declares them; the host MUST NOT hold or invent any binding (FR-VIS-007).
- **FR-MGF-003** The launch API MUST be the deferred event `minigame.launch { questId, objectiveId }`. The host MUST resolve the quest's `metaphorRef` to a spawned binding and MUST open a session only when the quest is active, the objective pending, the binding present, and the binding's mechanic registered. Any other launch MUST be ignored silently (FR-ARCH-008).
- **FR-MGF-004** The host MUST own a single session slice (FR-ARCH-015): at most one session is active; a launch while a session is active MUST be ignored. Opening a session MUST be announced as `minigame.started { mechanicId, metaphorId, questId, objectiveId, framingKey }`; params travel in the session slice.
- **FR-MGF-005** Mechanics MUST honor the common lifecycle mapped onto events and the update loop: **enter** on `minigame.started` naming their mechanic id, **play** inside `update(dt)` while their session is active, **resolve** by publishing `minigame.resolved { questId, objectiveId, outcome }` with outcome `success` or `bypass`, **exit** on `minigame.ended`.
- **FR-MGF-006** On `minigame.resolved` matching the active session, the host MUST publish the Quest Engine's `objective.resolved` with `success → solved` and `bypass → bypassed`, close the session, and announce `minigame.ended { mechanicId, questId, objectiveId, outcome }`. A resolution with no matching active session MUST be ignored (FR-QST-008 upstream).
- **FR-MGF-007** A metaphor naming an unknown mechanic MUST be rejected at load (DATA-FR-009); where a mechanic publishes a params schema, a metaphor's `params` MUST validate against it at load with field-level diagnostics (DATA edge case), and a mechanic without a published schema MUST accept any params shape.
- **FR-MGF-008** All host and mechanic events MUST be published deferred and delivered in the bus's deterministic order (FR-ARCH-010/012).

## Non-Functional Requirements

- **NFR-MGF-001 (Determinism):** Sessions advance only on events, world state, and simulation `dt`; randomness a mechanic needs comes from the seeded `RngService` (NFR-ARCH-001).
- **NFR-MGF-002 (Isolation):** Host and mechanics are unit-testable with a fake Context; neither references another System instance (NFR-ARCH-002, FR-ARCH-005).
- **NFR-MGF-003 (Extensibility):** A new mechanic type is one plugin plus, optionally, one params-schema entry; no host, Core, or Quest Engine edit (NFR-ARCH-005).

## Acceptance Criteria

- A sample mechanic plugin registers through the registry, is launched by `minigame.launch`, plays, and its resolution advances and completes a quest end to end (issue #33 AC1).
- A metaphor with params violating the mechanic's published schema is rejected at load with the field path; a metaphor naming an unknown mechanic is rejected (issue #33 AC2, DATA-FR-009).
- A `bypass` outcome resolves the objective as `bypassed` and the quest reveals its meaning immediately (FR-VIS-010 via FR-QST-006).
- Launches for busy sessions, unknown quests, settled objectives, missing bindings, and unregistered mechanics change nothing; a stray `minigame.resolved` changes nothing (FR-ARCH-008).
- Tearing a mechanic down retracts its descriptor; a later launch naming it is ignored rather than opening an unserviceable session.

## Dependencies

- `02-System-Architecture.md` — System/plugin lifecycle, slice ownership, deferred events, determinism.
- `03-Data-Model-and-Content-Pipeline.md` — the `metaphor` and `minigame` schemas, DATA-FR-009 validation this host's catalog feeds.
- `20-Quest-Engine.md` — consumer of `objective.resolved`; quests carry the `metaphorRef` the launch path resolves.
- `29-Mini-Games-Catalog.md` (#34) — the mechanic types built on this contract, each with a real params schema.
- Producers of `minigame.launch`: interaction/UI Systems (`18`) and the reference pack's markers (#35).

## Implementation Notes (non-normative)

- The host exports a mechanic factory: a spec of `{ mechanicId, enter?, play?, exit? }` becomes a conformant System — the hooks are the authoring surface, the events are the contract. A hand-rolled System honoring FR-MGF-005 is equally conformant.
- `play` returning an outcome is how a mechanic resolves; returning nothing keeps playing. The one-flush lag between resolution and the session closing means `play` runs at most one extra tick — harmless and deterministic.
- The engine-known mechanic catalog (`ENGINE_MECHANICS`) plus the params-schema map are the loader's defaults; composition roots may extend both so out-of-tree mechanic plugins validate the same way (DATA-FR-009's "plugins extend the catalog").
- The session slice is deliberately not in the save envelope: a mid-minigame save resumes at the quest, not inside the puzzle.

## Edge Cases

- **Launch while a session is active.** Ignored; the world runs one mini-game at a time (FR-MGF-004).
- **Resolution after the session closed** (double-fire, stale mechanic). No matching session → ignored; the Quest Engine additionally ignores replays (FR-QST-008).
- **Quest with no `metaphorRef`, or a dangling one.** Launch is ignored; reference validation catches the dangling case at load (DATA-FR-007).
- **Mechanic torn down mid-session.** The session stays open but unserviced; closing it is the launching UI's affordance (cancel/bypass) — v1 accepts this as a dev-time-only state, since plugins do not unload mid-play in production.
- **Two mechanics claiming one id.** The registry rejects duplicate System ids at registration (FR-ARCH-019).

## Risks

- **Session deadlock** (a mechanic that never resolves). Mitigation: the bypass affordance is part of every mechanic's contract (FR-VIS-010); the catalog issue enforces it per type.
- **Params drift** (a mechanic changes its schema; packs break). Mitigation: schemas are versioned with the engine and validated at load, so the break is a diagnostic, not a runtime fault.
- **Result-feed spoofing** (anything can publish `minigame.resolved`). Mitigation: the host forwards only resolutions matching the active session; the event log keeps every advance auditable (FR-ARCH-013).

## Open Questions

- **OQ-MGF-1:** Whether a session needs an explicit cancel path (`minigame.cancelled`) distinct from bypass. Owner: `18-UI-UX-and-HUD.md` consumers when the catalog lands (#34).
- **OQ-MGF-2:** Whether params schemas should ship inside mechanic plugins rather than the content layer's map, once out-of-tree plugins exist. Owner: #34.

## Future Considerations

- Concurrent sessions (ambient mini-games) would generalize the slice to a keyed set behind the same events.
- Mechanic-local difficulty settings sourced from the accessibility slice (`34-Accessibility.md`) rather than params.
- Replayable mini-games outside quest bindings (arcade mode) — a launch payload without a quest binding, resolved to no objective.

## Version / Author

Version 1.0 — Mike Blom.
