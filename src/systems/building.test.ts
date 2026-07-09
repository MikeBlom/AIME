/**
 * Buildings and Interiors System suite (issue #30): content-declared
 * interiors entered and left through doorway triggers with a fade
 * transition (AC1), interior geometry, collision, occupancy, and
 * interaction points defined entirely by content (AC2), and the space
 * partition every spatial system honors.
 */
import { describe, expect, it } from 'vitest';
import type { EntityId, SystemContext } from '../core';
import { deepFreeze, EntityStore, EventBus, RngService, TimeService } from '../core';
import type { InteriorDefinition } from './building';
import {
  BUILDING,
  BUILDING_ENTERED,
  BUILDING_EXITED,
  createBuildingSystem,
  DOORWAY,
  DOORWAY_SIZE,
  INTERACTION_POINT,
  interiorOrigin,
  interiorSpawn,
  readInterior,
  TRANSITION_SECONDS,
  WALL_THICKNESS,
} from './building';
import { createHeadlessPlatform } from '../platform';
import { COLLIDER, physicsSystem, TRIGGER_OCCUPANCY } from './physics';
import { renderFrame } from './render';
import {
  ACTIVE_SPACE,
  IDLE_MOTION,
  MOTION,
  PLAYER_CONTROLLED,
  POSITION,
  RENDERABLE,
  SPACE,
  SPACE_EXTERIOR,
} from './scene';
import { createNpcSystem, NPC, NPC_INTERACTED } from './npc';
import { INTENT_INTERACT } from './input';
import { createUiSystem, UI_HINT, UI_STATE } from './ui';

const DT = 1 / 60;
/** Fixed steps to run a transition start-to-finish, with margin. */
const FADE_STEPS = Math.ceil(TRANSITION_SECONDS / DT) + 2;

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

const TEST_INTERIOR: InteriorDefinition = {
  width: 160,
  height: 110,
  spawnX: 80,
  spawnY: 88,
  colliders: [{ x: 80, y: 26, width: 48, height: 12 }],
  points: [
    { pointId: 'point.console', hintKey: 'building.test-house.point.console', x: 80, y: 40 },
  ],
};

function spawnBuilding(
  context: SystemContext,
  interior: InteriorDefinition | null,
  at = { x: 160, y: 60 },
) {
  const building = context.world.createEntity();
  context.world.addComponent(building, POSITION, at);
  context.world.addComponent(building, RENDERABLE, { kind: 'building', width: 34, height: 24 });
  context.world.addComponent(building, COLLIDER, { width: 34, height: 24, mode: 'solid' });
  context.world.addComponent(building, BUILDING, {
    buildingId: 'building.test-house',
    interior,
  });
  return building;
}

function spawnPlayer(context: SystemContext, x: number, y: number) {
  const player = context.world.createEntity();
  context.world.addComponent(player, POSITION, { x, y });
  context.world.addComponent(player, PLAYER_CONTROLLED, { speed: 96 });
  context.world.addComponent(player, MOTION, IDLE_MOTION);
  context.world.addComponent(player, COLLIDER, { width: 10, height: 10, mode: 'solid' });
  return player;
}

const activeSpace = (context: SystemContext) => {
  for (const entity of context.world.query(ACTIVE_SPACE)) {
    const value = context.world.getComponent(entity, ACTIVE_SPACE);
    if (value !== undefined) return value;
  }
  return undefined;
};

const doorwayOf = (context: SystemContext, role: 'entry' | 'exit'): EntityId | undefined =>
  context.world
    .query(DOORWAY)
    .find((entity) => context.world.getComponent(entity, DOORWAY)?.role === role);

/** One runtime step as the loop runs it: flush deferred, physics, building. */
function step(context: SystemContext, building: ReturnType<typeof createBuildingSystem>) {
  context.events.flushDeferred();
  physicsSystem.update(DT, context);
  building.update(DT, context);
}

