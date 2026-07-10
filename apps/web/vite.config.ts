// From 'vitest/config', not 'vite': the `test` key below is Vitest's config
// surface. Vite's own defineConfig does not type it, and apps/web/tsconfig.json
// does not include this file, so the mistake would never surface as a build error.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The engine is plain .mjs in a workspace package; Vite must not try to
  // externalize it, and its .wasm asset must be emitted as a real file.
  assetsInclude: ['**/*.wasm'],
  worker: { format: 'es' },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
  },
});
