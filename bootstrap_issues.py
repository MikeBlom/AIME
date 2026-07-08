#!/usr/bin/env python3
"""
Resume.World — GitHub issue bootstrapper.

Creates the milestones, labels, epic tracking issues, and all build issues for
the initial build of Resume.World, wiring up the dependency graph so Claude Code
can always pick the next unblocked issue.

USAGE
    # Preview the plan (no gh, no network):
    python3 bootstrap_issues.py --print-plan

    # Preview every gh command without touching GitHub:
    python3 bootstrap_issues.py --dry-run

    # Create everything in the current repo (requires an authenticated `gh`):
    gh auth status                      # confirm you are logged in
    cd /path/to/your/resume-world-repo  # a git repo whose origin is the target
    python3 /path/to/bootstrap_issues.py

    # Target an explicit repo instead of the current directory:
    python3 bootstrap_issues.py --repo owner/name

The script is two-pass: it creates every issue first, records slug -> issue
number, then rewrites bodies and epic checklists so "Depends on:" references and
tracking lists point at real issue numbers.
"""

from __future__ import annotations
import argparse
import subprocess
import sys

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

MILESTONES = [
    ("Phase 0 — Foundations",     "Repo, CI, engine core, content loader, walking skeleton. Strictly sequential."),
    ("Phase 1 — Core Systems",    "Rendering, input, camera, movement, physics, animation, audio, UI, save/load."),
    ("Phase 2 — World Systems",   "Quest, dialogue, NPC, world sim, environment, buildings, inventory, achievements, mini-games host."),
    ("Phase 3 — Content & Polish","Reference content pack, mini-game catalog, art, accessibility, localization, analytics, performance."),
    ("Phase 4 — Delivery",        "Deployment, observability, testing hardening, onboarding, launch readiness."),
]

# label name, hex color, description
LABELS = [
    ("type:epic",       "5319e7", "Tracking issue for a phase"),
    ("type:build",      "1d76db", "Executable build issue (one PR)"),
    ("phase:0",         "b60205", "Phase 0 — Foundations"),
    ("phase:1",         "d93f0b", "Phase 1 — Core Systems"),
    ("phase:2",         "fbca04", "Phase 2 — World Systems"),
    ("phase:3",         "0e8a16", "Phase 3 — Content & Polish"),
    ("phase:4",         "0052cc", "Phase 4 — Delivery"),
    ("status:ready",    "0e8a16", "All dependencies closed; ready to build"),
    ("status:blocked",  "e99695", "Waiting on dependencies"),
    ("parallel-safe",   "c2e0c6", "Safe to run alongside peers in its phase"),
    ("gate:human",      "d4c5f9", "Requires human review before merge"),
    ("size:S",          "ededed", "A few hours"),
    ("size:M",          "ededed", "About a day"),
    ("size:L",          "ededed", "Multiple days; consider splitting"),
    ("question",        "cc317c", "Open product/technical question"),
]
AREA_COLOR = "bfd4f2"

DOD = """\
## Definition of Done
- [ ] Every Acceptance Criterion above is met and covered by a test where testable.
- [ ] CI green: build, unit tests, lint/format, JSON schema validation, and the "no career literals in engine" check.
- [ ] No career-specific literals in engine code; new player-visible text is a locale key, not an inline string.
- [ ] New Systems honor the System interface/lifecycle in `docs/02-System-Architecture.md` and communicate only via the event bus and shared world state.
- [ ] Determinism preserved: no direct wall-clock or unseeded randomness in simulation code.
- [ ] PR body maps each Acceptance Criterion to its implementation and tests, and includes `Closes #<this-issue>`.
"""

# --------------------------------------------------------------------------- #
# Issue data
# --------------------------------------------------------------------------- #

EPICS = [
    dict(slug="epic-phase-0", title="Epic: Phase 0 — Foundations", phase=0,
         summary="Stand up the repo, CI, engine core, content loader, and a walking-skeleton vertical slice. Strictly sequential; each issue merges before the next starts. Close this epic to unlock Phase 1."),
    dict(slug="epic-phase-1", title="Epic: Phase 1 — Core Systems", phase=1,
         summary="Build the interchangeable core Systems on top of a stable Core. Parallelizable within disjoint areas. Close to unlock Phase 2."),
    dict(slug="epic-phase-2", title="Epic: Phase 2 — World Systems", phase=2,
         summary="Build the world-behavior plugins: quests, dialogue, NPCs, simulation, environment, buildings, progression, mini-games host. Parallelizable. Close to unlock Phase 3."),
    dict(slug="epic-phase-3", title="Epic: Phase 3 — Content & Polish", phase=3,
         summary="Author the reference content pack and the polish layers: art, accessibility, localization, analytics, performance. Parallelizable. Close to unlock Phase 4."),
    dict(slug="epic-phase-4", title="Epic: Phase 4 — Delivery", phase=4,
         summary="Deploy, observe, harden tests, onboard, and run the launch-readiness sweep against the Vision acceptance criteria."),
]

