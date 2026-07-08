# Resume.World — Audio

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** AUD

---

## Purpose

This document specifies the Audio System: how gameplay events and world state become sound through the Platform Adapter's audio interface, without the rest of the engine knowing anything about the host or the content. It serves the Vision's polish bar — every interaction has sound (NFR-VIS-001) — and the world's ambient life (FR-VIS-005).

## Overview

Audio is a System like any other: it conforms to the System interface and lifecycle, subscribes to gameplay events, reads world state, and holds no reference to any other System. Everything audible is a reaction. One-shot **SFX cues** answer gameplay events (movement started/stopped, region entered, and whatever later Systems announce). The **ambient bed** is a looping channel selected from the active region's id, its live state, and the time-of-day phase. The **music bus** is a second looping channel selected per region with a default fallback.

Which sound plays is content. Cue and bed selection produce *manifest keys* (`audio.cue.movement-started`, `audio.ambient.<regionId>.<state>.<phase>`, `audio.music.<regionId>`), resolved through the Content Pack's asset manifest in world state. A key the manifest does not bind is simply silent — the engine names no career fact and ships no sound asset (DATA-FR-027).

## Goals

- Give every bound interaction immediate audible feedback (NFR-VIS-001).
- Keep the soundscape alive and situational: beds follow region, restoration state, and time of day.
- Keep all sound selection in content (the asset manifest), never in engine code.
- Provide volume, mute, and per-bus controls plus a reduced-audio accessibility option.
- Remain host-agnostic: every audible effect goes through the adapter's `AudioOutput`.
- Preserve determinism: a replayed session issues the identical audio call sequence.

## Non-Goals

- Final sound design and real audio assets (Phase 3; the reference pack carries placeholder addresses).
- The host mixer itself (WebAudio graphs, decoding, ducking curves) — that is Platform Adapter work behind `AudioOutput`.
- UI for the volume controls (`18-UI-UX-and-HUD.md` consumes the `audio.control` event).
- Positional audio beyond stereo pan and distance attenuation (a future mixer upgrade).

## User Stories

- *As a player,* every step, interaction, and restoration answers me audibly, so the world feels alive under my hands.
- *As a player entering a restored district,* the soundscape changes with the world state, so progress is something I hear.
- *As a player who needs quiet,* I can mute everything or reduce audio to essential feedback only.
- *As a content author,* I bind sounds by adding manifest entries — never by touching engine code.
- *As a tester,* I assert the exact audio call sequence against the headless adapter.

## Functional Requirements

