/**
 * Entry point. Boots the engine layers in order: platform adapter, core,
 * systems, then loads the content pack. Wiring arrives with later issues;
 * this file only proves the layers compose and the build is green.
 */
import { LAYER as platform } from './platform';
import { LAYER as core } from './core';
import { LAYER as systems } from './systems';

export const BOOT_ORDER = [platform, core, systems] as const;
