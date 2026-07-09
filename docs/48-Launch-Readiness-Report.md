# Resume.World — Launch Readiness Report

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** LRR
**Scope:** Issue #45 — the acceptance sweep of `docs/01-Vision.md`'s criteria against the built experience.

---

## Purpose

This report is the documented acceptance record required by issue #45's interface contract: every acceptance criterion in `docs/01-Vision.md` mapped to evidence — a repeatable test, a recorded verification run, or a filed, triaged exception. It is a report, not a specification; it asserts nothing normative beyond the sign-off at the end.

## How the sweep ran

Two kinds of evidence back this report:

1. **Repeatable gates.** The full CI gate (`npm run check`: build, unit + integration tests with coverage thresholds, lint, format, content validation, the career-literals check, the host-coupling check) ran green on the sweep branch. Where a Vision criterion was machine-checkable but uncovered, this sweep added the missing net (`scripts/launch-readiness.test.mjs`).
2. **A recorded browser verification run** (2026-07-09) of the *built* artifact (`npm run build` served by `vite preview`) in Chromium, driven end-to-end at two profiles:
   - **Desktop** — 1280×800 viewport, keyboard only.
   - **Phone** — 390×844 viewport, device scale 3, touch input, mobile user agent.

   The run loaded the world, measured time-to-canvas, verified ambient life with zero input (successive screenshots differ), played the short-visit path (walk to the engineer, resolve the assembly-line quest through dialogue), confirmed the autosave envelope in `localStorage` recorded the completed quest and the restoration, and confirmed a reload resumes the visit. Console errors were captured throughout.

Criteria that require human testers cannot pass in an automated environment; each carries a filed, triaged exception issue rather than an unverified claim.

## Vision acceptance criteria — verdicts and evidence

