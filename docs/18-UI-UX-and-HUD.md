# Resume.World — UI / UX and HUD

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** UI

---

## Purpose

This document specifies the UI / HUD System: the diegetic, minimal interface layer drawn above the world — interaction prompts, ambient hints, and the dialogue surface — honoring the Vision's "no menus, no text walls" bar (Vision Non-Goals, FR-VIS-009) and the polish pillar that every interaction acknowledges the player (Vision pillar 4).

## Overview

UI is a System like any other: it conforms to the System interface and lifecycle, reads shared world state, and holds no reference to any other System. It is split across the loop's two phases. During the fixed simulation step it maintains the **UI slice** it owns: the proximity-driven interaction prompt (raised when the player stands within reach of an interactable marker), the ambient hint line, and the dialogue surface — all mutated only from world state, the input intent slice, and buffered bus events. During the variable-rate presentation phase, a pure draw pass (`uiFrame`) renders that slice above the world through the Platform Adapter's surface, after rendering has drawn the world.

Every player-visible string is a **locale key** resolved through the pack's strings table, landed in world state at spawn exactly like the asset manifest (DATA-FR-011). The engine names only generic keys (e.g. the interact prompt key); their text is pack content. A key the table does not define draws nothing — never a raw key, never a fault.

Input routing is by observation, not capture: the System never writes the input intent slice and never suppresses another System's events, so UI can never unexpectedly block movement. While a dialogue is open the slice's `modal` flag is true; world-interaction Systems honor it by querying world state, never by call.

## Goals

- Give every interactable a legible, immediate prompt so no action is invisible (FR-VIS-003's visible half).
- Keep the interface diegetic and minimal: no menu screens, no text walls, no chrome that reads as a website (Vision Non-Goals).
- Make the dialogue surface a generic capability any System can drive through events, ready for the Dialogue and Mini-Games issues.
- Route input without stealing it: gameplay input always reaches gameplay Systems.
- Stay legible on desktop and small mobile viewports from one code path (NFR-VIS-004).
- Keep all text in the Content Pack via locale keys (DATA-FR-011, NFR-VIS-005).

## Non-Goals

- Dialogue *logic* — which node follows which choice is a future Dialogue System; this document only specifies the surface it drives.
- Mini-game internals — mini-games arrive as plugins; this layer reserves them a surface contract, not an implementation.
- The full accessibility pass (screen-reader narration, remap UI) — Phase 3, `34-Accessibility.md`; the seams (data-driven text, keyboard-only operation) are laid here.
- Art direction of the chrome (`12-Art-Direction.md`); colors here are generic engine presentation defaults.
- The debug overlay (FR-ARCH-031), which is developer tooling, not player UI.

## User Stories

- *As a player,* when I walk up to something interactive, a small prompt tells me so — and disappears when I walk away.
- *As a player,* when a character speaks, I read a short line and pick a reply without the world stopping around me.
- *As a visitor on a phone,* the same prompts and dialogue are readable without zooming.
- *As a content author,* I change every word the interface shows by editing the pack's strings document, never code.
- *As an engine developer,* I open a dialogue from any System by publishing one event, with no reference to the UI System.

## Functional Requirements

- **FR-UI-001** The UI System MUST own a single UI world-state slice (prompt, hint, dialogue, modal) and be its sole writer (FR-ARCH-015); other Systems request changes only via events (FR-ARCH-005).
- **FR-UI-002** The interaction prompt MUST appear while the player is within a defined logical-unit radius of an interactable marker (generic scene kinds, e.g. npc/building) and disappear when out of reach or when a modal surface opens.
- **FR-UI-003** The UI System MUST NOT write the input intent slice, suppress intent events, or otherwise prevent gameplay Systems from observing input; movement continues while any UI surface is visible.
- **FR-UI-004** The dialogue surface MUST open on a `ui.dialogue.open` event (a line key plus optional choice keys), advance selection on vertical move-intent edges, close on the interact intent or a `ui.dialogue.close` event, and announce the closing choice as a `ui.dialogue.chosen` event.
- **FR-UI-005** While a dialogue is open the slice's `modal` flag MUST be true, so world-interaction Systems can decline interact intents by world-state query, never by call.
- **FR-UI-006** Every player-visible string MUST resolve from a locale key through the pack strings table in world state (DATA-FR-011); an unresolved key MUST draw nothing — never the raw key, never a fault (FR-ARCH-008).
- **FR-UI-007** The presentation pass MUST draw above the world, after rendering, through the Platform Adapter's surface only (NFR-ARCH-004), and MUST be pure: it writes no world state, so presentation cadence cannot perturb simulation (FR-ARCH-025).
- **FR-UI-008** Layout MUST derive from the live surface size each frame — font size clamped to a legible range, panels fitted inside the viewport — so desktop and mobile share one code path (NFR-VIS-004).
- **FR-UI-009** The hint line MUST be settable and clearable via events, providing the non-blocking guidance channel FR-VIS-009 requires (no modal tutorials).
- **FR-UI-010** Malformed UI event payloads MUST be ignored without faulting the step (FR-ARCH-008).

## Non-Functional Requirements

- **NFR-UI-001 (Determinism):** The fixed-step slice update reads only world state, the intent slice, and buffered events — no clocks, no randomness — so replays reproduce identical UI state (NFR-ARCH-001).
- **NFR-UI-002 (Minimalism):** The interface never presents lists of credentials, menus of facts, or long prose; a surface that reads as a website is a defect (FR-VIS-006).
- **NFR-UI-003 (Testability):** The slice machine is assertable from a fake Context; the draw pass is assertable against the headless surface's recorded commands (NFR-ARCH-002).
- **NFR-UI-004 (Legibility):** Text renders at no less than a defined minimum pixel size on any supported viewport; the accessibility pass (Phase 3) tightens this to WCAG 2.2 AA.

## Acceptance Criteria

- Walking within reach of an npc/building marker raises the interact prompt; walking away lowers it; opening a dialogue suppresses it (FR-UI-002).
- With a dialogue open, the intent slice is untouched and the movement System still moves the player (FR-UI-003).
- `ui.dialogue.open` → move-edge selection → interact produces a `ui.dialogue.chosen` event naming the selected choice key, and the surface closes (FR-UI-004).
- All drawn text comes from the strings table; an unresolved key draws nothing (FR-UI-006).
- The dialogue panel and prompt fit inside both a desktop (640×360) and a small portrait (180×320) surface with the font inside its legible clamp (FR-UI-008).
- The UI System imports no other System module and holds no System references (FR-ARCH-005).

## Dependencies

- `02-System-Architecture.md` — System lifecycle, event bus, world-state ownership, presentation ordering.
- `03-Data-Model-and-Content-Pipeline.md` — locale keys and the strings documents (DATA-FR-011/024).
- `14-Input-and-Controls.md` — the intent events and slice this System observes.
- `30-Rendering.md` — draws the world beneath; UI draws after it in the presentation phase.
- The Platform Adapter's `RenderSurface`, extended here with a text primitive (issue #14's contract, NFR-ARCH-004).
- Downstream: the Dialogue System, Mini-Games host, and Onboarding (`19`) drive these surfaces.

