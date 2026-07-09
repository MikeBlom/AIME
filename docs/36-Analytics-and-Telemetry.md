# 36 — Analytics and Telemetry

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** ANLY

---

## Purpose

This document specifies privacy-respecting insight into the experience: a telemetry subscriber that translates gameplay events already on the bus into a minimal, anonymized funnel — enough to learn whether visitors reach delight, restoration, and the short-visit payoff, and nothing more.

## Overview

Analytics is a **passive System**. It subscribes to a handful of gameplay events (the same deferred events every System sees), and when a funnel milestone fires for the first time it records exactly one metric — the milestone's engine-generic name and the simulation time it landed — through the Platform Adapter's `TelemetrySink`. Event payloads never cross that boundary; the sink's type accepts a name and a number, so identifiers, text, and career facts cannot transit it by construction.

The minimal funnel (v1):

| Milestone | Fires on | Meaning |
|---|---|---|
| `first-delight` | first `intent.interact` | the visitor engaged and the world answered (FR-VIS-003) |
| `first-restoration` | first `system.restored` | the core narrative beat landed (FR-VIS-004) |
| `short-visit-complete` | first region state change to online | the short-visit arc delivered (FR-VIS-008) |

The System owns the `ANALYTICS_STATE` slice: the enabled switch (mutated only by `analytics.control` events) and the already-captured milestones, persisted through save/load so a resumed session never double-counts. In v1 the browser sink is a bounded in-memory buffer — **no network transport exists**; adding one is an explicit product decision confined to the platform layer.

## Goals

- Answer the three questions that matter — do visitors engage, restore, and finish the short visit — with the least data that can answer them.
- Zero personal data, by interface shape rather than by policy promise.
- Telemetry as a bystander: disabled, absent, or failing telemetry never affects gameplay (FR-ARCH-008).
- Deterministic capture: replays record identical metrics (NFR-ARCH-001).

## Non-Goals