ISSUES = [
    # ---------------------- Phase 0 — Foundations (sequential) ----------------------
    dict(slug="repo-scaffold", title="Repo scaffold, toolchain, and conventions", phase=0,
         area="repo", size="M", parallel=False, gate_human=True, deps=[],
         context="Establish the repository skeleton every later issue builds in. Fixes the (stack-agnostic -> concrete) technology choice for the project. See `docs/00-README.md` (conventions) and `docs/02-System-Architecture.md` (layering).",
         deliverables=[
             "Choose and document the concrete stack (language, build tool, test runner, lint/format) in `docs/40-Developer-Experience.md`; the specs stay stack-agnostic but the repo is concrete.",
             "Create the source layout reflecting the four architectural layers: platform adapter, core, systems, content.",
             "Move the four foundational specs into `docs/` and add a `docs/` index link from the repo README.",
             "Add `.editorconfig`, lint/format config, a `.gitignore`, a PR template, and `CODEOWNERS`.",
             "Add `CLAUDE.md` (operating protocol) at repo root.",
         ],
         interface="A buildable, lint-clean empty project with `docs/`, a documented stack, and a green `hello` build/test command that later CI wraps.",
         acceptance=[
             "Fresh clone builds and runs the test command with zero failures.",
             "Lint and format run clean on the empty project.",
             "`docs/` contains 00-03 and a stack decision in `docs/40-Developer-Experience.md`.",
             "PR template and CODEOWNERS are present and referenced by branch protection notes.",
         ],
         out_of_scope="Any engine behavior. This issue only stands up scaffolding and conventions."),

    dict(slug="ci-quality-gate", title="CI quality gate", phase=0,
         area="testing", size="M", parallel=False, gate_human=True, deps=["repo-scaffold"],
         context="CI is the safety net that makes leaf-issue auto-merge acceptable (see `CLAUDE.md`). It must fail any PR that breaks the invariants.",
         deliverables=[
             "CI pipeline running on every PR: build, unit tests, lint/format check.",
             "JSON schema validation step that runs the content validator against the reference pack.",
             "A 'no career literals in engine' static check: engine source must contain no creator/career string literals (allowlist for the content layer).",
             "Status checks wired so PRs cannot merge red; document required checks for branch protection.",
         ],
         interface="A reusable CI workflow other issues rely on; a single command developers can run locally that mirrors CI exactly.",
         acceptance=[
             "A PR with a failing test, a lint error, an invalid content document, or a career literal in engine code is each blocked by CI.",
             "The same checks run locally via one documented command and match CI results.",
         ],
         out_of_scope="Deployment (see Phase 4). This is verification only."),

    dict(slug="core-ecs-store", title="Core: entity/component store and queries", phase=0,
         area="core", size="M", parallel=False, gate_human=True, deps=["repo-scaffold"],
         context="Implements the composition substrate from `docs/02-System-Architecture.md` (FR-ARCH-001..004).",
         deliverables=[
             "Stable, serializable entity ids.",
             "Data-only components with no behavior.",
             "Efficient queries over entities by component composition.",
             "Open component-type registration so plugins can add component types without editing core.",
         ],
         interface="`createEntity`, `addComponent`, `removeComponent`, and a composition query API that Systems iterate. Serializable entity ids for save/load.",
         acceptance=[
             "FR-ARCH-001..004 satisfied and unit-tested.",
             "A composition query returns exactly the entities with the requested component set.",
             "A plugin-defined component type works without core changes (test with a fake plugin).",
         ],
         out_of_scope="Systems that act on components; the event bus."),

    dict(slug="core-event-bus", title="Core: typed event bus", phase=0,
         area="core", size="M", parallel=False, gate_human=True, deps=["core-ecs-store"],
         context="Implements FR-ARCH-009..013 from `docs/02-System-Architecture.md`.",
         deliverables=[
             "Typed publish/subscribe with many subscribers per type.",
             "Deterministic, stable subscriber ordering within a tick.",
             "Immutable events; immediate vs deferred/queued delivery.",
             "An observable event log toggled in development builds.",
         ],
         interface="`publish(event)`, `subscribe(type, handler, priority?)`, deferred-queue flush hook, and a read-only event log for debugging.",
         acceptance=[
             "FR-ARCH-009..013 satisfied and unit-tested.",
             "Two runs with identical inputs deliver events in identical order (determinism).",
             "A subscriber cannot mutate an event observed by a later subscriber.",
         ],
         out_of_scope="The runtime loop; specific gameplay events."),

    dict(slug="core-module-registry", title="Core: module registry, System interface, and plugins", phase=0,
         area="core", size="M", parallel=False, gate_human=True, deps=["core-event-bus"],
         context="Implements the System lifecycle and plugin model, FR-ARCH-005..008 and FR-ARCH-017..020, plus dependency ordering FR-ARCH-026..027.",
         deliverables=[
             "The System interface (id, dependencies, init, update, teardown) and Context object.",
             "A declarative registry that loads Systems from data, not hardcoded wiring.",
             "Plugin bundles that register Systems, component types, and event types as a unit.",
             "Topological ordering of Systems by declared dependencies with cycle detection and stable tiebreak.",
         ],
         interface="`register(system|plugin)`, computed init/update order, and a Context exposing world state, event bus, scheduler, and platform interfaces.",
         acceptance=[
             "A trivial System is added and registered with zero core changes and receives init/update/teardown.",
             "A dependency cycle is rejected at load with a diagnostic naming the cycle (FR-ARCH-026).",
             "A missing plugin dependency fails loudly and safely (FR-ARCH-020).",
         ],
         out_of_scope="The frame loop timing; concrete Systems."),

    dict(slug="core-runtime-loop", title="Core: deterministic runtime loop and services", phase=0,
         area="core", size="L", parallel=False, gate_human=True, deps=["core-module-registry"],
         context="Implements the fixed-step loop and determinism guarantees, FR-ARCH-021..025 and NFR-ARCH-001.",
         deliverables=[
             "Fixed-step simulation with interpolated presentation.",
             "Clamped catch-up to avoid the spiral of death; clean pause/resume on focus/visibility loss.",
             "Per-frame immutable input snapshot boundary (consumed later by the Input System).",
             "Seedable time and RNG services injected via Context so all nondeterminism is controlled.",
             "Per-System frame-timing hooks for the debug overlay.",
         ],
         interface="A `run()` loop driving registered Systems in order; `TimeService` and `RngService` on Context; record/replay entry points.",
         acceptance=[
             "Identical content + input + dt sequence yields identical final world state (FR-ARCH-025, replay test).",
             "Backgrounding for minutes produces no time spike on resume (FR-ARCH-022/024).",
             "A fault in one System's update is isolated and logged; the loop keeps running (FR-ARCH-029).",
         ],
         out_of_scope="Rendering/audio implementation; only the loop and services."),

    dict(slug="content-loader-validation", title="Content loader and schema validation", phase=0,
         area="content", size="L", parallel=False, gate_human=True, deps=["core-module-registry"],
         context="Implements the engine/content contract in `docs/03-Data-Model-and-Content-Pipeline.md` (DATA-FR-001..020).",
         deliverables=[
             "Content Pack manifest loading and document discovery.",
             "Versioned JSON schemas for every content type with placeholder examples.",
             "Reference resolution into an immutable, fully-linked content graph; dangling references rejected.",
             "A standalone validator CLI usable in CI (cross-document checks: references, unknown mechanics, missing default-locale keys, reachability warnings).",
             "Atomic load: malformed packs are rejected whole with actionable diagnostics.",
         ],
         interface="`loadPack(path) -> ResolvedContentGraph`, a `validate(path)` CLI returning actionable errors, and published schema artifacts shared by runtime and CI.",
         acceptance=[
             "A pack with a dangling reference, unknown mechanic, or missing default-locale key is rejected with a message naming document/field/value (DATA-FR-007/009/015).",
             "An incompatible engine-version pack is rejected with a version-mismatch message (DATA-FR-016).",
             "The same pack always loads to the same content graph (DATA-FR-017).",
         ],
         out_of_scope="Hot reload (Phase 3 can extend); world content beyond the minimal pack."),

    dict(slug="reference-content-pack-min", title="Minimal reference content pack", phase=0,
         area="content", size="S", parallel=False, gate_human=True, deps=["content-loader-validation"],
         context="A placeholder pack that exercises the loader and gives the walking skeleton something to render. All content is placeholder per `docs/03`.",
         deliverables=[
             "A `pack.json` manifest with one start region.",
             "One region, one NPC, one quest (with a bypass block), and an English strings document.",
             "All player-visible text as locale keys; no career literals.",
         ],
         interface="A valid Content Pack that loads cleanly and defines `entry.startRegion`.",
         acceptance=[
             "The pack passes the standalone validator with zero errors.",
             "No inline player-visible strings; every display string resolves via a key (DATA-FR-011).",
         ],
         out_of_scope="The full reference pack (Phase 3)."),

    dict(slug="platform-adapter-stub", title="Platform adapter: render/input/audio/storage stubs", phase=0,
         area="platform", size="M", parallel=False, gate_human=True, deps=["core-runtime-loop"],
         context="The only layer that touches the host, per `docs/02` (NFR-ARCH-004). A minimal but real adapter so the skeleton can draw and read input.",
         deliverables=[
             "A render surface abstraction able to draw simple primitives/sprites.",
             "Input device abstraction producing the per-frame snapshot.",
             "Audio output and storage/timer interfaces (stubs acceptable where not yet used).",
             "All host coupling confined to this layer.",
         ],
         interface="Narrow platform interfaces consumed via Context; swapping the backend touches only this layer.",
         acceptance=[
             "A primitive can be drawn and an input read through the adapter with no host calls elsewhere.",
             "A static check confirms no host/platform calls exist outside the adapter (NFR-ARCH-004).",
         ],
         out_of_scope="A full rendering system (Phase 1)."),

    dict(slug="walking-skeleton", title="Walking skeleton: playable vertical slice", phase=0,
         area="core", size="L", parallel=False, gate_human=True,
         deps=["platform-adapter-stub", "reference-content-pack-min"],
         context="The Phase 0 exit: prove the whole spine works end to end before fanning out. Closing this closes the Phase 0 epic.",
         deliverables=[
             "Boot the engine, load the minimal pack, and render the arrival region.",
             "A player-controllable entity moving via the input snapshot through the loop.",
             "A debug overlay showing event log, active Systems, and frame timing.",
             "A replay test capturing the determinism guarantee end to end.",
         ],
         interface="A running app: black screen -> moving controllable entity in the arrival region, tests green.",
         acceptance=[
             "The slice runs on desktop and a mobile viewport, controllable by keyboard and touch.",
             "The end-to-end replay test reproduces identical final state (FR-ARCH-025).",
             "The debug overlay renders live event/System/timing data.",
         ],
         out_of_scope="Polished visuals, audio, and any world behavior beyond moving the entity."),

    # ---------------------- Phase 1 — Core Systems (parallel) ----------------------
    dict(slug="rendering-system", title="Rendering System", phase=1,
         area="render", size="L", parallel=True, gate_human=False, deps=["walking-skeleton"],
         context="Realizes the presentation of the world per Vision polish (NFR-VIS-001) and the presentation phase of the loop. Author `docs/30-Rendering.md` as part of this issue.",
         deliverables=[
             "A rendering System that draws entities with a Renderable component via the platform adapter.",
             "Layering/z-order, camera-aware draw, and interpolation between fixed steps.",
             "A sprite/asset draw path fed by the asset manifest.",
             "`docs/30-Rendering.md` following the standard section skeleton.",
         ],
         interface="Consumes Renderable + Position components; exposes draw layers and interpolation; no host calls except through the adapter.",
         acceptance=[
             "Entities render at correct positions with stable layering; motion is smooth at the target frame budget.",
             "Rendering reads only world state and the adapter; it holds no direct System references.",
         ],
         out_of_scope="Animation state machines (separate issue); art direction (Phase 3)."),

    dict(slug="input-system", title="Input System", phase=1,
         area="input", size="M", parallel=True, gate_human=False, deps=["walking-skeleton"],
         context="Turns the per-frame input snapshot into intent events. Author `docs/14-Input-and-Controls.md`.",
         deliverables=[
             "Sample devices into the immutable per-frame snapshot; emit intent events (move, interact, etc.).",
             "Support keyboard and touch; a remappable binding layer (data-driven).",
             "`docs/14-Input-and-Controls.md`.",
         ],
         interface="Publishes typed intent events consumed by movement, UI, and interaction Systems.",
         acceptance=[
             "All Systems observe identical input for a frame (FR-ARCH-023).",
             "Keyboard and touch both produce equivalent intents; bindings are remappable via data.",
         ],
         out_of_scope="Accessibility remap UI (Phase 3 accessibility); gameplay reactions to input."),

    dict(slug="camera-system", title="Camera System", phase=1,
         area="camera", size="M", parallel=True, gate_human=False, deps=["rendering-system", "input-system"],
         context="Late-update camera that follows the resolved player position. Author `docs/13-Camera.md`.",
         deliverables=[
             "Follow, damping, bounds/clamping to region extents, and zoom hooks.",
             "Runs in the late-update phase after simulation settles.",
             "`docs/13-Camera.md`.",
         ],
         interface="Provides the view transform consumed by rendering; reads player position from world state.",
         acceptance=[
             "Camera follows smoothly with no jitter and respects region bounds.",
             "Camera updates after simulation resolves the player position (late-update ordering).",
         ],
         out_of_scope="Cinematic scripting."),

    dict(slug="movement-traversal", title="Movement and traversal", phase=1,
         area="movement", size="M", parallel=True, gate_human=False, deps=["input-system"],
         context="Satisfying, immediate movement per Vision pillar 4. Author `docs/15-Movement-and-Traversal.md`.",
         deliverables=[
             "Translate move intents into entity motion with acceleration/friction tuning.",
             "Deterministic, fixed-step motion integration.",
             "`docs/15-Movement-and-Traversal.md`.",
         ],
         interface="Updates Position from move intents; exposes velocity/facing for animation and camera.",
         acceptance=[
             "Movement feels responsive and is frame-rate independent (fixed-step).",
             "Given identical inputs, motion is reproducible (determinism).",
         ],
         out_of_scope="Collision response (next issue)."),

    dict(slug="physics-collision", title="Physics and collision", phase=1,
         area="physics", size="L", parallel=True, gate_human=False, deps=["movement-traversal"],
         context="Collision and simple physics for a top-down world. Author `docs/31-Physics-and-Collision.md`.",
         deliverables=[
             "Collider components, broadphase, and resolution against world geometry.",
             "Triggers/interaction volumes that emit events on enter/exit.",
             "`docs/31-Physics-and-Collision.md`.",
         ],
         interface="Consumes Collider + Position; emits collision/trigger events; blocks disallowed movement.",
         acceptance=[
             "Entities cannot pass through solids; triggers emit enter/exit events deterministically.",
             "No tunneling at target speeds; stable after backgrounding (catch-up clamp respected).",
         ],
         out_of_scope="Rigid-body/ragdoll physics; out of scope for v1."),

    dict(slug="animation-system", title="Animation System", phase=1,
         area="animation", size="M", parallel=True, gate_human=False, deps=["rendering-system"],
         context="Polished animation per Vision (NFR-VIS-001). Author `docs/16-Animation.md`.",
         deliverables=[
             "Sprite/skeletal animation state machine driven by world state (e.g., velocity -> walk).",
             "Interpolation in the presentation phase; event-triggered one-shots (interact, restore).",
             "`docs/16-Animation.md`.",
         ],
         interface="Reads state (velocity, facing, action events); outputs current frame/pose to rendering.",
         acceptance=[
             "Animation transitions are smooth and driven by world state, not by direct System calls.",
             "One-shot animations fire on the right events and return to base state.",
         ],
         out_of_scope="Specific character art (Phase 3)."),

    dict(slug="audio-system", title="Audio System", phase=1,
         area="audio", size="M", parallel=True, gate_human=False, deps=["walking-skeleton"],
         context="Every interaction has sound (NFR-VIS-001). Author `docs/17-Audio.md`.",
         deliverables=[
             "Event-driven SFX, spatialization hooks, ambient beds, and a music bus.",
             "Volume/mute controls and a reduced-audio option.",
             "`docs/17-Audio.md`.",
         ],
         interface="Subscribes to gameplay events and plays cues via the adapter's audio interface.",
         acceptance=[
             "Interactions produce audible feedback; ambient beds respond to region/time.",
             "Audio is driven purely by events and world state.",
         ],
         out_of_scope="Final sound design assets (Phase 3)."),

    dict(slug="ui-hud", title="UI / HUD System", phase=1,
         area="ui", size="L", parallel=True, gate_human=False, deps=["rendering-system", "input-system"],
         context="Diegetic, minimal UI per Vision (no menus/text walls). Author `docs/18-UI-UX-and-HUD.md`.",
         deliverables=[
             "A UI layer for prompts, interaction hints, and dialogue surfaces, styled minimally.",
             "Input routing that does not steal gameplay input unexpectedly.",
             "Responsive layout for desktop and mobile; all text via locale keys.",
             "`docs/18-UI-UX-and-HUD.md`.",
         ],
         interface="A UI System rendering above the world; consumes intent events; exposes a surface API for dialogue and mini-games.",
         acceptance=[
             "Interaction prompts appear/disappear correctly and never block movement unexpectedly.",
             "UI is legible on desktop and small mobile viewports; no inline strings.",
         ],
         out_of_scope="Full accessibility pass (Phase 3)."),

    dict(slug="save-load-persistence", title="Save/load and persistence", phase=1,
         area="saveload", size="M", parallel=True, gate_human=False, deps=["walking-skeleton"],
         context="Serialize progression per FR-ARCH-016 and `docs/32-Save-Load-and-Persistence.md` (author it).",
         deliverables=[
             "Serialize/deserialize world-state progression slices via the storage interface.",
             "Versioned save format with forward-safe migration hooks.",
             "Autosave on key events and safe resume.",
             "`docs/32-Save-Load-and-Persistence.md`.",
         ],
         interface="`save()`/`load()` over the storage adapter; round-trips progression without loss (FR-ARCH-016).",
         acceptance=[
             "A saved session restores to an identical, playable state (round-trip test).",
             "The content graph is not serialized; only mutable world state is.",
         ],
         out_of_scope="Cloud sync; out of scope for v1."),

    # ---------------------- Phase 2 — World Systems (parallel) ----------------------
    dict(slug="quest-engine", title="Quest Engine (Restoration)", phase=2,
         area="quest", size="L", parallel=True, gate_human=False,
         deps=["core-event-bus", "content-loader-validation", "walking-skeleton"],
         context="Restoration is the core narrative act (Vision FR-VIS-004). Data-driven from quest content in `docs/03`. Author `docs/20-Quest-Engine.md`.",
         deliverables=[
             "Quest state machine driven by content: objectives, completion, bypass path (FR-VIS-010).",
             "Emits `SystemRestored` and applies world effects (region offline -> online) on completion.",
             "Progress tracking persisted via save/load.",
             "`docs/20-Quest-Engine.md`.",
         ],
         interface="Loads quests from the content graph; subscribes to gameplay events to advance objectives; emits restoration events.",
         acceptance=[
             "Completing a quest transitions its region to online and emits `SystemRestored`.",
             "The bypass path reveals the career meaning without solving the puzzle (FR-VIS-010).",
             "Quest progress survives save/load.",
         ],
         out_of_scope="Specific quest content (Phase 3); mini-game mechanics (host issue)."),

    dict(slug="dialogue-system", title="Dialogue System", phase=2,
         area="dialogue", size="M", parallel=True, gate_human=False,
         deps=["ui-hud", "content-loader-validation"],
         context="Conversation trees from content, surfaced via UI. No text walls (Vision). Author `docs/21-Dialogue-System.md`.",
         deliverables=[
             "Traverse dialogue node graphs from content; branching choices; end nodes.",
             "Render via the UI surface; all text via locale keys.",
             "Hooks to trigger events/quest advancement from dialogue.",
             "`docs/21-Dialogue-System.md`.",
         ],
         interface="`startDialogue(id)` renders nodes through UI and can emit events on choices.",
         acceptance=[
             "A branching dialogue plays through to an end node with choices working.",
             "All dialogue text resolves via locale keys; missing non-default keys fall back (DATA-FR-025).",
         ],
         out_of_scope="Voice acting; dialogue content (Phase 3)."),

    dict(slug="npc-behavior", title="NPC and behavior", phase=2,
         area="npc", size="L", parallel=True, gate_human=False,
         deps=["movement-traversal", "content-loader-validation"],
         context="NPCs move and follow routines so the world feels alive (Vision pillar 1). Author `docs/22-NPC-and-Behavior.md`.",
         deliverables=[
             "Data-driven NPC routines (day/night activities, patrol paths) from content.",
             "Composable behaviors (idle, move-to, interact) via components + a behavior System.",
             "Interaction affordances that trigger dialogue/quests.",
             "`docs/22-NPC-and-Behavior.md`.",
         ],
         interface="A behavior System acting on NPC components; reads routines from the content graph; emits interaction events.",
         acceptance=[
             "NPCs follow their content-defined routines and shift on day/night change.",
             "Interacting with an NPC can start dialogue or advance a quest.",
         ],
         out_of_scope="Advanced AI/pathfinding beyond routine following (future)."),

    dict(slug="world-simulation-ambient", title="World simulation and ambient events", phase=2,
         area="worldsim", size="M", parallel=True, gate_human=False, deps=["core-runtime-loop"],
         context="Background events happen even when the player is idle (Vision pillar 1). Author `docs/24-World-Simulation-and-Ambient-Events.md`.",
         deliverables=[
             "A scheduler for ambient events (machines animating, transport moving, background activity).",
             "Deterministic, seedable scheduling so replays hold.",
             "Density tuning so there is always something nearby (no dead space).",
             "`docs/24-World-Simulation-and-Ambient-Events.md`.",
         ],
         interface="Emits ambient events consumed by rendering/audio/NPC Systems; driven by the seedable RNG service.",
         acceptance=[
             "Ambient life is visible while the player is idle and reproducible under replay.",
             "No region reads as static during normal play.",
         ],
         out_of_scope="Specific ambient content (Phase 3)."),

    dict(slug="day-night-weather", title="Day/night and weather", phase=2,
         area="environment", size="M", parallel=True, gate_human=False,
         deps=["world-simulation-ambient", "rendering-system"],
         context="Day/night and weather exist (Vision pillar 1). Author `docs/23-Day-Night-and-Weather.md`.",
         deliverables=[
             "A time-of-day cycle emitting `TimeOfDayChanged`; lighting/tint hooks for rendering.",
             "Weather states per region weather profile from content.",
             "`docs/23-Day-Night-and-Weather.md`.",
         ],
         interface="Publishes time/weather events; exposes current phase to rendering, NPC routines, and audio.",
         acceptance=[
             "Time progresses and drives visible lighting change and NPC routine shifts.",
             "Weather follows the region's content profile and is reproducible under replay.",
         ],
         out_of_scope="Photoreal weather VFX."),

    dict(slug="buildings-interiors", title="Buildings and interiors", phase=2,
         area="buildings", size="L", parallel=True, gate_human=False,
         deps=["rendering-system", "physics-collision", "content-loader-validation"],
         context="Every building has a purpose (Vision, brief). Author `docs/25-Buildings-and-Interiors.md`.",
         deliverables=[
             "Enter/exit transitions between exterior and interior spaces from content.",
             "Interior collision, occupancy, and interaction points.",
             "`docs/25-Buildings-and-Interiors.md`.",
         ],
         interface="Building/interior entities from content; transition events; interior world-state loading.",
         acceptance=[
             "The player can enter and exit a building with a polished transition and correct collision inside.",
             "Interiors are defined entirely by content (DATA invariants).",
         ],
         out_of_scope="Building art (Phase 3)."),

    dict(slug="inventory-progression", title="Inventory and progression", phase=2,
         area="inventory", size="M", parallel=True, gate_human=False,
         deps=["core-event-bus", "save-load-persistence"],
         context="Progression is restoration (Vision). Author `docs/26-Inventory-and-Progression.md`.",
         deliverables=[
             "Progression model tracking restored systems and unlocked capabilities.",
             "Optional inventory of tools/keys tied to quests; all persisted.",
             "`docs/26-Inventory-and-Progression.md`.",
         ],
         interface="Progression state in world state, mutated via events (e.g., `SystemRestored`), read by UI/achievements.",
         acceptance=[
             "Restoring a system updates progression and persists across save/load.",
             "Progression is event-driven; no System writes another's slice directly (FR-ARCH-015).",
         ],
         out_of_scope="Economy/currency systems (future)."),

    dict(slug="achievements", title="Achievements", phase=2,
         area="achievements", size="S", parallel=True, gate_human=False,
         deps=["core-event-bus", "inventory-progression"],
         context="Recognitions surfaced through gameplay, defined in content. Author `docs/27-Achievements.md`.",
         deliverables=[
             "Achievement definitions from content; unlock rules driven by events.",
             "Non-intrusive unlock feedback (animation + sound + state) per polish gate.",
             "`docs/27-Achievements.md`.",
         ],
         interface="Subscribes to gameplay events; unlocks content-defined achievements; persists unlock state.",
         acceptance=[
             "An achievement unlocks on its content-defined condition with polished feedback.",
             "Unlock state persists across save/load.",
         ],
         out_of_scope="Platform achievement integrations (future)."),

    dict(slug="minigames-framework", title="Mini-games host framework", phase=2,
         area="minigames", size="L", parallel=True, gate_human=False,
         deps=["core-module-registry", "ui-hud"],
         context="Mechanics are metaphors for accomplishments (Vision Metaphor Rule). The host provides mechanic types; content binds them. Author `docs/28-Mini-Games-Framework.md`.",
         deliverables=[
             "A plugin host contract: a mini-game registers as a System honoring a common lifecycle (enter, play, resolve, exit).",
             "A params schema per mechanic type so content can configure a mini-game (DATA-FR-009).",
             "Result events that feed the quest engine (success/bypass).",
             "`docs/28-Mini-Games-Framework.md`.",
         ],
         interface="A registration API for mechanic-type plugins; a launch API from quests; standardized result events.",
         acceptance=[
             "A sample mechanic-type plugin registers and runs, returning a result event consumed by a quest.",
             "Content can configure the mechanic via validated params; unknown mechanics are rejected at load.",
         ],
         out_of_scope="The specific catalog of mini-games (Phase 3)."),

    # ---------------------- Phase 3 — Content & Polish (parallel) ----------------------
    dict(slug="metaphor-minigames-catalog", title="Mechanic types and mini-game catalog", phase=3,
         area="minigames", size="L", parallel=True, gate_human=False,
         deps=["minigames-framework"],
         context="Implement the engine-provided mechanic types content binds to (route-and-balance, assembly, orchestrate, etc.). Author `docs/29-Mini-Games-Catalog.md`.",
         deliverables=[
             "At least three mechanic-type plugins, each a metaphor primitive (e.g., route-and-balance for distributed systems).",
             "Each with a params schema, polished feedback, and a bypass outcome.",
             "`docs/29-Mini-Games-Catalog.md`.",
         ],
         interface="Named `engine.mechanic.*` types referenceable by `metaphor` content (DATA-FR-009).",
         acceptance=[
             "Each mechanic is playable, teaches its concept, and is fully data-configurable.",
             "Each mechanic offers a bypass that still reveals meaning (FR-VIS-010).",
         ],
         out_of_scope="Career-specific framing (that lives in the content pack)."),

    dict(slug="reference-content-full", title="Full reference content pack", phase=3,
         area="content", size="L", parallel=True, gate_human=True,
         deps=["quest-engine", "dialogue-system", "minigames-framework", "metaphor-minigames-catalog"],
         context="Author the reference creator's world as pure content (placeholders until real career details are supplied). Uses `docs/03` schemas and `docs/47-Content-Style-Guide.md` (author it).",
         deliverables=[
             "Regions, buildings, NPCs, quests, dialogue, metaphor bindings, and achievements composing the core arc.",
             "A short-visit path that lands the strongest signal early (FR-VIS-008).",
             "`docs/47-Content-Style-Guide.md`.",
             "Everything validates; no career literals in engine; all text localized.",
         ],
         interface="A complete, valid Content Pack that plays as a coherent Resume.World.",
         acceptance=[
             "The pack passes validation and plays start-to-restored as a coherent arc.",
             "A two-minute visit communicates the creator's level and range without resume text (FR-VIS-008).",
             "Swapping to a second placeholder pack yields a different coherent world with no code changes (DATA-FR-029).",
         ],
         out_of_scope="Final real career copy (author supplies later by editing data)."),

    dict(slug="art-direction-pass", title="Art direction pass", phase=3,
         area="art", size="L", parallel=True, gate_human=True,
         deps=["rendering-system", "animation-system"],
         context="A single-hand visual identity (NFR-VIS-007). Author `docs/12-Art-Direction.md`.",
         deliverables=[
             "Palette, shape language, lighting, and motion feel; applied to world, UI, and effects.",
             "Asset guidelines feeding the asset pipeline.",
             "`docs/12-Art-Direction.md`.",
         ],
         interface="A cohesive visual style applied across rendering and UI.",
         acceptance=[
             "Reviewers describe the visuals as authored by a single hand (NFR-VIS-007).",
             "Style is data-referenced where possible, not hardcoded per screen.",
         ],
         out_of_scope="Final marketing art."),

    dict(slug="accessibility", title="Accessibility", phase=3,
         area="a11y", size="L", parallel=True, gate_human=True,
         deps=["input-system", "ui-hud"],
         context="Non-negotiable per NFR-VIS-003. Author `docs/34-Accessibility.md`.",
         deliverables=[
             "Keyboard-only play, screen-reader narration of essential content, WCAG 2.2 AA contrast.",
             "Reduced-motion mode and remappable controls UI.",
             "`docs/34-Accessibility.md`.",
         ],
         interface="Accessibility settings in world state; systems honor reduced-motion and contrast requirements.",
         acceptance=[
             "A keyboard-only tester and a screen-reader tester can reach and understand the short-visit content.",
             "Contrast meets WCAG 2.2 AA; reduced-motion visibly reduces motion.",
         ],
         out_of_scope="Full localization (separate issue)."),

    dict(slug="localization", title="Localization", phase=3,
         area="i18n", size="M", parallel=True, gate_human=False,
         deps=["content-loader-validation", "ui-hud"],
         context="Externalized strings from day one (DATA-FR-024..026). Author `docs/35-Localization.md`.",
         deliverables=[
             "Locale selection, key resolution with default-locale fallback, and layout tolerance for length.",
             "A second sample locale to prove the pipeline.",
             "`docs/35-Localization.md`.",
         ],
         interface="A locale service resolving keys; UI/dialogue consume it; validation warns on missing keys.",
         acceptance=[
             "Switching locale changes all visible text; missing keys fall back and are reported (DATA-FR-025).",
             "No layout breaks with longer strings.",
         ],
         out_of_scope="Professional translation of the reference pack."),

    dict(slug="analytics-telemetry", title="Analytics and telemetry", phase=3,
         area="analytics", size="M", parallel=True, gate_human=True,
         deps=["core-event-bus"],
         context="Privacy-respecting insight into the experience. Author `docs/36-Analytics-and-Telemetry.md`.",
         deliverables=[
             "Opt-appropriate, privacy-first event capture derived from the event bus.",
             "A minimal funnel: first delight, first restoration, short-visit completion.",
             "`docs/36-Analytics-and-Telemetry.md` including a privacy section.",
         ],
         interface="A telemetry subscriber translating gameplay events into anonymized metrics.",
         acceptance=[
             "Key funnel events are captured without collecting personal data.",
             "Telemetry can be disabled and never blocks gameplay.",
         ],
         out_of_scope="Third-party ad/tracking integrations (prohibited)."),

    dict(slug="performance-budgets", title="Performance budgets and profiling", phase=3,
         area="perf", size="M", parallel=True, gate_human=False,
         deps=["rendering-system", "walking-skeleton"],
         context="Jank is a bug (NFR-VIS-002). Set and enforce budgets. Author `docs/33-Performance-Budgets.md`.",
         deliverables=[
             "Frame-time and load-time budgets for mid-range laptop and modern phone.",
             "A profiling overlay and a CI perf smoke test flagging regressions.",
             "`docs/33-Performance-Budgets.md` (resolves the fixed-step rate open question OQ-ARCH-1).",
         ],
         interface="Documented budgets, a profiling hook, and a perf check other issues must not regress.",
         acceptance=[
             "The walking skeleton and a sample scene meet the documented budgets on target profiles.",
             "A perf regression is caught by the CI smoke test.",
         ],
         out_of_scope="Micro-optimization beyond meeting budgets."),

    # ---------------------- Phase 4 — Delivery ----------------------
    dict(slug="deployment-hosting", title="Deployment and hosting", phase=4,
         area="deploy", size="M", parallel=True, gate_human=True,
         deps=["ci-quality-gate", "walking-skeleton"],
         context="Ship it. Author `docs/42-Deployment-and-Hosting.md`.",
         deliverables=[
             "Build-and-deploy pipeline producing a hostable artifact; asset delivery/CDN path.",
             "Preview deploys per PR where feasible.",
             "`docs/42-Deployment-and-Hosting.md`.",
         ],
         interface="A reproducible deploy from a green main; a public URL.",
         acceptance=[
             "Merging to main deploys a working build; a PR preview is reachable.",
             "First delight does not depend on large assets finishing download (Vision edge case).",
         ],
         out_of_scope="Multi-region infra; out of scope for v1."),

    dict(slug="observability-error-handling", title="Observability and error handling", phase=4,
         area="observability", size="M", parallel=True, gate_human=False,
         deps=["core-runtime-loop"],
         context="Harden runtime resilience (FR-ARCH-029..031). Author `docs/43-Observability-and-Error-Handling.md`.",
         deliverables=[
             "System-fault isolation surfaced with context; production-safe logging.",
             "The debug overlay hardened; an error boundary that keeps the world running.",
             "`docs/43-Observability-and-Error-Handling.md`.",
         ],
         interface="Centralized error reporting fed by the loop's fault isolation; toggled debug surfaces.",
         acceptance=[
             "An injected System fault is isolated, logged with context, and the world keeps running (FR-ARCH-029).",
             "The debug overlay does not alter behavior when disabled (FR-ARCH-031).",
         ],
         out_of_scope="Third-party APM integration (optional future)."),

    dict(slug="testing-hardening", title="Testing hardening", phase=4,
         area="testing", size="M", parallel=True, gate_human=False,
         deps=["ci-quality-gate", "walking-skeleton"],
         context="Raise the safety net that makes auto-merge trustworthy. Author `docs/41-Testing-Strategy.md`.",
         deliverables=[
             "Determinism/replay tests across systems, an end-to-end smoke path, and coverage gates.",
             "A content-invariant test asserting no career literals in engine and full pack validation.",
             "`docs/41-Testing-Strategy.md`.",
         ],
         interface="A test suite and coverage thresholds enforced by CI.",
         acceptance=[
             "Replay reproduces identical state across the integrated systems.",
             "Coverage thresholds and the content-invariant test are enforced in CI.",
         ],
         out_of_scope="Exhaustive fuzzing (future)."),

    dict(slug="onboarding-first-session", title="Onboarding and first session", phase=4,
         area="ui", size="M", parallel=True, gate_human=True,
         deps=["ui-hud", "reference-content-full"],
         context="Non-blocking guidance; first-minute delight (FR-VIS-009, NFR-VIS-006). Author `docs/19-Onboarding-and-First-Session.md`.",
         deliverables=[
             "Diegetic guidance so the player is never lost, with no modal tutorials or text walls.",
             "A tuned opening that delivers delight within the first minute.",
             "`docs/19-Onboarding-and-First-Session.md`.",
         ],
         interface="Onboarding cues driven by world state/events, not a separate tutorial mode.",
         acceptance=[
             "A first-time tester experiences clear delight within a minute and is never lost.",
             "No modal tutorial or text wall appears.",
         ],
         out_of_scope="Long-form help documentation."),

    dict(slug="launch-readiness", title="Launch readiness sweep", phase=4,
         area="testing", size="M", parallel=False, gate_human=True,
         deps=["reference-content-full", "accessibility", "performance-budgets",
               "deployment-hosting", "onboarding-first-session", "save-load-persistence"],
         context="The closer: verify the whole experience against the Vision acceptance criteria before calling v1 done.",
         deliverables=[
             "Run every acceptance criterion in `docs/01-Vision.md` against the built experience.",
             "Cross-browser and desktop/mobile verification of the short-visit path.",
             "A punch list of gaps filed as new issues; sign-off when the Vision criteria pass.",
         ],
         interface="A documented acceptance report mapping each Vision criterion to evidence.",
         acceptance=[
             "Every Vision acceptance criterion passes or has a filed, triaged exception.",
             "No screen anywhere presents a resume, job list, or biography as primary content (FR-VIS-006).",
             "Content-pack swap still yields a coherent different world (DATA-FR-029).",
         ],
         out_of_scope="Post-launch expansion (see `docs/45-Future-Expansion.md`)."),
]

