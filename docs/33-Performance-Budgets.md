# Resume.World — Performance Budgets

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** PERF

---

## Purpose

This document sets the numeric budgets that make "jank is a bug" (NFR-VIS-002) enforceable: frame-time and load-time targets for the two reference device profiles, the profiling surface that shows where a frame goes, and the CI smoke check other issues must not regress.

## Overview

Budgets are contracts, not aspirations. Two device profiles anchor them — a **mid-range laptop** and a **modern phone** — and every budget is stated per profile. The engine's own machinery makes them measurable: the runtime loop already times every System per frame through an injected monotonic probe (FR-ARCH-031), so profiling aggregates what the loop already knows, and a CI smoke run boots the real reference pack headless and holds the measured costs under enforcement thresholds.

This document also resolves **OQ-ARCH-1** (the fixed simulation rate): simulation runs at **60 fixed steps per second** (`fixedDt = 1/60 s`), with catch-up clamped at 5 steps per frame (FR-ARCH-022). Rationale: 60 Hz matches the dominant display rate on both profiles, keeps per-step work small enough for the phone budget, and divides evenly into the render interpolation the loop already performs (FR-ARCH-021).

## Goals

- Make performance a testable acceptance criterion, not a vibe.
- Give every future issue a stable number to build against ("other issues must not regress" — the interface contract).
- Keep measurement observability-only: profiling never alters simulation behavior (FR-ARCH-031).
- Catch regressions in CI before they reach a visitor.

## Non-Goals

