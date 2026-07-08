# Resume.World — Camera

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** CAM

---

## Purpose

This document specifies the Camera System: how the view the player sees is chosen each step — following the controllable entity smoothly, staying inside the region, and honoring zoom requests — after simulation has settled and before presentation draws. It realizes the "late update" phase of the runtime loop (`02-System-Architecture.md`) for the view, serving the Vision's polish bar (NFR-VIS-001): the camera is part of how movement *feels*.

## Overview

The camera is data plus one System. The view itself is the `Camera` component (center in logical units plus a zoom multiplier) that rendering already consumes through its view transform (`30-Rendering.md`); the Camera System is that component's owner and sole writer. Each fixed step, ordered after movement by a declared dependency, it eases the view center toward its follow target — the player's just-resolved position — with a damped blend, eases zoom toward the requested level, and clamps the center so the visible span never leaves the region extents. Configuration is data too: a `CameraFollow` component (damping, zoom target, enable switch), and a `camera.zoom` event any System can publish to request a zoom level.

At zoom 1 the whole region is visible, so the bounds clamp pins the view to the region center — the walking skeleton's whole-space fit is simply this System's degenerate case, not a special mode.

## Goals

- Make following feel intentional: damped, monotonic, arriving exactly, never oscillating.
- Keep the visible span inside the region extents at every zoom.
- Run after simulation resolves positions, so the camera never lags a frame behind the player.
- Keep the view a datum: rendering consumes `Camera`; nothing consumes the System.
- Expose zoom as a hook (event + config), so later gameplay and UI zoom without touching this System.

## Non-Goals

- Cinematic scripting (camera paths, cutscene framing) — explicitly out of scope per the issue.
- Screen shake, look-ahead, and dead zones — future feel work layered on the same slice.
- The view transform math itself (`30-Rendering.md` owns surface fitting and letterboxing).
- Pointer-to-world mapping under a moved camera (the Input System issue tracks camera-aware mapping).

## User Stories

- *As a player,* the view glides after me rather than snapping, so moving feels composed.
- *As a player at the region's edge,* the camera stops at the boundary instead of showing void.
- *As an engine developer,* I zoom the view by publishing one event, not by referencing the camera System.
- *As a tester,* I assert the exact camera path from a scripted session, because easing is deterministic.

## Functional Requirements

- **FR-CAM-001** The Camera System MUST be the sole writer of the `Camera` component (FR-ARCH-015); all other code consumes it read-only.
- **FR-CAM-002** The System MUST run after simulation has resolved the followed position in the same fixed step (late update), expressed as a declared ordering dependency on the movement System — tolerated absent (FR-ARCH-008).
- **FR-CAM-003** The view center MUST ease toward the follow target with a damped, monotonic blend that cannot overshoot or oscillate, and MUST land exactly on the target when within a snap epsilon.
- **FR-CAM-004** The view center MUST be clamped so the visible logical span stays inside the region extents at the current zoom; at whole-region zoom this collapses to the region center.
- **FR-CAM-005** Zoom MUST be requestable by event (`camera.zoom`); requests are clamped to the engine's zoom limits, eased like the center, and malformed requests are ignored (FR-ARCH-008).
- **FR-CAM-006** Follow behavior MUST be configurable as data (`CameraFollow`: damping, zoom target, enabled); disabling freezes the view without unregistering anything.
- **FR-CAM-007** The follow target MUST come from world state (the player-controlled entity's position); with no target the view MUST return to the region center.

## Non-Functional Requirements

- **NFR-CAM-001 (Determinism):** Easing uses only IEEE-exact arithmetic (linear blend, no transcendental functions), so identical sessions produce bit-identical camera paths (NFR-ARCH-001).
- **NFR-CAM-002 (Testability):** The System is fully assertable with a bare context: init, script positions, step, read the component (NFR-ARCH-002).
- **NFR-CAM-003 (Cost):** Steady state (settled camera, still target) performs no component writes.

## Acceptance Criteria

- The camera approaches a moved player monotonically, never passes it, and lands exactly (FR-CAM-003).
- A player in a region corner converges the camera to the clamped bound, not the player (FR-CAM-004).
- The camera's update order is after movement, and it eases toward the position resolved in the *same* step (FR-CAM-002).
- A `camera.zoom` request eases zoom to the clamped level; garbage requests change nothing (FR-CAM-005).
- Disabling `CameraFollow` freezes the view (FR-CAM-006).

## Dependencies

- `02-System-Architecture.md` — System lifecycle, late-update ordering, slice ownership, determinism.
- `30-Rendering.md` — the `Camera` component's consumer; the view transform that gives zoom its meaning.
- `14-Input-and-Controls.md` (planned detail) — camera-aware pointer mapping builds on this view.

## Implementation Notes (non-normative)

- The blend factor is `min(1, damping * dt)`: frame-rate independence comes from the fixed step, and avoiding `Math.exp` keeps easing reproducible across hosts whose transcendental rounding differs.
- Region extents are currently the logical space; when regions carry real bounds (`11-World-Design.md`), the clamp reads them from the region's content — a data change, not a System change.
- The bounds clamp uses the whole-space-fit approximation of the visible span (logical space over zoom). Letterboxed surfaces can see slightly more; the visible *world* never exceeds the region because rendering letterboxes outside it.
- Camera interpolation between fixed steps (like entity `RenderMotion`) is deliberately deferred: at the current fixed rate the step-sampled camera is smooth; if profiling ever says otherwise, the camera writes a motion span the renderer interpolates — additive change.

## Edge Cases

- **No camera entity in the world.** Init creates one at the region center; the System never assumes the spawner ran.
- **No player entity.** The view eases home to the region center (FR-CAM-007) rather than freezing on a stale target.
- **Zoom-out request while pinned at a bound.** Re-clamping runs every step at the current zoom, so widening the view slides the center back inside the tighter inset.
- **Two camera entities.** The System adopts the first (deterministic query order); a second camera is inert data until ownership work says otherwise.
- **Damping of zero.** Blend is zero; the camera holds position — equivalent to disabled, and harmless.

## Risks

- **Feel debt.** A single damping constant may read as floaty or stiff on different scenes. Mitigation: damping is per-camera data; scene-specific tuning is content work.
- **Ownership drift.** Other Systems writing `Camera` directly would fight the easing. Mitigation: FR-CAM-001 plus the zoom event as the sanctioned channel; review holds the line.

## Open Questions

- **OQ-CAM-1:** Dead-zone follow (camera moves only when the player nears the view edge) — decide when traversal (`15-Movement-and-Traversal.md`) defines how far sprints move the player per second.
- **OQ-CAM-2:** Whether region transitions cut or glide the camera — decided with `25-Buildings-and-Interiors.md`.

## Future Considerations

- Look-ahead bias toward movement direction, as data on `CameraFollow`.
- Cinematic paths as a separate System that temporarily disables follow via the same data switch.
- Per-region zoom defaults from content once regions carry presentation hints.

## Version / Author

Version 1.0 — Mike Blom.
