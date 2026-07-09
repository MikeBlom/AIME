# Resume.World — Physics and Collision

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** PHY

---

## Purpose

This document specifies the Physics and Collision System: how colliders turn positions into space that pushes back — solids that block traversal, and trigger volumes that announce presence — for a top-down world, deterministically and at any frame rate. It is the constraint pass `15-Movement-and-Traversal.md` anticipates: Movement integrates motion in free space; Physics decides what that motion is allowed to do.

## Overview

Entities opt into collision by composition: attach a `Collider` — an axis-aligned box centered on the entity's `Position`, either **solid** or **trigger** — and the System begins acting on it (FR-ARCH-004). Each fixed step, after Movement has integrated positions, the System sweeps every *mover* (a solid collider that also carries the `Motion` slice) from where its step started to where Movement placed it. A uniform-grid **broadphase** narrows the candidate set; an axis-separated swept-AABB **narrowphase** clamps the mover at the first blocking face, checking the whole travel segment so no speed tunnels through a solid. The velocity component pressed into a contact is zeroed, so the tangential component survives and sliding along a wall works.

Blocking history and trigger occupancy are physics-owned world-state components — serializable data, never private shadow copies (FR-ARCH-014) — and every transition is announced as a deferred event: `collision.started`/`collision.ended` on the mover, `trigger.entered`/`trigger.exited` on the volume.

## Goals

- Space that pushes back: solids are impassable at any speed and any host frame chunking.
- Interaction volumes as data: a trigger is a component on an entity, and its enter/exit events are the hook dialogue, quests, and buildings compose on.
- Slide, don't stick: only the blocked velocity component dies, so walls steer rather than trap.
- Stay deterministic: resolution is a pure function of (world state, fixed dt); replays hold bit-identically.
- Stay decoupled: consume `Collider` + `Position` + `Motion`, communicate only via events and owned slices (FR-ARCH-005).

## Non-Goals

