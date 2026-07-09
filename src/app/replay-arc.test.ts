/**
 * Cross-system replay determinism (issue #43, FR-ARCH-025): where
 * replay.test.ts proves record/replay over movement and rendering, this
 * suite records a session that drives the INTEGRATED stack — NPC
 * interaction, dialogue choices, quest resolution, restorations, world
 * simulation, progression, achievements, analytics, and autosave — through
 * pure player input, then replays it into a freshly booted world. The
 * final state must be identical across every one of those systems.
 */
import { describe, expect, it } from 'vitest';
import type { HeadlessPlatform } from '../platform';
import { createHeadlessPlatform } from '../platform';
import {
  ACHIEVEMENT,
  ACHIEVEMENT_STATE,
  POSITION,
  PROGRESSION,
  QUEST,
  QUEST_STATE,
  REGION,
  REGION_ONLINE,
  SAVE_SLOT_KEY,
} from '../systems';
import type { WorldHandle } from './boot';
import { bootWorld } from './boot';
import { packFilesFromBundle } from './pack-bundle';

const DT = 1 / 60;
const SEED = 20260709;

type Session = { platform: HeadlessPlatform; handle: WorldHandle };

function bootSession(): Session {
  const platform = createHeadlessPlatform({ width: 640, height: 360 });
  const handle = bootWorld({ platform, packFiles: packFilesFromBundle(), seed: SEED });
  return { platform, handle };
}

/**
 * Everything observable about a finished session, across the integrated
 * systems, as comparable data: spatial state, quest and progression
 * records, achievements, region restoration, the autosave envelope, the
 * analytics stream, the full event log, and the rendered command stream.
 */
function finalState(session: Session) {
  const { handle, platform } = session;
  const { world } = handle;
  const quests = world.query(QUEST, QUEST_STATE).map((entity) => ({
    quest: world.getComponent(entity, QUEST),
    state: world.getComponent(entity, QUEST_STATE),
  }));
  const achievements = world.query(ACHIEVEMENT, ACHIEVEMENT_STATE).map((entity) => ({
    achievement: world.getComponent(entity, ACHIEVEMENT),
    state: world.getComponent(entity, ACHIEVEMENT_STATE),
  }));
  const regions = world.query(REGION).map((entity) => world.getComponent(entity, REGION));
  const progression = world
    .query(PROGRESSION)
    .map((entity) => world.getComponent(entity, PROGRESSION));
  return {
    playerPosition: world.getComponent(handle.spawned.player, POSITION),
    step: handle.loop.context.time.step,
    frame: handle.loop.context.time.frame,
    rngState: handle.loop.context.rng.state,
    faults: handle.loop.faults.length,
    quests,
    achievements,
    regions,
    progression,
    save: platform.storage.read(SAVE_SLOT_KEY),
    telemetry: platform.telemetry.records,
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

/**
 * Play the whole reference arc with the keyboard alone: walk to each of
 * the three NPCs and resolve their quest through a dialogue choice —
 * solve, bypass, solve — restoring all three regions. Each conversation
 * is three interacts: open, choose, dismiss the closing line. Returns the
 * recording of the live session.
 */
function driveArcSession(session: Session) {
  const { platform, handle } = session;
  const stop = handle.start();
  handle.loop.startRecording();

  const frames = (count: number) => {
    for (let i = 0; i < count; i += 1) platform.timers.tick(DT);
  };
  const hold = (key: string, count: number) => {
    platform.input.press(key);
    frames(count);
    platform.input.release(key);
    frames(2);
  };
  /** Tap a key: a short edge the input system latches, then settle. */
  const tap = (key: string) => hold(key, 2);

  // The engineer idles just below the spawn: solve the assembly line.
  hold('ArrowDown', 14);
  frames(60);
  tap('KeyE'); // open the engineer's conversation
  frames(10);
  tap('KeyE'); // first choice: solve
  frames(10);
  tap('KeyE'); // dismiss the closing line
  frames(20);

  // West to the dispatcher on the platform: bypass the signals quest —
  // meaning is never gated, the region still comes back online.
  hold('ArrowLeft', 52);
  frames(20);
  tap('KeyE'); // open the dispatcher's conversation
  frames(10);
  tap('ArrowDown'); // select the second choice: bypass
  frames(6);
  tap('KeyE'); // choose bypass
  frames(10);
  tap('KeyE'); // dismiss the closing line
  frames(20);

  // The foreman patrols the yard row with the engineer deadlocked against
  // him: loop below the pair, come back up east of the foreman, and press
  // into him from the east so he is strictly the nearest character.
  hold('ArrowDown', 10);
  hold('ArrowRight', 62);
  hold('ArrowUp', 9);
  hold('ArrowLeft', 25);
  tap('KeyE'); // open the foreman's conversation
  frames(10);
  tap('KeyE'); // first choice: solve — the yard's power comes back
  frames(10);
  tap('KeyE'); // dismiss the closing line
  frames(40);

  const recording = handle.loop.stopRecording();
  stop();
  return recording;
}

describe('cross-system replay determinism (issue #43, FR-ARCH-025)', () => {
  it('replays a full input-driven quest arc to the identical integrated state', () => {
    const live = bootSession();
    const recording = driveArcSession(live);
    const liveFinal = finalState(live);

    // The session must have actually exercised the integrated systems for
    // the replay comparison to mean anything: all three quests resolved
    // through dialogue, every region restored, progression and
    // achievements recorded, and an autosave written.
    const statuses = new Map(
      liveFinal.quests.map((entry) => [entry.quest?.questId, entry.state?.status]),
    );
    expect(statuses.get('quest.restore-power')).toBe('completed');
    expect(statuses.get('quest.rebuild-the-line')).toBe('completed');
    expect(statuses.get('quest.conduct-the-yard')).toBe('completed');
    expect(liveFinal.regions).toEqual([{ contentId: 'region.arrival', state: REGION_ONLINE }]);
    expect([...(liveFinal.progression[0]?.restored ?? [])].sort()).toEqual([
      'region.arrival',
      'region.signal-ridge',
      'region.workshop-row',
    ]);
    const unlocked = new Map(
      liveFinal.achievements.map((entry) => [
        entry.achievement?.achievementId,
        entry.state?.unlocked,
      ]),
    );
    expect(unlocked.get('achievement.first-light')).toBe(true);
    expect(unlocked.get('achievement.full-power')).toBe(true);
    expect(liveFinal.save).not.toBeNull();
    expect(liveFinal.faults).toBe(0);

    // Identical initial state + identical recorded frames = identical
    // final state, byte for byte, across every integrated system.
    const replayed = bootSession();
    replayed.handle.loop.replay(recording);
    expect(finalState(replayed)).toEqual(liveFinal);
  });
});
