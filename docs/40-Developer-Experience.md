# Resume.World — Developer Experience

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** DX

---

## Purpose

This document fixes the concrete technology stack and the developer workflow for the
repository. The specs in 00–03 are deliberately stack-agnostic; this document is where
agnostic becomes concrete. Once fixed here, the stack does not change without an issue and
human approval (per `CLAUDE.md`).

## Overview

Resume.World is delivered in the browser. The stack is **TypeScript on Node, built with
Vite, tested with Vitest, linted with ESLint, formatted with Prettier**. One command —
`npm run check` — runs the entire local quality gate that CI wraps.

## Goals

- A fresh clone is productive in two commands (`npm ci`, `npm run check`).
- The local gate and CI run the same checks, so green locally means green remotely.
- Tooling enforces the architecture's invariants (strict types, lint rules, and — with the
  CI issue — the "no career literals in engine" check).

## Non-Goals

- Choosing a rendering library, physics library, or state framework. Those are decided by
  their own system issues within this stack.
- Defining CI pipelines. The CI quality gate is its own issue; this document only defines
  the commands CI wraps.

## The Stack (normative)

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Language | **TypeScript** (strict) | Static types across engine seams (System interface, event payloads, content schemas); the strict flags catch coupling and drift at compile time. |
| Runtime target | **Browser** (ES2022) | NFR-VIS-002/004: smooth on a mid-range laptop and a modern phone, desktop + mobile viewports, pointer + touch, no separate build. The browser is the only target that satisfies all four without installs. |
| Toolchain runtime | **Node ≥ 22** | LTS floor; runs the build, tests, and the standalone content validator (DATA-FR-013). |
| Build tool | **Vite** | Fast dev loop with HMR (supports the content hot-reload authoring loop), zero-config TS, tree-shaken production builds. |
| Test runner | **Vitest** | Native Vite integration, same config file, fast watch mode; supports the deterministic, scripted-`dt` unit tests NFR-ARCH-002 requires. |
| Lint | **ESLint** (flat config, `typescript-eslint` strict) | Enforceable rules at the architecture seam (e.g. `no-console` in engine code). |
| Format | **Prettier** | Ends formatting debate; `format` is a CI-checkable command. |
| Package manager | **npm** (lockfile committed) | Ships with Node; no extra install for a fresh clone. |

- **FR-DX-001** The repository MUST build, test, lint, and format-check with the commands
  below, green on a fresh clone with only Node ≥ 22 installed.
- **FR-DX-002** Source MUST be organized by architectural layer: `src/platform/`,
  `src/core/`, `src/systems/`, and `content/` (data, never code), mirroring
  `02-System-Architecture.md`.
- **FR-DX-003** All tooling configuration MUST live in the repository (no editor-local or
  machine-local requirements beyond Node itself).

## Commands

```bash
npm ci              # reproducible install from the lockfile
npm run dev         # Vite dev server with HMR
npm run build       # typecheck (tsc --noEmit) + production build
npm run test        # Vitest, single run
npm run lint        # ESLint over the repo
npm run format      # Prettier check (format:fix to write)
npm run check       # build + test + lint + format — the full local gate
```

`npm run check` is the single local command that mirrors CI (the CI issue wraps exactly
these, plus content-schema validation and the no-career-literals check as they land).

## Branch protection notes

To be configured on `main` (documented here per the scaffold issue; wiring is the CI
issue's deliverable):

- **Required status checks:** build, test, lint, format — i.e. the jobs wrapping
  `npm run check` — plus, once landed, content-schema validation and the
  no-career-literals check. PRs cannot merge red.
- **Code owners:** `.github/CODEOWNERS` routes review to `@MikeBlom`. When a human gate is
  active (issues labeled `gate:human`), require code-owner review on those PRs.
- **PR template:** `.github/PULL_REQUEST_TEMPLATE.md` requires an acceptance-criteria
  mapping table and the invariant checklist on every PR.
- Squash-merge only; branch names `feat|fix|chore/<issue>-<slug>`; commits reference their
  issue (`#<n>`).

## User Stories

- *As a contributor,* I clone, run `npm ci && npm run check`, and know within a minute
  that my environment is sound.
- *As a reviewer,* I trust that a green `check` means the change met the same bar CI
  enforces, so review attention goes to design, not mechanics.
- *As a content author,* I run `npm run dev` and see content changes hot-reload without
  restarting the world.

## Acceptance Criteria

- Fresh clone + `npm ci` + `npm run check` is green with zero failures.
- Lint and format run clean on the empty project.
- The four-layer source layout exists and is importable (`src/main.ts` composes it).
- PR template and CODEOWNERS exist and are referenced by the branch protection notes above.

## Dependencies

- `01-Vision.md` — NFR-VIS-002/004 force the browser target.
- `02-System-Architecture.md` — the layer layout FR-DX-002 mirrors.
- `03-Data-Model-and-Content-Pipeline.md` — DATA-FR-013's standalone validator runs on
  this stack's runtime.

## Implementation Notes (non-normative)

- TypeScript strictness includes `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  and `verbatimModuleSyntax`; loosening any of these requires an issue.
- `no-console` is an error in engine code (warn/error allowed): Systems coordinate through
  the event bus and the observable event log (FR-ARCH-013), not stdout.
- Vitest runs in the `node` environment today; jsdom/browser environments can be added
  per-suite when render/input systems need them.

## Edge Cases

- **Node version drift.** `engines.node >= 22` plus the committed lockfile keep installs
  reproducible; CI pins its Node from the same constraint.
- **Formatting of generated files.** Build output and the lockfile are excluded via
  `.prettierignore`; docs are prose-formatted by hand and excluded from Prettier.

## Risks

- **Toolchain churn.** Vite/Vitest move fast. Mitigation: the lockfile pins exact
  versions; upgrades are deliberate PRs that must pass the full gate.
- **Stack lock-in before profiling.** The browser target is Vision-forced, but specific
  libraries are not chosen here, so per-system choices stay open (see Non-Goals).

## Open Questions

- **OQ-DX-1:** Whether the content validator ships as an npm script here or a separate
  CLI package — decided by the content-loader issue.

## Future Considerations

- A worker build target for heavy Systems (FR-ARCH-028) if profiling demands it.
- A native shell (e.g. wrapping the browser build) would be a Platform Adapter task per
  NFR-ARCH-004, not a stack change.

## Version / Author

Version 1.0 — Mike Blom.
