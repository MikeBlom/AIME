/**
 * Audio System — turns gameplay events and world state into sound through
 * the Platform Adapter's AudioOutput (issue #22; spec: docs/17-Audio.md).
 *
 * Everything audible is a reaction: one-shot SFX cues answer gameplay
 * events (FR-AUD-001), the ambient bed follows the active region's id,
 * live state, and the time-of-day phase (FR-AUD-003), and the music bus is
 * its own looping channel (FR-AUD-004). Which sound plays is content: cue
 * and bed keys resolve through the pack's asset manifest in world state,
 * and a key the manifest does not define is simply silent (FR-AUD-002,
 * FR-ARCH-008) — the engine names no career fact and ships no asset.
 *
 * The System owns one world-state slice, the audio settings (FR-ARCH-015);
 * other Systems request changes by publishing `audio.control` events.
 * Spatialization is a hook (FR-AUD-005): pan and distance attenuation are
 * computed from the emitting entity's position relative to the camera and
 * handed to the adapter. Determinism (NFR-ARCH-001): update reads only
 * world state, buffered events, and settings — no clocks, no randomness —
 * so a replayed session issues the identical audio call sequence.
 */
import type {
  EntityId,
  EntityStore,
  EventPayload,
  EventType,
  Plugin,
  System,
  SystemContext,
} from '../core';
import { defineComponentType, defineEventType } from '../core';
import type { AudioOutput } from '../platform';
import { ACHIEVEMENT_UNLOCKED } from './achievements';
import type { Camera } from './render';
import { ASSET_MANIFEST, CAMERA } from './render';
import { LOGICAL_SPACE, MOVEMENT_STARTED, MOVEMENT_STOPPED, REGION, REGION_ENTERED } from './scene';
import { POSITION } from './scene';

/**
 * The audio settings slice, owned by the Audio System (FR-ARCH-015):
 * master level and mute, per-bus gains, and the reduced-audio option
 * (FR-AUD-007) that silences the ambient and music beds while keeping
 * interaction feedback.
 */
export type AudioSettings = {
  readonly master: number;
  readonly muted: boolean;
  readonly reducedAudio: boolean;
  readonly sfxGain: number;
  readonly ambientGain: number;
  readonly musicGain: number;
};
export const AUDIO_SETTINGS = defineComponentType<AudioSettings>('audio-settings');

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  master: 1,
  muted: false,
  reducedAudio: false,
  sfxGain: 1,
  ambientGain: 1,
  musicGain: 1,
};

/**
 * Request a settings change (volume/mute controls, reduced audio). Any
 * subset of fields; the Audio System clamps and applies them on its next
 * update — no other System writes the settings slice directly.
 */
export const AUDIO_CONTROL = defineEventType<{
  readonly master?: number;
  readonly muted?: boolean;
  readonly reducedAudio?: boolean;
  readonly sfxGain?: number;
  readonly ambientGain?: number;
  readonly musicGain?: number;
}>('audio.control');

/**
 * The time-of-day phase changed (the `TimeOfDayChanged` shape docs/02 names).
 * Audio consumes it for bed selection; the day/night System publishes it
 * when that issue lands — until then the phase rests at its default.
 */
export const TIME_PHASE_CHANGED = defineEventType<{ readonly phase: string }>('time.phase-changed');

const DEFAULT_PHASE = 'day';

/** Gameplay events that trigger one-shot cues, and their manifest keys. */
const CUE_BINDINGS: readonly { readonly type: EventType<EventPayload>; readonly key: string }[] = [
  { type: MOVEMENT_STARTED, key: 'audio.cue.movement-started' },
  { type: MOVEMENT_STOPPED, key: 'audio.cue.movement-stopped' },
  { type: REGION_ENTERED, key: 'audio.cue.region-entered' },
  // The recognition chime (issue #32): plays only when the pack's manifest
  // supplies the asset, silent otherwise (FR-AUD-002).
  { type: ACHIEVEMENT_UNLOCKED, key: 'audio.cue.achievement-unlocked' },
];

/** Distance attenuation floor: a far cue is quieter, never inaudible. */
const ATTENUATION_FLOOR = 0.4;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clamp01 = (value: number) => clamp(value, 0, 1);

/** Narrow the open platform record to an AudioOutput; null degrades to silence. */
function audioOf(platform: SystemContext['platform']): AudioOutput | null {
  const candidate = (platform as { readonly audio?: unknown }).audio;
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as AudioOutput).play === 'function' &&
    typeof (candidate as AudioOutput).setLoop === 'function' &&
    typeof (candidate as AudioOutput).setMasterVolume === 'function'
  ) {
    return candidate as AudioOutput;
  }
  return null;
}