- Third-party ad or tracking integrations — prohibited (issue #39).
- Session identifiers, fingerprinting, IP handling, or any cross-visit correlation.
- Per-event streams, heatmaps, or timing histograms (future, only if a concrete question demands them).
- A network transport or dashboard (v1 is local-only; see Privacy).

## User Stories

- *As the creator,* I can learn what fraction of visits reach the first restoration without learning anything about who visited.
- *As a privacy-conscious visitor,* nothing about me leaves my machine, and I can switch capture off entirely.
- *As an engine developer,* I add a milestone by binding one event to one name — never by threading analytics calls through gameplay code.
- *As a tester,* I assert captured metrics against the headless sink like any other platform effect.

## Functional Requirements

- **FR-ANLY-001** The Analytics System MUST be a bus subscriber only: no gameplay System may call it, reference it, or await it (FR-ARCH-005); removing it MUST leave the world fully functional (FR-ARCH-008).
- **FR-ANLY-002** Each funnel milestone MUST be captured at most once per world, at its first occurrence, as one metric: `funnel.<milestone>` plus the simulation time in seconds.
- **FR-ANLY-003** Metrics MUST carry no event payload data, no entity ids, no content ids, and no free text — the sink interface accepts a metric name (engine-generic vocabulary) and a number only.
- **FR-ANLY-004** Capture MUST be switchable off (and back on) via `analytics.control` events; while disabled, milestone hits are dropped and MUST NOT fire retroactively on re-enable.
- **FR-ANLY-005** A platform without a telemetry sink MUST degrade to no capture without faulting; the slice still tracks milestones so behavior is host-independent.
- **FR-ANLY-006** `ANALYTICS_STATE` MUST persist through save/load (FR-ARCH-016) so a resumed session does not re-record milestones already counted.
- **FR-ANLY-007** Milestone timestamps MUST come from the Core TimeService (simulation seconds), never a wall clock (NFR-ARCH-001).

## Non-Functional Requirements

- **NFR-ANLY-001 (Privacy):** the whole pipeline — bindings, slice, sink — is inspectable in this repository; there is no server-side component in v1.
- **NFR-ANLY-002 (Cost):** capture work is a set-membership check per subscribed event; the gameplay hot path is untouched.
- **NFR-ANLY-003 (Determinism):** identical sessions produce identical metric sequences; the headless sink records them for replay comparison.

## Privacy

This section is normative.

1. **What is collected:** at most three records per world — a fixed engine-named milestone and a simulation-seconds number. Nothing else.
2. **What is never collected:** names, ids, input contents, free text, device or browser characteristics, wall-clock times, IP-derived anything. The sink's type signature (`record(metric: string, value: number)`) is the enforcement seam; widening it is a spec change to this document.
3. **Where it goes:** in v1, nowhere — the browser sink is a bounded in-memory buffer that dies with the tab. Any future transport (a) lives only in the Platform Adapter, (b) ships aggregate numbers matching FR-ANLY-003, and (c) is an explicit, documented product decision with an in-experience disclosure — not a quiet default.
4. **Control:** capture can be disabled at runtime (FR-ANLY-004) and the choice persists with the save. Disabling never degrades the experience (issue #39 AC2).
5. **Content packs cannot observe visitors:** packs are data (DATA contract) and have no channel to the sink.

## Acceptance Criteria

- Interacting, restoring a system, and bringing a region online produce exactly `funnel.first-delight`, `funnel.first-restoration`, and `funnel.short-visit-complete` — once each, with simulation-time values, and no other data (issue #39 AC1).
- With capture disabled by an `analytics.control` event, the same gameplay produces no records, gameplay is unaffected, and re-enabling does not retro-fire missed milestones (issue #39 AC2).
- A world on a platform without a telemetry sink runs identically, recording nothing.
- A save/load round-trip preserves captured milestones; repeating a milestone event after resume records nothing new.

## Dependencies

- `02-System-Architecture.md` — the event bus (issue #9) this System subscribes to; FR-ARCH-005/008; TimeService determinism.
- `20-Quest-Engine.md` — `system.restored` and region state changes, the funnel's later beats.
- `14-Input-and-Controls.md` — `intent.interact`, the funnel's first beat.
- `32-Save-Load-and-Persistence.md` — persistence of the analytics slice.
- `44-Security-and-Privacy.md` (planned) — inherits this document's privacy stance.

## Implementation Notes (non-normative)

- Milestone bindings live in one table in `src/systems/analytics.ts`; a guard may inspect a payload to decide *whether* a milestone fired (e.g. region state equals online) but the payload never reaches the sink.
- `first-delight` is approximated by the first interact intent — the first moment the visitor acts and the world answers. If playtesting suggests a better proxy (first restoration reveal, first mini-game start), changing it is a one-line binding edit.
- The browser buffer cap (256) exists only so an abandoned tab cannot grow memory; the funnel itself records at most three values.

## Edge Cases

- **A milestone event fires twice in one tick:** the first pending hit wins; the second sees the milestone already captured.
- **Disable and milestone in the same tick:** controls apply before milestones, so the disable wins deterministically regardless of publish order within the tick.
- **A save from a world that already finished the funnel:** resume applies the slice; nothing ever records again.
- **No quest/region systems loaded:** the later milestones simply never fire; the subscriber never notices their absence.

## Risks

- **Scope creep toward surveillance.** Every future question will want "just one more field." Mitigation: FR-ANLY-003 and the Privacy section make widening the sink a normative spec change, reviewed against the Vision.
- **Proxy drift.** `first-delight` is a proxy; if it stops correlating with observed delight in testing, the binding must move rather than accrete extra events. Mitigation: playtest review owns the mapping (docs/19 when it lands).

## Open Questions

- **OQ-ANLY-1:** The eventual transport and aggregation story (if any) — owner: Vision + `42-Deployment-and-Hosting.md`; blocked on a real need.
- **OQ-ANLY-2:** Whether the disable switch deserves a settings-surface row alongside docs/34's toggles — owner: `19-Onboarding-and-First-Session.md` (chrome budget).

## Future Considerations

- Aggregate-only export (counts and medians, never rows) if a transport ever ships.
- A dev-only overlay reading the analytics slice for playtest sessions, behind the debug flag (FR-ARCH-031).

## Version / Author

Version 1.0 — Mike Blom.
