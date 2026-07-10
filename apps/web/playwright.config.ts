import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  // A 1.88M-triangle repair is not a 30-second operation.
  timeout: 5 * 60 * 1000,
  // Runs against the production build, not `npm run dev`. On a cold Vite dep
  // cache (the state any fresh clone starts in), the dev server's optimizer
  // doesn't discover the Worker's import graph until the first real drop
  // constructs the Worker, then force-reloads mid-repair and silently drops
  // the selected File (see apps/web/vite.config.ts). Building first exercises
  // the actual artifact users receive — hashed assets, the real worker chunk,
  // the really-emitted .wasm — and removes that entire bug class instead of
  // papering over it. Do not switch this back to `npm run dev` to "speed it
  // up": that reintroduces the flake and lets a broken production bundle pass.
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 5 * 60 * 1000,
  },
  use: { baseURL: 'http://localhost:4173' },
});
