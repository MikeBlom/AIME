import { describe, expect, it } from 'vitest';
import { BOOT_ORDER } from './main';

describe('scaffold', () => {
  it('composes the engine layers bottom-up: platform, core, systems', () => {
    expect(BOOT_ORDER).toEqual(['platform', 'core', 'systems']);
  });
});
