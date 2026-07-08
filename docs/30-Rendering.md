# Resume.World — Rendering

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** REND

---

## Purpose

This document specifies the Rendering System: how the world state becomes pixels each frame, through the Platform Adapter's render surface, without the rest of the engine knowing anything about the host. It realizes the presentation phase of the runtime loop (`02-System-Architecture.md`, "The Runtime Loop") and serves the Vision's polish bar (NFR-VIS-001) and responsiveness requirement (NFR-VIS-004).

## Overview

Rendering is a System like any other: it conforms to the System interface and lifecycle, reads world state, and holds no reference to any other System. It is split across the loop's two phases. During the fixed simulation step it only *captures* — recording each drawable entity's motion span (previous → current position) into a world-state slice it owns. During the variable-rate presentation phase it *draws* — interpolating inside each motion span by the loop's alpha, transforming logical coordinates through the active camera, and issuing draw calls to the adapter's `RenderSurface` in stable layer order.

What to draw is data. An entity is drawable when it composes `Position` + `Renderable`; its draw layer is data; the camera is data (a component); sprite imagery arrives as asset ids resolved through the Content Pack's asset manifest. Rendering therefore contains no career facts and no host calls (NFR-ARCH-004, DATA-FR-027).

## Goals

- Draw every positioned `Renderable` at the correct position, every frame, on any viewport.
- Keep motion smooth at any frame rate by interpolating between fixed simulation steps (FR-ARCH-021).
- Make draw order deterministic and stable so layering never flickers.
- Keep the view a datum (camera component) so later Camera work is content/System work, not renderer surgery.
- Feed sprites from the pack's asset manifest so imagery is swappable content (DATA-FR-019).
- Remain host-agnostic: every draw goes through the adapter's `RenderSurface`.

## Non-Goals

- Animation state machines and sprite sheets (a separate issue/document).
- Art direction: palettes, shaders, and visual identity (`12-Art-Direction.md`, Phase 3).
- The Camera System's behavior (following, easing, bounds — `13-Camera.md`); this document only defines how rendering *consumes* a camera.
- Text rendering and UI/HUD composition (`18-UI-UX-and-HUD.md`).

## User Stories

- *As a player,* I see the world move smoothly even when the simulation ticks at a fixed rate my display does not share.
- *As an engine developer,* I make an entity visible by attaching one component, not by editing the renderer.
- *As a content author,* I change how a character looks by editing the asset manifest, never code.
- *As a tester,* I render a world onto the headless surface and assert exact draw commands, byte for byte.

## Functional Requirements