- Rigid-body dynamics, ragdolls, stacking, restitution, or forces — out of scope for v1 (issue #20).
- Pathfinding or steering around obstacles — navigation builds on this System later.
- Region-authored collision geometry — interiors and real region geometry arrive with `25-Buildings-and-Interiors.md`; until then world geometry is the colliders spawned on world entities.
- Circle/polygon shapes — the AABB contract covers the top-down slice; new shapes would extend `Collider`, not replace it.

## User Stories

- *As a player,* I cannot walk through a building, however fast I approach it; grazing its corner steers me along the wall instead of stopping me dead.
- *As a content author,* I make a doorway meaningful by placing a trigger volume: the engine tells me who entered and left, and I wire dialogue or transitions to those events.
- *As a quest author,* I listen for `trigger.entered` to know the player reached the generator room — no polling, no coupling to movement internals.
- *As a tester,* I background the tab for minutes, refocus, and the world resumes with everything exactly where physics allows — no explosion, no tunneling (FR-ARCH-022/024).

## Functional Requirements

- **FR-PHY-001** The System MUST derive collision behavior only from `Collider`, `Position`, and `Motion` components and its own owned slices — never from another System (FR-ARCH-005). A `Collider` MUST be data: box extents plus a `solid`/`trigger` mode.
- **FR-PHY-002** A mover MUST NOT end a fixed step overlapping a solid collider: swept resolution clamps it at the first blocking face along its travel, and a depenetration backstop expels any residual overlap (spawn-inside, restored save) along the smaller penetration axis, deterministically.
- **FR-PHY-003** Resolution MUST be axis-separated in a stable, documented order (x, then y), so the velocity component into a contact is zeroed while the tangential component survives (sliding).
- **FR-PHY-004** Resolution MUST check the mover's whole travel segment, not endpoint overlap, so no per-step displacement — including catch-up steps after a stall — can tunnel through a solid (FR-ARCH-022).
- **FR-PHY-005** The System MUST constrain only the velocity components on the `Motion` slice; the `moving` flag and facing remain Movement's judgment of intent-driven motion, so pressing against a wall is a stable state and never flaps `movement.started`/`movement.stopped`.
- **FR-PHY-006** Trigger volumes MUST NOT block movement, and MUST announce `trigger.entered`/`trigger.exited` exactly once per actual transition of overlap with a mover, as deferred events (FR-ARCH-012).
- **FR-PHY-007** Blocking contacts MUST be announced as `collision.started`/`collision.ended` exactly once per transition, deferred; a contact ends when the mover is no longer blocked that step.
- **FR-PHY-008** Contact history and trigger occupancy MUST live in physics-owned, serializable world-state components (FR-ARCH-014/015) — readable by consumers directly, and eligible for save capture if persistence ever needs them (which slices a save captures is `32-Save-Load-and-Persistence.md`'s decision).
- **FR-PHY-009** A broadphase MUST narrow narrowphase candidates (uniform grid keyed by cell), rebuilt from world state each step — derived data, never a stale cache.
- **FR-PHY-010** A world with no colliders, or colliders with no movers, MUST degrade gracefully: nothing faults, nothing is written (FR-ARCH-008).

## Non-Functional Requirements

- **NFR-PHY-001 (Determinism):** Resolution uses only IEEE-exact arithmetic; candidates and event emissions are ordered by ascending entity id; identical world state and dt sequences reproduce bit-identical results (NFR-ARCH-001, FR-ARCH-025).
- **NFR-PHY-002 (Frame-rate independence):** Behavior is a function of fixed steps; host frame chunking, including the clamped catch-up after backgrounding, cannot change outcomes (FR-ARCH-021/022).
- **NFR-PHY-003 (Performance):** Broadphase keeps narrowphase work proportional to local density, not world population; per-step allocations stay bounded by collider count (NFR-ARCH-003).

## Acceptance Criteria

- Entities cannot pass through solids: a dead-on approach rests exactly at the contact face and holds (FR-PHY-002); a diagonal approach slides (FR-PHY-003).
- No tunneling at target speeds: a mover crossing many times a solid's thickness per step is still clamped at the face (FR-PHY-004); a 10-second stall resolves identically to the same steps delivered live (NFR-PHY-002).
- Triggers emit enter/exit deterministically: exactly once per pass-through, deferred to the tick boundary, with occupancy readable in world state (FR-PHY-006/008).
- Contact begin/end events fire exactly once per transition (FR-PHY-007).
- Identical input scripts reproduce identical trajectories and event sequences (NFR-PHY-001).
- A collider-free world runs untouched (FR-PHY-010).

## Dependencies

- `02-System-Architecture.md` — fixed-step loop, slice ownership, deferred events, determinism.
- `15-Movement-and-Traversal.md` (issue #19) — the velocity integration this System constrains; its Risks section assigns the constraint pass here.
- Consumers: Buildings and interiors (`25`), Quest Engine (`20-Quest-Engine.md`), Dialogue, NPC behavior — via trigger/collision events; Save/Load (`32`) — owned slices are plain data a save could capture.

## Implementation Notes (non-normative)

- The step's origin is reconstructed as `position − velocity·dt` (Movement integrates semi-implicitly, so this is exact); when Movement's world-bounds clamp shortened the step, the reconstruction converges on the clamped position and the depenetration backstop covers the sliver.
- Movers resolve in store order; each resolved box immediately replaces the mover's snapshot for later movers, so mover-vs-mover contacts are computed against where entities actually are. Grid cells stay keyed by the snapshot — conservative, and refreshed next step.
- The grid cell size (32 logical units) suits marker-scale boxes in the 320×180 logical space; it is a constant, not content.
- "Contact" means *blocked this step*: releasing the intent while touching ends the contact — which is exactly when audio/UI want to stop reacting to the press.

## Edge Cases

- **Spawned or restored inside a solid.** The depenetration backstop pushes out along the smaller penetration axis (ties toward x, direction by relative centers) — deterministic, never stuck (FR-PHY-002).
- **Grazing a corner.** Cross-axis overlap is strict: touching a face or corner exactly does not block, so walking flush past a wall's end never snags.
- **Two solids meet at the stop face.** The nearest face wins; equal faces resolve to the lowest entity id — stable across runs.
- **A trigger on a moving entity.** Volumes may move; occupancy is computed from resolved boxes either way.
- **Backgrounded tab.** The loop clamps catch-up (FR-ARCH-022); each fixed step still sweeps its whole segment, so resume cannot teleport a mover through geometry.

## Risks

- **Ownership drift.** Physics writes `Position` and `Motion` velocity that Movement also writes. Mitigation: the boundary is phase-ordered and documented — Movement proposes within a step, Physics disposes; Physics never touches intent, `moving`, or facing (FR-PHY-005).
- **Broadphase staleness.** In-step movement can cross cell boundaries. Mitigation: queries cover the whole swept area, and narrowphase boxes are refreshed as movers resolve; a mover would need to cross a full cell while sharing it with another mover in one step to miss — outside the slice's speed envelope, revisited with `33-Performance-Budgets.md`.
- **Event spam from oscillating contacts.** Mitigation: contacts and occupancy are diffed against owned history; only true transitions publish.

## Open Questions

- **OQ-PHY-1:** Whether region content should author collision geometry directly (tile masks, polygons) or keep composing colliders on entities — decided with `25-Buildings-and-Interiors.md`.
- **OQ-PHY-2:** Whether NPC movers need mutual avoidance (soft-push) rather than hard blocking — decided with `22-NPC-and-Behavior.md`.

## Future Considerations

- Additional collider shapes (circles for characters) behind the same `Collider` data contract.
- A navigation layer (walkable-space queries, path requests) built on the same broadphase.
- One-way platforms/doors as conditional solids driven by world state (a region coming online unlocks its door).

## Version / Author

Version 1.0 — Mike Blom.
