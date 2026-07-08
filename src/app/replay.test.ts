/**
 * End-to-end replay determinism (FR-ARCH-025, issue #15 AC2): a live session
 * — boot the bundled pack, drive scripted keyboard and touch input through
 * the platform adapter and runtime loop — is recorded, then replayed into a
 * freshly booted world. Identical initial state, content, input, and dt
 * sequence must reproduce the identical final state, down to the rendered
 * command stream.
 */
import { describe, expect, it } from 'vitest';
import type { HeadlessPlatform } from '../platform';
import { createHeadlessPlatform } from '../platform';
import { pointerToLogical, POSITION } from '../systems';
import type { WorldHandle } from './boot';
import { bootWorld } from './boot';
import { packFilesFromBundle } from './pack-bundle';

const DT = 1 / 60;
const SEED = 20260708;

type Session = { platform: HeadlessPlatform; handle: WorldHandle };

function bootSession(width: number, height: number): Session {
  const platform = createHeadlessPlatform({ width, height });
  const handle = bootWorld({ platform, packFiles: packFilesFromBundle(), seed: SEED });
  return { platform, handle };
}

/** Everything observable about a finished session, as comparable data. */
function finalState(session: Session) {
  const { handle, platform } = session;
  return {
    playerPosition: handle.world.getComponent(handle.spawned.player, POSITION),
    step: handle.loop.context.time.step,
    frame: handle.loop.context.time.frame,
    rngState: handle.loop.context.rng.state,
    faults: handle.loop.faults.length,
    eventLog: handle.events.eventLog.map((entry) => ({
      seq: entry.seq,
      kind: entry.kind,
      type: entry.type,
      delivery: entry.delivery,
      payload: JSON.stringify(entry.payload),
    })),
    renderCommands: platform.render.commands,
  };
}

/** Scripted mixed keyboard-and-touch session; returns the recording. */
function driveLiveSession(session: Session) {
  const { platform, handle } = session;
  const stop = handle.start();
  handle.loop.startRecording();

  platform.input.press('ArrowRight');
  for (let i = 0; i < 30; i += 1) platform.timers.tick(DT);
  platform.input.release('ArrowRight');
  platform.input.press('KeyS');
  platform.input.press('KeyD');
  for (let i = 0; i < 20; i += 1) platform.timers.tick(DT);
  platform.input.release('KeyS');
  platform.input.release('KeyD');
  // Touch leg: hold the primary button while dragging the pointer.
  platform.input.movePointer(40, 40);
  platform.input.setButton(0, true);
  for (let i = 0; i < 25; i += 1) {
    platform.input.movePointer(40 + i * 4, 40 + i * 2);
    platform.timers.tick(DT);
  }
  platform.input.setButton(0, false);
  for (let i = 0; i < 5; i += 1) platform.timers.tick(DT);

  const recording = handle.loop.stopRecording();
  stop();
  return recording;
}

describe('end-to-end replay (FR-ARCH-025)', () => {
  it('reproduces the identical final state and render stream on a desktop viewport', () => {
    const live = bootSession(640, 360);
    const recording = driveLiveSession(live);
    const liveFinal = finalState(live);

    // The session must have actually gone somewhere for the test to mean anything.
    expect(liveFinal.playerPosition).not.toEqual({ x: 160, y: 90 });
    expect(recording.frames.length).toBe(80);

    const replayed = bootSession(640, 360);
    replayed.handle.loop.replay(recording);
    expect(finalState(replayed)).toEqual(liveFinal);
  });

  it('runs touch-only on a mobile portrait viewport and still replays identically', () => {
    const live = bootSession(180, 320);
    const { platform, handle } = live;
    const stop = handle.start();
    handle.loop.startRecording();

    // Hold a touch at the surface point that maps to logical (250, 90).
    const target = { x: 250, y: 90 };
    const scale = 180 / 320; // portrait letterbox: width-limited
    const surfaceX = target.x * scale;
    const surfaceY = target.y * scale + (320 - 180 * scale) / 2;
    expect(pointerToLogical(surfaceX, surfaceY, { width: 180, height: 320 })).toEqual(target);

    platform.input.movePointer(surfaceX, surfaceY);
    platform.input.setButton(0, true);
    for (let i = 0; i < 90; i += 1) platform.timers.tick(DT);
    platform.input.setButton(0, false);
    platform.timers.tick(DT);

    const recording = handle.loop.stopRecording();
    stop();
    const liveFinal = finalState(live);

    // Touch steering moved the player toward the target.
    expect(liveFinal.playerPosition?.x).toBeGreaterThan(200);
    expect(liveFinal.playerPosition?.y).toBeCloseTo(90, 0);

    const replayed = bootSession(180, 320);
    replayed.handle.loop.replay(recording);
    expect(finalState(replayed)).toEqual(liveFinal);
  });
});
