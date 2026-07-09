import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so one built artifact serves any mount point — a site
  // root, a project-pages subpath, or a per-PR preview directory (docs/42).
  base: './',
  build: {
    target: 'es2022',
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    environment: 'node',
  },
});