- **FR-REND-001** The Rendering System MUST draw exactly the entities composing `Position` + `Renderable`; no other entity may produce a draw call.
- **FR-REND-002** Draw order MUST be ascending by draw layer, where a `Renderable`'s explicit `layer` overrides its kind's default; ties MUST break by world insertion order, so ordering is stable across frames (FR-ARCH-027's spirit).
- **FR-REND-003** Presentation MUST interpolate each entity between its previous and current fixed-step positions by the loop's alpha (FR-ARCH-021); the motion span is captured during the fixed step into a slice owned by the Rendering System (FR-ARCH-015).
- **FR-REND-004** Rendering MUST be camera-aware: a camera component (view center + zoom) defines the view transform, and absent any camera the view MUST default to the centered whole-logical-space fit.
- **FR-REND-005** All drawing MUST go through the Platform Adapter's `RenderSurface`; the Rendering System MUST NOT touch host APIs (NFR-ARCH-004).
- **FR-REND-006** Rendering MUST read only world state and the adapter; it MUST NOT hold a reference to any other System (FR-ARCH-005). Its declared `movement` dependency is ordering only and MUST be tolerated absent (FR-ARCH-008).
- **FR-REND-007** A `Renderable` naming a `spriteRef` MUST resolve it through the asset manifest in world state and draw the sprite; an unresolvable ref MUST degrade to the kind's fallback shape, never fault (FR-ARCH-008).
- **FR-REND-008** Rendering MUST NOT mutate simulation state: running presentation more often, less often, or not at all yields identical simulation results (FR-ARCH-025).

## Non-Functional Requirements

- **NFR-REND-001 (Determinism):** Given identical world state, camera, alpha, and surface size, the emitted draw-command sequence is identical — this is what makes the replay test's render-stream comparison meaningful.
- **NFR-REND-002 (Performance):** Per-frame work is proportional to drawable entities; per-frame allocations in the draw path SHOULD be minimized (NFR-ARCH-003; budgets in `33-Performance-Budgets.md`).
- **NFR-REND-003 (Testability):** The full draw path is assertable against the headless surface's recorded commands (NFR-ARCH-002).

## Acceptance Criteria

- Entities render at their (interpolated) positions with stable layering across frames (FR-REND-001..003).
- A camera entity recenters and rescales the view; removing it restores the whole-space fit (FR-REND-004).
- A sprite ref present in the manifest draws via `drawSprite`; a missing ref draws the fallback rect and never throws (FR-REND-007).
- A recorded session replays to an identical draw-command stream (NFR-REND-001).
- The Rendering System imports nothing from any other System module and holds no System references (FR-REND-006).

## Dependencies

- `02-System-Architecture.md` — the System lifecycle, the loop's fixed/presentation split, world-state ownership.
- `03-Data-Model-and-Content-Pipeline.md` — the asset manifest (DATA-FR-019) and content isolation.
- The Platform Adapter's `RenderSurface` contract (issue #14).
- Downstream: `13-Camera.md`, `16-Animation.md`, `12-Art-Direction.md` build on this contract.

## Implementation Notes (non-normative)

- The motion span (`prevX/prevY → x/y`) is captured by the System's fixed-step `update`, which orders itself after `movement`; because it shifts current → previous each step, capture is correct for any System that moved the entity earlier in the step.
- The camera transform composes the whole-space fit scale with the camera zoom and centers the camera target on the surface; a centered zoom-1 camera therefore reproduces the letterboxed fit exactly, which keeps the no-camera default and the default spawned camera indistinguishable.
- Kind default layers (building < npc < player) are presentation defaults, not content; packs that need finer control set `layer` explicitly.
- Colors in this slice are engine presentation defaults keyed by generic scene roles; the art-direction pass replaces them wholesale.

## Edge Cases

- **A drawable spawns mid-frame** (no motion span yet): it draws at its current position; interpolation begins the next step.
- **An entity's `Renderable` names an unknown kind:** it draws in the fallback color at the fallback layer — visible, never fatal.
- **Zoom or surface degenerate to zero:** the fit scale clamps the transform; no division-by-zero reaches the surface.
- **Two cameras exist:** the first by deterministic query order wins; camera ownership discipline belongs to the future Camera System (FR-ARCH-015).
- **A sprite asset has not finished loading:** the adapter's `drawSprite` contract already skips unloaded sprites gracefully; rendering does not track load state.

## Risks

- **Renderer scope creep.** Animation, cameras, and UI all border this System. Mitigation: the Non-Goals above are load-bearing; each neighbor has its own document and issue.
- **Interpolation artifacts on teleports.** A large positional jump interpolates as a visible streak. Mitigation: a future `teleported` marker (or motion-span reset event) lets rendering snap; not needed for current content.
- **Draw-order coupling to insertion order.** Stable ties lean on entity creation order; content that needs guaranteed order must say so via `layer`. Documented in FR-REND-002.

## Open Questions

- **OQ-REND-1:** Whether presentation Systems ultimately share the simulation registry or get a parallel presentation registry (OQ-ARCH-4); rendering currently registers normally and exposes its draw entry point to the composition root.
- **OQ-REND-2:** Viewport culling — at what world size does skipping off-view drawables pay for itself? Deferred to `33-Performance-Budgets.md` profiling.
- **OQ-REND-3:** Whether sprite atlasing/batching belongs in the adapter or the renderer, decided when real art volume arrives (`38-Asset-Pipeline.md`).

## Future Considerations

- Render interpolation for rotation/scale once `Renderable` grows those fields.
- Multiple views (minimap, interiors) as additional camera entities plus surface regions.
- A diagnostics mode drawing collision/debug geometry through the same layered pipeline (FR-ARCH-031).

## Version / Author

Version 1.0 — Mike Blom.
