# 34 — Accessibility

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** A11Y

---

## Purpose

This document binds the Vision's accessibility requirement (NFR-VIS-003) to concrete engine behavior: keyboard-only play, screen-reader narration of essential content, WCAG 2.2 AA contrast, reduced motion, and remappable controls — all expressed as world-state data that Systems honor, never as a parallel "accessible mode" build.

## Overview

Accessibility is a settings slice, not a separate experience. A single **Accessibility System** owns the `ACCESSIBILITY_SETTINGS` slice (reduced motion, narration) and the `INPUT_BINDINGS` slice the Input System reads, applying `accessibility.control` and `input.remap` request events. Every honoring System — camera, rendering, animation, UI — reads the slice by world-state query and adapts its own behavior; none is ever called (FR-ARCH-005).

The player-facing surface is the UI System's **settings panel**: opened with the `settings` action (Escape by default), navigated with vertical move edges, activated with interact — the same keyboard-only vocabulary the dialogue surface established. Remapping is a listen-for-a-key flow: the Input System (still the sole snapshot interpreter, FR-INP-002) announces the first freshly pressed key as `input.key-captured` while a capture request is active, the UI turns it into an `input.remap` request, and the Accessibility System writes the bindings table.

Narration rides the UI slice: it already carries exactly the locale keys a screen reader needs (docs/18, Future Considerations), so the UI System announces essential changes — prompts appearing, hints, dialogue lines and selections, settings rows — through the Platform Adapter's **narration channel**, an ARIA live region in the browser backend and a recorded call in the headless one. Contrast is the theme's obligation: the palette's text and accent roles clear WCAG 2.2 AA by unit test (docs/12, NFR-ART-001).

## Goals

- Keyboard-only play across the whole short-visit path, including every settings interaction (NFR-VIS-003).
- Screen-reader narration of essential content without a second UI: what surfaces visually is what gets announced.
- Reduced motion as one toggle that every motion-producing System honors (NFR-ART-003).
- Remappable controls as pure data flow: UI requests, Accessibility System writes, Input System reads (FR-INP-003).
- Accessibility choices persist across visits like any other progression state (FR-ARCH-016).

## Non-Goals

- High-contrast alternate palettes — the single theme palette is required to clear AA on every surface it draws (docs/12); a variant theme is a future consideration there, not here.
- Touch-specific assistive gestures and switch-access devices (future input namespaces, docs/14).
- Narrating non-essential ambience (weather shifts, background events): narration covers what the player must not miss, not everything that happens.
- Localizing physical key codes: bindings display their hardware identifiers (`KeyE`, `ArrowLeft`), which are technical labels, not career or narrative text.

## User Stories

- *As a keyboard-only visitor,* I explore, talk, restore, and change every setting without touching a pointer.
- *As a screen-reader visitor,* I hear prompts, hints, and dialogue as they appear, so the world is legible without sight.
- *As a motion-sensitive visitor,* I flip one toggle and the camera stops easing, transitions cut instead of fading, and sprites rest.
- *As a visitor with my own layout,* I rebind movement and interact to keys that suit me and the world obeys immediately — and still does when I return tomorrow.

## Functional Requirements

