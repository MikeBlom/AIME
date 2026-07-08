# Resume.World

A data-driven game engine plus a swappable content pack — **the software itself is the
resume**. Visitors explore a living world and restore offline systems, learning about the
creator through gameplay rather than text.

Two invariants carry the design:

1. **The engine holds zero career facts.** All career/world specifics live in the content
   pack as JSON + assets.
2. **Composition and events, not coupling.** Systems talk through the event bus and shared
   world state, never by direct reference.

## Documentation

The specs in [`docs/`](docs/) are the source of truth. Read them in order:

| # | Document | Defines |
|---|----------|---------|
| 00 | [README — the map](docs/00-README.md) | Conventions, vocabulary, planned document tree |
| 01 | [Vision](docs/01-Vision.md) | Mission, pillars, quality bar — wins all conflicts |
| 02 | [System Architecture](docs/02-System-Architecture.md) | Layers, ECS, event bus, runtime loop |
| 03 | [Data Model & Content Pipeline](docs/03-Data-Model-and-Content-Pipeline.md) | The engine ↔ content contract |
| 40 | [Developer Experience](docs/40-Developer-Experience.md) | The concrete stack, commands, branch protection |

System specs (10–49) are authored alongside their implementation issues.

## Getting started

Requires Node ≥ 22.

```bash
npm ci          # install
npm run check   # build + test + lint + format — the full local gate
npm run dev     # dev server
```

## Layout

```
src/platform/   Platform Adapter — the only layer touching the host
src/core/       World state, ECS store, event bus, registry, main loop
src/systems/    Interchangeable behavior modules
content/        Content Packs — data, never code
docs/           Specifications (source of truth)
scripts/        Repo automation (issue selection, status refresh)
```

Contribution flow is issue-driven; see [`CLAUDE.md`](CLAUDE.md) for the operating protocol
and [`ISSUES-README.md`](ISSUES-README.md) for the issue plan.
