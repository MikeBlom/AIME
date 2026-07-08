# Resume.World — Animation

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** ANIM

---

## Purpose

This document specifies the Animation System: how world state becomes moving imagery — a sprite animation state machine whose transitions are driven by simulation facts (velocity, facing, gameplay events), never by direct System calls. It serves the Vision's polish bar (NFR-VIS-001) and realizes the "Animation interpolates" slot of the presentation phase in `02-System-Architecture.md`.

## Overview

Animation is a System like any other: it conforms to the System interface and lifecycle, reads shared world state, and holds no reference to any other System. It is split across the loop's two phases, mirroring rendering. During the fixed simulation step it runs the **state machine**: each animated entity's base clip is derived from the movement System's motion slice (`moving` → *walk*, at rest → *idle*), clip time advances deterministically by `dt`, and buffered **one-shot** triggers (the interact intent, or any System publishing the generic one-shot event) start clips that play once and return to the base state. All of that lands in the animation slice this System owns. During the variable-rate presentation phase, a pure pose-selection pass interpolates clip time inside the current step by the loop's alpha and resolves the current **frame** to a sprite ref, which the composition root hands to rendering.

What a clip looks like is content. Frames resolve through the Content Pack's asset manifest by key — `<spriteRef>.<clip>[.<direction>].<frame>`, most-specific-first — so imagery, frame counts, and directional variants are authored data (DATA-FR-019). A clip the manifest does not define falls back to the entity's base sprite; the engine names no career fact and ships no frame.

## Goals

- Drive every animation transition from world state or bus events; no System ever calls animation directly.
- Keep clip time deterministic: it advances only by simulation `dt`, so replays animate identically.
- Interpolate in the presentation phase so frame selection is smooth at any display rate.
- Make one-shots (interact, restore, …) a generic event-driven capability, open to future Systems without code changes here.
- Keep all imagery in the Content Pack: frames are manifest keys, direction and frame count are data.
- Degrade gracefully: missing clips, frames, or manifests fall back to the base sprite, never fault.

## Non-Goals

- Specific character art and clip authoring (Phase 3; `12-Art-Direction.md`).
- Skeletal rigs and tweened bones: the state-machine and pose contract is rig-agnostic, but v1 resolves sprite frames only.
- Rendering itself (`30-Rendering.md`): animation outputs a pose; drawing it is the renderer's job.
- Gameplay meaning of events: animation reacts to facts (an interact happened), it does not decide them.

## User Stories

- *As a player,* the character I steer walks when I move and settles when I stop, without stutter or snapping.
- *As a player,* pressing interact produces a visible acknowledgment that finishes and returns to normal on its own.
- *As a content author,* I add a walk cycle by adding manifest entries — `hero.walk.e.0`, `hero.walk.e.1`, … — never by touching code.
- *As an engine developer,* I trigger a celebration animation from a new System by publishing one event, with no reference to the Animation System.
- *As a tester,* I replay a recorded session and every frame of animation state reproduces exactly.

## Functional Requirements

