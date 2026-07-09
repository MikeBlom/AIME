# Resume.World — Achievements

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** ACH

---

## Purpose

This document specifies achievements: content-defined recognitions that unlock through gameplay, surface non-intrusively, and persist. They reward exploration and mark milestones in the restoration arc without ever interrupting it.

## Overview

An achievement is a content entity (`achievement` schema): locale keys for its title and description plus an **unlock rule**. The rule vocabulary belongs to the engine — membership and count predicates over the progression record (restored regions, completed quests, capabilities, items) and the building-entered moment — while what any rule binds to is pack data. The Achievements System re-evaluates locked achievements against shared world state each fixed step; when a rule holds, it flips the achievement's persisted unlock state, announces `achievement.unlocked`, and rides the title key on the UI hint line as a brief, self-clearing toast. The Audio System binds a cue to the announcement; the pack decides whether the chime asset exists.

## Goals

- Achievements as pure data: adding one is a content edit, never a code change (NFR-VIS-005).
- Unlocks driven by events and shared world state, honoring slice ownership (FR-ARCH-005/015).
- Feedback that delights without interrupting: no modal, no focus steal (FR-VIS-009's spirit).
- Unlock state that survives save/load without replaying feedback (FR-ARCH-016).

## Non-Goals

- Platform achievement integrations (Steam, Game Center) — future consideration.
- An achievements browsing screen (UI issue when the pack needs one).
- Meta-progression or rewards for unlocks; recognition is the reward in v1.

## User Stories

- *As a visitor,* restoring my first system earns a quiet chime and a brief line of recognition that fades on its own, so I feel seen but never interrupted.
- *As a visitor,* my recognitions are still there when I come back tomorrow.
- *As a content author,* I add an achievement document with `unlock: { kind, ref | count }` and it works; validation catches a rule that points at a region or quest that does not exist.
- *As an engine developer,* I extend the rule vocabulary with one new predicate and existing content keeps validating.

## Functional Requirements

- **FR-ACH-001** Achievement entities MUST spawn from `achievement` content documents; titles and descriptions MUST be locale keys, never inline text (DATA-FR-011).
- **FR-ACH-002** Unlock rules MUST bind engine-provided rule kinds (`restored-region`, `restored-count`, `quest-completed`, `capability-unlocked`, `item-added`, `building-entered`) to pack ids/counts; an unknown or malformed rule MUST degrade to never-self-unlocking rather than fault (FR-ARCH-008).
- **FR-ACH-003** Locked achievements MUST be re-evaluated each fixed step against the progression slice (and buffered `building.entered` announcements), so unlocks are state-driven and cannot be missed by event timing.
- **FR-ACH-004** An unlock MUST be announced as a deferred `achievement.unlocked` event and surfaced non-intrusively: a toast on the UI hint line that clears itself after a few seconds of simulation time, plus an audio cue bound by the Audio System that plays only when the pack supplies the asset.
- **FR-ACH-005** Unlock state MUST persist with the progression slices and round-trip losslessly; an achievement restored as unlocked MUST replay no feedback (FR-ARCH-016).
- **FR-ACH-006** Unlocks MUST be exactly-once: a satisfied rule re-checked on later steps changes nothing and re-announces nothing.
- **FR-ACH-007** Validation MUST check rule references against the pack: a `restored-region`, `quest-completed`, or `building-entered` rule naming a missing id is a broken reference (DATA-FR-007).

## Non-Functional Requirements

- **NFR-ACH-001 (Determinism):** Evaluation reads world state and buffered events only; the toast countdown runs on simulation `dt` (NFR-ARCH-001).
- **NFR-ACH-002 (Non-intrusiveness):** Feedback never blocks input, opens a modal, or pauses simulation.

## Acceptance Criteria

- An achievement unlocks on its content-defined condition with polished feedback (issue #32 AC1): the rule from the document fires, `achievement.unlocked` publishes, the title key rides the hint line and clears itself, and the audio cue binding exists.
- Unlock state persists across save/load (issue #32 AC2): capture → apply reproduces unlocked flags, and a restored unlock replays no feedback.
- Every rule kind unlocks on its condition; malformed rules never unlock; repeated satisfaction announces once.

## Dependencies

- `26-Inventory-and-Progression.md` — the progression slice rules predicate over.
- `25-Buildings-and-Interiors.md` — the `building.entered` announcement.
- `17-Audio.md` — the cue binding; `18-UI-UX-and-HUD.md` — the hint line the toast rides.
- `03-Data-Model-and-Content-Pipeline.md` — the `achievement` schema this document extends with `unlock`.
- `32-Save-Load-and-Persistence.md` — the persisted slice list.

## Implementation Notes (non-normative)

- Predicating over the progression slice (rather than subscribing to each gameplay event) makes unlocks resumable by construction: a save restored with progression already satisfying a rule unlocks on the first step — unless the unlock state itself was saved as unlocked, which is why both slices persist together.
- `building-entered` is the one edge-triggered kind because visits are not recorded in progression; if visit history ever joins the progression slice, the rule becomes a membership predicate like the others.
- The toast deliberately reuses the hint line instead of adding a new surface: one place for ambient text keeps the HUD quiet. If two systems contend for the line, the latest write wins and both clear themselves — acceptable for v1 and revisited with Art Direction.

## Edge Cases

- **Progression already satisfies a rule at first update** (resume without saved unlock state, or content lowering a count). The achievement unlocks immediately, once.
- **Two achievements unlock on the same step.** Both announce; the later toast replaces the earlier on the hint line; both unlock states persist.
- **A rule references content that was removed.** Validation rejects the pack (FR-ACH-007); a rule made stale at runtime simply never fires.
- **Save captured mid-toast.** The toast is presentation transient and is not persisted; resume shows no toast, which is correct — the unlock was already seen.

## Risks

- **Vocabulary creep.** Every content wish becomes a new rule kind. Mitigation: kinds must predicate over recorded world state; anything else needs its own system first.
- **Feedback fatigue.** Too many achievements cheapen the chime. Mitigation: a content-style-guide concern (`47-Content-Style-Guide.md`), not an engine control.

## Open Questions

- **OQ-ACH-1:** Whether an achievements review surface (list of earned recognitions) ships in v1 — decided by the content pack's needs in issue #35.
- **OQ-ACH-2:** Compound rules (AND/OR of predicates) — deferred until content demonstrates a need.

## Future Considerations

- Platform achievement bridges in the Platform Adapter.
- Compound and sequenced rules if the reference pack's arc wants them.
- Rarity/tier metadata as content-only fields the UI may surface.

## Version / Author

Version 1.0 — Mike Blom.
