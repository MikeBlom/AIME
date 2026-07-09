/**
 * World instantiation for the walking skeleton: builds entities from the
 * resolved content graph. Everything specific — which region, which
 * buildings, which characters — comes from the pack (FR-VIS-007); this file
 * only knows the generic schema types and lays markers out deterministically
 * so the same pack always spawns the same world (DATA-FR-017).
 */
import type { ComponentData, EntityId, EntityStore } from '../core';
import type { ResolvedContentGraph } from '../content';
import type { NpcRoutineEntry } from '../systems';
import {
  ASSET_MANIFEST,
  CAMERA,
  COLLIDER,
  DIALOGUE,
  IDLE_MOTION,
  LOCALE_STRINGS,
  LOGICAL_SPACE,
  initialQuestState,
  MOTION,
  NPC,
  PLAYER_CONTROLLED,
  POSITION,
  QUEST,
  QUEST_STATE,
  REGION,
  RENDERABLE,
} from '../systems';

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

/**
 * Translate a content `routine` array into the engine's routine entries:
 * `phase` is required; `waypoints` keeps only finite points; `speed` keeps
 * only finite positive numbers. Authoring notes (`activity`) never cross
 * the seam; anything malformed degrades toward idle (FR-ARCH-008).
 */
function readRoutine(value: ComponentData | undefined): readonly NpcRoutineEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asRecord(entry))
    .filter((entry) => typeof entry['phase'] === 'string')
    .map((entry) => ({
      phase: entry['phase'] as string,
      waypoints: (Array.isArray(entry['waypoints']) ? entry['waypoints'] : [])
        .map((point) => asRecord(point))
        .filter(
          (point) =>
            typeof point['x'] === 'number' &&
            Number.isFinite(point['x']) &&
            typeof point['y'] === 'number' &&
            Number.isFinite(point['y']),
        )
        .map((point) => ({ x: point['x'] as number, y: point['y'] as number })),
      speed:
        typeof entry['speed'] === 'number' && Number.isFinite(entry['speed']) && entry['speed'] > 0
          ? entry['speed']
          : null,
    }));
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
    row.ids.forEach((id, index) => {
      const marker = world.createEntity();
      const size = MARKER_SIZES.get(row.kind) ?? PLAYER_SIZE;
      world.addComponent(marker, POSITION, markerPosition(index, row.ids.length, row.y));
      // The marker's sprite is the content entity's declared appearance,
      // resolved at draw time through the pack's asset manifest.
      const assetRef = asRecord(asRecord(graph.entities.get(id)?.doc)['appearance'])['assetRef'];
      world.addComponent(marker, RENDERABLE, {
        kind: row.kind,
        ...size,
        ...(typeof assetRef === 'string' ? { spriteRef: assetRef } : {}),
      });
      // Markers are the region's world geometry: solid, so the player walks
      // around them, not through them (issue #20; interiors arrive later).
      world.addComponent(marker, COLLIDER, { ...size, mode: 'solid' });
      // Characters additionally carry their behavior definition (issue
      // #27): routine, dialogue reference, and a motion slice so the NPC
      // System can walk them and route interact presses.
      if (row.kind === 'npc') {
        const npcDoc = asRecord(graph.entities.get(id)?.doc);
        world.addComponent(marker, NPC, {
          npcId: id,
          dialogueRef: typeof npcDoc['dialogueRef'] === 'string' ? npcDoc['dialogueRef'] : null,
          routine: readRoutine(npcDoc['routine']),
        });
        world.addComponent(marker, MOTION, IDLE_MOTION);
      }
    });
  }

  // Land the pack's asset manifest(s) in world state so rendering can
  // resolve sprite refs without reaching into the content graph.
  const manifestEntries: Record<string, string> = {};
  for (const entity of graph.byType.get('assets')?.values() ?? []) {
    for (const [assetId, address] of Object.entries(asRecord(entity.doc['entries']))) {
      if (typeof address === 'string') manifestEntries[assetId] = address;
    }
  }
  const manifest = world.createEntity();
  world.addComponent(manifest, ASSET_MANIFEST, { entries: manifestEntries });

  // Land the default-locale strings table so UI resolves every player-
  // visible key from world state (DATA-FR-011), mirroring the manifest.
  const stringEntries: Record<string, string> = {};
  for (const [key, text] of graph.strings.get(graph.defaultLocale) ?? []) {
    stringEntries[key] = text;
  }
  const strings = world.createEntity();
  world.addComponent(strings, LOCALE_STRINGS, { entries: stringEntries });

  // Default view: a zoom-1 camera on the region center — the whole-space
  // fit. The Camera System adopts this entity at init and owns the slice.
  const camera = world.createEntity();
  world.addComponent(camera, CAMERA, {
    x: LOGICAL_SPACE.width / 2,
    y: LOGICAL_SPACE.height / 2,
    zoom: 1,
  });

  const player = world.createEntity();
  world.addComponent(player, POSITION, {
    x: LOGICAL_SPACE.width / 2,
    y: LOGICAL_SPACE.height / 2,
  });
  world.addComponent(player, PLAYER_CONTROLLED, { speed: PLAYER_SPEED });
  world.addComponent(player, MOTION, IDLE_MOTION);
  world.addComponent(player, RENDERABLE, { kind: 'player', ...PLAYER_SIZE });
  world.addComponent(player, COLLIDER, { ...PLAYER_SIZE, mode: 'solid' });

  // Quest entities for the region's quests (issue #25), appended after the
  // long-standing entities so ids stay stable for saves from earlier worlds.
  // Which quest restores what is entirely the pack's declaration.
  for (const id of [...stringList(contains['quests'])].sort()) {
    const questDoc = asRecord(graph.entities.get(id)?.doc);
    if (typeof questDoc['titleKey'] !== 'string' || typeof questDoc['regionRef'] !== 'string') {
      continue; // not a spawnable quest document; validation already warned
    }
    const objectives = (Array.isArray(questDoc['objectives']) ? questDoc['objectives'] : [])
      .map((objective) => asRecord(objective))
      .filter(
        (objective) =>
          typeof objective['id'] === 'string' && typeof objective['descriptionKey'] === 'string',
      )
      .map((objective) => ({
        id: objective['id'] as string,
        descriptionKey: objective['descriptionKey'] as string,
      }));
    const onComplete = asRecord(questDoc['onComplete']);
    const bypass = asRecord(questDoc['bypass']);
    const definition = {
      questId: id,
      titleKey: questDoc['titleKey'],
      regionRef: questDoc['regionRef'],
      objectives,
      emitsOnComplete: stringList(onComplete['emits']),
      revealsKey: typeof onComplete['revealsKey'] === 'string' ? onComplete['revealsKey'] : null,
      bypassAllowed: bypass['allowed'] === true,
      bypassRevealsKey: typeof bypass['revealsKey'] === 'string' ? bypass['revealsKey'] : null,
    };
    const quest = world.createEntity();
    world.addComponent(quest, QUEST, definition);
    world.addComponent(quest, QUEST_STATE, initialQuestState(definition));
  }

  // Dialogue entities for every dialogue document (issue #26): NPCs across
  // regions reference them, so all spawn; ids stay stable after the quests.
  const readResolves = (value: ComponentData | undefined) => {
    const record = asRecord(value);
    if (typeof record['questRef'] !== 'string' || typeof record['objectiveId'] !== 'string') {
      return null;
    }
    return {
      questId: record['questRef'],
      objectiveId: record['objectiveId'],
      outcome: record['outcome'] === 'bypassed' ? ('bypassed' as const) : ('solved' as const),
    };
  };
  for (const [id, entity] of graph.byType.get('dialogue') ?? []) {
    const doc = entity.doc;
    const nodes = (Array.isArray(doc['nodes']) ? doc['nodes'] : [])
      .map((node) => asRecord(node))
      .filter((node) => typeof node['id'] === 'string' && typeof node['textKey'] === 'string')
      .map((node) => ({
        id: node['id'] as string,
        textKey: node['textKey'] as string,
        end: node['end'] === true,
        resolves: readResolves(node['resolves']),
        choices: (Array.isArray(node['choices']) ? node['choices'] : [])
          .map((choice) => asRecord(choice))
          .filter(
            (choice) => typeof choice['textKey'] === 'string' && typeof choice['goto'] === 'string',
          )
          .map((choice) => ({
            textKey: choice['textKey'] as string,
            goto: choice['goto'] as string,
            resolves: readResolves(choice['resolves']),
          })),
      }));
    const dialogue = world.createEntity();
    world.addComponent(dialogue, DIALOGUE, { dialogueId: id, nodes });
  }

  return { regionId: regionEntity.id, player };
}
