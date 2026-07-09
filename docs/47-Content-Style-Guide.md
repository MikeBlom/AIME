# Resume.World — Content Style Guide

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** CSG

---

## Purpose

This document is the authoring guide for Content Packs: how to write regions, quests, metaphors, dialogue, and strings that play as a coherent Resume.World. The reference pack (`content/pack.reference`) is the worked example; this guide is the rules it follows.

## Overview

A pack is a world that *is* a career story, told through restoration (FR-VIS-004). Every document is data validated against the published schemas (`03-Data-Model-and-Content-Pipeline.md`); every player-visible sentence is a locale key; every accomplishment reaches the player as a **metaphor** bound to an engine mechanic, never as resume text (FR-VIS-006). The engine supplies the verbs — routing, assembling, orchestrating, talking, exploring — and the pack supplies every noun.

## Goals

- Worlds a two-minute visitor understands and a ten-minute visitor wants to finish (FR-VIS-008).
- Career meaning that lands through play and lands anyway through the bypass (FR-VIS-010).
- Packs any creator can fork: replace ids, strings, bindings, and assets; touch no code (DATA-FR-029).

## Non-Goals

- Visual art direction (`12-Art-Direction.md`) and UI copywriting conventions beyond string rules.
- Schema reference — shapes live in `03` and `src/content/schemas.ts`; this guide is judgment, not structure.

## User Stories

- *As the reference creator,* I replace `PLACEHOLDER` copy with my real stories and the world becomes mine without touching a schema.
- *As a new creator,* I fork the pack, rename `pack.reference` ids to my own namespace, and validation walks me through everything I missed.
- *As a reviewer,* I can check any player-visible sentence against the Metaphor Rule without reading engine code.

## Functional Requirements

- **FR-CSG-001** Every player-visible string MUST live in the locale table and be referenced by key (DATA-FR-011). No inline text in documents, ever.
- **FR-CSG-002** Copy awaiting the creator's real career details MUST carry the `PLACEHOLDER ` prefix so unfinished copy is greppable and never mistaken for final (the reference pack's convention).
- **FR-CSG-003** The `accomplishment` field on a metaphor is author-facing context only (DATA-FR-010). The player-facing translation of the same fact goes in `framingKey` copy, fiction-framed: *what the world felt like because this person did the thing*, never the thing's job title.
- **FR-CSG-004** Every quest MUST bind a metaphor (`metaphorRef`) whose mechanic teaches the accomplishment's shape (DATA-FR-009), and MUST declare a `bypass` with a reveal key — comprehension is never gated (FR-VIS-010). Choose the mechanic by the *feeling* of the work: distribution under constraint → route-and-balance; built right, in order → assembly; many parts on one beat → orchestrate (`29-Mini-Games-Catalog.md`).
- **FR-CSG-005** The start region MUST carry the short-visit path (FR-VIS-008): the strongest, most differentiating metaphor is the first quest a visitor meets, with an NPC whose opening dialogue points at it. Depth goes behind it, never in front of it.
- **FR-CSG-006** Dialogue MUST stay diegetic and short: an opening line, a choice that *does* the thing (`resolves` solved), a choice that *asks* instead (`resolves` bypassed — the fiction's own bypass), and a way out. No tutorials, no walls of text (NFR-VIS-006).
- **FR-CSG-007** Ids MUST be namespaced `type.name` (DATA-FR-008) and stable once shipped — saves key progression on them. Strings keys follow the id they describe (`quest.<name>.title`, `dialogue.<name>.<node>`).
- **FR-CSG-008** A pack MUST validate with zero errors AND zero warnings before it ships: every region reachable, every reference resolving, every key present in the default locale. Warnings are authoring debt; the reference pack carries none.

## Non-Functional Requirements

- **NFR-CSG-001 (Tone):** One narrative voice per pack; the reference pack's is quiet, concrete, and warm — machinery described the way its operator would.
- **NFR-CSG-002 (Economy):** If a sentence does not advance delight or meaning, cut it (the Vision's test).
- **NFR-CSG-003 (Swap-cleanliness):** Nothing in a pack may assume another pack's ids, and nothing in the engine may assume this pack's (`pack.harbor` exists to prove it).

## Acceptance Criteria

- The reference pack plays start-to-restored as a coherent arc: three quests, three mechanics, three reveals, achievements marking the beats.
- Every quest offers both an honest path and a bypass, in-fiction (dialogue) and in-mechanic (hold-to-bypass).
- `content/pack.harbor` — a different creator's world — validates and boots on the same engine build with no code changes (DATA-FR-029).
- Grepping `PLACEHOLDER` lists exactly the copy awaiting real career details, nothing else.

## Dependencies

- `01-Vision.md` — the Metaphor Rule, short-visit, and bypass requirements this guide operationalizes.
- `03-Data-Model-and-Content-Pipeline.md` — schemas, validation, and reference rules.
- `20-Quest-Engine.md`, `21-Dialogue-System.md`, `28`/`29` (mini-games) — what quests, dialogue, and bindings can do.

## Implementation Notes (non-normative)

- Author in this order: the accomplishment list → one metaphor per accomplishment → quests around the metaphors → the region layout that sequences them → NPCs and dialogue that point the way → strings last, in one sitting, for voice consistency.
- The bypass reveal may reuse the completion reveal key (the reference pack does) — meaning is identical either way; only the player's route differs.
- Keep params honest to the metaphor: route-and-balance channel counts, assembly sequences, and orchestrate tracks should echo the real accomplishment's scale in miniature, not inflate it.
- Grants (`onComplete.grants`) are for world callbacks — a key that opens a door, a capability a later quest checks — not rewards for their own sake.

## Edge Cases

- **A fact that resists metaphor** (a certification, a date). If it matters, embed it in fiction (a plaque in an interior point's hint); if it does not survive that translation, it did not matter (FR-VIS-006).
- **Two accomplishments, one mechanic.** Fine — different params and framing carry the difference; the catalog grows only when a *shape* of work is missing.
- **Copy that outgrows a hint line.** Split it across interior points and dialogue beats; no single surface should carry a paragraph.

## Risks

- **Placeholder shipping as final.** Mitigation: FR-CSG-002 makes it greppable; the launch sweep (#45) checks for the prefix.
- **Resume leakage** (job titles drifting into framing copy). Mitigation: review framing keys against FR-VIS-006 explicitly; the fiction test is "would a character in this world say it?"

## Open Questions

- **OQ-CSG-1:** Whether the pack should declare its short-visit path explicitly for onboarding (#44) rather than by convention (first quest in the start region). Owner: #44.

## Future Considerations

- A pack-scaffolding CLI (`fork this pack, rename the namespace`) once a second real creator exists.
- Locale style notes per language when localization (#38) adds them.

## Version / Author

Version 1.0 — Mike Blom.
