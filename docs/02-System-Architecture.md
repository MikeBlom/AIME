# Resume.World — System Architecture

**Version:** 1.0
**Author:** Mike Blom
**Document ID:** ARCH

---

## Purpose

This document defines the engine's shape: how the runtime is organized, how systems communicate, how modules are loaded and replaced, and how the whole thing ticks each frame. It is deliberately **stack-agnostic**. It specifies interfaces, contracts, and behavior, not a language, framework, or rendering library. Any implementation that satisfies these contracts is conformant.

## Overview

Resume.World is a **data-driven, composition-first, event-driven engine**. It holds no career knowledge. It loads a Content Pack (see `03-Data-Model-and-Content-Pipeline.md`), builds a world from that data, and runs a deterministic update loop over a set of decoupled **Systems** that communicate through an **event bus** and operate on **entities** made of **components**.

The architecture optimizes for one property above all: **replaceability**. Every system can be swapped for another that honors the same interface. Every piece of content can be swapped without touching code. This is what makes the engine a general-purpose "portfolio-as-a-game" engine rather than one person's website.

Three ideas carry the design:

1. **Composition over inheritance.** Behavior is assembled from small components and systems, not derived through deep class hierarchies.
2. **Events over coupling.** Systems announce facts and react to facts; they do not call each other directly.
3. **Data over code.** What the world contains is data; how the world behaves is code; the two never mix.

## Goals

- Provide a clean, documented interface for every System so implementations are interchangeable.
- Keep Systems decoupled through an event bus and a shared, queryable world state.
- Make module loading, ordering, and teardown explicit and deterministic.
- Support hot-reloading of content and, where feasible, of Systems, for a fast authoring loop.
- Keep the engine free of any career-specific knowledge.
- Make the update loop deterministic and testable, with time as an explicit input.

## Non-Goals

- Choosing a rendering technology, physics library, or programming language. Those are implementation decisions constrained, not made, here.
- Specifying the *content* of any System's behavior (quests, dialogue, art). Those live in their own system documents and in the Content Pack.
- Networking or multiplayer. Resume.World is single-player and (beyond content delivery and optional telemetry) offline-capable. Multiplayer is explicitly a future consideration.

## Architectural Layers

The engine is organized in four layers. Dependencies point downward only; a lower layer MUST NOT know about a higher one.

1. **Platform Adapter (bottom).** The only layer that touches the host environment: the render surface, the input devices, the audio output, timers, storage, and networking for content/telemetry. It exposes these as narrow interfaces so the rest of the engine is host-agnostic. Swapping the platform (e.g., a different render backend or a native shell) touches only this layer.
2. **Core.** The world state container, the entity/component store, the event bus, the module registry, the scheduler, and the main loop. Core knows nothing about *what* systems do, only how to host them.
3. **Systems.** The interchangeable modules that give the world behavior: Rendering, Input, Camera, Movement, Physics/Collision, Animation, Audio, World Simulation, NPC/Behavior, Quest, Dialogue, Inventory/Progression, Achievements, UI/HUD, Save/Load, Analytics, and the Mini-Games host. Each is specified in its own document; each conforms to the System interface below.
4. **Content (top, but data not code).** The Content Pack loaded at runtime. It parameterizes Systems but contains no logic. Formally specified in `03-Data-Model-and-Content-Pipeline.md`.

## Core Concepts

### Entities and Components

The world is a set of **entities**. An entity is an identity (a stable id) with a bag of **components** attached. A component is plain data (position, sprite reference, interaction affordance, quest binding, etc.) with no behavior. Entities gain capabilities by composition: attach a component and the relevant System begins acting on it.

- **FR-ARCH-001** An entity MUST be uniquely and stably identified for the lifetime of a Session, and its id MUST be serializable for save/load.
- **FR-ARCH-002** Components MUST be data-only. Any logic that reads or mutates components MUST live in a System, never in the component itself.
- **FR-ARCH-003** The Core MUST provide efficient queries over entities by component composition (e.g., "all entities with Position and Renderable"), so Systems can iterate only what concerns them.
- **FR-ARCH-004** Component types MUST be open for extension by content-referenced Systems and plugins without modifying Core.

### Systems

A **System** is a self-contained module with a defined lifecycle and a single responsibility. Systems never hold references to each other; they read shared world state and communicate through the event bus.

