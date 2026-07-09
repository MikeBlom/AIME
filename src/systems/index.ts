/**
 * Systems — the interchangeable modules that give the world behavior
 * (rendering, input, quest, dialogue, ...). Each conforms to the System
 * interface and lifecycle in docs/02-System-Architecture.md and communicates
 * only via the event bus and shared world state — never direct references.
 */
export const LAYER = 'systems';

export {
  ANIMATABLE,
  ANIMATION,
  ANIMATION_ONE_SHOT,
  animationPoses,
  CLIP_IDLE,
  CLIP_INTERACT,
  CLIP_WALK,
  createAnimationPlugin,
  createAnimationSystem,
  DEFAULT_ANIMATION_FPS,
  DEFAULT_ONE_SHOT_SECONDS,
  facingDirection,
  resolveClipFrame,
} from './animation';
export type { Animatable, AnimationState, OneShotState } from './animation';
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
  boxesOverlap,
  BROADPHASE_CELL,
  buildBroadphase,
  COLLIDER,
  COLLISION_CONTACTS,
  COLLISION_ENDED,
  COLLISION_STARTED,
  colliderBox,
  physicsPlugin,
  physicsSystem,
  TRIGGER_ENTERED,
  TRIGGER_EXITED,
  TRIGGER_OCCUPANCY,
} from './physics';
export type { Box, Broadphase, Collider, CollisionContacts, TriggerOccupancy } from './physics';
export {
  createQuestPlugin,
  createQuestSystem,
  initialQuestState,
  OBJECTIVE_RESOLVED,
  QUEST,
  QUEST_ADVANCED,
  QUEST_COMPLETED,
  QUEST_REVEALED,
  QUEST_STATE,
  REGION_ONLINE,
  REGION_STATE_CHANGED,
  SYSTEM_RESTORED,
} from './quest';
export type { ObjectiveStatus, QuestDefinition, QuestObjective, QuestState } from './quest';
export {
  createDialoguePlugin,
  createDialogueSystem,
  DIALOGUE,
  DIALOGUE_ENDED,
  DIALOGUE_START_REQUESTED,
  DIALOGUE_STARTED,
  DIALOGUE_STATE,
  IDLE_DIALOGUE_STATE,
} from './dialogue';
export type {
  DialogueChoice,
  DialogueDefinition,
  DialogueNode,
  DialogueResolves,
  DialogueState,
} from './dialogue';
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
export {
  applySave,
  AUTOSAVE_EVENTS,
  captureSave,
  createSaveLoadPlugin,
  createSaveLoadSystem,
  loadWorld,
  migrateSave,
  parseSave,
  PROGRESSION_SLICES,
  SAVE_FORMAT,
  SAVE_SLOT_KEY,
  SAVE_VERSION,
  saveWorld,
  WORLD_RESTORED,
  WORLD_SAVED,
} from './saveload';
export type { SaveEnvelope, SaveLoadOptions, SaveMigration } from './saveload';
export {
  createUiPlugin,
  createUiSystem,
  IDLE_UI_STATE,
  LOCALE_STRINGS,
  PROMPT_RADIUS,
  UI_DIALOGUE_CHOSEN,
  UI_DIALOGUE_CLOSE,
  UI_DIALOGUE_OPEN,
  UI_HINT,
  UI_PROMPT_INTERACT_KEY,
  UI_STATE,
  uiFrame,
  uiLayout,
} from './ui';
export type { DialogueSurface, LocaleStrings, UiState } from './ui';
