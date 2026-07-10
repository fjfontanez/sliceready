// From 'vitest/config', not 'vite': the `test` key below is Vitest's config
// surface. Vite's own defineConfig does not type it, and apps/web/tsconfig.json
// does not include this file, so the mistake would never surface as a build error.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The engine is plain .mjs in a workspace package; Vite must not try to
  // externalize it, and its .wasm asset must be emitted as a real file.
  assetsInclude: ['**/*.wasm'],
  worker: { format: 'es' },
  // Vite's dep optimizer only walks static imports from HTML entry points; it
  // never crawls into the Worker's own graph (repair.worker.ts -> engine.mjs
  // -> fflate) until something constructs the Worker at runtime. On a cold
  // `.vite` cache that first drop discovers fflate as a new dependency mid-
  // repair, forces a full-page reload to re-optimize, and silently drops the
  // user's selected File — no exception, just a second "[vite] connected." in
  // the console and the UI stuck on "Reading the file...". Pre-declaring
  // fflate here makes the optimizer bundle it up front, so nothing new is
  // discovered when the Worker starts. Do not remove this as "unnecessary":
  // it only fails on a cold cache, so a warm-cache dev session will look fine
  // without it.
  optimizeDeps: { include: ['fflate'] },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
  },
});