| # | Vision criterion | Verdict | Evidence |
|---|------------------|---------|----------|
| 1 | A first-time visitor, unprompted, describes the experience as "a game" or "a world", not "a portfolio" or "a resume" | **Exception filed** | Requires a human usability panel. Automated floor: the experience opens straight into a rendered, inhabited world (browser run: visible canvas ≈100 ms after load; ambient life with zero input) and ships no resume surface (criterion 6). Human panel tracked in the punch list below. |
| 2 | Within two minutes, a hiring-manager tester can state approximate seniority and two areas of strength, having read no resume text | **Exception filed** | Requires a human tester. Automated floor: the full three-restoration arc completes inside two simulated minutes through the real mechanics (`src/app/arc.test.ts`, FR-VIS-008), and each restoration lands a distinct metaphor framing through fiction keys, never resume text. Human comprehension check tracked in the punch list. |
| 3 | Every interactive element in a spot-check sample exhibits all four polish components (animation, sound, feedback, state change) | **Pass (spot-check)** | Interact intent triggers a one-shot animation on the player (`src/systems/animation.ts`, `animation.test.ts`), an audio cue per gameplay beat (`src/systems/audio.ts` cue table: movement, region, quest, achievement events; `audio.test.ts`), visible UI response (hint line, dialogue panel, HUD banner — `ui.test.ts`, and visible in the recorded run's screenshots), and a world-state transition (quest/progression slices — `quest.test.ts`, `smoke.test.ts`). Mechanics expose `progress`/flash hooks for presentation polish (`mechanics.ts`). |
| 4 | Replacing the Content Pack with a different creator's data produces a coherent, different Resume.World with no engine code changes | **Pass** | `scripts/pack-swap.test.mjs` (DATA-FR-029): the same `bootWorld` call boots `pack.reference` and `pack.harbor` into coherent, visibly different worlds — different pack ids, start regions, disjoint quest ids, different resolved player-visible strings. Both packs validate whole with zero diagnostics (`scripts/content-invariants.test.mjs`, `npm run validate:content`). |
| 5 | A keyboard-only tester and a screen-reader tester can both reach and understand at least the short-visit content | **Pass (keyboard, automated) / Exception filed (human sessions)** | The entire short-visit path is keyboard-driven end-to-end: headless (`src/app/smoke.test.ts`) and in the recorded Chromium run (arrow keys + E only, quest completed, restoration landed). Essential content is narrated through the accessibility System's narration channel (`src/systems/accessibility.ts`, `accessibility.test.ts`). Human keyboard-only and screen-reader sessions tracked in the punch list. |
| 6 | No screen in the entire experience presents a resume, a job list, or a biography as primary content | **Pass** | Three independent nets: (a) engine code holds zero career facts (`npm run check:literals`, `scripts/content-invariants.test.mjs` over the real source tree), so no engine screen *can* present resume content; (b) every player-visible string routes through pack locale keys (DATA-FR-011, enforced by content validation); (c) **new in this sweep** — `scripts/launch-readiness.test.mjs` scans every player-visible string of every shipped pack (all locale entries plus the manifest's in-world creator fields) for resume-shaped text (resume/CV vocabulary, employment date spans, tenure claims, references boilerplate, job-listing scaffolding) and proves the author-facing metaphor `accomplishment` notes never leak into a visible string (DATA-FR-010). The sweep caught and fixed one offender: `pack.reference`'s placeholder tagline contained the word "resume". |

## Issue #45 acceptance criteria

| Acceptance criterion | Where satisfied |
|----------------------|-----------------|
| Every Vision acceptance criterion passes or has a filed, triaged exception | Table above: criteria 3, 4, 6 pass with repeatable evidence; 1, 2, and the human legs of 5 have filed exceptions (punch list below). |
| No screen anywhere presents a resume, job list, or biography as primary content (FR-VIS-006) | `scripts/launch-readiness.test.mjs` (runs in `npm run test` and CI), plus the career-literals and content-validation gates. |
| Content-pack swap still yields a coherent different world (DATA-FR-029) | `scripts/pack-swap.test.mjs`, re-run green in this sweep's gate. |

## Cross-browser and desktop/mobile verification

**Verified in this sweep (Chromium, built artifact):**

- **Desktop (1280×800, keyboard):** canvas visible ≈100–300 ms after load with no landing page or login (FR-VIS-001); world exhibits ambient life with zero input (FR-VIS-005); the short-visit path completes by keyboard alone; the autosave envelope records the completed quest and restoration; reloading resumes the visit (issue #24 path). Zero console errors from the world itself; one cosmetic 404 (`/favicon.ico` — no favicon shipped, punch list). |
- **Phone viewport (390×844, DPR 3, touch):** canvas fills the viewport exactly, no horizontal overflow (NFR-VIS-004); ambient life identical; a held touch steers the avatar via the move-toward intent (FR-INP-004). Zero console errors. **Gap:** interact is bound to keys only (`Space`/`Enter`/`KeyE`), so a touch-only visitor cannot open dialogue or advance a quest — the short-visit path's dialogue leg is unreachable by touch, and the shipped hint text even promises "tap to interact". Filed as the top punch-list item. |

**Not verifiable in this environment (filed as punch list):** Firefox, Safari/WebKit, and real phone hardware; only Chromium is available here.

**Verification-run observation (not a defect in the human path):** the browser input device keeps a live pressed-key set sampled once per frame, so a *synthetic* sub-frame key press (down+up within ~5 ms) is invisible. Real keystrokes span multiple frames; no action needed beyond awareness in future automated drivers.

## Punch list (filed as issues)

1. **#85 — Touch visitors cannot interact** — no tap-to-interact affordance; blocks the mobile short-visit path's dialogue leg (NFR-VIS-004, FR-VIS-008, OQ-INP-1; hint copy already promises it).
2. **#86 — Human verification panel** — usability ("a game, not a portfolio"), hiring-manager two-minute comprehension, and keyboard-only + screen-reader sessions (Vision criteria 1, 2, 5).
3. **#87 — Real cross-browser and device sweep** — Firefox, Safari/WebKit, real phones; plus ship a favicon to clear the only console 404.

## Sign-off

Every machine-checkable Vision acceptance criterion passes against the built experience with repeatable evidence in the CI gate, and every criterion that needs a human has a filed, triaged exception. With the punch list open — most notably touch interaction — the engine-plus-reference-pack experience meets the Vision's automated acceptance bar for v1.

## Version / Author

Version 1.0 — Mike Blom.
