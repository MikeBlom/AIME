/**
 * NPC and Behavior System suite (issue #27): data-driven routines walked
 * deterministically — idle / move-to / patrol from content, shifting on
 * day/night phase change (AC1) — and the interaction affordance that
 * starts dialogue through the real Dialogue System (AC2).
 */
import { describe, expect, it } from 'vitest';
import type { EntityId, SystemContext } from '../core';
import { deepFreeze, EntityStore, EventBus, RngService, TimeService } from '../core';
import { TIME_PHASE_CHANGED } from './audio';
import { createDialogueSystem, DIALOGUE, DIALOGUE_STARTED } from './dialogue';
import { INTENT_INTERACT } from './input';
import type { NpcRoutineEntry } from './npc';
import {
  createNpcSystem,
  DEFAULT_NPC_SPEED,
  NPC,
  NPC_BEHAVIOR,
  NPC_INTERACT_RADIUS,
  NPC_INTERACTED,
} from './npc';
import { IDLE_MOTION, MOTION, PLAYER_CONTROLLED, POSITION } from './scene';
import { IDLE_UI_STATE, UI_STATE } from './ui';

const DT = 1 / 60;

function makeContext(): SystemContext {
  return {
    world: new EntityStore(),
    events: new EventBus({ logEnabled: true }),
    scheduler: { schedule: (task: () => void) => task() },
    platform: {},
    time: new TimeService(DT),
    rng: new RngService(1),
    input: { current: deepFreeze({}) },
  };
}

function spawnNpc(
  context: SystemContext,
  routine: readonly NpcRoutineEntry[],
  options: { x?: number; y?: number; dialogueRef?: string | null } = {},
) {
  const npc = context.world.createEntity();
  context.world.addComponent(npc, POSITION, { x: options.x ?? 100, y: options.y ?? 100 });
  context.world.addComponent(npc, MOTION, IDLE_MOTION);
  context.world.addComponent(npc, NPC, {
    npcId: 'npc.test-subject',
    dialogueRef: options.dialogueRef ?? null,
    routine,
  });
  return npc;
}

function spawnPlayer(context: SystemContext, x: number, y: number) {
  const player = context.world.createEntity();
  context.world.addComponent(player, POSITION, { x, y });
  context.world.addComponent(player, PLAYER_CONTROLLED, { speed: 60 });
  return player;
}

const positionOf = (context: SystemContext, entity: EntityId) =>
  context.world.getComponent(entity, POSITION);
const motionOf = (context: SystemContext, entity: EntityId) =>
  context.world.getComponent(entity, MOTION);

