# Resume.World — Product Requirements Repository

**Version:** 1.0
**Author:** Mike Blom
**Status:** Foundational set (Vision + Architecture). Remaining system specs are planned but not yet written.

---

## Purpose

This repository is the single source of truth for building **Resume.World**: an interactive, game-like engineering portfolio in which the *software itself is the resume*. This README is the map. It explains what the repository is, how documents are structured, what has been written so far, and what remains to be authored.

The objective is not a portfolio website. It is a living engineering world that a visitor explores, repairs, and understands, finishing with a clear sense of how the creator thinks, solves problems, leads engineers, and builds systems. At no point should the experience resemble LinkedIn, a resume site, or a traditional portfolio.

## Overview

Resume.World is a **data-driven engine plus a content pack**. The engine knows nothing about any particular career; it renders a world, runs quests, drives NPCs, and handles input. All career-specific meaning lives in JSON content files that can be swapped to feature a different creator without touching engine code. The two foundational documents in this set define the experience (Vision) and the machine that delivers it (System Architecture), plus the contract that binds them (Data Model & Content Pipeline).

## Goals

- Give any implementer a coherent mental model of the product before they read a single system spec.
- Establish shared vocabulary, document conventions, and a stable directory layout.
- Make the boundary between **engine** (generic) and **content** (career-specific) explicit and load-bearing.
- Sequence the remaining specification work so it can be authored and built incrementally.

## Non-Goals

- This README does not specify any runtime system in detail; it points to the documents that do.
- It does not choose a rendering technology, framework, or language. The specs are deliberately stack-agnostic (see Vision, "Technical Constraints").
- It does not contain career content. Career content lives in data files described by `03-Data-Model-and-Content-Pipeline.md`.

## The Foundational Set (authored now)

| # | Document | What it defines |
|---|----------|-----------------|
| 00 | `00-README.md` | This map: conventions, vocabulary, and the full planned document tree. |
| 01 | `01-Vision.md` | Mission, experiential pillars, story frame, design principles, quality bar, success metrics, and cross-cutting constraints every other doc inherits. |
| 02 | `02-System-Architecture.md` | The stack-agnostic engine: composition/ECS model, event bus, module lifecycle, plugin boundaries, system interfaces, and the runtime loop. |
| 03 | `03-Data-Model-and-Content-Pipeline.md` | The content contract: JSON schemas with placeholder examples, validation, hot reload, localization hooks, and creator-swappability. |

Read them in order. Vision sets intent, Architecture sets structure, Data Model sets the seam between the two.

## The Full Planned Repository (to be authored)

The following documents are anticipated. This list is a plan, not a promise of final structure; documents may split or merge as detail accrues. Numbers group by concern rather than build order.

**Experience & Design (10–19)**
`10-Gameplay-Loops.md`, `11-World-Design.md`, `12-Art-Direction.md`, `13-Camera.md`, `14-Input-and-Controls.md`, `15-Movement-and-Traversal.md`, `16-Animation.md`, `17-Audio.md`, `18-UI-UX-and-HUD.md`, `19-Onboarding-and-First-Session.md`

**World Systems (20–29)**
`20-Quest-Engine.md`, `21-Dialogue-System.md`, `22-NPC-and-Behavior.md`, `23-Day-Night-and-Weather.md`, `24-World-Simulation-and-Ambient-Events.md`, `25-Buildings-and-Interiors.md`, `26-Inventory-and-Progression.md`, `27-Achievements.md`, `28-Mini-Games-Framework.md`, `29-Mini-Games-Catalog.md`

**Platform & Engine (30–39)**
`30-Rendering.md`, `31-Physics-and-Collision.md`, `32-Save-Load-and-Persistence.md`, `33-Performance-Budgets.md`, `34-Accessibility.md`, `35-Localization.md`, `36-Analytics-and-Telemetry.md`, `37-Content-Authoring-Tools.md`, `38-Asset-Pipeline.md`, `39-State-Management.md`

**Delivery (40–49)**
`40-Developer-Experience.md`, `41-Testing-Strategy.md`, `42-Deployment-and-Hosting.md`, `43-Observability-and-Error-Handling.md`, `44-Security-and-Privacy.md`, `45-Future-Expansion.md`, `46-Glossary.md`, `47-Content-Style-Guide.md`

