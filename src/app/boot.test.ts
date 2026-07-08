import { describe, expect, it } from 'vitest';
import { PackLoadError } from '../content';
import { createHeadlessPlatform } from '../platform';
import { MOTION, PLAYER_CONTROLLED, POSITION, REGION } from '../systems';
import { bootWorld } from './boot';
import { packFilesFromBundle } from './pack-bundle';

const DT = 1 / 60;

function boot(
  overrides: { width?: number; height?: number; onOverlayText?: (t: string) => void } = {},
) {
  const platform = createHeadlessPlatform({
    width: overrides.width ?? 640,
    height: overrides.height ?? 360,
  });
  const handle = bootWorld({
    platform,
    packFiles: packFilesFromBundle(),
    seed: 7,
    ...(overrides.onOverlayText ? { onOverlayText: overrides.onOverlayText } : {}),
  });
  return { platform, handle };
}

describe('bootWorld', () => {
  it('loads the bundled pack and spawns the start region and player', () => {
    const { handle } = boot();
    expect(handle.spawned.regionId).toBe(handle.graph.startRegion);

    const regionStates = handle.world
      .query(REGION)
      .map((entity) => handle.world.getComponent(entity, REGION));
    expect(regionStates).toEqual([{ contentId: handle.graph.startRegion, state: 'offline' }]);

    const player = handle.spawned.player;
    expect(handle.world.getComponent(player, POSITION)).toEqual({ x: 160, y: 90 });
    expect(handle.world.getComponent(player, PLAYER_CONTROLLED)?.speed).toBeGreaterThan(0);
    expect(handle.world.getComponent(player, MOTION)).toEqual({ moving: false });
  });

  it('rejects an invalid pack atomically with diagnostics (FR-ARCH-030)', () => {
    const platform = createHeadlessPlatform();
    expect(() =>
      bootWorld({ platform, packFiles: new Map([['pack.json', '{']]), seed: 1 }),
    ).toThrow(PackLoadError);
  });

  it('renders the region and entities each presented frame', () => {
    const { platform, handle } = boot();
    const stop = handle.start();
    platform.timers.tick(DT);
    stop();

    const commands = platform.render.commands;
    expect(commands[0]).toMatchObject({ op: 'clear' });
    const rects = commands.filter((command) => command['op'] === 'fillRect');
    // Region background + building marker + npc marker + player.
    expect(rects.length).toBeGreaterThanOrEqual(4);
  });

  it('announces the entered region through the event bus on the first step', () => {
    const { platform, handle } = boot();
    const stop = handle.start();
    platform.timers.tick(DT);
    stop();

    const delivered = handle.events.eventLog.filter((entry) => entry.kind === 'delivered');
    expect(delivered.map((entry) => entry.type)).toContain('region.entered');
  });

  it('feeds the debug overlay live System, timing, and event data (FR-ARCH-031)', () => {
    const overlayFrames: string[] = [];
    const { platform, handle } = boot({ onOverlayText: (text) => overlayFrames.push(text) });
    const stop = handle.start();
    platform.input.press('ArrowRight');
    platform.timers.tick(DT);
    platform.timers.tick(DT);
    stop();

    const snapshot = handle.debugSnapshot();
    expect(snapshot.systems).toContain('movement');
    expect(snapshot.timings.map((timing) => timing.systemId)).toContain('movement');
    expect(snapshot.frame).toBe(2);
    expect(snapshot.step).toBeGreaterThan(0);
    expect(snapshot.events.map((entry) => entry.type)).toContain('movement.started');

    expect(overlayFrames.length).toBe(2);
    const lastOverlay = overlayFrames.at(-1) ?? '';
    expect(lastOverlay).toContain('movement');
    expect(lastOverlay).toContain('events:');
    expect(lastOverlay).toContain('frame 2');
  });

  it('moves the player from live keyboard input through the loop', () => {
    const { platform, handle } = boot();
    const stop = handle.start();
    platform.input.press('ArrowRight');
    for (let i = 0; i < 30; i += 1) platform.timers.tick(DT);
    stop();

    const position = handle.world.getComponent(handle.spawned.player, POSITION);
    expect(position !== undefined && position.x > 160).toBe(true);
    expect(position?.y).toBe(90);
  });
});