- **FR-ANIM-001** The Animation System MUST derive each animated entity's base clip from world state alone: an entity whose motion slice reports `moving` plays *walk*; otherwise it plays *idle*. Entities without a motion slice play *idle* (FR-ARCH-008).
- **FR-ANIM-002** An entity is animated exactly when it composes a `Renderable` carrying a `spriteRef`; the System MUST ignore all other entities.
- **FR-ANIM-003** Clip time MUST advance only by the fixed-step `dt`, restart on clip transition, and be recorded as a previous→current span so presentation can interpolate inside the step (FR-ARCH-021, NFR-ARCH-001).
- **FR-ANIM-004** One-shot clips MUST be triggered only by bus events: the interact intent targets every player-controlled entity; the generic one-shot event (`animation.one-shot { clip, entityId? }`) targets the named entity, or every player-controlled entity when `entityId` is absent (FR-ARCH-005).
- **FR-ANIM-005** An active one-shot MUST take precedence over the base clip for pose selection, expire after its duration — the clip's manifest frame count over its fps, or a tuned/default fallback when the manifest defines no frames — and return the entity to its base state (AC: one-shots "return to base state").
- **FR-ANIM-006** Pose selection MUST resolve frames through the asset manifest most-specific-first: directional frames (`ref.clip.dir.n`), directional still (`ref.clip.dir`), plain frames (`ref.clip.n`), plain still (`ref.clip`), and finally the base sprite when none resolve. Direction is the dominant facing axis (e/w/n/s, south by default).
- **FR-ANIM-007** The presentation pass MUST be pure: it reads world state and returns poses without writing anything, so presentation cadence cannot perturb simulation or replay (FR-ARCH-025, FR-REND-008's spirit).
- **FR-ANIM-008** The Animation System MUST own its animation slice exclusively (FR-ARCH-015); tuning (fps, one-shot fallback duration) is per-entity component data, never code.
- **FR-ANIM-009** A malformed one-shot payload, an unknown clip, or an absent manifest MUST degrade silently to the base sprite/state, never fault the step (FR-ARCH-008).

## Non-Functional Requirements

- **NFR-ANIM-001 (Determinism):** Given identical world state, events, and `dt` sequence, animation state and pose output are identical; the System reads no clock and no randomness (NFR-ARCH-001).
- **NFR-ANIM-002 (Performance):** Per-step work is proportional to animated entities; frame probing is bounded so a malformed manifest cannot stall a step (NFR-ARCH-003).
- **NFR-ANIM-003 (Testability):** The state machine is assertable from a fake Context, and pose selection is a pure function assertable without a loop (NFR-ARCH-002).

## Acceptance Criteria

- Setting an entity's motion slice to moving switches its clip to *walk*; clearing it returns to *idle*; the transition restarts clip time — with no System call anywhere (FR-ANIM-001/003).
- Publishing the interact intent plays the *interact* one-shot on player-controlled entities; after its duration the entity is back in its base state and pose (FR-ANIM-004/005).
- With directional walk frames in the manifest, an east-facing walker poses `ref.walk.e.<n>` and the frame index follows clip time, fps, and alpha (FR-ANIM-006, FR-ANIM-003).
- An entity whose clips resolve nothing draws its base sprite and the pose map omits it (FR-ANIM-009).
- Two identical runs produce identical animation slices and pose maps (NFR-ANIM-001).

## Dependencies

- `02-System-Architecture.md` — System lifecycle, event bus, world-state ownership, the presentation phase slot.
- `03-Data-Model-and-Content-Pipeline.md` — the asset manifest frames resolve through (DATA-FR-019).
- `15-Movement-and-Traversal.md` — the motion slice (velocity, facing) that drives the base state machine.
- `14-Input-and-Controls.md` — the interact intent event bound to the interact one-shot.
- `30-Rendering.md` — the consumer of the pose output.

## Implementation Notes (non-normative)

- The pose map is handed from `animationPoses` to `renderFrame` by the composition root — data flowing through the boot wiring, not a System reference; rendering tolerates its absence entirely.
- Frame count is discovered by probing consecutive `<prefix>.<n>` manifest keys from zero, capped; authors number frames contiguously from `0`.
- Clip vocabulary (*idle*, *walk*, *interact*) is generic engine vocabulary like `Renderable.kind`; packs choose what imagery those states show, and the generic one-shot event carries arbitrary clip names for content-defined moments (e.g. a *restore* celebration).
- The one-shot duration falls back to a tuned per-entity value (or an engine default) when a clip has no frames, so worlds without art still get correctly-timed state transitions — useful for tests and for pre-art development.

## Edge Cases

- **A one-shot retriggers mid-play:** the clip restarts from zero — the newest fact wins.
- **A one-shot arrives for an entity with no sprite ref:** ignored; there is nothing to pose (FR-ANIM-002).
- **The motion slice flaps at the rest threshold:** the movement System's rest-speed epsilon already debounces stop; animation follows `moving` and stays smooth.
- **A clip defines directional stills but no frames:** the still resolves; frame index is irrelevant (FR-ANIM-006).
- **An entity spawns mid-session:** it enters *idle* with zero clip time on the next step; no special case.
- **Presentation runs at a different rate than simulation:** pose selection is pure and interpolated; simulation state is untouched (FR-ANIM-007).

## Risks

- **Manifest key sprawl.** Directional, per-frame keys multiply quickly. Mitigation: most-specific-first resolution means packs author only the variants they need; everything else falls back.
- **State-machine growth.** More states (jump, swim, emote) could tempt hardcoded transitions. Mitigation: base states stay derived from world state; everything else is the generic one-shot channel, and a data-driven transition table is the escalation path (see Open Questions).
- **Pose/render drift.** Two Systems interpreting the manifest could disagree. Mitigation: animation outputs a *sprite ref* and rendering resolves it exactly like a base sprite — one resolution path.

## Open Questions

- **OQ-ANIM-1:** Whether base-state derivation should become a data-driven transition table (state × condition → clip) once content packs need states beyond idle/walk; deferred until a pack demands it.
- **OQ-ANIM-2:** Skeletal/tweened animation support — whether the pose type grows bone transforms or a parallel rig System arrives; gated on art direction (Phase 3).
- **OQ-ANIM-3:** Per-clip fps in the manifest (e.g. `ref.clip.fps` metadata) versus per-entity tuning; decided when real art volume arrives (`38-Asset-Pipeline.md`).

## Future Considerations

- Animation events (a frame that emits a bus event, e.g. a footstep for audio) once sound design lands.
- Blend/crossfade between clips if pixel art gives way to smoother rigs.
- Pose components for non-sprite consumers (UI portraits, minimap markers) reusing the same clip state.

## Version / Author

Version 1.0 — Mike Blom.
