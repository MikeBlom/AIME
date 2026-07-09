# Resume.World — Dialogue System

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** DLG

---

## Purpose

This document specifies the Dialogue System: how conversation trees authored as content play through the UI surface — branching choices, end nodes, no text walls (Vision Non-Goals) — and how a conversation touches the world through hooks, including advancing quests.

## Overview

A dialogue is a content document (`03-Data-Model-and-Content-Pipeline.md`, schema `dialogue`): a list of nodes, each carrying a speaker line's locale key, optional player choices (`textKey` + `goto`), an `end` flag, and optional `resolves` hooks. The composition root spawns one entity per dialogue document carrying the immutable `Dialogue` definition; the System owns the `DialogueState` traversal slice — which conversation is at which node (FR-ARCH-015).

The System is a pure event-driven traversal. Any System requests a conversation by publishing `dialogue.start.requested { dialogueId }` — the `startDialogue(id)` contract expressed as an event, since Systems never call each other (FR-ARCH-005). Each visited node is presented by publishing the UI System's `ui.dialogue.open` with locale keys only; the UI owns rendering, selection, and the modal flag (`18-UI-UX-and-HUD.md`). The player's answer returns as `ui.dialogue.chosen`; the System follows the chosen branch's `goto`, fires its hook, and ends the conversation at end nodes (or on a plain advance past a choiceless node) with `dialogue.ended`.

Hooks are the seam to gameplay: a choice or an end node may declare `resolves { questRef, objectiveId, outcome }`, which the System publishes as the Quest Engine's standardized `objective.resolved` feed (`20-Quest-Engine.md`) — a conversation can advance or bypass a quest objective without either System knowing the other exists.

## Goals

- Conversations as pure content: node graphs, branches, and hooks are JSON; the engine ships the traversal, never a sentence (FR-VIS-007).
- No text walls: one line and its choices at a time, through the same minimal surface everything else uses (Vision Non-Goals, NFR-VIS-001 via the UI layer).
- Composable consequences: dialogue drives quests (and, later, anything listening) through standard events, not couplings.
- Deterministic traversal: identical answers replay identical conversations (NFR-ARCH-001).

## Non-Goals

