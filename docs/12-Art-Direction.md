# 12 — Art Direction

## Purpose

This document defines Resume.World's visual identity — palette, shape language, lighting, and motion feel — and the guidelines every asset must follow, so the world, UI, and effects read as authored by a single hand (NFR-VIS-007) while every value stays data the engine references, never hardcodes (issue #36).

## Overview

The identity is a **quiet industrial dusk**. The world at rest is deep blue-slate — a district after hours, powered down but not dead. Restoration is the arc of the experience, so color follows it: offline regions sit in cold blues, restored regions warm toward green, people carry lamplight amber, and one cool cyan accent marks the player and everything selectable. Geometry is rect-first and flat-shaded; light is a single translucent overlay; motion is short, damped, and functional. Nothing shouts: the world is calm so that the moment a system comes back online reads as the loudest thing on screen.

All of it is expressed as a **theme**: a single table of named color roles and motion tokens (`src/style/theme.ts`) that rendering, UI, environment lighting, effects, and even the platform chrome resolve by role. Screens own *which role* a drawn thing plays; the theme owns *what that role looks like*. Swapping the identity is an edit to one table.

## Goals

- One recognizable visual voice across world, UI, effects, and debug chrome (NFR-VIS-007).
- Style as data: every engine-drawn color resolves from the theme by named role, so no screen carries its own values (serving NFR-VIS-005's spirit at the presentation layer).
- Legibility as a hard property: text and interactive roles clear WCAG contrast on the surfaces they draw over (NFR-VIS-003).
- Asset guidelines strong enough that sprites from different sessions (or authors) sit side by side without visual seams.

## Non-Goals

- Final marketing art, key art, or brand identity beyond the play experience (issue #36 out of scope).
- Per-Content-Pack themes. The theme restyles the engine uniformly; packs contribute sprites and text, not palette overrides (candidate for `45-Future-Expansion.md`).
- Shaders, gradients, or painterly rendering. The rect-and-sprite model from `30-Rendering.md` is the canvas this identity is designed for.

## User Stories

- *As a visitor,* every screen — world, dialogue, prompts, transitions — feels like one crafted object, so the product itself testifies to the creator's care (FR-VIS-001's "the software is the resume").
- *As a visitor,* I can always find myself and what I can touch: the player and interactables share one accent no other role uses.
- *As a content author,* I draw sprites against published anchors and sizes and they sit naturally in the world without engine changes.
- *As an implementer,* restyling a surface means choosing an existing role — never inventing a color.

## Functional Requirements

- **FR-ART-001** Every color the engine draws MUST resolve from the theme table by named role. No System, app, or platform module may carry a color literal; the style layer is the single source. (Enforced by test.)
- **FR-ART-002** Theme roles MUST be keyed by generic engine vocabulary — renderable kinds, region states, chrome surfaces — never by career- or content-specific names, preserving the engine/content seam (NFR-ARCH-007).
- **FR-ART-003** The rect-fallback fill MUST be defined for every generic scene kind (`player`, `building`, `npc`, `wall`, `doorway`, `furnishing`, `poi`) plus a fallback for unknown kinds, so an unstyled world still reads coherently (`30-Rendering.md` FR-REND-006).
- **FR-ART-004** Lighting MUST remain the single translucent overlay defined by `23-Day-Night-and-Weather.md`; this document owns the tint values (the night role), that document owns when they apply.
- **FR-ART-005** Motion feel MUST be named in theme motion tokens (space-transition length, camera follow damping, animation cadence and one-shot length); simulation code realizes those tokens rather than restating the numbers.
- **FR-ART-006** Sprites, when present, take precedence over rect fallbacks (`30-Rendering.md`); both layers MUST follow the same palette anchors so a partially-sprited world does not read as two products.

## Non-Functional Requirements

- **NFR-ART-001 (Contrast):** Body and muted text MUST clear WCAG 2.2 AA (4.5:1) composited on the dialogue panel over any region ground; the accent MUST clear 4.5:1 as selected text and 3:1 as a world graphic (NFR-VIS-003).
- **NFR-ART-002 (Restraint):** The palette holds one accent. New surfaces reuse existing roles; a new role is a spec change to this document, not a local decision.
- **NFR-ART-003 (Calm motion):** All eased motion is short (≤ 0.6 s) and monotonic — no bounce, no overshoot — and respects reduced-motion preferences as `34-Accessibility.md` specifies them.

## The Identity

### Palette

Anchors (authoritative values live in `src/style/theme.ts`):

| Role | Value | Meaning |
|------|-------|---------|
| Backdrop | `#06080c` | The void outside the world; also the transition cover's base. |
| Region, offline | `#131a24` | Cold slate — a district waiting for power. |
| Region, online | `#1d2b26` | The same darkness warmed toward green: restored, alive. |
| Structure | `#415062` / `#2c3a4a` / `#4a5a6e` | Buildings, walls/hairlines, furnishings — one blue-grey family. |
| Doorway | `#8a97a5` | Lighter than structure: openings invite. |
| People | `#c9a86a` | Lamplight amber; NPCs are the warmest thing in an offline world. |
| Accent | `#7ec8ff` | The player, the selection, the interactive. One cyan, used nowhere else. |
| Restoration | `#9fd6a8` | Points of interest and the online direction of travel. |
| Text | `#e6edf3` / `#9fb0c0` | Body and muted, on the panel scrim `rgba(10, 14, 20, 0.85)`. |

### Shape language

Rect-first, flat-fill, hairline-bordered. Geometry is axis-aligned with 90° corners; borders are 1-unit hairlines in the structure family; there are no gradients, shadows, or rounded corners. Openings (doorways) are lighter than the mass they pierce. The letterboxed logical space (`30-Rendering.md`) frames the world with the backdrop; UI panels are translucent scrims with a single hairline edge.

### Lighting

One translucent overlay above the world, below UI (`23-Day-Night-and-Weather.md`). Night is the theme's night role — a deep blue at low alpha — and day is no overlay at all. Effects that cover the screen (the space-transition fade) use the backdrop's RGB with animated alpha, so darkness is always the *same* darkness.

### Motion feel

Motion is functional and damped: the camera follows with a linear blend (damping 8 s⁻¹) and never overshoots; space transitions fade out and in across 0.6 s with the swap hidden at the midpoint; sprite animation runs a calm 8 fps with 0.4 s one-shots. Nothing loops attention-seekingly at rest; motion means something changed.

## Asset Guidelines (feeding the asset pipeline)

Binding for every sprite an asset manifest addresses (`03-Data-Model-and-Content-Pipeline.md`; the planned `38-Asset-Pipeline.md` inherits these):

1. **Flat-shaded, limited ramps.** At most three tones per material, stepped, no gradients. Hue families follow the palette anchors: structures blue-grey, people warm amber, interactables toward the accent or restoration green.
2. **Silhouette first.** An asset MUST read at its logical size against both region grounds; test at 1× before adding detail.
3. **Sizes are logical units.** Author at the entity's declared renderable size (multiples of 2 units); the renderer scales, it never crops.
4. **No baked text.** Words are locale strings (DATA-FR-011), never pixels.
5. **No baked lighting.** Day/night comes from the overlay; a sprite carrying its own night pass will double-darken.
6. **Career meaning stays in content.** Engine-default assets MUST be career-neutral; anything depicting the creator's story ships in a Content Pack and is referenced by manifest id (NFR-VIS-005).

## Acceptance Criteria

- **AC-ART-1** A source scan finds no color literal in engine code outside the style layer: style is theme-referenced, not hardcoded per screen (issue #36 AC2).
- **AC-ART-2** The theme table is well-formed and frozen, covers every generic scene kind, and its text/accent roles pass the NFR-ART-001 contrast thresholds, all verified by unit tests.
- **AC-ART-3** World, UI chrome, lighting, transition effects, and debug overlay all draw from theme roles, so a reviewer walking the vertical slice describes one visual hand (NFR-VIS-007; the human-judgment half of issue #36 AC1).

## Dependencies

- `01-Vision.md` — NFR-VIS-003 (accessibility), NFR-VIS-005 (data-driven), NFR-VIS-007 (craft consistency).
- `30-Rendering.md` — the rect/sprite draw model whose "engine presentation defaults" this document replaces with themed roles.
- `18-UI-UX-and-HUD.md` — the chrome surfaces the panel/text roles style.
- `23-Day-Night-and-Weather.md` — the overlay mechanism whose tint values this document owns.
- Downstream: the planned `38-Asset-Pipeline.md` operationalizes the asset guidelines; `34-Accessibility.md` binds the contrast and reduced-motion requirements.

## Implementation Notes

- The theme lives in `src/style/theme.ts` as one frozen object — data by construction. If a future need arises to load it as a document (per-pack theming), the table's shape is already the schema; that move is deliberately deferred.
- Systems import the theme as shared presentation vocabulary exactly as they import `scene.ts` component vocabulary; this is data reference, not System coupling (FR-ARCH-005 untouched).
- The existing vertical-slice palette was retained as the identity's anchors: it was already coherent, and churn in pinned render output buys nothing. This pass *names* the identity, centralizes it, and makes it enforceable.

## Edge Cases

- **Unknown renderable kind** — falls back to the neutral kind-fallback fill; the world stays one family even for un-specced content.
- **Unknown region state** — reads as offline (cold), never as a missing-color flash.
- **Sprite missing from the manifest** — the themed rect fallback keeps the scene coherent rather than leaving holes (FR-ART-006).
- **Panel over the online region** — contrast requirements are checked against *both* region grounds, so restoring a region can never make text illegible.

## Risks

- **Role sprawl.** Every new surface tempts a new color. Mitigation: NFR-ART-002 makes new roles a spec change here.
- **Literal creep.** A hurried screen hardcodes a hex and the single hand erodes. Mitigation: AC-ART-1's scan runs in the unit-test gate on every merge.
- **Sprite/rect divergence.** As real sprites land, they could drift from the anchor palette. Mitigation: the asset guidelines are binding, and `38-Asset-Pipeline.md` should add automated palette linting.

## Open Questions

- **OQ-ART-1:** Dawn/dusk gradient tints (OQ-DNW-1, deferred from `23-Day-Night-and-Weather.md`) — the overlay mechanism supports them; add tint roles here only if the vertical slice proves the two-phase cycle too abrupt.
- **OQ-ART-2:** Whether per-pack theme overrides ever earn their complexity, or a second creator ships on the same identity (owner: Vision).

## Future Considerations

- Loading the theme as a validated document would let `37-Content-Authoring-Tools.md` expose safe restyling without code.
- A reduced-motion theme variant (transition and camera tokens shortened toward instant) gives `34-Accessibility.md` a single switch to flip.

## Version / Author

Version 1.0 — Mike Blom.
