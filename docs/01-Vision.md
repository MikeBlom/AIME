# Resume.World — Vision

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** VIS

---

## Purpose

This document defines what Resume.World *is*, what it must make a visitor feel, and the principles that govern every other specification in the repository. When a system document and this Vision disagree, the Vision wins. It exists so that a team of designers, engineers, and artists can make thousands of small decisions consistently without asking.

## Overview

Resume.World is an interactive world, rendered as a polished indie game, in which the software itself is the resume. A visitor arrives in a partially non-functional engineering world where systems are offline, power is inconsistent, and automation has stalled. By exploring and restoring systems, the visitor gradually rebuilds an engineering organization, and in doing so comes to understand how the creator thinks, solves problems, leads engineers, and builds. Nothing is stated as a resume line. Everything is shown as gameplay.

The product is deliberately built as two separable halves: a career-agnostic **engine** and a swappable **content pack**. This document specifies the experience the engine-plus-content must produce. It does not specify the engine's internals (see `02-System-Architecture.md`) or the content contract (see `03-Data-Model-and-Content-Pipeline.md`).

## Goals

- Make a visitor forget they are reviewing a candidate and instead feel they are exploring a living world.
- Communicate craftsmanship, curiosity, and engineering excellence through *interaction*, never through prose.
- Convert every accomplishment into a mechanic, every concept into a puzzle, every system into something the player restores.
- Achieve a level of polish where every interaction has animation, sound, visual feedback, and a state transition.
- Produce an experience memorable enough to be shared on its own merits, independent of any hiring context.

## Non-Goals

- **Not** a portfolio website, resume site, or LinkedIn-like profile. If a screen ever resembles one, it is a defect.
- **Not** a text dump. The world never presents the creator's resume, long paragraphs, or walls of bullet points.
- **Not** a technology showcase for its own sake. Spectacle that does not teach something about the creator is filler and is removed.
- **Not** an open-ended sandbox with no throughline. There is a story and a direction, even though exploration is free.

## Experiential Pillars

Five pillars define the felt quality of Resume.World. Every feature is judged against them.

1. **A world, not a page.** The space is continuous, inhabited, and reactive. NPCs move, weather changes, day turns to night, machines animate, and background events occur even when the player is idle. The world is never static.
2. **Show, never tell.** Meaning is delivered by doing. "Led 60 engineers" is never written; instead the player experiences a leadership mechanic. "Built distributed systems" is never written; instead the player repairs one.
3. **Restoration as narrative.** Progress is bringing offline systems back to life. Each restoration is both a gameplay beat and a revelation about the creator's career.
4. **Everything acknowledges you.** No invisible actions. Every input produces immediate, legible feedback. Movement feels satisfying; interaction feels instant; animation feels intentional.
5. **Density of delight.** There is always something interesting nearby. No dead space, no long walks without discovery, no unnecessary menus.

## Story Frame

The player arrives in an engineering world that has fallen quiet. Systems are offline, power is inconsistent, automation has stopped. The world reads as a place that was once humming and is now waiting.

As the player explores, they restore systems one at a time. Each restored system re-energizes a part of the world and reveals a chapter of the creator's engineering journey through what the player *does* to restore it, not through exposition. Over the arc, the player realizes they have been rebuilding an entire engineering organization: the systems, the teams, the culture, and the craft that made it run.

The story is expressed entirely through world state and mechanics. There is no cutscene lecture, no biography screen. The narrative lives in the transition from offline to online, and in the metaphors that each restoration embodies.

### The Metaphor Rule (normative)

Accomplishments become mechanics. This mapping is content, never engine code. The engine provides the vocabulary of interaction (restore, repair, route, assemble, orchestrate); the content pack binds specific accomplishments to specific mechanics. Illustrative mappings, using placeholders:

- *"Led a large engineering organization"* → a leadership mechanic where the player coordinates autonomous agents toward a shared objective.
- *"Built distributed systems"* → a district whose power and data must be routed and balanced to come back online.
- *"Shipped an assessment platform"* → an assembly-line facility the player configures and starts.

The engine MUST NOT assume any of these specific metaphors exist. They are examples of the pattern, defined per Content Pack in `03-Data-Model-and-Content-Pipeline.md`.

## User Stories

- *As a hiring manager with ten minutes,* I want to grasp the creator's seniority and range within the first two minutes of play, so that a short visit is still worthwhile.
- *As a curious engineer,* I want to poke at systems and discover how they work, so that the world rewards my instinct to explore.
- *As a visitor on a phone,* I want controls and pacing that suit a touchscreen and a short session, so that the experience does not assume a desktop and an hour.
- *As a visitor using a screen reader or keyboard only,* I want the experience to be navigable and legible, so that the world's craftsmanship extends to everyone.
- *As the creator,* I want to update my career content without engineering help, so that the world stays current as my career grows.
- *As a future creator,* I want to drop in my own content pack and get my own Resume.World, so that the engine outlives any one person's resume.

## Functional Requirements

