# Resume.World — Input and Controls

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** INP

---

## Purpose

This document specifies how device input becomes gameplay intent: the per-frame snapshot boundary, the data-driven binding layer, and the intent vocabulary every other System consumes. It realizes FR-ARCH-023 (one immutable snapshot per frame) and serves the Vision's responsiveness and accessibility requirements (NFR-VIS-003/004).

## Overview

Input flows through three stages, each with a hard seam:

1. **Devices → snapshot (Platform Adapter).** The adapter's `InputDevice` reports raw device state; the runtime loop samples it exactly once per frame and freezes it, so every System observes identical input for that frame (FR-ARCH-023). Pointer coordinates are normalized into logical units at this boundary — simulation never sees pixels.
2. **Snapshot → intent (Input System).** The Input System is the only reader that interprets the snapshot. It resolves pressed keys through a **bindings table** — plain data mapping actions (`move-left`, `interact`, …) to physical key codes — and a held primary pointer/touch into a *move-toward* target. The result lands in an **intent slice** the System owns (FR-ARCH-015) and is announced as typed **intent events** on change (FR-ARCH-012).
3. **Intent → behavior (consumers).** Movement, UI, and interaction Systems read the intent slice or subscribe to intent events. They never see keys, buttons, or pointers, so swapping control schemes touches data, not consumers.

## Goals

- One immutable input snapshot per frame, observed identically by every System.
- Keyboard and touch as first-class, equivalent control paths from day one (NFR-VIS-004).
- Bindings as data: remapping is a world-state write, never a code change.
- A small, typed intent vocabulary that decouples every consumer from devices.
- Full determinism: intent resolution is a pure function of snapshot + world state.

## Non-Goals

- The accessibility remap **UI** (Phase 3, `34-Accessibility.md`); this document only guarantees the data layer that UI writes to.
- Gameplay reactions to intents (movement rules, interaction outcomes — their own documents).
- Gamepad support (a future binding namespace; the seam already accommodates it).
- Gesture recognition beyond press/hold (swipes, multi-touch — future consideration).

## User Stories

- *As a player on a laptop,* I steer with arrows or WASD interchangeably and everything responds the same frame.
- *As a player on a phone,* I hold a point on screen and the character heads there — the same behavior a keyboard player gets, with no separate build (NFR-VIS-004).
- *As a player who remaps keys,* I bind movement to my preferred keys and the world obeys immediately, because bindings are data.
- *As an engine developer,* I add an interaction System by subscribing to `intent.interact`, never touching key codes.
- *As a tester,* I feed a scripted snapshot sequence and get bit-identical intent every run.

## Functional Requirements

- **FR-INP-001** Device state MUST be sampled into an immutable snapshot exactly once per frame, before simulation; every System MUST observe the identical snapshot object for that frame (FR-ARCH-023).
- **FR-INP-002** Only the Input System interprets the snapshot. Other Systems MUST consume the intent slice or intent events, never raw keys/pointer state.
- **FR-INP-003** Bindings MUST be data: an action → key-codes table in world state, replaceable at runtime by writing the bindings component. Engine defaults (arrows + WASD + Space/Enter/KeyE) apply when no table is present. Remapping MUST require no code change.
- **FR-INP-004** Keyboard and touch MUST resolve into the same intent vocabulary: bound keys drive the move axis; a held primary pointer/touch drives a move-toward target in logical units; an active keyboard axis wins when both are present.
- **FR-INP-005** Intent changes MUST be announced as typed, deferred events (`intent.move` on any change to the resolved movement intent; `intent.interact` once per press, not per held frame) (FR-ARCH-012).
- **FR-INP-006** The intent slice MUST be owned by the Input System (FR-ARCH-015) and MUST exist from `init`, so consumers can always read a well-formed intent.
- **FR-INP-007** A malformed or absent snapshot MUST resolve to idle intent, never a fault (FR-ARCH-008).
- **FR-INP-008** Intent resolution MUST be a pure function of the snapshot and world state: no wall clock, no unseeded randomness (NFR-ARCH-001), so recorded sessions replay to identical intent sequences (FR-ARCH-025).