describe('readInterior (content seam, FR-BLD-001)', () => {
  it('parses a full interior block, dropping malformed entries', () => {
    const interior = readInterior({
      size: { width: 120, height: 90 },
      spawn: { x: 60, y: 70 },
      colliders: [
        { x: 30, y: 30, width: 10, height: 10 },
        { x: 'bad', y: 0, width: 1, height: 1 },
      ],
      points: [
        { id: 'point.desk', hintKey: 'building.b.point.desk', x: 40, y: 40 },
        { id: 'point.broken', x: 1, y: 1 },
      ],
    });
    expect(interior).toEqual({
      width: 120,
      height: 90,
      spawnX: 60,
      spawnY: 70,
      colliders: [{ x: 30, y: 30, width: 10, height: 10 }],
      points: [{ pointId: 'point.desk', hintKey: 'building.b.point.desk', x: 40, y: 40 }],
    });
  });

  it('is null for a missing block and defaulted for an empty one', () => {
    expect(readInterior(undefined)).toBeNull();
    expect(readInterior('not-an-object')).toBeNull();
    const defaulted = readInterior({});
    expect(defaulted?.width).toBeGreaterThan(0);
    expect(defaulted?.height).toBeGreaterThan(0);
    // The default spawn sits clear of the exit doorway (FR-BLD-004).
    expect(defaulted?.spawnY).toBeLessThan(
      (defaulted?.height ?? 0) - WALL_THICKNESS - DOORWAY_SIZE.height,
    );
    expect(defaulted?.colliders).toEqual([]);
    expect(defaulted?.points).toEqual([]);
  });
});

describe('entry doorways (FR-BLD-002)', () => {
  it('spawns one trigger doorway at the south face of an enterable building, once', () => {
    const context = makeContext();
    const system = createBuildingSystem();
    system.init(context);
    spawnBuilding(context, TEST_INTERIOR);

    system.update(DT, context);
    system.update(DT, context);

    const doorways = context.world.query(DOORWAY);
    expect(doorways).toHaveLength(1);
    const doorway = doorways[0] as EntityId;
    expect(context.world.getComponent(doorway, POSITION)).toEqual({
      x: 160,
      y: 60 + 24 / 2 + DOORWAY_SIZE.height / 2,
    });
    expect(context.world.getComponent(doorway, COLLIDER)?.mode).toBe('trigger');
    expect(context.world.getComponent(doorway, DOORWAY)).toEqual({
      buildingId: 'building.test-house',
      role: 'entry',
    });
  });

  it('gives a building without an interior no doorway (set dressing)', () => {
    const context = makeContext();
    const system = createBuildingSystem();
    system.init(context);
    spawnBuilding(context, null);

    system.update(DT, context);
    expect(context.world.query(DOORWAY)).toHaveLength(0);
  });
});

