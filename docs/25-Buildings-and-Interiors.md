# Resume.World — Buildings and Interiors

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** BLD

---

## Purpose

This document specifies how content-defined buildings become enterable spaces: the doorway affordance, the enter/exit transition, interior geometry and collision, occupancy, and the interaction points that give interiors purpose. Every building has a purpose (Vision, brief); this is the machinery that lets a visitor step inside and find it.

## Overview

A building is a content entity (`03-Data-Model-and-Content-Pipeline.md`, `building` schema). A building whose document declares an `interior` block is **enterable**: the engine places a **doorway** at the building's exterior marker, and walking onto it runs a short fade transition that moves the player into the building's **interior space** — a room whose size, furnishings, spawn point, and interaction points all come from the content document. Walking onto the interior's exit doorway runs the reverse transition back to where the player stood outside.

The load-bearing concept is the **space**: a named partition of the one logical simulation area. The exterior is one space; each interior is another, named by its building's content id. Entities carry a `SPACE` component (absent means exterior), and systems that relate entities spatially — collision, prompts, interaction, drawing — only relate entities that share a space. Populations coexist without interacting; nothing is despawned to enter a building, so exterior state (NPC routines, quest markers) persists untouched while the player is inside.

## Goals

- Make buildings enterable purely by adding data to the content pack — no code change per building (DATA-FR-004, NFR-VIS-005).
- A polished, legible enter/exit transition with correct collision inside.
- Interior occupancy and transitions expressed as world state and events other systems can consume (FR-ARCH-005, FR-ARCH-015).
- Preserve determinism and save/load round-tripping (FR-ARCH-025, FR-ARCH-016).

## Non-Goals

- Interior art and lighting direction (see `12-Art-Direction.md`).
- Multi-room interiors, stairs, or nested buildings (future consideration).
- What interiors *contain* narratively — quests, NPCs, and mini-games bind to buildings through their own content documents.

## User Stories

- *As a visitor,* I walk up to a building's door and the world fades briefly and places me inside a distinct room, so entering feels deliberate and polished.
- *As a visitor,* I bump into a workbench inside and I am stopped, so interiors feel physical rather than painted.
- *As a visitor,* I stand near a marked spot inside and a hint line tells me what I am looking at, so interiors reward exploration.
- *As a content author,* I add an `interior` block to a building document — size, spawn, colliders, points — and the building becomes enterable with no engine change.
- *As a content author,* I omit the `interior` block and the building stays set dressing with no doorway.

## Functional Requirements

- **FR-BLD-001** Building entities MUST spawn from `building` content documents; a building's interior layout (room size, spawn point, colliders, interaction points) MUST come entirely from its document's `interior` block. The engine holds geometry defaults, never career facts (DATA-FR-027).
- **FR-BLD-002** A building whose document declares an `interior` MUST receive an entry doorway trigger at its exterior marker; a building without one MUST NOT be enterable.
- **FR-BLD-003** A player-controlled entity stepping onto a doorway MUST start an enter (or exit) transition: a timed fade to cover, a swap of the player into the target space at its spawn (or remembered return) position exactly once at the fade's midpoint, and a fade back in.
- **FR-BLD-004** Exiting MUST return the player to the position where they stood when they entered, and a completed transition MUST NOT immediately re-fire from the doorway the player lands on: doorways re-arm only after the player has stepped clear.
- **FR-BLD-005** Interior geometry — perimeter walls, content-declared colliders, the exit doorway, interaction points — MUST spawn tagged with the interior's space id, and MUST spawn deterministically (same content, same order, same ids; DATA-FR-017).
- **FR-BLD-006** Spatial systems MUST relate only entities sharing a space: collision resolution, trigger occupancy, interaction reach, prompts, and drawing each filter by space. An interior wall never blocks an exterior walker sharing its coordinates, and vice versa.
- **FR-BLD-007** Interaction points MUST surface their content-declared, locale-keyed hint when the player is within the shared prompt radius in the same space, and clear it when the player leaves (DATA-FR-011).
- **FR-BLD-008** Space membership and the active-space slice MUST serialize with progression state so a session saved inside a building resumes inside it, with the interior re-materialized on demand (FR-ARCH-016).
- **FR-BLD-009** Enter and exit MUST be announced as deferred events (`building.entered`, `building.exited`) carrying the building's content id, so quests, achievements, and analytics can react without knowing buildings (FR-ARCH-012).
- **FR-BLD-010** The Buildings System MUST tolerate absent collaborators: without a physics System doorways never fire and buildings degrade to set dressing; without a UI System hints go unheard (FR-ARCH-008).