Every System MUST implement this conceptual interface (names illustrative; the contract is what binds):

- `id` — a unique, stable string identifier.
- `dependencies` — the set of capabilities or events this System needs, used for load ordering.
- `init(context)` — one-time setup; receives a **Context** granting access to world state, the event bus, the scheduler, and platform interfaces. MUST NOT assume any other System has run yet beyond its declared dependencies.
- `update(dt, context)` — called each tick with the elapsed simulation time `dt`. MUST be pure with respect to inputs it is given: same world state plus same `dt` plus same events yields the same result.
- `teardown(context)` — release resources; MUST leave world state consistent so the System can be re-initialized (this is what enables hot-reload).

Requirements:

- **FR-ARCH-005** Systems MUST communicate only via the event bus and shared world-state queries. A System MUST NOT hold a direct reference to another System instance.
- **FR-ARCH-006** Each System MUST declare its dependencies so the Core can compute a valid initialization and update order (see Scheduling).
- **FR-ARCH-007** A System MUST be replaceable by any other System sharing its `id`-class contract without changes to Core or to other Systems.
- **FR-ARCH-008** A System MUST tolerate the absence of optional collaborators: if an event it would emit has no listeners, or an optional System is not loaded, it MUST degrade gracefully rather than fail.

### The Event Bus

Systems coordinate by publishing and subscribing to typed **events**. An event is an immutable data record with a type and a payload (e.g., `SystemRestored { regionId }`, `PlayerInteracted { entityId }`, `TimeOfDayChanged { phase }`).