function manifestOf(world: EntityStore): { readonly [assetId: string]: string } {
  return (
    world
      .query(ASSET_MANIFEST)
      .map((entity) => world.getComponent(entity, ASSET_MANIFEST)?.entries)
      .find((entries) => entries !== undefined) ?? {}
  );
}

function activeCamera(world: EntityStore): Camera {
  for (const entity of world.query(CAMERA)) {
    const camera = world.getComponent(entity, CAMERA);
    if (camera !== undefined) return camera;
  }
  return { x: LOGICAL_SPACE.width / 2, y: LOGICAL_SPACE.height / 2, zoom: 1 };
}

function activeRegion(world: EntityStore): { contentId: string; state: string } | null {
  for (const entity of world.query(REGION)) {
    const region = world.getComponent(entity, REGION);
    if (region !== undefined) return region;
  }
  return null;
}

/** Most-specific-first manifest keys for the ambient bed (FR-AUD-003). */
export function ambientBedCandidates(
  region: { readonly contentId: string; readonly state: string } | null,
  phase: string,
): readonly string[] {
  if (region === null) return ['audio.ambient.default'];
  return [
    `audio.ambient.${region.contentId}.${region.state}.${phase}`,
    `audio.ambient.${region.contentId}.${region.state}`,
    `audio.ambient.${region.contentId}`,
    'audio.ambient.default',
  ];
}

/** Most-specific-first manifest keys for the music bus (FR-AUD-004). */
export function musicCandidates(region: { readonly contentId: string } | null): readonly string[] {
  return region === null
    ? ['audio.music.default']
    : [`audio.music.${region.contentId}`, 'audio.music.default'];
}

function firstResolved(
  manifest: { readonly [assetId: string]: string },
  candidates: readonly string[],
): string | null {
  for (const key of candidates) {
    const address = manifest[key];
    if (address !== undefined) return address;
  }
  return null;
}

/**
 * The spatialization hook (FR-AUD-005): pan from the emitter's horizontal
 * offset to the camera, gain attenuation from its distance. An event with
 * no locatable emitter plays centered at full gain.
 */
function spatialParams(
  world: EntityStore,
  entityId: number | null,
  camera: Camera,
): { pan: number; attenuation: number } {
  if (entityId === null) return { pan: 0, attenuation: 1 };
  let position: { readonly x: number; readonly y: number } | undefined;
  try {
    position = world.getComponent(entityId as EntityId, POSITION);
  } catch {
    position = undefined;
  }
  if (position === undefined) return { pan: 0, attenuation: 1 };
  const dx = position.x - camera.x;
  const dy = position.y - camera.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const range = LOGICAL_SPACE.width;
  return {
    pan: clamp(dx / (LOGICAL_SPACE.width / 2), -1, 1),
    attenuation: 1 - (1 - ATTENUATION_FLOOR) * Math.min(1, distance / range),
  };
}

/** Defensive settings merge: unknown/invalid fields are ignored, numbers clamped. */
function mergeSettings(settings: AudioSettings, payload: EventPayload): AudioSettings {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return settings;
  const record = payload as { readonly [key: string]: EventPayload };
  const num = (key: string, current: number): number => {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? clamp01(value) : current;
  };
  const bool = (key: string, current: boolean): boolean => {
    const value = record[key];
    return typeof value === 'boolean' ? value : current;
  };
  return {
    master: num('master', settings.master),
    muted: bool('muted', settings.muted),
    reducedAudio: bool('reducedAudio', settings.reducedAudio),
    sfxGain: num('sfxGain', settings.sfxGain),
    ambientGain: num('ambientGain', settings.ambientGain),
    musicGain: num('musicGain', settings.musicGain),
  };
}

/**
 * Build the Audio System. A factory (not a shared instance) because the
 * System buffers events between flush and update and caches what it last
 * applied to the adapter; each booted world gets its own instance so state
 * never bleeds across worlds.
 */
