# Resume.World — NPC and Behavior

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** NPC

---

## Purpose

This document specifies the NPC and Behavior System: how characters defined entirely in content move through the world on data-driven routines, shift activity with the day/night cycle, and offer the interaction affordance that starts dialogue and advances quests — the "world feels alive" pillar delivered as composition, never as scripted engine code.

## Overview

An NPC is a content document (`03-Data-Model-and-Content-Pipeline.md`, schema `npc`): a display-name locale key, an appearance asset reference, an optional `dialogueRef`, and a `routine` — an ordered list of entries, one per time-of-day phase, each optionally carrying waypoints and a speed. The composition root spawns one entity per NPC contained in the active region, attaching the immutable `Npc` definition alongside the generic scene components (position, renderable, collider, motion).

The behavior System composes three primitive behaviors from that data each fixed step:

- **idle** — a routine entry with no waypoints: the character rests in place, holding facing.
- **move-to** — an entry with a single waypoint: the character walks there and stays.
- **patrol** — an entry with several waypoints: the character walks the loop indefinitely.

Which entry is active is selected by the current time-of-day phase, tracked from the shared `time.phase-changed` event (`23-Day-Night-and-Weather.md` will own publishing it; the Audio System already consumes the same vocabulary). Until a phase is announced, the first routine entry is active, so a world without a day/night System still has walking characters (FR-ARCH-008).

Interaction is the System's second responsibility: on the Input System's `intent.interact`, if the UI surface is not modal and a character stands within interaction range of the player, the System announces `npc.interacted` and — when the definition declares a `dialogueRef` — publishes the Dialogue System's `dialogue.start.requested`. Dialogue hooks (`21-Dialogue-System.md`) are how the same press advances quests; this System knows neither what a conversation nor a quest is.

## Goals

- Characters as pure content: who exists, where they walk, when they rest, and what they say are JSON; the engine ships walking, waiting, and the interact affordance (FR-VIS-007).
- A living world: routines shift with the world clock so places read differently by day and night (Vision pillar 1).
- Composable behavior: idle / move-to / patrol are one data shape interpreted by one System acting on components — no per-character code, ever.
- Deterministic motion: identical world state and `dt` sequences reproduce identical walks (NFR-ARCH-001).

## Non-Goals