# --------------------------------------------------------------------------- #
# Rendering
# --------------------------------------------------------------------------- #

def slugs_to_refs(slugs, numbers):
    if not slugs:
        return "_None — this issue is ready immediately._"
    return ", ".join(f"#{numbers[s]}" if s in numbers else f"`{s}`" for s in slugs)

def render_issue_body(issue, numbers):
    parallel = "yes" if issue["parallel"] else "no"
    gate = "  \n> WARNING **Merge gate:** human review required before merge." if issue["gate_human"] else ""
    deliverables = "\n".join(f"- {d}" for d in issue["deliverables"])
    acceptance = "\n".join(f"- [ ] {a}" for a in issue["acceptance"])
    deps = slugs_to_refs(issue["deps"], numbers)
    return f"""\
> **Phase:** {issue['phase']} - **Area:** `{issue['area']}` - **Size:** {issue['size']} - **Parallel-safe:** {parallel}{gate}

## Context
{issue['context']}

Read `docs/00-README.md`, `docs/01-Vision.md`, `docs/02-System-Architecture.md`, and `docs/03-Data-Model-and-Content-Pipeline.md` before starting. Follow the build loop in `CLAUDE.md`.

## Deliverables
{deliverables}

## Interface contract
{issue['interface']}

## Acceptance criteria
{acceptance}

## Dependencies
Depends on: {deps}

## Out of scope
{issue['out_of_scope']}

{DOD}"""