export function createAudioSystem(): System {
  interface PendingCue {
    readonly key: string;
    readonly entityId: number | null;
  }
  let pendingCues: PendingCue[] = [];
  let pendingControls: EventPayload[] = [];
  let phase = DEFAULT_PHASE;
  let unsubscribes: (() => void)[] = [];
  let settingsEntity: EntityId | null = null;
  let appliedMaster: number | null = null;
  const appliedLoops = new Map<string, { soundRef: string; gain: number } | null>();

  const reset = () => {
    pendingCues = [];
    pendingControls = [];
    phase = DEFAULT_PHASE;
    settingsEntity = null;
    appliedMaster = null;
    appliedLoops.clear();
  };

  const entityIdOf = (payload: EventPayload): number | null => {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
    const value = (payload as { readonly [key: string]: EventPayload })['entityId'];
    return typeof value === 'number' ? value : null;
  };

  const applyLoop = (
    audio: AudioOutput,
    channel: string,
    soundRef: string | null,
    gain: number,
  ): void => {
    const desired = soundRef === null ? null : { soundRef, gain };
    const applied = appliedLoops.get(channel) ?? null;
    const unchanged =
      desired === null
        ? applied === null && appliedLoops.has(channel)
        : applied !== null &&
          applied.soundRef === desired.soundRef &&
          applied.gain === desired.gain;
    if (unchanged) return;
    audio.setLoop(channel, soundRef, { gain });
    appliedLoops.set(channel, desired);
  };

  return {
    id: 'audio',
    dependencies: [],
    init(context: SystemContext): void {
      reset();
      // The settings slice: adopt an existing entity (hot re-init) or spawn
      // one with defaults. This System is its sole writer (FR-ARCH-015).
      const existing = context.world.query(AUDIO_SETTINGS)[0];
      if (existing === undefined) {
        settingsEntity = context.world.createEntity();
        context.world.addComponent(settingsEntity, AUDIO_SETTINGS, DEFAULT_AUDIO_SETTINGS);
      } else {
        settingsEntity = existing;
      }
      for (const binding of CUE_BINDINGS) {
        unsubscribes.push(
          context.events.subscribe(binding.type, (event) => {
            pendingCues.push({ key: binding.key, entityId: entityIdOf(event.payload) });
          }),
        );
      }
      unsubscribes.push(
        context.events.subscribe(AUDIO_CONTROL, (event) => {
          pendingControls.push(event.payload);
        }),
      );
      unsubscribes.push(
        context.events.subscribe(TIME_PHASE_CHANGED, (event) => {
          if (typeof event.payload.phase === 'string') phase = event.payload.phase;
        }),
      );
    },
    update(_dt: number, context: SystemContext): void {
      const audio = audioOf(context.platform);
      if (audio === null || settingsEntity === null) {
        // No audio interface on this host: degrade to silence (FR-ARCH-008)
        // without accumulating stale cues.
        pendingCues = [];
        pendingControls = [];
        return;
      }
      const world = context.world;

      let settings = world.getComponent(settingsEntity, AUDIO_SETTINGS) ?? DEFAULT_AUDIO_SETTINGS;
      for (const control of pendingControls) settings = mergeSettings(settings, control);
      pendingControls = [];
      world.addComponent(settingsEntity, AUDIO_SETTINGS, settings);

      const master = settings.muted ? 0 : settings.master;
      if (master !== appliedMaster) {
        audio.setMasterVolume(master);
        appliedMaster = master;
      }

      const manifest = manifestOf(world);
      const camera = activeCamera(world);
      for (const cue of pendingCues) {
        const address = manifest[cue.key];
        if (address === undefined) continue; // unbound cue: silent, never a fault
        const { pan, attenuation } = spatialParams(world, cue.entityId, camera);
        audio.play(address, { gain: clamp01(settings.sfxGain * attenuation), pan });
      }
      pendingCues = [];

      // Beds follow world state every step (FR-AUD-003/004): region id and
      // live state plus the time phase pick the ambient bed; reduced audio
      // silences both beds while cues above keep interactions audible.
      const region = activeRegion(world);
      const ambient = settings.reducedAudio
        ? null
        : firstResolved(manifest, ambientBedCandidates(region, phase));
      const music = settings.reducedAudio ? null : firstResolved(manifest, musicCandidates(region));
      applyLoop(audio, 'ambient', ambient, clamp01(settings.ambientGain));
      applyLoop(audio, 'music', music, clamp01(settings.musicGain));
    },
    teardown(context: SystemContext): void {
      for (const unsubscribe of unsubscribes) unsubscribe();
      unsubscribes = [];
      const audio = audioOf(context.platform);
      if (audio !== null) {
        audio.setLoop('ambient', null);
        audio.setLoop('music', null);
      }
      reset();
    },
  };
}

/**
 * The audio plugin: the System plus the settings component and control/time
 * event types it introduces, registered and removed as one unit
 * (FR-ARCH-018). A factory so every world composes a fresh System instance.
 */
export function createAudioPlugin(): Plugin {
  return {
    id: 'plugin.audio',
    systems: [createAudioSystem()],
    componentTypes: [AUDIO_SETTINGS],
    eventTypes: [AUDIO_CONTROL, TIME_PHASE_CHANGED],
  };
}