- Dialogue traversal and quest resolution — this System only publishes the start request; `21-Dialogue-System.md` and `20-Quest-Engine.md` own the consequences.
- Pathfinding, avoidance, or steering beyond straight-line waypoint walking — future work under this document's contract.
- The day/night clock itself — `23-Day-Night-and-Weather.md` (issue #29) publishes the phase; this System only listens.
- Proximity prompt rendering — the UI System owns the prompt surface; both layers share one interaction radius so the prompt and the affordance agree.

## User Stories

- *As a player,* I watch a character walk their rounds during the day and head home at night, and pressing interact beside them starts a conversation.
- *As a content author,* I give a character a night routine by adding one JSON entry — no code, no build.
- *As a quest author,* "talk to the character" works because the interact press starts their dialogue, whose hooks resolve my objective.
- *As a tester,* I replay a recorded session and every character retraces the same steps.

## Functional Requirements

- **FR-NPC-001** NPC definitions MUST come entirely from content documents; the engine MUST NOT name any character, route, or schedule (DATA-FR-027).
- **FR-NPC-002** The System MUST derive behavior from the definition's `routine`: no waypoints = idle, one waypoint = move-to, several = a repeating patrol loop. Malformed or absent routine data MUST degrade to idle, never fault (FR-ARCH-008).
- **FR-NPC-003** The active routine entry MUST be selected by matching the current time-of-day phase against each entry's `phase`; with no match the first entry applies; before any phase is announced the first entry applies.
- **FR-NPC-004** The System MUST track the phase from the shared `time.phase-changed` event and re-select every character's active entry when it changes, restarting the entry's waypoint sequence deterministically.
- **FR-NPC-005** Walking MUST integrate position at the entry's speed (engine default when unspecified) along straight segments each fixed step, clamped to the traversable space; the physics pass constrains the result against solids (`31-Physics-and-Collision.md`).
- **FR-NPC-006** The System MUST write each character's `Motion` slice (velocity and facing) so animation and camera consumers observe NPC movement exactly as they observe the player's. For character entities this System is the motion writer (FR-ARCH-015); the Movement System acts only on player-controlled entities. The shared `movement.started`/`movement.stopped` events remain player vocabulary — they pace autosave and audio cues — and MUST NOT be published for ambient character motion.
- **FR-NPC-007** On `intent.interact`, when the UI slice is not modal, the System MUST select the nearest character within the interaction radius of the player (ties broken by ascending entity id) and announce `npc.interacted { entityId, npcId, dialogueId }`; when the definition declares a `dialogueRef` it MUST also publish `dialogue.start.requested`. With no character in range it MUST do nothing.
- **FR-NPC-008** While the UI surface is modal, interact intents MUST be ignored by this System — the surface owns the press (`18-UI-UX-and-HUD.md`); world interaction resumes when the surface closes.
- **FR-NPC-009** All events this System publishes MUST be deferred (FR-ARCH-012) and delivered in the bus's deterministic order (FR-ARCH-010).
- **FR-NPC-010** Behavior state (current phase, waypoint progress) MUST live in a System-owned world-state component, serializable and adopted across re-init for hot-reload (FR-ARCH-014/015/016).

## Non-Functional Requirements

- **NFR-NPC-001 (Determinism):** update is pure with respect to (world state, dt, buffered events); no wall clock, no unseeded randomness (NFR-ARCH-001, FR-ARCH-025).
- **NFR-NPC-002 (Isolation):** unit-testable with a fake Context; no System references, no platform access (NFR-ARCH-002/004).
- **NFR-NPC-003 (Scale):** per-step cost is linear in the number of characters; no per-frame allocation beyond component writes on actual change (NFR-ARCH-003).

## Acceptance Criteria

- A character with a multi-waypoint routine entry walks the loop; announcing a phase change switches it to that phase's entry (rest or a different walk) — content-defined routines followed, shifting on day/night change.
- An interact press within range starts the character's dialogue through the real Dialogue System; hooks in that dialogue advance quests unchanged.
- An interact press while a dialogue is open does not start another conversation; a press out of range does nothing.
- Identical `dt` and event sequences reproduce identical character positions.
- A character with no routine, an unknown phase, or malformed waypoints stands idle without faulting.

## Dependencies

- `02-System-Architecture.md` — System lifecycle, slice ownership, deferred events, determinism.
- `03-Data-Model-and-Content-Pipeline.md` — the `npc` schema whose `routine` entries this System interprets.
- `15-Movement-and-Traversal.md` (issue #19) — the motion vocabulary (`Motion`, movement events) characters share with the player.
- `31-Physics-and-Collision.md` (issue #20) — the constraint pass that keeps walking characters out of solids.
- `18-UI-UX-and-HUD.md` (issue #23) — the modal flag and the shared interaction radius.
- `21-Dialogue-System.md` (issue #26) — the consumer of `dialogue.start.requested`.
- `23-Day-Night-and-Weather.md` (issue #29, future) — the publisher of `time.phase-changed`.

## Implementation Notes (non-normative)

- Waypoint walking is constant-speed straight-line segments: a step that would overshoot the waypoint lands exactly on it, and the index advances next step — simple, exact, and reproducible. Arrive-steering polish can come later without changing the contract.
- The interaction radius is the UI System's prompt radius, imported as shared vocabulary, so "a prompt shows" and "interact works" can never disagree.
- The `time.phase-changed` event type currently lives with the Audio System's vocabulary; when issue #29 lands the environment System both consumers subscribe unchanged.
- Routine entries carry author-facing `activity` notes (never rendered); the engine reads only `phase`, `waypoints`, and `speed`.

## Edge Cases

- **A phase with no matching entry** (content covers `day` only, world says `night`): the first entry applies — a character is never undefined.
- **A waypoint outside the traversable space:** motion clamps at the boundary; the character presses the edge until the segment ends. Content validation may warn later.
- **Two characters equidistant from the player on interact:** ascending entity id wins — deterministic.
- **A character with a dialogueRef but no spawned dialogue:** the request is published and the Dialogue System ignores the unknown id (FR-DLG-002); `npc.interacted` still announces the press.
- **Phase change mid-segment:** the new entry starts from the character's current position toward its first waypoint — no teleporting.

## Risks

- **Routine data drifting toward scripting.** Waypoints could sprawl into conditionals and triggers. Mitigation: behavior stays a closed set of primitives; new behavior means a new declared primitive in this document, not embedded logic.
- **Ownership collision on Motion.** Two writers on one slice would break FR-ARCH-015. Mitigation: the writer split is by entity class (player-controlled → Movement; characters → this System) and stated in both documents; physics remains the sanctioned constraint pass for both.
- **Interaction races with the UI surface.** The same press must not both open and advance a dialogue. Mitigation: all requests are deferred (FR-NPC-009), and the modal flag gates world interaction (FR-NPC-008).

## Open Questions

- **OQ-NPC-1:** Should characters face the player during conversation? Cosmetic; deferred to the art direction pass (#36).
- **OQ-NPC-2:** Should pack validation warn on unreachable waypoints or empty routines? Owner: content pipeline follow-up.
- **OQ-NPC-3:** Do routines need per-entry timing offsets (staggered schedules) beyond phase granularity? Deferred until the full reference pack (#35) demonstrates need.

## Future Considerations

- Grid or navmesh pathfinding behind the same waypoint contract.
- Reaction behaviors (look-at, flee, follow) as new composable primitives.
- Routine authoring aids in the content tools track (`37-Content-Authoring-Tools.md`).

## Version / Author

Version 1.0 — Mike Blom.