def render_epic_body(epic, child_issues, numbers):
    children = [i for i in child_issues if i["phase"] == epic["phase"]]
    checklist = "\n".join(
        f"- [ ] #{numbers[i['slug']]} {i['title']}" if i["slug"] in numbers else f"- [ ] `{i['slug']}` {i['title']}"
        for i in children
    )
    seq = ("This phase is **strictly sequential**: finish and merge one child before starting the next."
           if epic["phase"] == 0 else
           "Children are parallelizable across disjoint `area:` labels. Do not start the next phase until this epic is closed.")
    return f"""\
> **Phase {epic['phase']} tracking issue.**

{epic['summary']}

{seq}

## Child issues
{checklist}

## Exit criteria
- [ ] Every child issue above is closed.
- [ ] CI is green on `main`.
"""

# --------------------------------------------------------------------------- #
# gh helpers
# --------------------------------------------------------------------------- #

def run(cmd, dry_run, capture=False):
    if dry_run:
        print("[dry-run] " + " ".join(cmd[:6]) + (" ..." if len(cmd) > 6 else ""))
        return ""
    if capture:
        return subprocess.run(cmd, check=True, text=True, capture_output=True).stdout.strip()
    subprocess.run(cmd, check=True)
    return ""

def repo_args(repo):
    return ["--repo", repo] if repo else []