- **FR-VIS-001** The experience MUST open directly into the world with no resume, no landing page, and no login wall. First meaningful interaction MUST be available within seconds of load.
- **FR-VIS-002** The world MUST present at least one point of interest within immediate view or a few seconds of travel from any location the player can occupy.
- **FR-VIS-003** Every player-initiated interaction MUST produce, at minimum, a visible response, an audible response, and a state change. Silent, invisible interactions are prohibited.
- **FR-VIS-004** Progression MUST be expressed as restoration of world systems, and each restoration MUST reveal career meaning through mechanics rather than expository text.
- **FR-VIS-005** The world MUST exhibit ambient life independent of player input: NPC movement, day/night progression, weather, animated machinery, and background events.
- **FR-VIS-006** The experience MUST NOT at any point display the creator's resume, a biography screen, or a list of jobs, titles, and dates as its primary content. Any factual credential surfaced MUST be embedded in the fiction.
- **FR-VIS-007** All career-specific meaning MUST reside in the Content Pack. The engine MUST be able to run a different creator's pack with no code changes (see `03-Data-Model-and-Content-Pipeline.md`).
- **FR-VIS-008** The experience MUST offer a coherent "short visit" path: a visitor who spends only a few minutes MUST still leave with an accurate impression of the creator's level and range.
- **FR-VIS-009** The world MUST provide non-blocking guidance so a player is never lost, without resorting to modal tutorials or text walls (detailed in the planned `19-Onboarding-and-First-Session.md`).
- **FR-VIS-010** Difficulty MUST never gate comprehension: a player who cannot solve a puzzle MUST still be able to learn what it represents about the creator.

## Non-Functional Requirements

- **NFR-VIS-001 (Polish):** Every interaction bundles animation, sound, visual feedback, and a state transition. This is a hard quality gate, not an aspiration.
- **NFR-VIS-002 (Performance):** The world MUST feel smooth on a mid-range laptop and a modern phone. Concrete frame-time and load budgets are defined in the planned `33-Performance-Budgets.md`; the Vision-level requirement is that jank is treated as a bug.
- **NFR-VIS-003 (Accessibility):** The experience MUST be playable with keyboard only, MUST support screen-reader narration of essential content, MUST meet WCAG 2.2 AA contrast, and MUST offer reduced-motion and remappable controls. Full detail in the planned `34-Accessibility.md`.
- **NFR-VIS-004 (Responsiveness):** The experience MUST adapt to desktop and mobile viewports and to both pointer and touch input without a separate build.
- **NFR-VIS-005 (Data-driven):** No career content is hardcoded. All content is JSON and referenced assets. This is verified in testing.
- **NFR-VIS-006 (Time-to-first-delight):** A first-time visitor MUST experience a moment of clear delight within the first minute.
- **NFR-VIS-007 (Craft consistency):** Visual, audio, and motion design MUST feel authored by a single hand, per the planned `12-Art-Direction.md`.

## Acceptance Criteria

- A first-time visitor, unprompted, describes the experience as "a game" or "a world," not as "a portfolio" or "a resume," in usability testing.
- Within two minutes, a hiring-manager tester can accurately state the creator's approximate seniority and two areas of strength, having read no resume text.
- Every interactive element in a spot-check sample exhibits all four polish components (animation, sound, feedback, state change).
- Replacing the Content Pack with a different creator's data produces a coherent, different Resume.World with no engine code changes.
- A keyboard-only tester and a screen-reader tester can both reach and understand at least the short-visit content.
- No screen in the entire experience presents a resume, a job list, or a biography as primary content.

## Dependencies

- `02-System-Architecture.md` — the engine that realizes this experience.
- `03-Data-Model-and-Content-Pipeline.md` — the contract that keeps career meaning in content, satisfying FR-VIS-007 and NFR-VIS-005.
- Downstream, every system document (10–49) inherits the pillars and requirements defined here.

## Implementation Notes

- Design references for *feel* (non-binding): the moment-to-moment satisfaction of Nintendo traversal, the systemic clarity of Valve puzzles, the finish of Blizzard menus and feedback, the interface calm of Apple, the developer ergonomics of Vercel, and the documentation discipline of Amazon. These are calibration targets, not features to copy.
- Prefer teaching by consequence over teaching by instruction. If the player learns a mechanic by trying it and seeing what happens, no tutorial text is needed.
- The "short visit" path (FR-VIS-008) is best served by placing the most senior, most differentiating metaphor near the start, so a two-minute visit still lands the strongest signal.

## Edge Cases

- **The skimmer.** A visitor clicks around without engaging. The world must still communicate signal through ambient state and easily-triggered interactions.
- **The completionist.** A visitor tries to exhaust everything. There must be enough depth and enough discoverable secrets that thoroughness is rewarded, not exhausted in minutes.
- **The blocked player.** A visitor cannot solve a puzzle. Per FR-VIS-010, comprehension must never be gated behind skill; a graceful bypass or hint reveals the meaning regardless.
- **The offline or slow connection.** First delight must not depend on large assets finishing download; the opening must be lightweight.
- **The tiny screen.** On a small phone, density of delight must not become density of clutter; the world must remain legible.

## Risks

- **Cleverness over clarity.** A metaphor so abstract that the player misses the point defeats "show, never tell." Mitigation: every metaphor is playtested for whether players extract the intended meaning.
- **Polish debt.** The four-part polish gate is expensive; skipping it "temporarily" erodes the whole premise. Mitigation: the gate is enforced in review, not deferred.
- **Breadth over depth.** Trying to represent an entire career at once yields shallow everything. Mitigation: fewer, deeper restorations beat many thin ones.
- **Engine/content leakage.** Career facts leaking into engine code kills swappability. Mitigation: enforced by the Data Model contract and tests.

## Open Questions

- **OQ-VIS-1:** How many restorations constitute the core arc? (A small number, deep, is preferred; exact count deferred to `10-Gameplay-Loops.md`.)
- **OQ-VIS-2:** Is there an explicit "ending," or does the world simply reach a fully-restored steady state? (Deferred to `10-Gameplay-Loops.md`.)
- **OQ-VIS-3:** Does the short-visit path need an explicit "highlights" affordance, or does world placement alone suffice? (Deferred to `19-Onboarding-and-First-Session.md`.)

## Future Considerations

- A second Content Pack for a different creator, proving the engine's generality and opening a possible product.
- Seasonal or event-driven world states that keep returning visitors surprised.
- An authoring tool so non-engineers can generate their own Resume.World from career data.

## Version / Author

Version 1.0 — Mike Blom.
