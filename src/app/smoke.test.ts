/**
 * End-to-end smoke path (issue #43): the shortest full slice of the real
 * experience — boot the bundled pack on the headless platform, walk to a
 * character, resolve a quest through dialogue, and watch the first
 * restoration land — driven by player input alone, well inside the first
 * minute of simulated time (FR-VIS-008). If this suite fails, a visitor's
 * first minute is broken and nothing else in CI matters; it asserts the
 * outcome of every layer (content, boot, input, simulation, presentation,
 * persistence) without reaching into any System's internals.
 */
import { describe, expect, it } from 'vitest';
import { createHeadlessPlatform } from '../platform';
import {
  ACHIEVEMENT,
  ACHIEVEMENT_STATE,
  PROGRESSION,
  QUEST,
  QUEST_STATE,
  SAVE_SLOT_KEY,
} from '../systems';
import { bootWorld } from './boot';
import { packFilesFromBundle } from './pack-bundle';

const DT = 1 / 60;
/** The whole path must fit inside one simulated minute of the visit. */
const ONE_MINUTE_OF_FRAMES = 60 * 60;

describe('end-to-end smoke path (issue #43)', () => {
  it('boots the shipped pack and restores the first region inside a minute', () => {
    const platform = createHeadlessPlatform({ width: 640, height: 360 });
    const handle = bootWorld({ platform, packFiles: packFilesFromBundle(), seed: 7 });
    const stop = handle.start();

    let framesDriven = 0;
    const frames = (count: number) => {
      for (let i = 0; i < count; i += 1) platform.timers.tick(DT);
      framesDriven += count;
    };
    const hold = (key: string, count: number) => {
      platform.input.press(key);
      frames(count);
      platform.input.release(key);
      frames(2);
    };
    const tap = (key: string) => hold(key, 2);

    // Walk down to the engineer idling below the spawn and solve the
    // assembly-line quest through his conversation: open, choose, dismiss.
    hold('ArrowDown', 14);
    frames(60);
    tap('KeyE');
    frames(10);
    tap('KeyE');
    frames(10);
    tap('KeyE');
    frames(30);

    // The quest resolved through the fiction and the restoration landed.
    const quests = new Map(
      handle.world
        .query(QUEST, QUEST_STATE)
        .map((entity) => [
          handle.world.getComponent(entity, QUEST)?.questId,
          handle.world.getComponent(entity, QUEST_STATE),
        ]),
    );
    expect(quests.get('quest.rebuild-the-line')).toEqual({
      status: 'completed',
      objectives: { 'obj.assemble-line': 'solved' },
    });
    const progression = handle.world
      .query(PROGRESSION)
      .map((entity) => handle.world.getComponent(entity, PROGRESSION))[0];
    expect(progression?.restored.length).toBeGreaterThan(0);
    const unlocked = new Map(
      handle.world
        .query(ACHIEVEMENT, ACHIEVEMENT_STATE)
        .map((entity) => [
          handle.world.getComponent(entity, ACHIEVEMENT)?.achievementId,
          handle.world.getComponent(entity, ACHIEVEMENT_STATE)?.unlocked,
        ]),
    );
    expect(unlocked.get('achievement.first-light')).toBe(true);

    // The restoration beat and the reveal both arrived through events.
    const delivered = (type: string) =>
      handle.events.eventLog.filter((entry) => entry.kind === 'delivered' && entry.type === type);
    expect(delivered('system.restored').length).toBeGreaterThan(0);
    expect(delivered('quest.revealed').length).toBeGreaterThan(0);

    // Presentation and persistence both ran: frames rendered, save written.
    expect(platform.render.commands.length).toBeGreaterThan(0);
    expect(platform.storage.read(SAVE_SLOT_KEY)).not.toBeNull();

    // The whole path was clean and quick: zero faults, under a minute.
    expect(handle.loop.faults).toEqual([]);
    expect(framesDriven).toBeLessThan(ONE_MINUTE_OF_FRAMES);

    stop();
  });
});