def ensure_milestones(repo, dry_run):
    for title, desc in MILESTONES:
        path = f"repos/{repo}/milestones" if repo else "repos/{owner}/{repo}/milestones"
        cmd = ["gh", "api", "--method", "POST", path, "-f", f"title={title}", "-f", f"description={desc}"]
        try:
            run(cmd, dry_run)
        except subprocess.CalledProcessError:
            print(f"  (milestone '{title}' may already exist; continuing)")

def ensure_labels(repo, dry_run):
    areas = sorted({i["area"] for i in ISSUES})
    labels = list(LABELS) + [(f"area:{a}", AREA_COLOR, f"Area: {a}") for a in areas]
    for name, color, desc in labels:
        cmd = ["gh", "label", "create", name, "--color", color, "--description", desc, "--force"] + repo_args(repo)
        try:
            run(cmd, dry_run)
        except subprocess.CalledProcessError:
            print(f"  (label '{name}' skipped; continuing)")

def issue_labels(issue):
    labels = ["type:build", f"phase:{issue['phase']}", f"area:{issue['area']}", f"size:{issue['size']}"]
    labels.append("status:ready" if not issue["deps"] else "status:blocked")
    if issue["parallel"]:
        labels.append("parallel-safe")
    if issue["gate_human"]:
        labels.append("gate:human")
    return labels

