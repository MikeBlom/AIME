# Resume.World — Onboarding and First Session

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** ONB

---

## Purpose

This document specifies the Onboarding System: the diegetic, non-blocking guidance that keeps a first-time visitor oriented (FR-VIS-009) and paces the opening so a moment of clear delight lands inside the first minute (NFR-VIS-006) — with no modal tutorial, no text wall, and no separate tutorial mode.

## Overview

Onboarding is a System like any other: it conforms to the System interface and lifecycle, reads shared world state and bus events, and holds no reference to any other System. It expresses guidance as a small set of one-shot **cues** that ride the UI System's hint line — the channel `18-UI-UX-and-HUD.md` reserves for exactly this purpose (FR-UI-009) — so guidance shares the interface's minimalism instead of adding chrome.

The arc is teaching by consequence (Vision, Implementation Notes): the world offers a beat only when the player has not yet discovered the thing themselves, and a demonstrated skill cancels its nudge instantly. Arrival raises a short welcome; sustained stillness nudges movement; movement without interaction nudges interaction; and a player adrift mid-session — idle while a quest is still open — is re-oriented toward the arc. Nothing pauses, nothing blocks, and the player who needs no help never notices the System exists.

The engine names only generic cue keys (`onboarding.hint.*`), following the `ui.prompt.interact` precedent: the pack supplies the words in its strings documents, so the guidance voice belongs to the content, not the code. First-minute *delight* itself is a joint product: the pack's short-visit placement (DATA/47, FR-VIS-008) puts a point of interest near spawn; this System makes sure the visitor is moving toward it within seconds.

## Goals

- Keep a first-time visitor oriented at every point of a first session without ever blocking play (FR-VIS-009).
- Pace the opening so a fully passive visitor is guided into their first interaction well inside the first minute (NFR-VIS-006).
- Cancel guidance the moment it is redundant: the world never explains what the player just did.
- Keep every guidance word in the Content Pack via locale keys (DATA-FR-011, NFR-VIS-005).
- Degrade gracefully: a world without a UI System, a quest engine, or onboarding strings stays coherent (FR-ARCH-008).

## Non-Goals

- **No tutorial mode.** There is no separate onboarding scene, overlay, or state machine the player must exit.
- **Not the hint line itself** — that surface belongs to `18-UI-UX-and-HUD.md`; this System is one of its clients.
- **Not content authoring guidance** — which words each cue speaks and where the short-visit path leads are the pack's business (`47-Content-Style-Guide.md`).
- **Not the touch/virtual-controls decision** (OQ-INP-1) — input affordances stay with `14-Input-and-Controls.md`; this System guides whatever inputs exist.
- **Not analytics** — the funnel that *measures* time-to-first-delight is `36-Analytics-and-Telemetry.md`; this System optimizes it.

## User Stories

- *As a first-time visitor,* moments after I arrive something in the world acknowledges me, so I feel expected rather than dropped into a void.
- *As a hesitant visitor,* when I sit still too long a single quiet line suggests what to try, and it disappears once I try it.
- *As a confident player,* I move and interact immediately and never see a single instruction.
- *As a returning visitor,* I am not welcomed twice: the world remembers what I have already learned.
- *As a content author,* I change every guidance line by editing the pack's strings document, never code.

## Functional Requirements

- **FR-ONB-001** Guidance MUST be expressed only through non-blocking surfaces (the UI hint line via `ui.hint` events); the System MUST NOT open a modal surface, pause simulation, or suppress input (FR-VIS-009, FR-UI-003).
- **FR-ONB-002** The System MUST derive every cue from world state and bus events only — no separate tutorial mode, no scripted sequence divorced from the live world.
- **FR-ONB-003** The cue arc MUST be: a **welcome** shortly after arrival; a **move** nudge if the player has never moved; an **interact** nudge if the player has moved but never interacted; an **objective** re-orientation when the player has been idle with a quest still open.
- **FR-ONB-004** A demonstrated skill MUST cancel its nudge immediately and permanently: movement cancels the move nudge, interaction (an interact intent or an opened dialogue) cancels the interact nudge; neither ever re-fires.
- **FR-ONB-005** Welcome and the two skill nudges MUST be one-shot per visitor: their fired/learned flags live in the System's owned world-state slice (FR-ARCH-015) and persist through the save envelope (FR-ARCH-016), so a resumed session replays none of them.
- **FR-ONB-006** The objective re-orientation MUST re-arm after each further idle span (the player is *never* lost), MUST fire only while at least one quest is still open, and any player activity or progress event MUST reset the idle clock.
- **FR-ONB-007** Cue timings MUST budget the first minute (NFR-VIS-006): the welcome within moments of arrival, the move nudge and the interact nudge each early enough that a fully passive visitor has received every applicable beat before sixty simulated seconds.
- **FR-ONB-008** Every cue MUST be a locale key resolved through the pack strings table (DATA-FR-011); the engine names only the generic keys `onboarding.hint.welcome|move|interact|objective`. A pack that defines no onboarding strings shows nothing and faults nothing (FR-UI-006, FR-ARCH-008).
- **FR-ONB-009** Cues MUST be polite: at most one cue at a time; each clears itself after a short ride; no cue fires while a modal surface is open or while any other System's hint occupies the line; the System clears only the hint it set.
- **FR-ONB-010** Each cue MUST also be announced as an `onboarding.cue` event (cue id plus key), so audio, analytics, or future Systems can bind feedback without coupling (FR-ARCH-005).

