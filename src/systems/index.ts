/**
 * Systems — the interchangeable modules that give the world behavior
 * (rendering, input, quest, dialogue, ...). Each conforms to the System
 * interface and lifecycle in docs/02-System-Architecture.md and communicates
 * only via the event bus and shared world state — never direct references.
 *
 * Systems arrive with their own issues; this placeholder only anchors the
 * layer's location and import path.
 */
export const LAYER = 'systems';