## Non-Functional Requirements

- **NFR-BLD-001 (Determinism):** Transitions advance on simulation `dt` only; no wall clock, no randomness (NFR-ARCH-001).
- **NFR-BLD-002 (Ownership):** The active-space slice has exactly one writer, the Buildings System; other systems read it or subscribe to its events (FR-ARCH-015).
- **NFR-BLD-003 (Polish):** The transition is fast enough never to feel like a loading screen and total enough to hide the population swap (NFR-VIS-002's spirit: jank is a bug).

## Acceptance Criteria

- The player can enter and exit a building with a polished fade transition and correct collision inside (issue #30 AC1): walls and content colliders block, the exterior population neither draws nor collides while inside.
- Interiors are defined entirely by content (issue #30 AC2): changing the building document's `interior` block changes the room with no code change; a building without the block has no doorway.
- Exiting returns the player to their pre-entry position, and the landing doorway does not re-trigger until stepped off.
- A session saved inside a building resumes inside it.
- Interaction-point hints appear near their points, resolve through locale keys, and clear on walking away.

## Dependencies

- `02-System-Architecture.md` — System lifecycle, event bus, world-state ownership, determinism.
- `03-Data-Model-and-Content-Pipeline.md` — the `building` schema this document extends with the `interior` block.
- `31-Physics-and-Collision.md` — doorways are trigger volumes; interiors rely on solid collision (issue #20).
- `30-Rendering.md` — drawing filters by active space; the transition cover draws above the world.
- `18-UI-UX-and-HUD.md` — the hint line interaction points publish to; the shared prompt radius.
- `32-Save-Load-and-Persistence.md` — space membership joins the progression slices.

## Implementation Notes (non-normative)

- The interior room centers in the fixed logical space; room-local coordinates (rects by center) keep authoring simple and swappable. Exterior door placement derives from the marker's south face because exterior marker layout is engine-computed, not content-declared.
- The doorway re-arm gate is a single boolean on the active-space slice: cleared at every swap, set once no doorway trigger contains the player. This is simpler and more robust than per-doorway cooldown timers.
- The swap lands at the fade midpoint so the population change is never visible; interpolated render motion across the teleport is hidden behind the fully opaque cover.
- Interior geometry persists after first entry rather than despawning on exit: cheap, and it keeps entity ids stable for saves.

## Edge Cases

- **Save captured mid-transition.** The transition state serializes with the slice; resume continues the fade and the swap still lands exactly once.
- **A save inside a building loads into a fresh world.** Interior geometry is absent on fresh spawn; the system re-materializes the active interior on the next update (FR-BLD-008).
- **The target building vanishes mid-transition** (content hot-reload). The swap cancels and the fade returns to the current space.
- **An NPC walks onto an entry doorway.** Ignored: transitions are for player-controlled entities only.
- **Content declares a spawn point on the exit doorway.** The re-arm gate holds until the player steps off, so no bounce loop occurs.
- **Two buildings' doorways overlap.** Doorways are scanned in ascending entity order; the first armed doorway the player occupies wins and starts the transition, and doorways are ignored while it runs.
- **The player reaches a doorway while a fade is still finishing.** Transitions start from occupancy state, not event edges, so the doorway is honored on the first idle update rather than dropped.

## Risks

- **Space-filter drift.** A future spatial system that forgets to filter by space would leak populations across the seam. Mitigation: the shared `spaceOf` helper makes the filter one line, and FR-BLD-006 makes it a reviewable requirement.
- **Interior authoring blindness.** Authors place colliders in room-local units without a visual tool. Mitigation: validation catches malformed shapes; the authoring tool (`37-Content-Authoring-Tools.md`) is the real fix.

## Open Questions

- **OQ-BLD-1:** Whether interiors should support their own ambient profile (lighting, audio bed) distinct from the region's — decided when Art Direction (issue #36) lands.
- **OQ-BLD-2:** Whether interact-to-enter (pressing the interact key at a door) should supplement walk-through doorways, and how it arbitrates with NPC interaction — revisit with Onboarding (issue #44).

## Future Considerations

- Multi-room interiors and doors between rooms (spaces already name rooms, not buildings, so the model extends).
- NPCs with routines that cross spaces (a shopkeeper who goes home at night).
- Interior-specific weather/lighting exclusion once `12-Art-Direction.md` defines interior looks.

## Version / Author

Version 1.0 — Mike Blom.
