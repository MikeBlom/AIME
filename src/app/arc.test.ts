/**
 * Reference-pack arc suite (issue #35 AC1/AC2): the shipped pack plays
 * start-to-restored as a coherent arc through the REAL mechanics — three
 * quests, three catalog mini-games, three restorations — inside a booted,
 * frame-driven world. The whole playthrough fits comfortably inside a
 * two-minute visit of simulated time (FR-VIS-008's short-visit bar), and
 * every restoration reveals meaning through events, never resume text.
 */
import { describe, expect, it } from 'vitest';
import { createHeadlessPlatform } from '../platform';
import {
  ACHIEVEMENT,
  ACHIEVEMENT_STATE,
  MINIGAME_LAUNCH_REQUESTED,
  PROGRESSION,
  QUEST,
  QUEST_STATE,
  REGION,
  REGION_ONLINE,
} from '../systems';
import { bootWorld } from './boot';
import { packFilesFromBundle } from './pack-bundle';

const DT = 1 / 60;
/** FR-VIS-008: the arc must fit a short visit — two minutes of play. */
const TWO_MINUTES_OF_FRAMES = 120 * 60;

function makeRun() {
  const platform = createHeadlessPlatform({ width: 640, height: 360 });
  const handle = bootWorld({ platform, packFiles: packFilesFromBundle(), seed: 11 });
  const stop = handle.start();
  let framesDriven = 0;
  const frames = (count: number) => {
    for (let i = 0; i < count; i += 1) platform.timers.tick(DT);
    framesDriven += count;
  };
  /** Tap a key: held a couple of frames, then released to settle edges. */
  const press = (key: string) => {
    platform.input.press(key);
    frames(2);
    platform.input.release(key);
    frames(2);
  };
  const launch = (questId: string, objectiveId: string) => {
    handle.events.publish(MINIGAME_LAUNCH_REQUESTED, { questId, objectiveId });
    frames(3); // session opens, mechanic enters
  };
  const questState = (questId: string) => {
    for (const entity of handle.world.query(QUEST, QUEST_STATE)) {
      if (handle.world.getComponent(entity, QUEST)?.questId === questId) {
        return handle.world.getComponent(entity, QUEST_STATE);
      }
    }
    return undefined;
  };
  return {
    platform,
    handle,
    stop,
    frames,
    press,
    launch,
    questState,
    framesDriven: () => framesDriven,
  };
}

describe('the reference pack plays start-to-restored (issue #35 AC1)', () => {
  it('three quests, three mechanics, three restorations — inside a two-minute visit (AC2)', () => {
    const run = makeRun();

    // Walk clear of the marker rows so interact presses reach only the
    // active mini-game, never an NPC conversation.
    run.platform.input.press('ArrowDown');
    run.frames(40);
    run.platform.input.release('ArrowDown');
    run.frames(2);

    // Quest 1 — the short-visit headliner: route-and-balance
    // (channels [2, 2, 1], load 4 from the pack's metaphor params).
    run.launch('quest.restore-power', 'obj.route-power');
    run.press('KeyE'); // channel 0: 1/4
    run.press('KeyE'); // channel 0 full: 2/4
    run.press('ArrowRight'); // select channel 1
    run.press('KeyE'); // 3/4
    run.press('KeyE'); // 4/4 -> success
    run.frames(8);
    expect(run.questState('quest.restore-power')).toEqual({
      status: 'completed',
      objectives: { 'obj.route-power': 'solved' },
    });
    // The restoration beat: the start region visibly comes back online.
    const regionStates = run.handle.world
      .query(REGION)
      .map((entity) => run.handle.world.getComponent(entity, REGION));
    expect(regionStates).toEqual([{ contentId: 'region.arrival', state: REGION_ONLINE }]);

    // Quest 2 — assembly (slots [1, 0, 2], choices 3).
    run.launch('quest.rebuild-the-line', 'obj.assemble-line');
    run.press('ArrowDown'); // offer part 1
    run.press('KeyE'); // slot 1 placed
    run.press('ArrowUp'); // back to part 0
    run.press('KeyE'); // slot 2 placed
    run.press('ArrowUp'); // wraps to part 2
    run.press('KeyE'); // slot 3 placed -> success
    run.frames(8);
    expect(run.questState('quest.rebuild-the-line')?.status).toBe('completed');

    // Quest 3 — orchestrate (two tracks, 0.6 s windows open from the start).
    run.launch('quest.conduct-the-yard', 'obj.conduct-signals');
    run.press('KeyE'); // track 1 inside its window
    run.press('KeyE'); // track 2 inside its window -> success
    run.frames(8);
    expect(run.questState('quest.conduct-the-yard')?.status).toBe('completed');

    // Let progression and achievements settle, then check the arc's record.
    run.frames(30);
    const progression = run.handle.world
      .query(PROGRESSION)
      .map((entity) => run.handle.world.getComponent(entity, PROGRESSION))[0];
    expect([...(progression?.restored ?? [])].sort()).toEqual([
      'region.arrival',
      'region.signal-ridge',
      'region.workshop-row',
    ]);
    expect(progression?.capabilities).toContain('capability.yard-power');
    expect(progression?.items).toContain('item.control-house-key');

    // Achievements mark the beats: first restoration, the full sweep, and
    // the line's signature — but not the unvisited control house interior.
    const unlockedById = new Map(
      run.handle.world
        .query(ACHIEVEMENT, ACHIEVEMENT_STATE)
        .map((entity) => [
          run.handle.world.getComponent(entity, ACHIEVEMENT)?.achievementId,
          run.handle.world.getComponent(entity, ACHIEVEMENT_STATE)?.unlocked,
        ]),
    );
    expect(unlockedById.get('achievement.first-light')).toBe(true);
    expect(unlockedById.get('achievement.full-power')).toBe(true);
    expect(unlockedById.get('achievement.line-signature')).toBe(true);
    expect(unlockedById.get('achievement.inside-story')).toBe(false);

    // Meaning arrived through the fiction: every quest revealed its key.
    const revealed = run.handle.events.eventLog
      .filter((entry) => entry.kind === 'delivered' && entry.type === 'quest.revealed')
      .map((entry) => (entry.payload as { revealsKey: string }).revealsKey);
    expect(revealed).toContain('quest.restore-power.reveal');
    expect(revealed).toContain('quest.rebuild-the-line.reveal');
    expect(revealed).toContain('quest.conduct-the-yard.reveal');

    // The whole arc fits a short visit with frames to spare (FR-VIS-008).
    expect(run.framesDriven()).toBeLessThan(TWO_MINUTES_OF_FRAMES);

    run.stop();
  });

  it('the bypass path completes the arc too: meaning is never gated (FR-VIS-010)', () => {
    const run = makeRun();
    run.platform.input.press('ArrowDown');
    run.frames(40);
    run.platform.input.release('ArrowDown');
    run.frames(2);

    // Hold interact through the default 3 s span instead of solving.
    run.launch('quest.restore-power', 'obj.route-power');
    run.platform.input.press('KeyE');
    run.frames(Math.ceil(3 / DT) + 2);
    run.platform.input.release('KeyE');
    run.frames(8);

    expect(run.questState('quest.restore-power')).toEqual({
      status: 'completed',
      objectives: { 'obj.route-power': 'bypassed' },
    });
    const revealed = run.handle.events.eventLog
      .filter((entry) => entry.kind === 'delivered' && entry.type === 'quest.revealed')
      .map((entry) => (entry.payload as { revealsKey: string }).revealsKey);
    expect(revealed).toContain('quest.restore-power.reveal');

    run.stop();
  });
});