def milestone_title(phase):
    return MILESTONES[phase][0]

def create_issue(repo, title, body, labels, milestone, dry_run):
    cmd = ["gh", "issue", "create", "--title", title, "--body", body, "--milestone", milestone] + repo_args(repo)
    for l in labels:
        cmd += ["--label", l]
    if dry_run:
        print(f"[dry-run] create issue: {title}  labels={labels}")
        return None
    url = run(cmd, dry_run=False, capture=True)
    return int(url.rstrip("/").split("/")[-1])

def update_issue_body(repo, number, body, dry_run):
    run(["gh", "issue", "edit", str(number), "--body", body] + repo_args(repo), dry_run)

# --------------------------------------------------------------------------- #
# Ordering / validation
# --------------------------------------------------------------------------- #

def topo_order(issues):
    by_slug = {i["slug"]: i for i in issues}
    ordered, seen, stack = [], set(), set()
    def visit(i):
        if i["slug"] in seen:
            return
        if i["slug"] in stack:
            raise ValueError(f"dependency cycle at {i['slug']}")
        stack.add(i["slug"])
        for d in i["deps"]:
            if d in by_slug:
                visit(by_slug[d])
        stack.discard(i["slug"])
        seen.add(i["slug"])
        ordered.append(i)
    for i in issues:
        visit(i)
    return ordered

