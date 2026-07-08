# Resume.World — Data Model & Content Pipeline

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** DATA

---

## Purpose

This document specifies the **contract between the engine and content**: the shape of a Content Pack, the schemas that describe every content type, how content is validated and loaded, how it hot-reloads, and how it is localized. This contract is what makes Resume.World a general engine with a swappable career, rather than one person's hardcoded website. It realizes the Vision's data-driven requirement (NFR-VIS-005) and the Architecture's content-isolation requirement (NFR-ARCH-007).

## Overview

A **Content Pack** is a self-describing bundle of JSON documents plus referenced assets. It contains everything career- and world-specific: regions, buildings, NPCs, quests, dialogue, metaphor bindings, achievements, localized strings, and asset manifests. It contains **no logic**. The engine reads a Content Pack, validates it against published schemas, resolves references, and instantiates a world.

The guiding rule is a hard seam: **the engine is code with no career facts; the Content Pack is data with no behavior.** Everything a visitor learns about the creator comes from the Content Pack; everything about *how* the world behaves comes from the engine.

All examples in this document use **placeholder content**. The reference creator (Mike Blom) supplies real values later by editing data files; no schema or example here should be read as final career copy.

## Goals

- Define a versioned, validated JSON contract for every content type the engine consumes.
- Make a Content Pack fully swappable: dropping in a different pack yields a different, coherent Resume.World with zero code changes.
- Fail fast and clearly on malformed content, at author time, before it ever reaches a visitor.
- Support a fast authoring loop via hot-reload and human-readable diagnostics.
- Keep all display text externalized for localization from day one.
- Keep the "metaphor" mapping (accomplishment → mechanic) in data, honoring the Vision's Metaphor Rule.

## Non-Goals