- **FR-ARCH-009** The event bus MUST support typed publish/subscribe with many subscribers per event type.
- **FR-ARCH-010** Event delivery within a tick MUST be deterministic: for a given tick, subscribers to a given event type MUST be invoked in a defined, stable order.
- **FR-ARCH-011** Events MUST be immutable; a subscriber MUST NOT mutate an event to influence later subscribers. Coordination happens by publishing new events or mutating world state through defined channels.
- **FR-ARCH-012** The bus MUST distinguish **immediate** events (delivered within the current tick's event phase) from **deferred/queued** events (delivered at the next tick boundary), so systems can avoid mid-iteration surprises. Systems SHOULD prefer deferred events for cross-system effects.
- **FR-ARCH-013** Event publication and delivery MUST be observable for debugging (an event log) without changing behavior, supporting `43-Observability-and-Error-Handling.md`.

### World State

There is a single authoritative **world state**: the entity/component store plus a small set of global, namespaced blackboard values (time of day, weather, restoration progress, active region). Systems read freely and write only to the slices they own.

- **FR-ARCH-014** World state MUST be the single source of truth. Systems MUST NOT keep private shadow copies of shared state that can drift.
- **FR-ARCH-015** Ownership of each writable slice MUST be assigned to exactly one System. Other Systems request changes via events; they do not write another System's slice directly.
- **FR-ARCH-016** World state relevant to progression MUST be fully serializable to support save/load (`32-Save-Load-and-Persistence.md`) and MUST round-trip without loss.

### Modules and Plugins

Systems are registered with the Core through a **module registry**. A **plugin** is a bundle of one or more Systems (and optionally component types and event types) that can be added or removed as a unit. This is how Mini-Games, for example, are integrated: each mini-game is a plugin that registers a System honoring the Mini-Games host contract.

- **FR-ARCH-017** The Core MUST load Systems from a declarative registry (data), not from hardcoded wiring, so the set of active Systems is configurable per build and per Content Pack.
- **FR-ARCH-018** A plugin MUST be able to register new component types, event types, and Systems without modifying Core or other plugins.
- **FR-ARCH-019** Adding or removing a plugin MUST NOT require changes to unrelated Systems, satisfying the composition principle.
- **FR-ARCH-020** Plugins MUST declare their dependencies and MUST fail to load loudly and safely (with a clear diagnostic) if a dependency is missing, rather than corrupting the runtime.

## The Runtime Loop

The engine runs a fixed-order, variable-rate loop. Time is an explicit input so the loop is deterministic and testable.

Each frame proceeds in defined phases:

1. **Time** — compute `dt` from the platform clock; advance a fixed-step accumulator for simulation.
2. **Input** — the Input System snapshots device state into intent events; input is sampled once per frame into an immutable snapshot.
3. **Simulation (fixed step)** — for each accumulated fixed step, deliver queued events, then run gameplay Systems (Movement, Physics/Collision, World Simulation, NPC/Behavior, Quest, etc.) in dependency order. Fixed-step simulation keeps behavior stable across frame rates.
4. **Late update** — Systems that must run after simulation settles (e.g., Camera following the resolved player position).
5. **Presentation (variable step)** — Animation interpolates, then Rendering draws, then Audio mixes. Presentation MAY run with interpolation between fixed steps for smoothness.
6. **Deferred events flush** — queued events produced this frame are handed to the next frame's simulation phase.

Requirements:

- **FR-ARCH-021** Gameplay simulation MUST use a fixed timestep so behavior is frame-rate independent and reproducible; rendering MAY interpolate for smoothness.
- **FR-ARCH-022** The loop MUST clamp catch-up (a maximum number of fixed steps per frame) to prevent a "spiral of death" after a long stall (e.g., a backgrounded tab).
- **FR-ARCH-023** Input MUST be sampled into an immutable per-frame snapshot before simulation reads it, so all Systems observe identical input for a frame.
- **FR-ARCH-024** The loop MUST pause simulation cleanly when the experience loses focus or visibility, and resume without a time spike.
- **FR-ARCH-025** Given identical initial world state, content, input sequence, and `dt` sequence, the simulation MUST produce identical results (determinism), enabling record/replay testing.

## Scheduling and Ordering

The Core computes System order from declared dependencies.

- **FR-ARCH-026** The Core MUST derive a valid update order via topological sort of System dependencies and MUST detect and reject dependency cycles at load time with a clear error.
- **FR-ARCH-027** Where dependencies leave order ambiguous, the Core MUST apply a stable tiebreak (e.g., registration order) so ordering is reproducible.
- **FR-ARCH-028** Long-running work (asset loads, content parsing) MUST be schedulable off the critical simulation path so the loop does not stall; results are delivered back via events.

## Error Handling and Resilience

- **FR-ARCH-029** A failure inside one System's `update` MUST be isolated: the Core MUST catch it, log it with context, and continue running other Systems rather than crashing the world.
- **FR-ARCH-030** A malformed Content Pack MUST be rejected at load with actionable diagnostics (see `03`), never partially applied to produce an incoherent world.
- **FR-ARCH-031** The engine MUST expose a debug overlay/hooks surface for the event log, active Systems, frame timing, and entity inspection, without altering behavior when disabled.

## Non-Functional Requirements

- **NFR-ARCH-001 (Determinism):** The simulation is deterministic given identical inputs; all nondeterministic sources (wall-clock, randomness) are injected through Core services and seedable.
- **NFR-ARCH-002 (Testability):** Every System is unit-testable in isolation by constructing a Context with a fake world state and event bus; the loop is testable by feeding a scripted `dt` and input sequence.
- **NFR-ARCH-003 (Performance):** Core dispatch, event delivery, and entity queries MUST not be the bottleneck; per-frame allocations in the hot path SHOULD be minimized. Concrete budgets live in `33-Performance-Budgets.md`.
- **NFR-ARCH-004 (Portability):** All host coupling is confined to the Platform Adapter; porting to a new host is a Platform Adapter task, not an engine rewrite.
- **NFR-ARCH-005 (Extensibility):** New component types, events, Systems, and plugins are added without editing Core.
- **NFR-ARCH-006 (Observability):** The runtime is inspectable in development builds: event log, System timings, and world-state snapshots are available.
- **NFR-ARCH-007 (Content isolation):** A static check or test MUST be able to assert that engine code contains no career-specific literals; all such data comes from the Content Pack.

## User Stories

- *As an engine developer,* I want to add a new System by implementing one interface and registering it, so that extending the world does not mean surgery on existing code.
- *As a mini-game author,* I want to ship my game as a plugin that registers cleanly, so that I never touch the Core to add content behavior.
- *As a tester,* I want to replay a recorded input sequence and get identical world state, so that gameplay bugs are reproducible.
- *As a performance engineer,* I want per-System frame timings, so that I can find the expensive System without guessing.
- *As a content author,* I want to hot-reload the Content Pack and see the world change without restarting, so that iteration is fast.

## Acceptance Criteria

- A new "hello world" System can be added and registered with zero changes to Core or other Systems, and it receives `init`/`update`/`teardown` correctly.
- Removing a non-essential plugin leaves the rest of the world fully functional (graceful degradation per FR-ARCH-008).
- A recorded session (content + input + dt sequence) replays to a bit-identical final world state (FR-ARCH-025).
- Injecting a fault into one System's `update` produces a logged error and a still-running world (FR-ARCH-029).
- A dependency cycle among Systems is rejected at load with a clear diagnostic naming the cycle (FR-ARCH-026).
- A static check confirms no career-specific string literals exist in engine code (NFR-ARCH-007).
- Backgrounding and refocusing the experience does not produce a time spike or a physics explosion (FR-ARCH-022, FR-ARCH-024).

## Dependencies

- `01-Vision.md` — the experience these mechanisms serve; the pillars constrain what "graceful degradation" and "polish" mean.
- `03-Data-Model-and-Content-Pipeline.md` — defines the Content Pack this engine loads and the load-time validation referenced in FR-ARCH-030.
- Every System document (10–49) is a consumer of this contract; each specifies a conformant System.

## Implementation Notes (non-normative)

- The entity/component store may be implemented as archetype tables, sparse sets, or maps; the contract only requires efficient composition queries (FR-ARCH-003). Choose per performance profiling.
- The event bus deterministic ordering (FR-ARCH-010) is easiest to guarantee with subscriber priority tiers plus stable registration order as tiebreak.
- Fixed-step simulation with interpolated rendering (FR-ARCH-021) is the standard game-loop pattern; a fixed step around a common simulation rate with render interpolation is a reasonable default, tuned in `33`.
- Hot-reload of Systems (beyond content) is valuable but harder than content hot-reload; if the chosen stack makes System hot-reload costly, content hot-reload is the required baseline and System hot-reload is a MAY.
- Randomness must flow through a seedable Core service so replays are deterministic (NFR-ARCH-001).

## Edge Cases

- **A System publishes an event during another System's iteration.** Deferred delivery (FR-ARCH-012) prevents mid-iteration mutation surprises; immediate delivery is reserved for cases proven safe.
- **Two Systems both want to own a state slice.** Rejected: ownership is exclusive (FR-ARCH-015). The design must assign the slice to one and route the other through events.
- **A plugin declares a dependency that is not loaded.** Load fails loudly with a diagnostic (FR-ARCH-020); the runtime does not start in a half-wired state.
- **A very long frame** (tab backgrounded for minutes). Catch-up is clamped (FR-ARCH-022); simulation resumes without replaying every missed step.
- **Content references a component type from a plugin that is absent.** Load validation (FR-ARCH-030, and `03`) catches it before the world is built.

## Risks

- **Over-engineering the ECS.** A maximalist entity/component framework can outweigh the game's actual needs. Mitigation: implement the smallest store that satisfies the query contract; grow only under profiling pressure.
- **Event-bus spaghetti.** Fully decoupled systems can become hard to trace. Mitigation: the observable event log (FR-ARCH-013) and named, typed events keep coordination legible.
- **Determinism erosion.** A single un-seeded random call or wall-clock read breaks replay. Mitigation: NFR-ARCH-001 routes all such sources through Core; a test asserts no direct platform time/random use in Systems.
- **Hot-reload complexity.** Reloading live Systems can corrupt state. Mitigation: require clean `teardown` (FR-ARCH-005 lifecycle) and treat System hot-reload as optional.

## Open Questions

- **OQ-ARCH-1:** Fixed simulation rate value — deferred to `33-Performance-Budgets.md` once target devices are profiled.
- **OQ-ARCH-2:** Whether the event bus needs typed channels/namespaces beyond a flat type registry, decided when the number of event types is known.
- **OQ-ARCH-3:** Extent of System-level hot-reload support, gated by the eventual stack choice.
- **OQ-ARCH-4:** Whether presentation Systems (Render/Audio) share the same registry/lifecycle as simulation Systems or use a parallel presentation registry.

## Future Considerations

- A worker/thread offload path for heavy Systems if profiling demands it, expressed through the scheduler (FR-ARCH-028) so Systems need not change.
- An optional networked content-delivery layer in the Platform Adapter for streaming large worlds.
- Multiplayer or shared-world experiences would require a networking layer and a rethink of world-state ownership; explicitly out of scope for v1 but not precluded by this design.

## Version / Author

Version 1.0 — Mike Blom.