describe('enter and exit through doorways (AC1, FR-BLD-003/004/005)', () => {
  function enterHouse(context: SystemContext, system: ReturnType<typeof createBuildingSystem>) {
    spawnBuilding(context, TEST_INTERIOR);
    const player = spawnPlayer(context, 160, 100);
    system.update(DT, context); // spawn the entry doorway
    const entry = doorwayOf(context, 'entry') as EntityId;
    const doorAt = context.world.getComponent(entry, POSITION) as { x: number; y: number };
    // Step onto the doorway; the physics pass reports the trigger entry.
    context.world.addComponent(player, POSITION, { x: doorAt.x, y: doorAt.y });
    step(context, system);
    // Where the player physically stands (physics depenetrates them off
    // the building's solid): the spot the exit must return them to.
    const standAt = context.world.getComponent(player, POSITION) as { x: number; y: number };
    for (let i = 0; i < FADE_STEPS - 1; i += 1) step(context, system);
    return { player, entry, doorAt, standAt };
  }

  it('walking onto the doorway fades, swaps the player in at the content spawn, and announces it', () => {
    const context = makeContext();
    const system = createBuildingSystem();
    system.init(context);
    const entered: string[] = [];
    context.events.subscribe(BUILDING_ENTERED, (event) => {
      if (typeof event.payload.buildingId === 'string') entered.push(event.payload.buildingId);
    });

    const { player } = enterHouse(context, system);

    expect(context.world.getComponent(player, SPACE)?.space).toBe('building.test-house');
    expect(context.world.getComponent(player, POSITION)).toEqual(interiorSpawn(TEST_INTERIOR));
    expect(activeSpace(context)?.space).toBe('building.test-house');
    context.events.flushDeferred();
    expect(entered).toEqual(['building.test-house']);

    // Interior geometry materialized in the interior's space (FR-BLD-005):
    // four walls plus one content collider, all solid, plus the exit doorway.
    const interiorSolids = context.world
      .query(COLLIDER, SPACE)
      .filter(
        (entity) => context.world.getComponent(entity, SPACE)?.space === 'building.test-house',
      )
      .filter((entity) => context.world.getComponent(entity, COLLIDER)?.mode === 'solid')
      .filter((entity) => context.world.getComponent(entity, PLAYER_CONTROLLED) === undefined);
    expect(interiorSolids).toHaveLength(5);
    expect(doorwayOf(context, 'exit')).toBeDefined();
  });

  it('interior walls block the player; exterior solids at the same spot do not (FR-BLD-006)', () => {
    const context = makeContext();
    const system = createBuildingSystem();
    system.init(context);
    const { player } = enterHouse(context, system);

    // Drive the player into the north wall: place the intended destination
    // overlapping it and let the constraint pass sweep the step.
    const origin = interiorOrigin(TEST_INTERIOR);
    const wallFace = origin.y + WALL_THICKNESS;
    const speed = 60;
    context.world.addComponent(player, POSITION, { x: 160, y: wallFace + 2 });
    context.world.addComponent(player, MOTION, { ...IDLE_MOTION, velocityY: -speed, moving: true });
    physicsSystem.update(DT, context);
    // Stopped with the collider's half-height resting on the wall face.
    expect(context.world.getComponent(player, POSITION)?.y).toBe(wallFace + 5);

    // An exterior solid sharing coordinates does not collide with the
    // indoor player: no block, no depenetration push.
    const ghost = context.world.createEntity();
    const at = context.world.getComponent(player, POSITION) as { x: number; y: number };
    context.world.addComponent(ghost, POSITION, { x: at.x, y: at.y });
    context.world.addComponent(ghost, COLLIDER, { width: 20, height: 20, mode: 'solid' });
    physicsSystem.update(DT, context);
    expect(context.world.getComponent(player, POSITION)).toEqual(at);
  });

  it('the exit doorway returns the player to where they entered, and doorways re-arm only off-trigger', () => {
    const context = makeContext();
    const system = createBuildingSystem();
    system.init(context);
    const exited: string[] = [];
    context.events.subscribe(BUILDING_EXITED, (event) => {
      if (typeof event.payload.buildingId === 'string') exited.push(event.payload.buildingId);
    });
    const { player, standAt } = enterHouse(context, system);

    // Step clear of all doorways so they re-arm (FR-BLD-004), then onto
    // the exit doorway.
    step(context, system);
    expect(activeSpace(context)?.armed).toBe(true);
    const exit = doorwayOf(context, 'exit') as EntityId;
    const exitAt = context.world.getComponent(exit, POSITION) as { x: number; y: number };
    context.world.addComponent(player, POSITION, { x: exitAt.x, y: exitAt.y });
    for (let i = 0; i < FADE_STEPS; i += 1) step(context, system);

    expect(context.world.getComponent(player, SPACE)?.space).toBe(SPACE_EXTERIOR);
    // Back where they stood when the enter swap landed: the entry doorway.
    expect(context.world.getComponent(player, POSITION)).toEqual(standAt);
    expect(activeSpace(context)?.space).toBe(SPACE_EXTERIOR);
    context.events.flushDeferred();
    expect(exited).toEqual(['building.test-house']);

    // The player landed on the entry doorway, so it stays disarmed and
    // never bounces them straight back inside.
    for (let i = 0; i < FADE_STEPS; i += 1) step(context, system);
    expect(activeSpace(context)?.space).toBe(SPACE_EXTERIOR);
    expect(activeSpace(context)?.armed).toBe(false);
    expect(
      context.world.getComponent(doorwayOf(context, 'entry') as EntityId, TRIGGER_OCCUPANCY),
    ).toBeDefined();
  });

  it('a non-player mover on a doorway starts no transition', () => {
    const context = makeContext();
    const system = createBuildingSystem();
    system.init(context);
    spawnBuilding(context, TEST_INTERIOR);
    system.update(DT, context);
    const entry = doorwayOf(context, 'entry') as EntityId;
    const doorAt = context.world.getComponent(entry, POSITION) as { x: number; y: number };
    const walker = context.world.createEntity();
    context.world.addComponent(walker, POSITION, { x: doorAt.x, y: doorAt.y });
    context.world.addComponent(walker, MOTION, IDLE_MOTION);
    context.world.addComponent(walker, COLLIDER, { width: 8, height: 12, mode: 'solid' });

    for (let i = 0; i < FADE_STEPS; i += 1) step(context, system);
    expect(activeSpace(context)?.space).toBe(SPACE_EXTERIOR);
    expect(activeSpace(context)?.transition).toBeNull();
  });
});

