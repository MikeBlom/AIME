# Resume.World — Observability and Error Handling

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** OBS

---

## Purpose

This document specifies how the running world stays inspectable and resilient: how a System fault is isolated, surfaced with context, and reported without flooding; and how the debug surfaces are toggled so visitors never see them while developers always can.

## Overview

The Core runtime loop already carries the load-bearing machinery (issue #11, FR-ARCH-029/031): a failure inside one System's `update` is caught, recorded in a bounded fault log with its context (system id, step, frame), and the other Systems keep running; the event bus keeps an observable log; per-System timings flow through an injected probe. This document adds the layer that makes those signals *usable*:

- A **fault reporter** — the centralized error reporting the interface contract names — subscribes to the loop's fault hook, formats each fault as one actionable line (system, step, frame, error), and rate-limits repeats so a crash-looping System yields signal, not noise. Where lines go is the host's choice (the browser entry sends them to the console); the reporter itself is host-free.
- A **hardened debug overlay** — the overlay shows the fault count and the most recent fault's context alongside frame, timing, profile, and event data, and is a **toggled surface**: hidden by default so a visitor never meets developer chrome, revealed with a keystroke, and behavior-neutral either way (FR-ARCH-031).

## Goals

- A System failure is diagnosable from its report alone: which System, which step, what error.
- A crash-looping System cannot flood the console, the memory, or the frame budget.
- Debug surfaces cost visitors nothing: invisible by default, byte-identical simulation when enabled.
- Keep all of it out of the engine's simulation path — observability observes.

## Non-Goals

- Third-party APM/error-tracking integration (explicitly optional-future in issue #42).
- Remote error reporting; the telemetry funnel (docs/36) deliberately carries no error payloads. If field diagnostics are ever wanted, that is a new, explicit product decision.
- Player-facing error UI. The world's answer to a fault is to keep running (FR-ARCH-029), not to apologize in a modal.

## User Stories

- *As an engine developer,* when a System throws, I want one line telling me the System, the step, and the error, so diagnosis starts at the cause and not in a stack of noise.
- *As a developer chasing a heisenbug,* I want the overlay toggled on over the live world — timings, faults, events — without changing the world's behavior.
- *As a visitor,* I never see any of this.

## Functional Requirements

- **FR-OBS-001** A fault isolated by the loop (FR-ARCH-029) MUST be reported through a single, centralized reporter with its full context: system id, fixed step, host frame, and the error's message.
- **FR-OBS-002** Fault reporting MUST be rate-limited per System: the first few faults report in full, after which repeats are summarized periodically (with a count of suppressed repeats), so a System faulting every step cannot flood the report sink.
- **FR-OBS-003** The reporter MUST be host-agnostic: it formats and throttles; the composition root decides where lines go (browser console, test capture, nothing). A world booted without a report sink runs identically and loses nothing but the lines (FR-ARCH-008).
- **FR-OBS-004** The debug overlay MUST include the fault picture alongside its existing data: total fault count and the most recent fault's context.
- **FR-OBS-005** The debug overlay MUST be a toggled surface, hidden by default: a visitor sees no developer chrome; a keystroke (`` ` `` backquote) reveals and hides it. The toggle lives in host chrome, not world state — it MUST NOT touch simulation.
- **FR-OBS-006** Observability MUST be behavior-neutral end to end (FR-ARCH-031): with the overlay hidden or shown, with or without a report sink, identically-seeded worlds produce identical world state.
- **FR-OBS-007** All observability memory MUST be bounded: the loop's fault log is capped (Core), and the reporter keeps only per-System counters — no unbounded buffers.

## Non-Functional Requirements

- **NFR-OBS-001 (Production safety):** Report lines carry engine vocabulary and error messages only — no player input, no personal data, no career content (that lives in the pack, not the engine).
- **NFR-OBS-002 (Cost):** With no faults and the overlay hidden, observability adds no per-frame allocation beyond the loop's existing probe work.
- **NFR-OBS-003 (Legibility):** One fault, one line, greppable by system id.

## Acceptance Criteria

- An injected System fault is isolated, reported once with system/step/frame/error context, and the world keeps running — other Systems continue updating (issue #42 AC1; FR-ARCH-029).
- A System that faults every step produces the initial reports plus periodic summaries, not a line per step (FR-OBS-002).
- The debug overlay does not alter behavior when disabled: identically-seeded worlds with and without an overlay consumer end in identical state (issue #42 AC2; FR-ARCH-031) — pinned by test.
- The overlay is hidden by default in the browser and toggles with backquote; toggling touches only host chrome (FR-OBS-005).

## Dependencies

- `02-System-Architecture.md` — FR-ARCH-029 (fault isolation), FR-ARCH-031 (debug surface neutrality), FR-ARCH-013 (event log) are the substrate.
- `33-Performance-Budgets.md` — the profiling block that shares the overlay.
- `36-Analytics-and-Telemetry.md` — the boundary: telemetry carries funnel aggregates, never errors.

## Implementation Notes (non-normative)

- The reporter is a small pure factory (`src/app/faults.ts`): `handle(fault)` in, formatted lines out through an injected emit callback. The browser entry passes `console.error`; tests pass an array-pusher; headless runs may pass nothing.
- Rate limiting is per system id: report the first `3` faults fully, then every `100th` with a suppressed-count summary. Counters only — O(systems) memory (FR-OBS-007).
- The overlay toggle is a `keydown` listener in the browser host mount (the platform layer owns DOM). It flips the overlay element's visibility; the engine keeps producing overlay text either way, which keeps the neutrality proof trivial.
- The Core loop's own guarantees (bounded fault log, catch-per-System, probe-only timing) were built in issue #11 and are asserted by `runtime-loop.test.ts`; this document layers reporting on top rather than re-implementing.

## Edge Cases

- **A fault during presentation** (`onPresent` consumer throws): outside the loop's per-System isolation; the browser surfaces it as an uncaught error. Accepted for v1 — presentation consumers are composition-root code, not plugins.
- **An error value that is not an Error** (a System throws a string): the reporter formats whatever it gets; `String(error)` is the floor.
- **Two Systems fault in the same step:** each reports under its own system id and rate-limit lane.
- **The overlay is toggled during a fault storm:** the overlay reads the same bounded state the reporter does; no additional cost.

## Risks

- **Console dependence.** Console output disappears in the field. Accepted: v1's audience for fault lines is development; field diagnostics would be a new decision (Non-Goals).
- **Rate-limit hiding a novel failure.** A System that fails two different ways after its first faults could have the second mode summarized. Mitigation: the loop's fault log retains full entries (bounded) for inspection; the overlay always shows the most recent fault verbatim.

## Open Questions

- **OQ-OBS-1:** Whether the overlay warrants a touch affordance for the toggle (mobile has no backquote). Owner: revisit with onboarding (#44) if mobile debugging is ever needed in the field.

## Future Considerations

- An opt-in remote error sink behind the same reporter interface, if field diagnostics are ever needed — with its own privacy review.
- Per-System timing history in the overlay (sparkline-style) if profiling pressure demands it.

## Version / Author

Version 1.0 — Mike Blom.
