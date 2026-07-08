/**
 * World instantiation for the walking skeleton: builds entities from the
 * resolved content graph. Everything specific — which region, which
 * buildings, which characters — comes from the pack (FR-VIS-007); this file
 * only knows the generic schema types and lays markers out deterministically
 * so the same pack always spawns the same world (DATA-FR-017).
 */
import type { ComponentData, EntityId, EntityStore } from '../core';
import type { ResolvedContentGraph } from '../content';
import { LOGICAL_SPACE, MOTION, PLAYER_CONTROLLED, POSITION, REGION, RENDERABLE } from '../systems';

/** Logical-unit sizes for the slice's generic marker kinds. */
const MARKER_SIZES: ReadonlyMap<string, { readonly width: number; readonly height: number }> =
  new Map([
    ['building', { width: 34, height: 24 }],
    ['npc', { width: 8, height: 12 }],
  ]);
const PLAYER_SIZE = { width: 10, height: 10 } as const;
/** Player speed in logical units per second — world data, not System code. */
const PLAYER_SPEED = 96;

function asRecord(value: ComponentData | undefined): Readonly<Record<string, ComponentData>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Readonly<Record<string, ComponentData>>;
}

function stringList(value: ComponentData | undefined): readonly string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

/** Evenly space `count` markers across the logical width at a given row. */
function markerPosition(index: number, count: number, y: number): { x: number; y: number } {
  return { x: (LOGICAL_SPACE.width * (index + 1)) / (count + 1), y };
}

export interface SpawnedWorld {
  readonly regionId: string;
  readonly player: EntityId;
}

/**
 * Spawn the start region named by the pack manifest: a region entity
 * carrying its live state, a marker per contained building and NPC, and the
 * player at the center of the logical space.
 */
export function spawnWorld(world: EntityStore, graph: ResolvedContentGraph): SpawnedWorld {
  const regionEntity = graph.entities.get(graph.startRegion);
  if (regionEntity === undefined) {
    throw new Error(`start region "${graph.startRegion}" missing from the content graph`);
  }
  const doc = regionEntity.doc;
  const initialState = asRecord(doc['state'])['initial'];

  const region = world.createEntity();
  world.addComponent(region, REGION, {
    contentId: regionEntity.id,
    state: typeof initialState === 'string' ? initialState : 'offline',
  });

  const contains = asRecord(doc['contains']);
  const rows: readonly { kind: string; ids: readonly string[]; y: number }[] = [
    { kind: 'building', ids: [...stringList(contains['buildings'])].sort(), y: 60 },
    { kind: 'npc', ids: [...stringList(contains['npcs'])].sort(), y: 112 },
  ];
  for (const row of rows) {
    row.ids.forEach((_, index) => {
      const marker = world.createEntity();
      const size = MARKER_SIZES.get(row.kind) ?? PLAYER_SIZE;
      world.addComponent(marker, POSITION, markerPosition(index, row.ids.length, row.y));
      world.addComponent(marker, RENDERABLE, { kind: row.kind, ...size });
    });
  }

  const player = world.createEntity();
  world.addComponent(player, POSITION, {
    x: LOGICAL_SPACE.width / 2,
    y: LOGICAL_SPACE.height / 2,
  });
  world.addComponent(player, PLAYER_CONTROLLED, { speed: PLAYER_SPEED });
  world.addComponent(player, MOTION, { moving: false });
  world.addComponent(player, RENDERABLE, { kind: 'player', ...PLAYER_SIZE });

  return { regionId: regionEntity.id, player };
}
