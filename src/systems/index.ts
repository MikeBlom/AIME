/**
 * Systems — the interchangeable modules that give the world behavior
 * (rendering, input, quest, dialogue, ...). Each conforms to the System
 * interface and lifecycle in docs/02-System-Architecture.md and communicates
 * only via the event bus and shared world state — never direct references.
 */
export const LAYER = 'systems';

export {
  ambientBedCandidates,
  AUDIO_CONTROL,
  AUDIO_SETTINGS,
  createAudioPlugin,
  createAudioSystem,
  DEFAULT_AUDIO_SETTINGS,
  musicCandidates,
  TIME_PHASE_CHANGED,
} from './audio';
export type { AudioSettings } from './audio';
export {
  CAMERA_FOLLOW,
  CAMERA_ZOOM_REQUESTED,
  clampToRegionExtents,
  createCameraPlugin,
  createCameraSystem,
  DEFAULT_CAMERA_FOLLOW,
  ZOOM_MAX,
  ZOOM_MIN,
} from './camera';
export type { CameraFollow } from './camera';
export {
  activeBindings,
  DEFAULT_BINDINGS,
  INPUT_BINDINGS,
  INPUT_INTENT,
  INTENT_INTERACT,
  INTENT_MOVE,
  inputPlugin,
  inputSystem,
} from './input';
export type { BindingTable, InputBindings, InputIntent } from './input';
export { movementPlugin, movementSystem } from './movement';
export {
  ASSET_MANIFEST,
  CAMERA,
  RENDER_MOTION,
  renderFrame,
  renderPlugin,
  renderSystem,
  viewTransform,
} from './render';
export type { AssetManifest, Camera, RenderMotion } from './render';
export {
  fitTransform,
  IDLE_MOTION,
  LOGICAL_SPACE,
  MOTION,
  MOVEMENT_STARTED,
  MOVEMENT_STOPPED,
  PLAYER_CONTROLLED,
  pointerToLogical,
  POSITION,
  REGION,
  REGION_ENTERED,
  RENDERABLE,
  readControls,
  scenePlugin,
} from './scene';
export type {
  ControlSnapshot,
  Motion,
  PlayerControlled,
  Position,
  RegionState,
  Renderable,
} from './scene';
