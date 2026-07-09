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
  BUILDING,
  BUILDING_ENTERED,
  BUILDING_EXITED,
  createBuildingPlugin,
  createBuildingSystem,
  DOORWAY,
  DOORWAY_SIZE,
  INTERACTION_POINT,
  interiorOrigin,
  interiorSpawn,
  readInterior,
  TRANSITION_SECONDS,
  WALL_THICKNESS,
} from './building';
export type {
  BuildingDefinition,
  Doorway,
  InteractionPoint,
  InteriorDefinition,
  InteriorPoint,
  InteriorRect,
} from './building';
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
  activeRoutineEntry,
  createNpcPlugin,
  createNpcSystem,
  DEFAULT_NPC_SPEED,
  IDLE_NPC_BEHAVIOR,
  NPC,
  NPC_BEHAVIOR,
  NPC_INTERACT_RADIUS,
  NPC_INTERACTED,
} from './npc';
export type { NpcBehavior, NpcDefinition, NpcRoutineEntry } from './npc';
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
  CAPABILITY_UNLOCKED,
  createProgressionPlugin,
  createProgressionSystem,
  EMPTY_PROGRESSION,
  ITEM_ADDED,
  PROGRESSION,
  PROGRESSION_CHANGED,
} from './progression';
export type { Progression } from './progression';
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
  createEnvironmentPlugin,
  createEnvironmentSystem,
  DAY_SECONDS,
  DEFAULT_WEATHER_STATES,
  ENVIRONMENT,
  NIGHT_SECONDS,
  NIGHT_TINT,
  PHASE_DAY,
  PHASE_NIGHT,
  REGION_AMBIENT,
  WEATHER_CHANGED,
  WEATHER_MAX_SECONDS,
  WEATHER_MIN_SECONDS,
  WEATHER_PROFILES,
} from './environment';
export type { EnvironmentState, RegionAmbient } from './environment';
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
  ENVIRONMENT_LIGHT,
  RENDER_MOTION,
  renderFrame,
  renderPlugin,
  renderSystem,
  viewTransform,
} from './render';
export type { AssetManifest, Camera, EnvironmentLight, RenderMotion } from './render';
export {
  ACTIVE_SPACE,
  activeSpaceOf,
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
  SPACE,
  SPACE_EXTERIOR,
  spaceOf,
} from './scene';
export type {
  ActiveSpace,
  ControlSnapshot,
  Motion,
  PlayerControlled,
  Position,
  RegionState,
  Renderable,
  Space,
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
export {
  AMBIENT_CLIP_PREFIX,
  AMBIENT_EVENT,
  AMBIENT_KINDS,
  AMBIENT_MAX_INTERVAL,
  AMBIENT_MIN_INTERVAL,
  AMBIENT_NEARBY_RADIUS,
  createWorldSimPlugin,
  createWorldSimSystem,
  WORLD_SIM,
} from './worldsim';
export type { WorldSimState } from './worldsim';