Not every number will be used, and new documents may be added. The rule from the brief holds: never create filler; every document must justify its existence.

## Document Conventions

Every specification in this repository uses the same section skeleton so readers can navigate any document by muscle memory:

1. **Purpose** — why this document exists, in one or two sentences.
2. **Overview** — the shape of the thing being specified.
3. **Goals** — what success looks like for this system.
4. **Non-Goals** — what this system deliberately does not do.
5. **User Stories** — the experience expressed from the player's or author's point of view.
6. **Functional Requirements** — observable behavior, numbered for reference.
7. **Non-Functional Requirements** — performance, accessibility, quality attributes.
8. **Acceptance Criteria** — testable conditions that determine "done."
9. **Dependencies** — other documents and systems this one relies on.
10. **Implementation Notes** — guidance and rationale, non-binding where marked.
11. **Edge Cases** — the awkward states that break naive implementations.
12. **Risks** — what could go wrong and how we mitigate it.
13. **Open Questions** — decisions deferred, with an owner where known.
14. **Future Considerations** — what we are leaving room for.
15. **Version / Author** — provenance.

### Requirement identifiers

Functional requirements are labeled with a document prefix and number, e.g. `FR-ARCH-014`. Non-functional requirements use `NFR-`. This lets any other document, test, or ticket cite an exact requirement. Prefixes: `VIS` (Vision), `ARCH` (Architecture), `DATA` (Data Model), and the two-to-three letter code of each future document.

### Normative language

We use RFC 2119 keywords. **MUST** / **MUST NOT** are hard requirements. **SHOULD** / **SHOULD NOT** are strong recommendations with room for justified deviation. **MAY** denotes an option. Anything in an "Implementation Notes" section is non-normative unless it restates a numbered requirement.

## Core Vocabulary

A shared glossary prevents the most expensive bugs, which are definitional. The authoritative glossary will live in `46-Glossary.md`; these terms are load-bearing across the foundational set:

- **Engine** — the generic, career-agnostic runtime. Contains zero career facts.
- **Content Pack** — the JSON (and referenced asset) bundle that gives the engine a specific world and career to express. Swappable.
- **Creator** — the person whose career the active Content Pack expresses. Placeholder in this repo; the reference creator is Mike Blom.
- **Region** — a named area of the world (e.g., an offline district) that groups buildings, NPCs, and quests.
- **System** — a self-contained engine module with a defined interface and lifecycle (e.g., Rendering, Quest, Dialogue).
- **Restoration** — the core narrative act: bringing an offline system back online, which reveals a slice of the creator's career.
- **Metaphor** — the mapping from a real accomplishment to an interactive mechanic (e.g., "led a distributed team" becomes a repairable distributed system). Metaphors live in content, not code.
- **Session** — one continuous visit by one player.

## How to Use This Repository

Implementers should read `01-Vision.md` first to internalize intent, then `02-System-Architecture.md` for structure, then `03-Data-Model-and-Content-Pipeline.md` for the engine/content contract. System specs (10–49) can then be authored and built in dependency order, each one inheriting the constraints declared in the foundational set. When a system spec conflicts with the Vision, the Vision wins and the system spec must be corrected.

## Dependencies

None. This is the root document.

## Risks

- **Scope gravity.** The brief is expansive; the risk is breadth without depth. Mitigation: the foundational set is authored deep first, and the repository grows in dependency order rather than all at once.
- **Engine/content leakage.** If career facts creep into engine code, swappability dies. Mitigation: the seam is specified normatively in Document 03 and enforced in testing (see planned `41-Testing-Strategy.md`).

## Open Questions

- **OQ-README-1:** Final numbering scheme once all systems are authored — confirm the 10/20/30/40 grouping survives contact with detail.
- **OQ-README-2:** Whether Mini-Games warrant a single document or a catalog plus framework split (currently planned as both, 28 and 29).

## Future Considerations

The repository is structured so a second Content Pack (a different creator) could be added without any new engine document. If the product succeeds, the natural expansion is a public authoring tool (`37`) that lets anyone generate a Resume.World from their own career data.

## Version / Author

Version 1.0 — Mike Blom.
