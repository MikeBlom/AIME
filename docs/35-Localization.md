# 35 — Localization

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** L10N

---

## Purpose

This document binds the Data Model's localization requirements (DATA-FR-024..026) to runtime behavior: how the active locale is selected, how keys resolve with default-locale fallback, and how layout tolerates the length variance real translation brings — so shipping a new language is a content change, never a code change.

## Overview

Localization is three seams, each already half-built by earlier issues and completed here:

1. **Content.** A pack ships one strings document set per locale under `strings/<locale>/`, keyed identically to the default locale (DATA-FR-024). The loader merges them into per-locale tables, treats the default locale as the key set's source of truth, and reports gaps in non-default locales as warnings (DATA-FR-025) — validated offline and in CI by the standalone validator.
2. **Runtime.** Spawn lands two components: `LOCALE_TABLES` (every locale's table plus the pack's default) and `LOCALE_STRINGS` (the one resolved table every consumer reads, DATA-FR-011). The **Locale System** owns `LOCALE_STATE` (the active locale, persisted through save/load) and rewrites `LOCALE_STRINGS` as *default overlaid with active* whenever the choice changes — per-key fallback, applied wholesale, so consumers never carry fallback logic. Switching is requested by a `locale.select` event; the settings surface's locale row cycles the shipped locales.
3. **Presentation.** No layout assumes string length (DATA-FR-026): panels size from the surface, and every drawn line clips to its panel's character budget with an ellipsis rather than escaping the viewport. The reference pack ships an elongated `xl` pseudo-locale — every key ~40% longer — so length tolerance is exercised by real content, not hypothetically.

## Goals

- A new locale is a strings document set: no engine change, no consumer change (DATA-FR-024).
- Missing keys degrade per key to the default locale's text — never a blank, never a raw key (DATA-FR-025) — and are reported at validation time.
- Locale choice is player data: switchable at runtime, persisted across visits.
- Layout survives the longest shipped string on the smallest supported viewport (DATA-FR-026).

## Non-Goals