- Defining the *engine behavior* that content parameterizes (that lives in each System's document).
- Prescribing an art style or asset format beyond how assets are referenced and manifested (art specifics live in `12-Art-Direction.md` and `38-Asset-Pipeline.md`).
- Building the visual authoring tool; this document defines the data it must produce (the tool is `37-Content-Authoring-Tools.md`).
- Server-side content management; a Content Pack is a static, versioned bundle. A CMS is a future consideration.

## Content Pack Structure

A Content Pack is a directory (or equivalent addressable bundle) with a required manifest at its root and content organized by type. Conceptual layout:

```
content-pack/
  pack.json                  # manifest: id, version, engine compatibility, creator, entry points
  regions/                   # world areas
  buildings/                 # structures and interiors
  npcs/                      # characters and their routines
  quests/                    # restoration objectives
  dialogue/                  # conversation trees
  metaphors/                 # accomplishment -> mechanic bindings
  achievements/              # recognitions
  minigames/                 # mini-game configuration (behavior ships as engine plugins)
  strings/                   # localized text, keyed
    en/
    ...
  assets/                    # or an asset manifest referencing external storage
    assets.manifest.json
```

- **DATA-FR-001** A Content Pack MUST contain a root `pack.json` manifest declaring at minimum: pack `id`, semantic `version`, the range of engine versions it is compatible with, the `creator` metadata, the default locale, and the list of content documents (or globs) to load.
- **DATA-FR-002** The engine MUST load only content declared or discoverable through the manifest; stray files MUST NOT silently affect the world.
- **DATA-FR-003** Every content document MUST declare its `schemaType` and `schemaVersion` so the engine selects the correct validator.
- **DATA-FR-004** A Content Pack MUST be swappable as a unit: pointing the engine at a different valid pack MUST produce a coherent world with no code changes (this is the central requirement; it is verified in acceptance).

## Identity and References

Content is a graph: quests reference regions, dialogue references NPCs, metaphors reference quests. References are by stable id.

- **DATA-FR-005** Every content entity MUST have a pack-unique, stable, human-readable `id` (e.g., `region.north-district`, `npc.foreman`, `quest.restore-power`).
- **DATA-FR-006** References between content documents MUST use these ids, never array indices or file paths, so content can be reorganized without breaking links.
- **DATA-FR-007** The loader MUST resolve all references at load time and MUST reject the pack if any reference is dangling, with a diagnostic naming the referrer, the missing id, and the source location.
- **DATA-FR-008** Ids MUST be namespaced by type to prevent collisions across content categories.

## Schemas (with placeholder examples)

Each content type has a published JSON Schema. The engine validates every document against its schema before use. The following are illustrative shapes, not exhaustive field lists; the authoritative schemas ship alongside the engine and are versioned.

### Manifest (`pack.json`)

```json
{
  "schemaType": "pack",
  "schemaVersion": "1.0",
  "id": "pack.reference",
  "version": "0.1.0",
  "engineCompatibility": ">=1.0.0 <2.0.0",
  "creator": {
    "displayName": "PLACEHOLDER Creator Name",
    "tagline": "PLACEHOLDER one-line framing shown only in-world, never as a resume"
  },
  "defaultLocale": "en",
  "entry": { "startRegion": "region.arrival" },
  "documents": ["regions/**", "buildings/**", "npcs/**", "quests/**", "dialogue/**", "metaphors/**", "achievements/**", "minigames/**"]
}
```

### Region

```json
{
  "schemaType": "region",
  "schemaVersion": "1.0",
  "id": "region.arrival",
  "displayNameKey": "region.arrival.name",
  "state": { "initial": "offline" },
  "bounds": { "PLACEHOLDER": "spatial description consumed by World Design" },
  "contains": {
    "buildings": ["building.control-house"],
    "npcs": ["npc.foreman"],
    "quests": ["quest.restore-power"]
  },
  "ambient": { "weatherProfile": "temperate", "dayNight": true }
}
```

### NPC

```json
{
  "schemaType": "npc",
  "schemaVersion": "1.0",
  "id": "npc.foreman",
  "displayNameKey": "npc.foreman.name",
  "appearance": { "assetRef": "asset.npc.foreman" },
  "routine": [
    { "phase": "day", "activity": "PLACEHOLDER patrol path or task" },
    { "phase": "night", "activity": "PLACEHOLDER rest location" }
  ],
  "dialogueRef": "dialogue.foreman.intro",
  "role": "PLACEHOLDER narrative role, e.g., guide to the first restoration"
}
```

### Quest (a Restoration)

```json
{
  "schemaType": "quest",
  "schemaVersion": "1.0",
  "id": "quest.restore-power",
  "titleKey": "quest.restore-power.title",
  "regionRef": "region.arrival",
  "metaphorRef": "metaphor.distributed-systems",
  "objectives": [
    { "id": "obj.route-power", "type": "PLACEHOLDER mechanic reference", "descriptionKey": "quest.restore-power.obj.route" }
  ],
  "onComplete": {
    "emits": ["SystemRestored"],
    "revealsKey": "quest.restore-power.reveal",
    "worldEffect": "PLACEHOLDER: region.arrival -> online"
  },
  "bypass": { "allowed": true, "revealsKey": "quest.restore-power.reveal" }
}
```

The `bypass` block satisfies Vision FR-VIS-010: a player who cannot solve the puzzle still receives the career meaning.

### Metaphor (accomplishment → mechanic binding)

The metaphor is where a real accomplishment is mapped to an engine mechanic. Crucially, the *mechanic types* are provided by the engine; the *binding and framing* are content.

```json
{
  "schemaType": "metaphor",
  "schemaVersion": "1.0",
  "id": "metaphor.distributed-systems",
  "accomplishment": "PLACEHOLDER: what the creator actually did, author-facing note only",
  "mechanic": "engine.mechanic.route-and-balance",
  "params": { "PLACEHOLDER": "mechanic-specific configuration" },
  "framingKey": "metaphor.distributed-systems.framing"
}
```

- **DATA-FR-009** A metaphor's `mechanic` MUST reference an engine-provided mechanic type; the engine MUST reject a metaphor that names an unknown mechanic (fail-fast, per validation).
- **DATA-FR-010** The `accomplishment` field is author-facing context only and MUST NOT be rendered to the player as resume text; only fiction-framed, localized `*.Key` strings are displayed.

### Dialogue

```json
{
  "schemaType": "dialogue",
  "schemaVersion": "1.0",
  "id": "dialogue.foreman.intro",
  "nodes": [
    { "id": "n1", "textKey": "dialogue.foreman.intro.n1", "choices": [ { "textKey": "dialogue.foreman.intro.n1.c1", "goto": "n2" } ] },
    { "id": "n2", "textKey": "dialogue.foreman.intro.n2", "end": true }
  ]
}
```

### Strings (localized)

```json
{
  "schemaType": "strings",
  "schemaVersion": "1.0",
  "locale": "en",
  "entries": {
    "region.arrival.name": "The Arrival Yard",
    "quest.restore-power.title": "Wake the Yard",
    "quest.restore-power.reveal": "PLACEHOLDER: fiction-framed insight into the creator's work"
  }
}
```

- **DATA-FR-011** All player-visible text MUST be stored as keyed strings in locale documents; content documents MUST reference text only by key (`*Key`), never as inline literals.

## Validation

Validation is the guardrail that keeps a broken pack from ever reaching a visitor.

- **DATA-FR-012** The engine MUST validate every content document against its declared schema at load time and MUST refuse to start the world if any document is invalid.
- **DATA-FR-013** Validation MUST run as a standalone, offline step (a CLI/CI check) so authors and pipelines can validate a pack without launching the full experience.
- **DATA-FR-014** Validation diagnostics MUST be actionable: each error MUST include the document, the field path, the expected shape, and the offending value where safe to show.
- **DATA-FR-015** Validation MUST include cross-document checks: reference integrity (DATA-FR-007), unknown mechanic detection (DATA-FR-009), missing string keys for the default locale, and unreachable content (e.g., a region no quest or path leads to) reported at least as a warning.
- **DATA-FR-016** Schema versions MUST be checked against engine compatibility (`engineCompatibility` in the manifest); an incompatible pack MUST be rejected with a clear version mismatch message.

## Loading and Resolution

- **DATA-FR-017** Loading MUST be deterministic: the same pack MUST produce the same in-memory world graph every time (supporting Architecture determinism, NFR-ARCH-001).
- **DATA-FR-018** The loader MUST resolve references into a fully linked, immutable content graph before the world is instantiated; runtime Systems consume the resolved graph, not raw files.
- **DATA-FR-019** Large assets MUST be referenced through an asset manifest and loaded asynchronously off the critical path (Architecture FR-ARCH-028), while the lightweight opening content loads first to satisfy Vision time-to-first-delight.
- **DATA-FR-020** Loading MUST be atomic: a partially loaded pack MUST NOT be presented; either the whole coherent world loads or the load fails cleanly with diagnostics (Architecture FR-ARCH-030).

## Hot Reload

- **DATA-FR-021** In development builds, editing a content document MUST trigger re-validation and, if valid, a live update of the affected world state without a full restart.
- **DATA-FR-022** A hot reload that fails validation MUST leave the running world untouched and surface the diagnostic, so a typo never blanks the screen.
- **DATA-FR-023** Hot reload MUST preserve as much player/session state as is coherent with the change (e.g., editing dialogue text should not reset the player's position).

## Localization

- **DATA-FR-024** The content model MUST support multiple locales, each a set of strings documents keyed identically to the default locale.
- **DATA-FR-025** A missing key in a non-default locale MUST fall back to the default locale rather than showing a blank or a raw key, and MUST be reported as a warning by validation.
- **DATA-FR-026** No layout or logic MUST assume string length; strings vary widely across locales (detailed handling in `35-Localization.md`).

## Creator Swappability

This is the property the whole document exists to guarantee.

- **DATA-FR-027** The engine MUST contain zero career-specific literals; all creator-specific content MUST come from the active Content Pack (enforces Architecture NFR-ARCH-007).
- **DATA-FR-028** Selecting which Content Pack to load MUST be configuration/data, not a code change.
- **DATA-FR-029** A conformant second Content Pack (a different creator) MUST run on the same engine build and produce a coherent, different Resume.World.

## Non-Functional Requirements

- **NFR-DATA-001 (Author ergonomics):** Content is hand-editable JSON with clear ids and keys; a non-engineer can update career content by editing data and running validation.
- **NFR-DATA-002 (Fail fast):** Invalid content is caught at author/CI time, not at the visitor's screen.
- **NFR-DATA-003 (Forward compatibility):** Schemas are versioned; the engine can support a migration path for older packs rather than hard-breaking them.
- **NFR-DATA-004 (Separation of concerns):** No behavior in content, no content in behavior; verifiable by inspection and tests.
- **NFR-DATA-005 (Performance):** Load and validation of a full pack completes fast enough not to harm first-load experience; heavy assets are deferred.

## User Stories

- *As the creator,* I edit a JSON file to change how an accomplishment is framed, run validation, and see the change hot-reload, without involving an engineer.
- *As a new creator,* I fork the reference Content Pack, replace ids, strings, and metaphor bindings with my own, and get my own Resume.World on the same engine.
- *As a CI pipeline,* I validate a pack on every commit and block merges that would ship a broken world.
- *As a localizer,* I add a new locale as a strings document keyed to the default, and missing keys fall back gracefully.
- *As an engine developer,* I add a new mechanic type and publish its metaphor params schema, so content authors can bind accomplishments to it.

## Acceptance Criteria

- Pointing the engine at a second, different valid Content Pack yields a coherent, visibly different world with no code changes (DATA-FR-004, DATA-FR-029).
- A pack with a dangling reference, an unknown mechanic, or a missing default-locale key is rejected by the standalone validator with an actionable message (DATA-FR-007, DATA-FR-009, DATA-FR-015).
- Editing a dialogue string in a dev build hot-reloads without resetting player position (DATA-FR-021, DATA-FR-023); an invalid edit leaves the world running and shows the error (DATA-FR-022).
- A static/inspection check confirms no career-specific literals exist in engine code (DATA-FR-027).
- No content document contains an inline player-visible string; all display text resolves through locale keys (DATA-FR-011).
- A pack declaring an incompatible engine version is rejected with a version mismatch message (DATA-FR-016).

## Dependencies

- `01-Vision.md` — NFR-VIS-005 (data-driven), FR-VIS-007 (content holds all career meaning), FR-VIS-010 (bypass reveals meaning).
- `02-System-Architecture.md` — FR-ARCH-030 (reject malformed content), FR-ARCH-018/020 (plugins register mechanics/component types), NFR-ARCH-007 (content isolation), determinism.
- Downstream consumers: every content-driven System document (Quest, Dialogue, NPC, World Design, Achievements, Mini-Games, Localization) references these schemas.

## Implementation Notes (non-normative)

- JSON Schema is a natural fit for DATA-FR-012–016; schemas are versioned artifacts shipped with the engine and used by both the runtime loader and the standalone validator so there is one source of truth.
- Ids as namespaced strings (`type.name`) make diagnostics readable and grep-able; enforce the pattern in schema.
- The resolved content graph (DATA-FR-018) should be immutable at runtime; runtime mutable state (progression, restored flags) lives in world state, not in the content graph.
- For very large worlds, the asset manifest can point at external/CDN storage; the manifest, not the code, holds those addresses.
- A migration tool (NFR-DATA-003) can transform an older `schemaVersion` document to the current one; keep migrations as data-to-data transforms.

## Edge Cases

- **Duplicate ids across documents.** Rejected at load with both source locations named (DATA-FR-005, DATA-FR-008).
- **A quest references a region that references no path to it.** Reachability warning (DATA-FR-015); author decides whether it is intentional.
- **A string key exists in a non-default locale but not the default.** Warning plus fallback; the default locale is the source of truth for the key set.
- **A metaphor binds to a mechanic whose params schema it violates.** Rejected with field-level diagnostics; content authors cannot misconfigure a mechanic silently.
- **Hot reload of a document that renames an id.** Treated as remove-plus-add; the loader re-resolves references and reports any newly dangling links rather than crashing.
- **An asset referenced in the manifest is missing.** Non-blocking for opening content if deferred, but reported; blocking if it is required for the start region.

## Risks

- **Schema sprawl.** Too many finely-split schemas raise authoring friction. Mitigation: keep schemas coarse-grained per content type; add fields before adding types.
- **Silent content drift.** Content that validates but is semantically wrong (a metaphor that misrepresents the creator). Mitigation: validation cannot catch meaning; playtesting and author review do. Documented as a process control, not a technical one.
- **Localization neglect.** Teams often inline strings "temporarily." Mitigation: DATA-FR-011 is enforced by validation (no inline visible strings), not left to discipline.
- **Version lock-in.** A pack pinned to an old engine range blocks upgrades. Mitigation: migration path (NFR-DATA-003) and clear compatibility ranges.

## Open Questions

- **OQ-DATA-1:** Whether mini-game *behavior* is always an engine plugin with content-only config, or whether some lightweight mini-games can be fully data-described. (Leaning plugin-plus-config; final call in `28-Mini-Games-Framework.md`.)
- **OQ-DATA-2:** Whether to support content overlays/patches (a base pack plus deltas) or require whole packs only. (Deferred; whole packs for v1.)
- **OQ-DATA-3:** The exact catalog of engine-provided mechanic types available for metaphor binding, defined jointly with `28`/`29` and `10-Gameplay-Loops.md`.
- **OQ-DATA-4:** Whether assets ship inside the pack or always via manifest reference; likely both, decided in `38-Asset-Pipeline.md`.

## Future Considerations

- A visual authoring tool (`37`) that emits schema-valid JSON so non-engineers author worlds without hand-editing files.
- A content marketplace or template gallery once creator-swappability is proven, letting anyone generate a Resume.World.
- Content overlays for seasonal/event variations of a single creator's world.
- A hosted CMS backend if static bundles become limiting; the schema contract stays the same regardless of where content is stored.

## Version / Author

Version 1.0 — Mike Blom.
