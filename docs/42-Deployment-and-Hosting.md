# Resume.World — Deployment and Hosting

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** DEP

---

## Purpose

This document specifies how a green `main` becomes a public, visitable world: the hostable artifact, the pipeline that publishes it, per-PR previews, and the load-path properties that keep first delight fast on a slow connection.

## Overview

The engine builds to a fully static artifact: one HTML file plus one bundled script with the reference Content Pack's JSON inlined at build time (see `src/app/pack-bundle.ts`). There is no server component, so hosting is static-file serving — v1 uses **GitHub Pages** fed from a `gh-pages` branch that a first-party GitHub Actions workflow maintains.

Two publish paths share one relocatable build:

- **Main deploys.** Every push to `main` (which branch protection already guarantees is CI-green) rebuilds and replaces the site root. The public URL is the repository's Pages URL.
- **PR previews.** Every same-repo pull request rebuilds and publishes under `previews/pr-<number>/` on the same branch, so reviewers can walk a change in a real browser before merge.

`ci.yml` stays the merge gate; the deploy workflow only ships what is already green.

## Goals

- A reproducible, hands-off path from green `main` to a public URL (the interface contract).
- Previews per PR so review includes the played experience, not just the diff.
- A lightweight opening: first delight must not wait on heavy downloads (Vision edge case; DATA-FR-019).
- Least privilege: the pipeline holds only the scopes it needs, and fork PRs can never write the site.

## Non-Goals

- Multi-region or CDN-tier infrastructure (explicitly out of scope for v1 in issue #41).
- A server or CMS; the artifact is static by architecture (`03`, Content Pack is a static bundle).
- Preview environments for forks — an untrusted token writing the site branch is a non-starter.

## User Stories

- *As the creator,* I merge a green PR and the public world updates itself, so shipping is a non-event.
- *As a reviewer,* I open a preview URL and play the change before approving it.
- *As a visitor on a slow connection,* the world opens fast because the opening payload is tiny.

## Functional Requirements

- **FR-DEP-001** The build MUST produce a fully static, hostable artifact (`dist/`) containing the engine and the bundled reference pack, with no server dependency.
- **FR-DEP-002** The artifact MUST be relocatable: built with a relative base so the identical build serves at the site root, a project-pages subpath, or a preview directory. No code may assume an absolute mount point.
- **FR-DEP-003** Every push to `main` MUST redeploy the site root automatically; no manual step may sit between a green merge and the public URL.
- **FR-DEP-004** Root deploys MUST NOT destroy live previews; the `previews/` tree survives main publishes.
- **FR-DEP-005** Every same-repo pull request MUST publish a preview at `previews/pr-<number>/`, rebuilt on each push to the PR. Fork PRs are excluded (see Security).
- **FR-DEP-006** The Pages site MUST serve files verbatim (`.nojekyll`); no host-side transformation of the artifact.
- **FR-DEP-007** The opening payload (HTML + bundle, gzipped) SHOULD stay within the load budgets of `docs/33-Performance-Budgets.md` (FR-PERF-005); large media joins via the asset manifest, deferred off the critical path (DATA-FR-019), never inlined into the opening bundle.

## Non-Functional Requirements

- **NFR-DEP-001 (Reproducibility):** A deploy is a pure function of the commit: checkout, `npm ci`, `npm run build`, publish. No snowflake state.
- **NFR-DEP-002 (Least privilege):** The workflow token holds `contents: write` only.
- **NFR-DEP-003 (Serialization):** Publishes to `gh-pages` are serialized by a concurrency group so a preview and a root deploy never race the branch.

## Security

- Fork pull requests never run the publish job: the job is gated on the PR head repository equaling this repository, so an untrusted fork cannot write the site branch or exfiltrate the token.
- The workflow uses only first-party actions (`actions/checkout`, `actions/setup-node`) plus plain git — no third-party publish action in the trust chain.
- The site is static; there is no secret material in the artifact, and the Content Pack is public by design.

## Acceptance Criteria

- Merging to main deploys a working build: the deploy run goes green and the public Pages URL serves the current world (issue #41 AC1).
- A PR preview is reachable at `previews/pr-<number>/` under the Pages URL while the PR is open (issue #41 AC1).
- First delight does not depend on large assets finishing download: the opening payload is the HTML plus one small bundle (currently ~36 KB gzipped, well inside FR-PERF-005's budgets), verified against docs/33 by the CI perf smoke (issue #41 AC2).
- The deploy configuration's load-bearing properties are pinned by test (`scripts/deploy-config.test.mjs`): relative base, fork guard, minimal token scope, preview preservation, verbatim serving.

## Dependencies

- `33-Performance-Budgets.md` — the load budgets the opening payload must honor.
- `03-Data-Model-and-Content-Pipeline.md` — DATA-FR-019 (deferred assets), the static-pack model that makes static hosting sufficient.
- `40-Developer-Experience.md` — the CI gate and branch protection that make "deploy from main" safe.
- `docs/38-Asset-Pipeline.md` (planned) — where heavy media and its CDN path get specified; this document only reserves the seam (FR-DEP-007).

## Implementation Notes (non-normative)

- GitHub Pages serves the `gh-pages` branch; creating that branch generally auto-publishes it for the repository. If the site 404s after the first deploy, enable Pages once in repository settings (Source: deploy from branch, `gh-pages`, root) — a one-time setting, after which FR-DEP-003 holds hands-off.
- Preview directories accumulate; a cleanup step (delete `previews/pr-<n>` when the PR closes) is a small follow-up if the tree ever gets heavy.
- If the project later outgrows Pages (custom domain with edge caching, immutable asset URLs), the artifact's relocatability (FR-DEP-002) means only this workflow changes.

## Edge Cases

- **Two publishes race** (a preview and a main deploy): the concurrency group serializes them; the later run rebases onto the fresh branch state by re-fetching before it writes.
- **A deploy produces no changes** (e.g., re-run on the same commit): the publish step detects the empty diff and exits green without an empty commit.
- **The first event is a PR, not a main push:** the orphan `gh-pages` branch is created with only the preview; the root fills in on the next main merge.
- **Pages not yet enabled:** the workflow still maintains `gh-pages` correctly; the one-time setting above turns the light on without redeploying.

## Risks

- **Pages auto-enable is not guaranteed.** Mitigated by the one-time setting documented above; the pipeline itself is unaffected.
- **Preview sprawl.** Unbounded `previews/` growth; accepted for v1 (tiny artifacts), cleanup noted as follow-up.
- **Silent staleness.** If the deploy workflow breaks, main moves but the site does not. Mitigation: the deploy run is visible on every merge; a red `deploy` run on main is treated as a bug to fix immediately.

## Open Questions

- **OQ-DEP-1:** Whether preview cleanup on PR close is worth a workflow of its own, or previews are pruned manually when noticed. Owner: whoever hits the clutter first.

## Future Considerations

- Custom domain + CDN with immutable asset hashes once real media ships (`38-Asset-Pipeline.md`).
- Deploy notifications through the telemetry/observability path if the world ever needs release markers (docs/36, docs/43).

## Version / Author

Version 1.0 — Mike Blom.
