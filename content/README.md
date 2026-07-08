# Content (top layer — data, not code)

This directory holds Content Packs: the JSON documents and referenced assets that give the
engine a specific world and career to express. A pack parameterizes Systems but contains
**no logic**, and the engine contains **no career facts** — that seam is load-bearing.

The pack format, schemas, validation, and swappability rules are specified in
[`docs/03-Data-Model-and-Content-Pipeline.md`](../docs/03-Data-Model-and-Content-Pipeline.md).

## `pack.reference` — the minimal reference pack

The pack in [`pack.reference/`](pack.reference/) is the minimal placeholder world: one
region, one NPC, one quest (with a bypass block), and an English strings document, wired
together by a `pack.json` manifest that names `entry.startRegion`. Every value is a
`PLACEHOLDER`; it exists to exercise the loader and give the walking skeleton something
to render, and it doubles as the template a new creator forks (replace ids, strings, and
metaphor bindings to get a different Resume.World on the same engine).

All player-visible text lives in `strings/<locale>/` and is referenced from documents
only by `*Key` fields — never inline (DATA-FR-011). Validate any pack under this
directory with `npm run validate:content`; `scripts/reference-pack.test.mjs` holds the
pack to zero validator errors in CI.
