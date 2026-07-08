# Resume.World — Movement and Traversal

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** MOV

---

## Purpose

This document specifies the Movement System: how move intents become entity motion that feels immediate and satisfying (Vision pillar 4, "Everything acknowledges you") while remaining deterministic and frame-rate independent. It is the layer between the Input System's intent vocabulary (`14-Input-and-Controls.md`, planned detail) and everything that consumes motion — animation, camera, and later physics.

## Overview

Movement is velocity integration under two rates. Each fixed step the System derives a **desired velocity** from the intent slice — keyboard axes at top speed (diagonals normalized), or arrive-steering toward a move-toward target — then moves the entity's actual velocity toward it at the **acceleration** rate, or toward rest at the **friction** rate when the intent clears. Position integrates semi-implicitly from the new velocity and clamps to the traversable space, killing the velocity component pressed into a boundary.

The System owns the `Motion` slice (velocity, unit facing, and a moving flag) and the `Position` it integrates; consumers read those or subscribe to the deferred `movement.started` / `movement.stopped` transition events. Tuning is data: `speed`, `acceleration`, and `friction` live on the controllable entity's component, with engine defaults when absent.

## Goals

- Immediate feel: motion visibly answers intent on the first step and reaches top speed in fractions of a second.
- Composed feel: ramps and stops are eased by tuning, never instantaneous teleports of velocity.
- One motion vocabulary for keyboard and touch: axes and move-toward targets produce the same kind of motion.
- Expose velocity and facing as world state for animation and camera, so consumers never infer motion by diffing positions.
- Stay deterministic and frame-rate independent: motion is a pure function of (world state, intent, fixed dt).

## Non-Goals

- Collision response and obstacle traversal — the Physics and Collision issue builds on this System's velocity.
- Gaits, sprinting, stamina, or traversal verbs (climb, vault) — future issues extend the same slices.
- NPC locomotion — NPC behavior drives its own entities; this document covers intent-driven motion.
- Pathfinding for move-toward targets: arrive-steering heads straight for the target; routing around obstacles arrives with physics/navigation work.

## User Stories

- *As a player on a keyboard,* the entity leans into motion the instant I press and settles the instant I release, so control feels wired to my hands.
- *As a player on a phone,* holding a point walks the entity there and stops it exactly there — no orbiting, no jitter.
- *As an animation author,* I read velocity and facing from world state to pick a walk cycle and direction.
- *As a tester,* I feed a scripted intent sequence and get the identical trajectory every run.

## Functional Requirements

- **FR-MOV-001** The Movement System MUST derive motion only from the intent slice and its own owned state — never from raw keys, pointers, or another System (FR-ARCH-005; intent per the Input System).
- **FR-MOV-002** Velocity MUST approach the desired velocity at the entity's acceleration rate and decay toward rest at its friction rate; both rates MUST be per-entity data with engine defaults.
- **FR-MOV-003** Keyboard axis intents MUST normalize diagonals so top speed is direction-independent.
- **FR-MOV-004** Move-toward intents MUST arrive: approach speed is capped so the entity can brake within the remaining distance, settling at the target without overshoot cycles or orbiting.
- **FR-MOV-005** Position MUST integrate on the fixed step (semi-implicit) and clamp to the traversable space; the velocity component into a boundary MUST be zeroed.
- **FR-MOV-006** The System MUST own and publish the `Motion` slice — moving flag, velocity, and unit facing (held at its last direction while at rest) — for animation and camera consumers (FR-ARCH-015).
- **FR-MOV-007** Motion start/stop MUST be announced as deferred events exactly on the transition of actual motion (velocity leaving/reaching rest), not on intent edges (FR-ARCH-012).
- **FR-MOV-008** A world with no intent slice MUST degrade gracefully: entities coast to rest; nothing faults (FR-ARCH-008).

## Non-Functional Requirements

- **NFR-MOV-001 (Determinism):** Only IEEE-exact arithmetic plus correctly-rounded `Math.sqrt`; identical intent and dt sequences reproduce bit-identical trajectories (NFR-ARCH-001, FR-ARCH-025).
- **NFR-MOV-002 (Frame-rate independence):** Motion is a function of fixed steps; how host frames chunk elapsed time cannot change the trajectory (FR-ARCH-021).
- **NFR-MOV-003 (Responsiveness):** With engine defaults, an entity reaches ≥90% of top speed within 0.2 simulated seconds and rests within 0.1 seconds of intent release — the numbers behind "feels responsive".

## Acceptance Criteria

- Velocity ramps at the acceleration rate, holds top speed exactly, and friction rests it after release (FR-MOV-002).
- The same simulated duration delivered as different host-frame chunkings yields identical position and motion (NFR-MOV-002).
- A scripted mixed keyboard/touch intent sequence reproduces an identical trajectory across runs (NFR-MOV-001).
- A move-toward target is reached and held without orbiting (FR-MOV-004).
- Facing persists through rest at the last motion direction (FR-MOV-006).
- Start/stop events fire exactly once per actual transition (FR-MOV-007).

## Dependencies

- `02-System-Architecture.md` — fixed-step loop, slice ownership, event bus, determinism.
- The Input System (issue #17) — the intent slice this System consumes.
- Consumers: Animation (`16-Animation.md`), Camera (`13-Camera.md`), Physics/Collision (next issue), Audio (motion transition cues).

## Implementation Notes (non-normative)

- The two-rate model (acceleration while intending, friction while coasting) is the smallest tuning surface that produces "lean in / settle out" feel; curves and gaits can layer on later without changing the contract.
- Arrive-steering caps desired speed at `sqrt(2 · acceleration · distance) · 0.9`; the safety factor keeps the ideal stopping distance strictly inside the remaining distance, so the approach is monotone in practice.
- The moving flag derives from velocity, not intent — so the stop event coincides with the entity visibly resting, which is what audio/animation want to react to.
- `LOGICAL_SPACE` stands in for traversable bounds until regions carry real geometry; the clamp is the seam where region bounds plug in.

## Edge Cases

- **Intent flips direction at top speed.** Velocity swings through the turn at the acceleration rate — a brief, tunable drift rather than an instant reversal.
- **Move-toward target inside the arrival epsilon.** Desired velocity is zero; friction rests the entity where it stands.
- **Boundary approach at speed.** Position clamps and the normal velocity component dies; the tangential component survives, so sliding along a wall works.
- **Both axis and target in one intent.** The axis wins (deliberate: keyboard overrides steering), matching the Input System's precedence.
- **Zero acceleration data.** Desired velocity is never approached; the entity stays at rest — degenerate but harmless, and visible immediately in authoring.

## Risks

- **Feel is opinion.** Defaults tuned in the abstract may read floaty on real content. Mitigation: rates are per-entity data; playtesting adjusts data, not code.
- **Physics rework.** Collision (next issue) could be tempted to re-own velocity. Mitigation: physics consumes and constrains this System's velocity through its own pass; ownership boundaries stay in the docs.

## Open Questions

- **OQ-MOV-1:** Whether traversal verbs (dash, climb) are new intents on this System or sibling Systems — decided with `10-Gameplay-Loops.md`.
- **OQ-MOV-2:** Whether facing should quantize to compass directions for sprite-sheet animation — decided by `16-Animation.md`.

## Future Considerations

- Region-supplied traversable geometry replacing the logical-space clamp.
- Surface-dependent tuning (ice, mud) as data multipliers on the two rates.
- Analog input magnitudes (gamepad sticks) scaling desired speed below top speed — the intent shape already permits fractional axes.

## Version / Author

Version 1.0 — Mike Blom.