describe('resume into a saved interior (FR-BLD-008)', () => {
  it('re-materializes the active interior when its geometry is missing', () => {
    const context = makeContext();
    const system = createBuildingSystem();
    system.init(context);
    spawnBuilding(context, TEST_INTERIOR);
    const player = spawnPlayer(context, 100, 100);
    // Simulate a restored save: the slice and the player's space point at
    // the interior, but no interior geometry exists in the fresh world.
    const sliceEntity = context.world.query(ACTIVE_SPACE)[0] as EntityId;
    context.world.addComponent(sliceEntity, ACTIVE_SPACE, {
      space: 'building.test-house',
      transition: null,
      returnX: 100,
      returnY: 100,
      armed: true,
    });
    context.world.addComponent(player, SPACE, { space: 'building.test-house' });
    context.world.addComponent(player, POSITION, interiorSpawn(TEST_INTERIOR));

    system.update(DT, context);
    expect(doorwayOf(context, 'exit')).toBeDefined();
    const interiorSolids = context.world
      .query(COLLIDER, SPACE)
      .filter(
        (entity) => context.world.getComponent(entity, SPACE)?.space === 'building.test-house',
      )
      .filter((entity) => context.world.getComponent(entity, COLLIDER)?.mode === 'solid')
      .filter((entity) => context.world.getComponent(entity, PLAYER_CONTROLLED) === undefined);
    expect(interiorSolids).toHaveLength(5);
  });
});

describe('interaction points (FR-BLD-007)', () => {
  it('publishes the content-keyed hint near a point and clears it on leaving', () => {
    const context = makeContext();
    const system = createBuildingSystem();
    system.init(context);
    const hints: (string | null)[] = [];
    context.events.subscribe(UI_HINT, (event) => {
      hints.push(typeof event.payload.textKey === 'string' ? event.payload.textKey : null);
    });
    spawnBuilding(context, TEST_INTERIOR);
    const player = spawnPlayer(context, 100, 100);
    context.world.addComponent(player, SPACE, { space: 'building.test-house' });
    system.update(DT, context); // materializes nothing yet — exterior slice

    // Place the player at the point (interior geometry spawns on entry; here
    // we spawn it via the resume path by pointing the slice indoors).
    const sliceEntity = context.world.query(ACTIVE_SPACE)[0] as EntityId;
    context.world.addComponent(sliceEntity, ACTIVE_SPACE, {
      space: 'building.test-house',
      transition: null,
      returnX: null,
      returnY: null,
      armed: true,
    });
    system.update(DT, context);
    const origin = interiorOrigin(TEST_INTERIOR);
    context.world.addComponent(player, POSITION, { x: origin.x + 80, y: origin.y + 40 });
    context.events.flushDeferred();
    system.update(DT, context);
    context.events.flushDeferred();
    expect(hints).toEqual(['building.test-house.point.console']);

    // Walking out of range clears the hint exactly once.
    context.world.addComponent(player, POSITION, { x: origin.x + 80, y: origin.y + 88 });
    system.update(DT, context);
    system.update(DT, context);
    context.events.flushDeferred();
    expect(hints).toEqual(['building.test-house.point.console', null]);
  });

  it('an interaction point in another space raises no hint', () => {
    const context = makeContext();
    const system = createBuildingSystem();
    system.init(context);
    const hints: unknown[] = [];
    context.events.subscribe(UI_HINT, (event) => hints.push(event.payload.textKey));
    const point = context.world.createEntity();
    context.world.addComponent(point, POSITION, { x: 100, y: 100 });
    context.world.addComponent(point, INTERACTION_POINT, {
      pointId: 'point.hidden',
      hintKey: 'building.test-house.point.hidden',
    });
    context.world.addComponent(point, SPACE, { space: 'building.test-house' });
    spawnPlayer(context, 100, 100); // exterior player, same coordinates

    system.update(DT, context);
    context.events.flushDeferred();
    expect(hints).toEqual([]);
  });
});