def validate():
    by_slug = {i["slug"]: i for i in ISSUES}
    problems = []
    for i in ISSUES:
        for d in i["deps"]:
            if d not in by_slug:
                problems.append(f"{i['slug']} depends on unknown '{d}'")
    try:
        order = [i["slug"] for i in topo_order(ISSUES)]
        for i in ISSUES:
            for d in i["deps"]:
                if d in by_slug and order.index(d) > order.index(i["slug"]):
                    problems.append(f"ordering violation: {i['slug']} before dep {d}")
    except ValueError as e:
        problems.append(str(e))
    return problems

# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def print_plan():
    problems = validate()
    print(f"Epics: {len(EPICS)} | Build issues: {len(ISSUES)}")
    for phase in range(5):
        ps = [i for i in ISSUES if i["phase"] == phase]
        print(f"\n--- {milestone_title(phase)} ({len(ps)} issues) ---")
        for i in ps:
            dep = ", ".join(i["deps"]) or "-"
            flags = ("PARALLEL " if i["parallel"] else "") + ("GATE" if i["gate_human"] else "")
            print(f"  [{i['size']}] {i['slug']:<28} {flags:<14} deps: {dep}")
    print("\nValidation:", "OK - no cycles or dangling deps" if not problems else "PROBLEMS:")
    for p in problems:
        print("  -", p)
    return 0 if not problems else 1