## Non-Functional Requirements

- **NFR-ONB-001 (Determinism):** Cue selection and timing read only world state, buffered events, and `dt` — no clocks, no randomness — so replays reproduce identical guidance (NFR-ARCH-001).
- **NFR-ONB-002 (Restraint):** Guidance is one short line at a time, occasional by construction. A first session that reads as instructional is a defect (Vision pillar: show, never tell).
- **NFR-ONB-003 (Testability):** The full first-minute arc is assertable from a fake Context by feeding scripted events and `dt` (NFR-ARCH-002).

## Acceptance Criteria

- A fully passive session receives welcome, move nudge, and (with a quest open) an objective re-orientation, all inside sixty simulated seconds, each clearing itself (FR-ONB-003/007).
- A session that moves at once and interacts promptly sees at most the welcome — never a nudge (FR-ONB-004).
- No cue opens a modal surface or writes any slice but its own; with a dialogue open or another hint showing, cues wait (FR-ONB-001/009).
- A restored visitor whose flags are all set receives no welcome and no nudges (FR-ONB-005).
- The same scripted session replays an identical cue feed (NFR-ONB-001).
- All cue text comes from pack strings; the engine source contains no guidance sentence (FR-ONB-008).

## Dependencies

- `01-Vision.md` — FR-VIS-009 (never lost, never modal), NFR-VIS-006 (first-minute delight), FR-VIS-008 (short-visit path).
- `02-System-Architecture.md` — System lifecycle, event bus, slice ownership, determinism.
- `18-UI-UX-and-HUD.md` — the hint line (`ui.hint`, FR-UI-009) and the modal flag this System honors.
- `14-Input-and-Controls.md`, `20-Quest-Engine.md`, `21-Dialogue-System.md`, `15-Movement-and-Traversal.md` — the intent, quest, dialogue, and movement events that drive cues.
- `32-Save-Load-and-Persistence.md` — the save envelope that persists the one-shot flags.
- `47-Content-Style-Guide.md` — voice and placeholder rules for the pack's `onboarding.hint.*` strings.

## Implementation Notes (non-normative)

- The reference implementation (`src/systems/onboarding.ts`) runs ordered after the UI System so the modal/hint occupancy it reads is current, and buffers events between flushes exactly like the camera and achievements Systems.
- Tuning as shipped: welcome at 1.5s riding 6s; move nudge at 8s; interact nudge 12s after first movement; adrift re-orientation after 45s idle. All constants are exported for tests and future tuning.
- The interact nudge deliberately waits for first movement: a visitor who has not yet moved needs the move beat, not two competing lines.
- "Activity" that resets the idle clock is any movement, interaction, or progress event (dialogue, mini-game, building entry, quest advance/completion, restoration) — a busy player is never re-oriented.
- First-delight measurement (`first-delight` in analytics) is the funnel this pacing serves; if playtesting moves the constants, the budget in FR-ONB-007 is the invariant, not the numbers.

## Edge Cases

- **The player moves before the welcome.** The welcome still lands (it is scene-setting, not instruction); the move nudge never does.
- **An achievement toast and a due cue collide.** The cue waits out the toast; the hint line is never stomped (FR-ONB-009).
- **A dialogue is open when a nudge falls due.** The cue waits for the modal flag to clear.
- **The pack defines no onboarding strings.** Keys go unresolved and the hint line draws nothing; the arc's state still advances so a later locale switch does not replay stale beats.
- **No quest engine or no open quest.** The objective cue never fires; stillness alone is not "lost" once there is nothing to point toward.
- **A world without a UI System.** Cue events still publish to no listeners; state stays honest (FR-ARCH-008).

## Risks

- **Nag drift.** More cues, shorter fuses, and re-firing nudges would slide toward a tutorial. Mitigation: NFR-ONB-002 is a review gate; new cues need a demonstrated player-lost case.
- **Placement dependence.** Guidance can point at the arc, but only content placement makes the first minute delightful. Mitigation: FR-VIS-008/DATA short-visit placement is asserted in the reference pack's tests.
- **Idle misreads.** Watching ambient life contentedly is indistinguishable from being lost. Mitigation: the adrift span is long (45s), the line is one sentence, and it clears itself.

## Open Questions

- **OQ-ONB-1 (was OQ-VIS-3):** *Resolved for v1:* no explicit "highlights" affordance; short-visit placement plus the objective cue suffice. Revisit if playtesting shows two-minute visitors missing the strongest signal.
- **OQ-ONB-2 (was OQ-CSG-1's onboarding half):** *Resolved for v1:* no pack-level onboarding declaration; the engine names generic cue keys and packs supply words. A declarative per-pack cue list (custom triggers, custom keys) is the natural extension if a pack needs a differently shaped opening.
- **OQ-ONB-3:** Touch-first affordances (OQ-UI-3, OQ-INP-1) — whether the move/interact nudges should name the input modality. Deferred until virtual touch controls land; keys are generic today so packs may already phrase for both.

## Future Considerations

- A declarative pack-defined cue list (trigger + key + budget) once a second pack wants a different opening rhythm.
- Cue-aware audio: a soft chime bound to `onboarding.cue`, mirroring the achievement cue binding.
- World-simulation cooperation: nudging ambient events toward the player's view while they are adrift (OQ-WSM-2).

## Version / Author

Version 1.0 — Mike Blom.
