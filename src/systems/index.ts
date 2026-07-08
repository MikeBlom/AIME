/**
 * Systems — the interchangeable modules that give the world behavior
 * (rendering, input, quest, dialogue, ...). Each conforms to the System
 * interface and lifecycle in docs/02-System-Architecture.md and communicates
 * only via the event bus and shared world state — never direct references.
 */
export const LAYER = 'systems';

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