- **FR-A11Y-001** Accessibility settings MUST live in a world-state slice owned by the Accessibility System (FR-ARCH-015), mutated only via `accessibility.control` events, and readable by any System via query.
- **FR-A11Y-002** With `reducedMotion` enabled: the camera MUST land instantly instead of easing, the space-transition MUST hold a full cover instead of an animated fade, sprite animation MUST rest on a still frame, and one-shot clips MUST NOT play. Simulation outcomes MUST be unchanged — reduced motion is presentation calm, not different gameplay.
- **FR-A11Y-003** With `narration` enabled and a narration channel present, the UI System MUST announce essential surface changes — the interact prompt appearing, hint changes, dialogue lines and selection changes, settings rows — as already-localized strings; an unresolved locale key announces nothing (FR-UI-006's rule, spoken).
- **FR-A11Y-004** The Platform Adapter MUST expose a narration channel; the browser backend implements it as a visually hidden polite ARIA live region, the headless backend records announcements for assertion. A platform without the channel degrades silently (FR-ARCH-008).
- **FR-A11Y-005** The settings surface MUST be fully operable with the intent vocabulary alone: `settings` toggles it, vertical move edges select, interact activates. No pointer is required anywhere in the flow.
- **FR-A11Y-006** Rebinding MUST flow as data: the UI writes a capture request; the Input System publishes the first freshly pressed key as `input.key-captured` while the request is active (and resolves idle intent so the chosen key never also steers the world); the UI publishes `input.remap`; the Accessibility System validates and writes `INPUT_BINDINGS`. Unknown actions and malformed requests are ignored (FR-ARCH-008).
- **FR-A11Y-007** The `settings` action itself MUST NOT be offered for remapping, and a captured key currently bound to `settings` MUST cancel the capture rather than bind, so the surface can always be closed.
- **FR-A11Y-008** `ACCESSIBILITY_SETTINGS` and `INPUT_BINDINGS` MUST persist through save/load and survive a resumed session (FR-ARCH-016).
- **FR-A11Y-009** Narration defaults on (the live region is silent chrome for sighted visitors); reduced motion defaults off.

## Non-Functional Requirements

- **NFR-A11Y-001 (Contrast):** All engine-drawn text and interactive roles clear WCAG 2.2 AA per docs/12 NFR-ART-001, verified by the theme unit tests on every merge.
- **NFR-A11Y-002 (Determinism):** All accessibility behavior is a pure function of world state, buffered events, and the input snapshot — no clocks, no randomness (NFR-ARCH-001). Narration calls, like audio calls, replay identically.
- **NFR-A11Y-003 (No modes):** Accessibility never forks the build or the content: the same world, pack, and Systems serve every visitor (NFR-VIS-004's spirit).

## Acceptance Criteria

- A keyboard-only session can reach and understand the short-visit content, including opening settings, toggling both options, and rebinding an action (Vision acceptance, NFR-VIS-003).
- With narration on and a headless platform, walking up to an interactable, receiving a hint, and opening a dialogue each produce the expected announcement strings in order; with narration off, none are produced.
- Toggling reduced motion makes the camera blend factor 1, holds the transition cover at full alpha, and freezes clip time — each verified by unit test.
- Capturing a key rebinds only the chosen action, unbinding its defaults; the remapped table persists through a save/load round-trip.
- The theme contrast tests pass unchanged (WCAG 2.2 AA).

## Dependencies

- `01-Vision.md` — NFR-VIS-003, the requirement this document realizes.
- `02-System-Architecture.md` — System lifecycle, event bus, slice ownership, determinism.
- `12-Art-Direction.md` — contrast thresholds (NFR-ART-001) and calm-motion rules (NFR-ART-003) this document binds.
- `14-Input-and-Controls.md` — the bindings data layer this document's remap UI writes (its declared deferral).
- `18-UI-UX-and-HUD.md` — the UI slice and surfaces narration reads; the settings panel follows its interaction grammar.
- `32-Save-Load-and-Persistence.md` — the progression-slice persistence the settings ride.

## Implementation Notes (non-normative)

- The Accessibility System registers before the Input System, so a rebind applied in a step is read by input resolution the same step.
- The UI System owns a small `INPUT_CAPTURE` request component (active while a remap row listens); this keeps the Input System the only snapshot reader while letting the surface ask for a key without ever seeing one.
- After a capture completes, the UI ignores interact edges until the intent slice reports release, so a key freshly bound to interact cannot immediately re-activate the row it was bound from.
- Announcement strings compose resolved locale strings with plain separators (`label: value`); bindings announce their key codes verbatim.
- The bindings holder entity is spawned at init with the engine defaults so a saved remap overlays a deterministic entity id on resume.

## Edge Cases

- **Capture entered by a held interact key:** the key that opened the capture is already down, so it is never a *fresh* edge and cannot self-bind; the player's next key press binds.
- **A captured key bound to `settings`:** the capture cancels (FR-A11Y-007) — Escape always closes, never gets shadowed.
- **Rebinding interact to a key still held when capture ends:** the post-capture cooldown swallows the edge until release; no re-entry loop.
- **Settings opened during a dialogue:** the settings panel takes the selection and interact edges while open; the dialogue waits beneath and resumes when settings close.
- **A pack whose strings table lacks the settings keys:** rows draw and announce nothing (never a raw key); the surface still navigates and activates.
- **No narration channel on the platform:** narration degrades to silence; nothing faults (FR-ARCH-008).

## Risks

- **Narration chatter.** Announcing too much makes the channel useless. Mitigation: narration is scoped to the essential-content list in FR-A11Y-003; additions are spec changes here.
- **Bindings lock-out.** A bad remap could strand the player. Mitigation: FR-A11Y-007 protects the settings action; defaults always exist in code-as-data as the fallback table.
- **Reduced-motion drift.** New motion effects could forget the toggle. Mitigation: FR-A11Y-002 names the honoring set; any new motion-producing System must cite it in review.

## Open Questions

- **OQ-A11Y-1:** Touch access to the settings surface (an on-screen affordance for `settings`) — owned by `19-Onboarding-and-First-Session.md` with the other touch affordances (OQ-UI-3).
- **OQ-A11Y-2:** Multi-line text wrapping for long localized strings (OQ-UI-2) — needs adapter text metrics; deferred until real pack copy exceeds the panel.
- **OQ-A11Y-3:** Narrating mini-game state (route/assembly/orchestrate progress) — decided when the mini-game surface contract grows sub-panel text.

## Future Considerations

- A reduced-motion theme variant collapsing the motion tokens toward instant (docs/12, Future Considerations) as a single switch behind the same setting.
- Multiple binding contexts (world / menu / mini-game) layered as additional tables selected by UI state (docs/14, Future Considerations).
- Narration verbosity levels (essential / verbose) if screen-reader testing asks for more ambient description.

## Version / Author

Version 1.0 — Mike Blom.