## Implementation Notes (non-normative)

- The adapter's `drawText` is the one new host capability this layer needs; fonts are backend-owned (a generic system face), so text carries no asset dependency and no career fact.
- The prompt key (`ui.prompt.interact`) follows the audio System's precedent of engine-named, content-valued keys: the engine names a generic slot; the pack supplies the words.
- Choice selection on move-intent *edges* (not held state) avoids auto-repeat scrolling; the same edge discipline suits future list surfaces.
- The composition root calls `uiFrame` after `renderFrame`, giving UI the topmost layer without any z-order coupling between the two Systems.
- Mini-games will want a bounded sub-surface; the panel metrics in `uiLayout` are exported so a mini-game host can adopt the same responsive frame. The formal surface contract lands with the Mini-Games issue.

## Edge Cases

- **The player stands near two interactables:** one prompt shows — the prompt is a capability signal, not a target selector; targeting belongs to the interaction System.
- **A dialogue opens while another is open:** the newest request wins (the surface shows one conversation at a time).
- **A dialogue with no choices:** interact dismisses it; the chosen event carries a null choice.
- **The hint and a dialogue are both active:** both render (hint top, dialogue bottom); the prompt alone is suppressed by the modal surface.
- **A tiny surface (very narrow phone):** the panel clamps to the surface width minus padding; text stays at the minimum legible size and may truncate visually rather than overflow the viewport.
- **No Input System present:** no intent slice exists; dialogue stays open until a close event — degraded but coherent (FR-ARCH-008).

## Risks

- **UI scope creep.** Menus, inventories, and maps all border this System. Mitigation: this document owns only prompt/hint/dialogue surfaces; every further surface arrives with its own issue and contract.
- **Diegetic drift.** Convenience chrome accumulating until the world reads as a website. Mitigation: NFR-UI-002 is a review gate; new chrome must justify itself against the Vision pillars.
- **Text overflow on small screens.** Long pack strings can exceed a small panel. Mitigation: the layout clamps and truncates gracefully now; measured wrapping arrives with the accessibility pass (OQ-UI-2).

## Open Questions

- **OQ-UI-1:** Whether interact intents consumed by a modal dialogue should be formally marked (an event) rather than inferred from the `modal` flag — decided when the interaction System lands.
- **OQ-UI-2:** Text wrapping and measurement — `drawText` draws a single line today; multi-line wrapping needs adapter text metrics, owned by the accessibility pass (`34`).
- **OQ-UI-3:** Touch affordances for choice selection (tap targets vs. move edges) — owned by `19-Onboarding-and-First-Session.md` and the accessibility pass.

## Future Considerations

- Screen-reader narration hooks: the UI slice already carries exactly the strings a narrator needs; the adapter grows a narration channel in Phase 3.
- A mini-game surface contract (bounded panel + input lease) building on `uiLayout` and the modal flag.
- Reduced-motion and high-contrast presentation variants of the chrome constants (Phase 3).

## Version / Author

Version 1.0 — Mike Blom.