## Non-Functional Requirements

- **NFR-INP-001 (Latency):** Input sampled at frame start is acted on within the same frame's simulation steps; no internal queueing adds frames of lag (serves NFR-VIS-001's "everything acknowledges you").
- **NFR-INP-002 (Testability):** The Input System is unit-testable with a fabricated context and scripted snapshots; the snapshot boundary is testable with probe Systems (NFR-ARCH-002).
- **NFR-INP-003 (Extensibility):** New actions and new device kinds are new bindings-table entries and snapshot fields — consumers of existing intents never change (NFR-ARCH-005).

## Acceptance Criteria

- Probe Systems registered at different points in the order observe the same frozen snapshot object within a frame, and a fresh one next frame (FR-INP-001).
- A held right arrow and a held touch to the player's right displace the player identically over the same duration (FR-INP-004).
- Writing a custom bindings component remaps movement to new keys and unbinds the defaults, with no code change (FR-INP-003).
- A held interact key publishes exactly one `intent.interact`; releasing and pressing again publishes another (FR-INP-005).
- Malformed snapshot payloads leave intent idle and throw nothing (FR-INP-007).

## Dependencies

- `02-System-Architecture.md` — the loop's input phase, event bus, world-state ownership.
- The Platform Adapter's `InputDevice` contract (issue #14) and the composition root's logical-unit normalization (issue #15).
- Consumers: Movement (issue #15), future UI/HUD (`18`), interaction and dialogue Systems.
- `34-Accessibility.md` (planned) — the remap UI writes the bindings data this document defines.

## Implementation Notes (non-normative)

- Physical key codes (`KeyW`, `ArrowLeft`) rather than characters keep bindings keyboard-layout-independent; they are hardware identifiers, not player-visible text, so they are engine data, not locale strings.
- The bindings table is deliberately flat (`action → codes[]`). Contexts/chords (menu vs. world bindings) can layer later as additional tables selected by UI state.
- The move-toward target is passed through in logical units rather than resolved to a direction, so the Input System needs no knowledge of any entity's position — direction is the consumer's business.
- `intent.move` fires on change, not per frame, keeping the observable event log legible (FR-ARCH-013) and replay comparisons meaningful.

## Edge Cases

- **Opposing keys held (left + right):** the axis sums to zero — idle, not jitter.
- **Keyboard pressed while touch held:** the axis wins (FR-INP-004); releasing the keys hands control back to the touch target the same frame.
- **Focus loss mid-hold:** the browser adapter clears key state on blur, so no stuck movement on refocus (adapter contract, issue #14).
- **A bindings table missing an action:** that action simply never fires; other actions are unaffected.
- **Two bindings components in the world:** the first by deterministic query order wins; bindings ownership discipline arrives with the settings/UI work.

## Risks

- **Intent vocabulary sprawl.** Every System inventing intents erodes the seam. Mitigation: intents live in the Input System's module; additions are reviewed there.
- **Divergent feel between input paths.** Touch steering and keyboard movement could drift apart in speed or responsiveness. Mitigation: the equivalence acceptance test pins them together.
- **Bindings data corruption** (a bad remap bricking controls). Mitigation: defaults always exist as a fallback table in code-as-data; a future settings UI validates before writing.

## Open Questions

- **OQ-INP-1:** Virtual on-screen controls (a thumbstick) for touch — needed, or is move-toward sufficient? Decided with `19-Onboarding-and-First-Session.md` playtesting.
- **OQ-INP-2:** Whether bindings ship per Content Pack (a pack suggesting a scheme) or stay engine/player data only. Leaning player-only; packs describe worlds, not controls.
- **OQ-INP-3:** Gamepad mapping namespace and dead-zone policy, when gamepad support is scheduled.

## Future Considerations

- Gamepad and gesture bindings as new code namespaces in the same table.
- Binding contexts (world / menu / mini-game) selected by UI state.
- Input recording surfaces for accessibility review: the intent stream is already the observable artifact.

## Version / Author

Version 1.0 — Mike Blom.