- Rendering, layout, selection input — the UI System owns the surface; this System only asks it to show nodes.
- Voice acting; dialogue *content* beyond the reference placeholder (Phase 3, #35).
- NPC interaction affordances that *start* conversations — `22-NPC-and-Behavior.md` (issue #27) publishes the start request.
- Conditional branches (state-gated choices), variables, or dialogue memory — future extensions of the same schema.
- Locale switching and cross-locale fallback — `35-Localization.md` (issue #38); this System never touches text at all.

## User Stories

- *As a player,* I talk to a character, pick an answer with the same keys I move with, and the conversation branches; it never dumps a page of prose on me.
- *As a content author,* I write a JSON node graph and my conversation just plays; marking one choice with a `resolves` hook makes it advance a quest.
- *As a quest author,* "talk to the foreman" is an objective a dialogue choice resolves — I wire it in data.
- *As a tester,* I script the same answers twice and get bit-identical traversal and events.

## Functional Requirements

- **FR-DLG-001** Dialogue definitions MUST come entirely from content documents; every player-visible line and choice travels as a locale key, never inline text (DATA-FR-011, NFR-VIS-005).
- **FR-DLG-002** A conversation MUST start only via `dialogue.start.requested`; the System MUST announce `dialogue.started` and present the graph's first node. A request while a conversation is active MUST be ignored (the surface is modal), as MUST a request naming an unknown dialogue (FR-ARCH-008).
- **FR-DLG-003** Nodes MUST be presented through the UI System's dialogue surface event with the node's locale keys; this System MUST NOT render, resolve text, or read input devices (FR-ARCH-005; FR-ARCH-023 is the UI/input layers' concern).
- **FR-DLG-004** On `ui.dialogue.chosen`, the System MUST follow the chosen choice's `goto` to the next node; a chosen answer's `resolves` hook MUST be fired exactly once, when the choice is taken.
- **FR-DLG-005** A plain advance past a node with no choices MUST end the conversation; ending on a node MUST fire that node's `resolves` hook and announce `dialogue.ended { dialogueId, nodeId }`, and the traversal slice MUST return to idle.
- **FR-DLG-006** Hooks MUST be published as the Quest Engine's standardized `objective.resolved { questId, objectiveId, outcome }` event — dialogue advances quests only through the request channel (FR-ARCH-015).
- **FR-DLG-007** Malformed traversal MUST degrade, never wedge: a `goto` naming a missing node ends the conversation at the current node; a definition that vanishes mid-conversation settles the slice to idle; stray `ui.dialogue.chosen` events with no active conversation are ignored (FR-ARCH-008).
- **FR-DLG-008** The traversal slice MUST live in a System-owned world-state component (`DialogueState`), adopted across re-init for hot-reload (FR-ARCH-014/015).
- **FR-DLG-009** All events this System publishes MUST be deferred (FR-ARCH-012) and delivered in the bus's deterministic order (FR-ARCH-010).

## Non-Functional Requirements

- **NFR-DLG-001 (Determinism):** Traversal is a pure function of the event sequence and world state; identical scripts reproduce identical node sequences and event logs (NFR-ARCH-001, FR-ARCH-025).
- **NFR-DLG-002 (Isolation):** Unit-testable with a fake Context; no System references, no platform access (NFR-ARCH-002/004).
- **NFR-DLG-003 (No text walls):** The System presents exactly one node at a time; pacing is structural, not stylistic (Vision Non-Goals).

## Acceptance Criteria

- A branching dialogue plays through to an end node with choices working: both branches reachable, selection honored, `dialogue.ended` on the end node — covered in unit tests and through the real UI System round-trip.
- All dialogue text resolves via locale keys: every presented payload is a key (pattern-checked in tests); traversal succeeds with no strings table at all, so text resolution — including DATA-FR-025's fallback for missing non-default keys, owned by the UI/localization layers — can never gate a conversation.
- A `resolves` hook on a choice and on an end node each publish `objective.resolved` exactly once, and a hooked conversation completes a quest through the real Quest Engine.
- Unknown dialogue ids, stray chosen events, double starts, and broken `goto`s neither fault nor wedge the slice.
- Identical answer scripts reproduce identical traversal and event sequences.

## Dependencies

- `02-System-Architecture.md` — System lifecycle, slice ownership, deferred events, determinism.
- `03-Data-Model-and-Content-Pipeline.md` — the `dialogue` schema (extended here with the optional `resolves` hook, validated and reference-checked).
- `18-UI-UX-and-HUD.md` (issue #23) — the dialogue surface, selection input, and modal flag this System drives.
- `20-Quest-Engine.md` (issue #25) — the standardized result feed hooks publish into.
- `22-NPC-and-Behavior.md` (issue #27) — the expected producer of `dialogue.start.requested` from NPC interactions.

## Implementation Notes (non-normative)

- The System's `update` is a no-op: traversal happens in event handlers at the tick boundary, subscribed in `init` and released in `teardown` — the same shape as the Quest Engine.
- The first node of the graph is the entry node by position (`nodes[0]`). An explicit `entry` field can join the schema if content ever wants multiple entry points.
- `outcome` on a hook defaults to `solved`; `bypassed` exists so a conversation can be the graceful bypass FR-VIS-010 asks for ("let me just tell you what this was about").
- Spawn instantiates every dialogue document, not just the start region's, because NPCs across regions reference dialogues by id; definitions are inert data until requested.

## Edge Cases

- **A node with choices but a stray plain advance** (UI reports no choice on a choiced node — out-of-contract). Treated as a plain advance: the conversation ends at the node rather than guessing a branch.
- **A `goto` cycle** (n1 → n2 → n1). Legal: conversations may loop; the player exits through a branch or the UI's dismiss. Content review owns loop sanity.
- **Two dialogues requested in one tick.** Arrival order wins; the second is ignored as modal — deterministic because bus delivery is ordered.
- **A hook naming an unknown quest or objective.** This System fires the event as declared; the Quest Engine ignores invalid resolutions (FR-QST-008). Cross-document `questRef` existence is validated at load.
- **An empty `nodes` array.** The start request is ignored; validation may warn (see Open Questions).

## Risks

- **Schema drift toward scripting.** Hooks could sprawl into a condition/effect language. Mitigation: `resolves` is one reviewed, validated shape; new consequences mean new declared event vocabulary, not embedded logic.
- **UI contract coupling.** The System leans on `ui.dialogue.chosen` semantics (choice index reporting). Mitigation: the contract is typed events both suites test against; the round-trip test pins it.
- **Modal deadlock.** A conversation that never ends keeps the surface modal. Mitigation: the UI's dismiss path always emits `chosen`, and every non-branching answer terminates (FR-DLG-005/007).

## Open Questions

- **OQ-DLG-1:** Should pack validation warn on unreachable nodes, empty graphs, or `goto` cycles? Owner: content pipeline follow-up.
- **OQ-DLG-2:** Do dialogues need state-gated choices (show a choice only when a quest is active)? Deferred until the full reference pack (#35) demonstrates need.
- **OQ-DLG-3:** Speaker identity on nodes (which NPC talks) for portraits/voice — deferred to NPC/art issues.

## Future Considerations

- Conditional choices and dialogue-local variables as declared schema, evaluated against world state.
- Additional hook vocabulary (open a building, grant an item) as those Systems land their request events.
- Barks/ambient one-liners reusing nodes outside the modal surface.

## Version / Author

Version 1.0 — Mike Blom.