describe('the space partition across spatial systems (FR-BLD-006)', () => {
  it('ui: a prompting marker in another space raises no prompt', () => {
    const context = makeContext();
    const ui = createUiSystem();
    ui.init(context);
    spawnPlayer(context, 100, 100);
    const marker = context.world.createEntity();
    context.world.addComponent(marker, POSITION, { x: 104, y: 100 });
    context.world.addComponent(marker, RENDERABLE, { kind: 'npc', width: 8, height: 12 });
    context.world.addComponent(marker, SPACE, { space: 'building.test-house' });

    ui.update(DT, context);
    const state = context.world.getComponent(
      context.world.query(UI_STATE)[0] as EntityId,
      UI_STATE,
    );
    expect(state?.prompt).toBeNull();

    // The same marker in the player's space prompts.
    context.world.removeComponent(marker, SPACE);
    ui.update(DT, context);
    expect(
      context.world.getComponent(context.world.query(UI_STATE)[0] as EntityId, UI_STATE)?.prompt,
    ).not.toBeNull();
  });

  it('npc: a character in another space is out of interaction reach', () => {
    const context = makeContext();
    const npc = createNpcSystem();
    npc.init(context);
    const interactions: number[] = [];
    context.events.subscribe(NPC_INTERACTED, (event) => {
      if (typeof event.payload.entityId === 'number') interactions.push(event.payload.entityId);
    });
    spawnPlayer(context, 100, 100);
    const character = context.world.createEntity();
    context.world.addComponent(character, POSITION, { x: 104, y: 100 });
    context.world.addComponent(character, MOTION, IDLE_MOTION);
    context.world.addComponent(character, NPC, {
      npcId: 'npc.test-subject',
      dialogueRef: null,
      routine: [],
    });
    context.world.addComponent(character, SPACE, { space: 'building.test-house' });

    context.events.publish(INTENT_INTERACT, {});
    context.events.flushDeferred(); // intent reaches the buffered System
    npc.update(DT, context);
    context.events.flushDeferred();
    expect(interactions).toEqual([]);
  });

  it('render: only the active space draws, and the transition cover fades', () => {
    const context = makeContext();
    const system = createBuildingSystem();
    system.init(context);
    const render = createHeadlessPlatform({ width: 640, height: 360 }).render;
    const outdoor = context.world.createEntity();
    context.world.addComponent(outdoor, POSITION, { x: 100, y: 100 });
    context.world.addComponent(outdoor, RENDERABLE, { kind: 'npc', width: 8, height: 12 });
    const indoor = context.world.createEntity();
    context.world.addComponent(indoor, POSITION, { x: 100, y: 100 });
    context.world.addComponent(indoor, RENDERABLE, { kind: 'wall', width: 8, height: 12 });
    context.world.addComponent(indoor, SPACE, { space: 'building.test-house' });

    renderFrame(0, context, render);
    const rects = render.commands.filter((c) => c['op'] === 'fillRect');
    // Backdrop-region background plus exactly one drawable: the outdoor npc.
    expect(rects).toHaveLength(2);

    // Mid-transition, the cover rect draws above everything.
    const sliceEntity = context.world.query(ACTIVE_SPACE)[0] as EntityId;
    context.world.addComponent(sliceEntity, ACTIVE_SPACE, {
      space: SPACE_EXTERIOR,
      transition: { to: 'building.test-house', progress: 0.5 },
      returnX: null,
      returnY: null,
      armed: false,
    });
    const covered = createHeadlessPlatform({ width: 640, height: 360 }).render;
    renderFrame(0, context, covered);
    const cover = covered.commands.filter((c) => c['op'] === 'fillRect').at(-1);
    expect(cover?.['color']).toBe('rgba(6, 8, 12, 1)');
    expect(cover?.['width']).toBe(640);
    expect(cover?.['height']).toBe(360);
  });

  it('keeps the whole flow deterministic: two identical runs, identical worlds', () => {
    const run = () => {
      const context = makeContext();
      const system = createBuildingSystem();
      system.init(context);
      spawnBuilding(context, TEST_INTERIOR);
      const player = spawnPlayer(context, 160, 100);
      system.update(DT, context);
      const entry = doorwayOf(context, 'entry') as EntityId;
      const doorAt = context.world.getComponent(entry, POSITION) as { x: number; y: number };
      context.world.addComponent(player, POSITION, { x: doorAt.x, y: doorAt.y });
      for (let i = 0; i < FADE_STEPS + 5; i += 1) step(context, system);
      return {
        space: context.world.getComponent(player, SPACE),
        position: context.world.getComponent(player, POSITION),
        slice: activeSpace(context),
        entities: context.world.query(POSITION).length,
      };
    };
    expect(run()).toEqual(run());
  });
});
