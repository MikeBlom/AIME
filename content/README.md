# Content (top layer — data, not code)

This directory holds Content Packs: the JSON documents and referenced assets that give the
engine a specific world and career to express. A pack parameterizes Systems but contains
**no logic**, and the engine contains **no career facts** — that seam is load-bearing.

The pack format, schemas, validation, and swappability rules are specified in
[`docs/03-Data-Model-and-Content-Pipeline.md`](../docs/03-Data-Model-and-Content-Pipeline.md).
The minimal reference pack arrives with its own issue.