def main():
    ap = argparse.ArgumentParser(description="Bootstrap Resume.World GitHub issues.")
    ap.add_argument("--repo", help="owner/name (default: current directory's repo)")
    ap.add_argument("--dry-run", action="store_true", help="print gh actions without calling GitHub")
    ap.add_argument("--print-plan", action="store_true", help="print the issue/dependency plan and exit")
    args = ap.parse_args()

    if args.print_plan:
        sys.exit(print_plan())

    problems = validate()
    if problems:
        print("Refusing to run: dependency graph has problems:")
        for p in problems:
            print("  -", p)
        sys.exit(1)

    print(f"Resume.World bootstrap - {'DRY RUN' if args.dry_run else 'LIVE'}")
    print(f"Epics: {len(EPICS)}  Build issues: {len(ISSUES)}\n")

    print("== Milestones ==")
    ensure_milestones(args.repo, args.dry_run)
    print("\n== Labels ==")
    ensure_labels(args.repo, args.dry_run)

    numbers = {}
    print("\n== Pass 1: create epics ==")
    for epic in EPICS:
        body = render_epic_body(epic, ISSUES, numbers)
        n = create_issue(args.repo, epic["title"], body, ["type:epic", f"phase:{epic['phase']}"],
                          milestone_title(epic["phase"]), args.dry_run)
        if n:
            numbers[epic["slug"]] = n

    print("\n== Pass 1: create build issues (dependency order) ==")
    for issue in topo_order(ISSUES):
        body = render_issue_body(issue, numbers)
        n = create_issue(args.repo, issue["title"], body, issue_labels(issue),
                          milestone_title(issue["phase"]), args.dry_run)
        if n:
            numbers[issue["slug"]] = n

    if args.dry_run:
        print("\n[dry-run] Skipping pass 2 (dependency/epic rewrite).")
        return

    print("\n== Pass 2: resolve dependency references ==")
    for issue in ISSUES:
        update_issue_body(args.repo, numbers[issue["slug"]], render_issue_body(issue, numbers), args.dry_run)
    for epic in EPICS:
        update_issue_body(args.repo, numbers[epic["slug"]], render_epic_body(epic, ISSUES, numbers), args.dry_run)

    print(f"\nDone. Created {len(EPICS)} epics and {len(ISSUES)} build issues.")

if __name__ == "__main__":
    main()