describe('routine behaviors (deliverable: composable idle / move-to / patrol)', () => {
  it('walks toward the active waypoint at the routine speed, writing motion', () => {
    const context = makeContext();
    const system = createNpcSystem();
    system.init(context);
    const npc = spawnNpc(context, [{ phase: 'day', waypoints: [{ x: 140, y: 100 }], speed: 30 }]);

    system.update(DT, context);
    const position = positionOf(context, npc);
    const motion = motionOf(context, npc);
    expect(position?.x).toBeCloseTo(100 + 30 * DT, 10);
    expect(position?.y).toBe(100);
    expect(motion?.moving).toBe(true);
    expect(motion?.velocityX).toBe(30);
    expect(motion?.facingX).toBe(1);
  });

  it('move-to: a single waypoint is walked to exactly, then held (no orbit)', () => {
    const context = makeContext();
    const system = createNpcSystem();
    system.init(context);
    const npc = spawnNpc(context, [{ phase: 'day', waypoints: [{ x: 103, y: 100 }], speed: 60 }]);

    for (let i = 0; i < 10; i += 1) system.update(DT, context);
    expect(positionOf(context, npc)).toEqual({ x: 103, y: 100 });
    const rest = motionOf(context, npc);
    expect(rest?.moving).toBe(false);
    expect(rest?.velocityX).toBe(0);
    // Facing holds the walk direction so the character keeps looking there.
    expect(rest?.facingX).toBe(1);
  });

  it('patrol: several waypoints loop indefinitely (AC1: routines followed)', () => {
    const context = makeContext();
    const system = createNpcSystem();
    system.init(context);
    const npc = spawnNpc(
      context,
      [
        {
          phase: 'day',
          waypoints: [
            { x: 104, y: 100 },
            { x: 100, y: 100 },
          ],
          speed: 60,
        },
      ],
      { x: 100, y: 100 },
    );

    // Walk to the first waypoint (4 units at 1 unit/step), arrive, advance,
    // walk back, and keep cycling — record each waypoint arrival.
    const visits: number[] = [];
    let lastIndex = 0;
    for (let i = 0; i < 40; i += 1) {
      system.update(DT, context);
      const index = context.world.getComponent(npc, NPC_BEHAVIOR)?.waypointIndex ?? 0;
      if (index !== lastIndex) visits.push(index);
      lastIndex = index;
    }
    expect(visits.length).toBeGreaterThanOrEqual(3); // looped, not a one-way trip
    expect(visits.slice(0, 3)).toEqual([1, 0, 1]);
  });

  it('idles without a routine, with an empty routine, and with no waypoints', () => {
    const context = makeContext();
    const system = createNpcSystem();
    system.init(context);
    const bare = spawnNpc(context, []);
    const resting = spawnNpc(context, [{ phase: 'day', waypoints: [], speed: null }]);

    for (let i = 0; i < 5; i += 1) system.update(DT, context);
    expect(positionOf(context, bare)).toEqual({ x: 100, y: 100 });
    expect(positionOf(context, resting)).toEqual({ x: 100, y: 100 });
    expect(motionOf(context, bare)?.moving).toBe(false);
  });

  it('uses the engine default speed when the entry declares none', () => {
    const context = makeContext();
    const system = createNpcSystem();
    system.init(context);
    const npc = spawnNpc(context, [{ phase: 'day', waypoints: [{ x: 200, y: 100 }], speed: null }]);
    system.update(DT, context);
    expect(motionOf(context, npc)?.velocityX).toBe(DEFAULT_NPC_SPEED);
  });
});

describe('day/night phase shifts (AC1: routines shift on phase change)', () => {
  const ROUTINE: readonly NpcRoutineEntry[] = [
    {
      phase: 'day',
      waypoints: [
        { x: 140, y: 100 },
        { x: 100, y: 100 },
      ],
      speed: 30,
    },
    { phase: 'night', waypoints: [], speed: null },
  ];

  it('switches the active entry when the world clock announces a phase', () => {
    const context = makeContext();
    const system = createNpcSystem();
    system.init(context);
    const npc = spawnNpc(context, ROUTINE);

    // Before any phase: the first entry applies — the day patrol walks.
    system.update(DT, context);
    expect(motionOf(context, npc)?.moving).toBe(true);

    context.events.publish(TIME_PHASE_CHANGED, { phase: 'night' });
    context.events.flushDeferred();
    system.update(DT, context);
    const night = motionOf(context, npc);
    expect(night?.moving).toBe(false); // night entry is a rest
    expect(context.world.getComponent(npc, NPC_BEHAVIOR)?.phase).toBe('night');

    context.events.publish(TIME_PHASE_CHANGED, { phase: 'day' });
    context.events.flushDeferred();
    system.update(DT, context);
    // Back on the day patrol, restarted from the first waypoint.
    expect(motionOf(context, npc)?.moving).toBe(true);
    expect(context.world.getComponent(npc, NPC_BEHAVIOR)?.waypointIndex).toBe(0);
  });

  it('an unknown phase falls back to the first entry (never undefined)', () => {
    const context = makeContext();
    const system = createNpcSystem();
    system.init(context);
    const npc = spawnNpc(context, ROUTINE);
    context.events.publish(TIME_PHASE_CHANGED, { phase: 'dusk' });
    context.events.flushDeferred();
    system.update(DT, context);
    expect(motionOf(context, npc)?.moving).toBe(true); // day entry applies
  });
});