- Professional translation of the reference pack (issue #38 out of scope); `xl` is a length-stress pseudo-locale, not a language.
- Right-to-left script support and complex text shaping — the single-line canvas text primitive cannot honor them yet; deferred with measured wrapping (OQ-L10N-1).
- Localizing physical key codes, entity ids, or other technical identifiers — they are not player-visible prose (docs/34).
- Per-locale assets (sprites with baked text are already prohibited by docs/12's asset guidelines).

## User Stories

- *As a localizer,* I add `strings/<locale>/strings.json` keyed to the default locale and my language appears in the settings surface with no engineering help.
- *As a visitor,* I switch language in settings and every prompt, hint, dialogue line, and settings row changes at once — and my choice is remembered next visit.
- *As a content author,* keys I have not translated yet show the default text instead of breaking the world, and validation tells me exactly which they are.
- *As a designer,* a locale with much longer words does not overflow a panel on a small phone.

## Functional Requirements

- **FR-L10N-001** Spawn MUST land every shipped locale's table (`LOCALE_TABLES`) and the resolved strings table (`LOCALE_STRINGS`) in world state; consumers MUST read only the resolved table (DATA-FR-011).
- **FR-L10N-002** The Locale System MUST own the active-locale slice and the resolved table (FR-ARCH-015), re-resolving whenever they disagree — whether the change came from a `locale.select` event or a restored save.
- **FR-L10N-003** Resolution MUST be the default locale's table overlaid per key by the active locale's, so a key missing from the active locale falls back to the default text (DATA-FR-025); selecting the default locale yields the default table exactly.
- **FR-L10N-004** A `locale.select` naming a locale the pack does not ship MUST be ignored without faulting (FR-ARCH-008).
- **FR-L10N-005** Locale selection MUST be reachable keyboard-only through the settings surface (docs/34 FR-A11Y-005): the locale row cycles the shipped locales in stable sorted order.
- **FR-L10N-006** `LOCALE_STATE` MUST persist through save/load (FR-ARCH-016) so a return visit resumes in the chosen language.
- **FR-L10N-007** Validation MUST report non-default-locale gaps (missing keys) and orphans (keys absent from the default locale) as warnings naming the locale and key (DATA-FR-025, loader behavior from issue #12).
- **FR-L10N-008** Every UI draw of localized text MUST clip to its panel's budget rather than overflow (DATA-FR-026); panels themselves size from the surface, never from string length alone.

## Non-Functional Requirements

- **NFR-L10N-001 (Determinism):** Locale resolution is a pure function of world state and buffered events (NFR-ARCH-001); replays reproduce identical text.
- **NFR-L10N-002 (No consumer churn):** Adding locales or changing the fallback policy touches only the Locale System and content; UI, dialogue, and narration consume the resolved table unchanged.
- **NFR-L10N-003 (Author feedback):** Locale gaps surface at validation time (CI and the standalone validator), not first in front of a visitor.

## Acceptance Criteria

- Selecting `xl` in the settings surface changes every visible string (prompt, hint, dialogue, settings rows); selecting `en` changes them back (issue #38 AC1).
- A locale table missing a key draws and narrates the default locale's text for that key — never a blank or the raw key — and the validator warns about the gap (DATA-FR-025).
- With the elongated `xl` locale active, panels stay inside both the desktop (640×360) and small portrait (180×320) surfaces and no drawn line exceeds its panel (issue #38 AC2).
- The locale choice survives a save/load round-trip.

## Dependencies

- `03-Data-Model-and-Content-Pipeline.md` — DATA-FR-011 and DATA-FR-024..026, the contract realized here.
- The content loader and schema validation (issue #12, `src/content`) — per-locale merge and gap warnings already in the content pipeline.
- `18-UI-UX-and-HUD.md` — the consuming surfaces and the panel layout this document constrains.
- `34-Accessibility.md` — the settings surface hosting the locale row; narration speaks whatever the resolved table provides.
- `32-Save-Load-and-Persistence.md` — the persistence the locale choice rides.

## Implementation Notes (non-normative)

- Rewriting the whole resolved table on switch (rather than per-key lookup indirection at draw time) keeps the hot path untouched: consumers do one object lookup per key, exactly as before this document.
- The `xl` pseudo-locale is generated from the default locale (`XL` prefix plus padding), so regenerating it after adding keys is mechanical; its job is proving the pipeline and stressing layout.
- The truncation estimate shares the prompt pill's per-character heuristic; true text measurement needs an adapter metric primitive (OQ-L10N-1).
- Locale codes shown in the settings row are technical tags (like key codes in docs/34); a locale's *display name* would itself be a locale key and is deferred until a real second language ships.

## Edge Cases

- **A locale document for a locale the manifest's `defaultLocale` never names:** it simply becomes selectable; the default stays the key-set source of truth.
- **The active locale's table vanishes on a pack swap** (a save carried a locale the new pack lacks): selects are validated against the shipped tables, and resolution falls back to the default table for every key the overlay no longer defines.
- **A world with no `LOCALE_TABLES`** (bare test worlds): the system leaves the seeded strings untouched and selects are dropped harmlessly.
- **Two rapid selects in one tick:** arrival order applies; the last valid one wins.
- **An empty locale table:** valid, warns for every key, resolves entirely to the default — the world remains fully readable.

## Risks

- **Estimate drift.** The per-character width heuristic can under- or over-clip for unusual glyphs. Mitigation: the clamp errs toward clipping inside the panel; measured wrapping is the planned fix (OQ-L10N-1).
- **Pseudo-locale rot.** `xl` can fall behind the default key set as content grows. Mitigation: gaps only produce fallback plus warnings — the validator names every stale key on each CI run.
- **Key-set divergence between packs.** Engine-named keys (`ui.*`) must exist in every pack; a missing one draws nothing by design. Mitigation: docs/47's content checklist includes the engine key list.

## Open Questions

- **OQ-L10N-1:** Measured text wrapping and multi-line panels (shared with OQ-UI-2) — requires adapter text metrics; owner: rendering/platform.
- **OQ-L10N-2:** Whether locale display names ship as locale keys once a real second language lands (owner: content style guide).

## Future Considerations

- Browser-language detection as the *initial* locale (a platform read at the composition root, never inside a System, NFR-ARCH-004).
- Per-locale fonts through the adapter when scripts demand them.
- A CLI report that lists translation coverage percentage per locale from the existing validation warnings.

## Version / Author

Version 1.0 — Mike Blom.