- Micro-optimization beyond meeting the budgets (explicitly out of scope in issue #40).
- Real-device lab testing infrastructure; profiles are calibration targets, verified by testing on representative hardware at release gates (#45).
- Asset-pipeline compression specifics (`38-Asset-Pipeline.md` territory); this document budgets their *effects* (load time).

## Device Profiles

| Profile | Reference hardware | Display | Sustained target |
|---|---|---|---|
| `laptop` | Mid-range laptop, integrated graphics (~2020 or later) | 60 Hz | 60 fps |
| `phone` | Modern mid-tier phone (~2021 or later) | 60 Hz | 60 fps target, 30 fps floor |

## Functional Requirements

### Frame-time budgets

- **FR-PERF-001** A full frame (simulation steps + presentation) MUST fit **16.7 ms** on the `laptop` profile and **33.3 ms** on the `phone` profile, sustained; isolated spikes are tolerated only if the catch-up clamp absorbs them without visible hitching (FR-ARCH-022).
- **FR-PERF-002** One fixed simulation step (all Systems, in order) SHOULD cost at most **half** the frame budget on each profile (≤ 8 ms laptop, ≤ 16 ms phone), leaving the other half for presentation (animation, render, UI, audio).
- **FR-PERF-003** No single System's `update` SHOULD exceed **2 ms** per step on the `laptop` profile in a representative scene; a System that needs more moves its heavy work off the critical path via the scheduler (FR-ARCH-028).

### Load-time budgets

- **FR-PERF-004** Pack load and validation (`loadPack` on the reference pack) MUST complete within **500 ms** on the `laptop` profile (NFR-DATA-005).
- **FR-PERF-005** Boot — pack load through the first presented frame — MUST complete within **1 s** on the `laptop` profile and **2 s** on the `phone` profile over a typical mobile connection, and first delight MUST NOT wait on deferred assets (DATA-FR-019; Vision edge case "the offline or slow connection").

### Profiling surface

- **FR-PERF-006** The engine MUST expose a profiling view over the loop's per-System timings: last-frame simulation cost per System plus rolling aggregate frame statistics (average and worst over a recent window) compared against the active profile's budgets, surfaced through the debug overlay (FR-ARCH-031).
- **FR-PERF-007** Profiling MUST be observability-only: with the overlay disabled or the monotonic probe absent, behavior is byte-for-byte identical (NFR-ARCH-001); profiling data never feeds back into simulation.

### CI enforcement

- **FR-PERF-008** CI MUST run a perf smoke check that boots the reference pack on the headless platform, drives a representative frame sequence, and fails when measured costs exceed the enforcement thresholds below.
- **FR-PERF-009** Enforcement thresholds carry headroom for CI-runner variance and MUST be strictly looser than the device budgets they guard, so the check flags genuine regressions rather than runner noise: boot (load + first frame) ≤ **1500 ms**, average fixed-step cost ≤ **8 ms**, worst fixed-step cost ≤ **50 ms** on the CI runner.
- **FR-PERF-010** The budget comparison itself MUST be a pure, unit-tested function (measurements in, violations out), so a regression's failure mode is a named budget with the measured value — actionable, not a bare assertion.

## Non-Functional Requirements

- **NFR-PERF-001 (Stability):** The smoke check's thresholds are calibrated so false failures from runner variance are rare; flakiness in the perf gate is itself treated as a bug.
- **NFR-PERF-002 (Determinism):** Wall-clock measurement exists only in the perf harness and the injected probe; simulation code reads neither (NFR-ARCH-001).
- **NFR-PERF-003 (Legibility):** A budget violation names the budget, the measured value, and the threshold, in both CI output and the overlay.

## User Stories

- *As a performance engineer,* I want per-System frame timings and rolling frame statistics against budgets, so I can find the expensive System without guessing (docs/02 user story, made concrete).
- *As an engine developer landing a new System,* I want CI to tell me if I blew the step budget, so regressions never ride in silently.
- *As a visitor on a phone,* I want the world smooth and fast to open, so the craftsmanship claim holds on my device.

## Acceptance Criteria

- The walking skeleton plus the reference pack's representative scene meet the documented budgets on the target profiles, verified by the headless smoke run under CI thresholds (FR-PERF-008/009) and spot-checked on representative hardware at the launch sweep (#45).
- A perf regression is caught: the budget comparator flags synthetic over-budget measurements (unit test, FR-PERF-010), and the CI smoke fails when the booted world exceeds enforcement thresholds.
- The profiling overlay shows per-System cost and rolling frame statistics against budgets, and enabling it does not change simulation behavior (FR-PERF-006/007).

## Dependencies

- `01-Vision.md` — NFR-VIS-002 (jank is a bug), NFR-VIS-006 (time-to-first-delight) anchor the budgets.
- `02-System-Architecture.md` — the fixed-step loop, catch-up clamp, timing probe, and scheduler these budgets attach to; OQ-ARCH-1 is resolved here.
- `03-Data-Model-and-Content-Pipeline.md` — NFR-DATA-005 and DATA-FR-019 shape the load budgets.
- `30-Rendering.md`, `16-Animation.md`, `17-Audio.md` — the presentation half of the frame budget.
- `41-Testing-Strategy.md` (planned, #43) — inherits the perf smoke as part of the CI safety net.

## Implementation Notes (non-normative)

- The smoke harness measures with `performance.now()` in test code only; engine layers stay clock-free (the host-coupling gate enforces this).
- Rolling statistics use a fixed-size window (~120 frames ≈ 2 s at 60 fps): long enough to smooth noise, short enough to reflect the current scene.
- CI thresholds (FR-PERF-009) intentionally do not equal device budgets: CI runners are slower and noisier than the `laptop` profile; the check exists to catch order-of-magnitude regressions and creeping bloat, not to certify device experience — that is the launch sweep's job (#45).
- If a future System legitimately needs more than its share, the budget conversation happens in its issue with this document updated by PR — budgets change by decision, never by drift.

## Edge Cases

- **A backgrounded tab returns.** The catch-up clamp bounds the burst (5 steps); the budgets apply to steady state, not the resume frame.
- **CI runner has a bad day.** Thresholds carry ~2× headroom over expected CI cost; a hard failure is treated as real until profiling shows otherwise (NFR-PERF-001).
- **The probe is absent** (production builds without the overlay). Timings read zero, profiling shows nothing, behavior is identical (FR-PERF-007).
- **A scene far larger than the reference pack.** Budgets are per-frame regardless of content size; content that cannot meet them on the profiles is a content bug (density, not engine, is the lever).

## Risks

- **Threshold rot.** Budgets that never tighten as hardware assumptions age. Mitigation: revisit profiles at each launch sweep.
- **Smoke myopia.** The headless run has no real rendering backend, so presentation regressions can hide. Mitigation: presentation draws through the recording surface (calls still execute), and the launch sweep covers real devices; a browser-based perf pass is a future consideration.
- **Gaming the window.** Rolling averages can mask periodic spikes. Mitigation: the worst-frame threshold accompanies the average.

## Open Questions

- **OQ-PERF-1:** Whether a browser-automation perf pass (real canvas, real device emulation) joins CI once deployment (#41) provides the harness. Owner: #41/#43.

## Future Considerations

- Per-System budget declarations consumed by the overlay, so each System's 2 ms guidance becomes data.
- Frame-time histograms exported through telemetry's sink (docs/36) as anonymous aggregates, if tuning ever needs field data.

## Version / Author

Version 1.0 — Mike Blom.