describe('interaction affordance (AC2: interact starts dialogue / advances quests)', () => {
  function spawnDialogue(context: SystemContext, dialogueId: string) {
    const entity = context.world.createEntity();
    context.world.addComponent(entity, DIALOGUE, {
      dialogueId,
      nodes: [{ id: 'n1', textKey: 'k.n1', end: true, choices: [], resolves: null }],
    });
  }

  it('a press within range announces npc.interacted and starts the dialogue', () => {
    const context = makeContext();
    const npcSystem = createNpcSystem();
    const dialogueSystem = createDialogueSystem();
    npcSystem.init(context);
    dialogueSystem.init(context);
    spawnDialogue(context, 'dialogue.hello');
    spawnNpc(context, [], { x: 110, y: 100, dialogueRef: 'dialogue.hello' });
    spawnPlayer(context, 100, 100);

    const interacted: unknown[] = [];
    const started: unknown[] = [];
    context.events.subscribe(NPC_INTERACTED, (event) => interacted.push(event.payload));
    context.events.subscribe(DIALOGUE_STARTED, (event) => started.push(event.payload));

    context.events.publish(INTENT_INTERACT, {});
    context.events.flushDeferred(); // intent reaches the buffered System
    npcSystem.update(DT, context);
    context.events.flushDeferred(); // deferred request reaches Dialogue
    context.events.flushDeferred(); // Dialogue's own deferred announcements land

    expect(interacted).toEqual([
      { entityId: expect.any(Number), npcId: 'npc.test-subject', dialogueId: 'dialogue.hello' },
    ]);
    expect(started).toEqual([{ dialogueId: 'dialogue.hello', nodeId: 'n1' }]);
  });

  it('a press out of range does nothing', () => {
    const context = makeContext();
    const system = createNpcSystem();
    system.init(context);
    spawnNpc(context, [], { x: 100 + NPC_INTERACT_RADIUS + 1, y: 100, dialogueRef: 'dialogue.x' });
    spawnPlayer(context, 100, 100);

    const interacted: unknown[] = [];
    context.events.subscribe(NPC_INTERACTED, (event) => interacted.push(event.payload));
    context.events.publish(INTENT_INTERACT, {});
    context.events.flushDeferred();
    system.update(DT, context);
    context.events.flushDeferred();
    expect(interacted).toEqual([]);
  });

  it('ignores the press while the UI surface is modal (the surface owns it)', () => {
    const context = makeContext();
    const system = createNpcSystem();
    system.init(context);
    spawnNpc(context, [], { x: 110, y: 100, dialogueRef: 'dialogue.hello' });
    spawnPlayer(context, 100, 100);
    const ui = context.world.createEntity();
    context.world.addComponent(ui, UI_STATE, { ...IDLE_UI_STATE, modal: true });

    const interacted: unknown[] = [];
    context.events.subscribe(NPC_INTERACTED, (event) => interacted.push(event.payload));
    context.events.publish(INTENT_INTERACT, {});
    context.events.flushDeferred();
    system.update(DT, context);
    context.events.flushDeferred();
    expect(interacted).toEqual([]);
  });

  it('routes the press to the nearest character; announces even without dialogue', () => {
    const context = makeContext();
    const system = createNpcSystem();
    system.init(context);
    spawnNpc(context, [], { x: 120, y: 100, dialogueRef: 'dialogue.far' });
    const near = spawnNpc(context, [], { x: 108, y: 100, dialogueRef: null });
    spawnPlayer(context, 100, 100);

    const interacted: { entityId: number; dialogueId: string | null }[] = [];
    context.events.subscribe(NPC_INTERACTED, (event) =>
      interacted.push({ entityId: event.payload.entityId, dialogueId: event.payload.dialogueId }),
    );
    context.events.publish(INTENT_INTERACT, {});
    context.events.flushDeferred();
    system.update(DT, context);
    context.events.flushDeferred();
    expect(interacted).toEqual([{ entityId: near, dialogueId: null }]);
  });
});

describe('determinism (NFR-NPC-001)', () => {
  it('identical dt and event sequences reproduce identical walks', () => {
    const run = () => {
      const context = makeContext();
      const system = createNpcSystem();
      system.init(context);
      const npc = spawnNpc(context, [
        {
          phase: 'day',
          waypoints: [
            { x: 137, y: 91 },
            { x: 84, y: 123 },
          ],
          speed: 33,
        },
      ]);
      for (let i = 0; i < 25; i += 1) {
        if (i === 10) {
          context.events.publish(TIME_PHASE_CHANGED, { phase: 'day' });
          context.events.flushDeferred();
        }
        system.update(DT, context);
      }
      return positionOf(context, npc);
    };
    expect(run()).toEqual(run());
  });
});