- **FR-AUD-001** The Audio System MUST be driven purely by events and world state: it subscribes to gameplay events for cues, reads world state for bed selection and spatial parameters, and MUST NOT reference another System (FR-ARCH-005).
- **FR-AUD-002** Cue and bed keys MUST resolve through the pack's asset manifest in world state; an unbound key MUST be silent and MUST NOT fault (FR-ARCH-008).
- **FR-AUD-003** The ambient bed MUST be selected from the active region's id, its live state, and the time-of-day phase, most specific key first, falling back to `audio.ambient.default`.
- **FR-AUD-004** The music bus MUST be an independent looping channel selected per region (`audio.music.<regionId>`) with a `audio.music.default` fallback.
- **FR-AUD-005** Cue playback MUST carry spatialization parameters — stereo pan from the emitter's horizontal offset to the camera and gain attenuation from its distance — computed from world state and handed to the adapter (the spatialization hook).
- **FR-AUD-006** The Audio System MUST own the audio settings slice (master volume, mute, per-bus gains, reduced audio) as its sole writer (FR-ARCH-015); other Systems request changes by publishing `audio.control` events.
- **FR-AUD-007** The reduced-audio option MUST silence the ambient and music beds while keeping interaction feedback audible, so essential acknowledgment survives (NFR-VIS-003's spirit).
- **FR-AUD-008** All audible output MUST go through the Platform Adapter's `AudioOutput`; the Audio System MUST NOT touch host audio APIs (NFR-ARCH-004).

## Non-Functional Requirements

- **NFR-AUD-001 (Determinism):** Given identical events, world state, and settings, the sequence of adapter audio calls is identical (NFR-ARCH-001) — no clocks, no randomness in selection.
- **NFR-AUD-002 (Testability):** The full pipeline — event to adapter call — is assertable against the headless adapter's recorded cues and loop state (NFR-ARCH-002).
- **NFR-AUD-003 (Graceful hosts):** A platform without an audio interface degrades to silence without faulting (FR-ARCH-008).

## Acceptance Criteria

- A bound gameplay event produces an adapter `play` call with the manifest-resolved address and spatial parameters (FR-AUD-001/002/005).
- Changing the region's live state or the time phase switches the ambient bed to the most specific bound key (FR-AUD-003).
- Mute drives the master volume to zero; bus gains scale their channels; reduced audio silences beds but not cues (FR-AUD-006/007).
- A pack with no audio bindings runs silently with zero faults (FR-AUD-002).
- Two identical sessions issue the identical audio call sequence (NFR-AUD-001).

## Dependencies

- `02-System-Architecture.md` — System lifecycle, event bus, world-state ownership, determinism.
- `03-Data-Model-and-Content-Pipeline.md` — the asset manifest that binds keys to addresses (DATA-FR-019).
- `30-Rendering.md` — the camera component the spatialization hook reads.
- Consumers: `23-Day-Night-and-Weather.md` publishes the time-phase event; `18-UI-UX-and-HUD.md` publishes `audio.control`.

## Implementation Notes (non-normative)

- The System buffers events between the tick's flush and its own update, so all audible output happens in its update phase, in deterministic order.
- Bed changes are applied to the adapter only on change (ref or gain), so a steady state issues no per-frame audio calls.
- The browser backend currently plays through media elements and accepts `pan` without applying it; upgrading to a WebAudio mixer is a platform-layer change no System will notice (FR-AUD-008).
- The time-phase event (`time.phase-changed`) is the `TimeOfDayChanged` shape `02` names; until the day/night System publishes it, the phase rests at its default and bed selection simply ignores phase-specific keys.

## Edge Cases

- **An event names an entity that no longer exists.** The cue plays centered at full gain; a dead emitter never faults the System.
- **A manifest binds the phase-specific bed but not the base keys.** Selection is most-specific-first; the bound key wins, absent keys are skipped.
- **Rapid region state flapping.** The bed follows state each step; the adapter contract (re-setting the same ref only retunes gain) prevents restart stutter.
- **Mute during an active bed.** Master volume goes to zero; beds keep looping silently and survive unmute intact.
- **A control event carries garbage.** Fields are validated and clamped individually; invalid fields are ignored, valid ones apply.

## Risks

- **Cue spam.** High-frequency events (per-step movement) could flood the mixer. Mitigation: cues bind to start/stop *transitions*, not per-step facts; future rate limiting lives in the System, not callers.
- **Manifest key sprawl.** The key convention is the contract; drift would orphan sounds silently. Mitigation: the convention is normative here and validated by tests; a validator warning for unused `audio.*` keys is future work.
- **Host autoplay policies.** Browsers may block audio before a user gesture. Mitigation: platform-layer concern; the first input gesture unlocks playback without any System change.

## Open Questions

- **OQ-AUD-1:** Should cue bindings (event → key) eventually move into content, letting packs bind arbitrary events to sounds? (Leaning yes, alongside the mechanic catalog work in `28`/`29`.)
- **OQ-AUD-2:** Ducking rules (music under dialogue) — deferred to the Dialogue System issue.

## Future Considerations

- WebAudio-based mixing in the browser backend: real panning, crossfades between beds, per-bus compressor.
- Weather-layered ambient beds once `23-Day-Night-and-Weather.md` lands.
- Per-entity looping emitters (a humming machine) as a component the System manages.

## Version / Author

Version 1.0 — Mike Blom.
