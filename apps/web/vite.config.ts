// From 'vitest/config', not 'vite': the `test` key below is Vitest's config
// surface. Vite's own defineConfig does not type it, and apps/web/tsconfig.json
// does not include this file, so the mistake would never surface as a build error.
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = dirname(fileURLToPath(import.meta.url));
const guidesDir = resolve(here, 'guides');

// Every guides/<slug>/index.html becomes its own Rollup entry, so each guide is
// emitted as real pre-rendered HTML at /guides/<slug>/ — a crawler gets the prose
// with no JS executed. Discovered rather than listed: the SEO plan has eight more
// guides queued, and a build config nobody remembers to update is a build config
// that silently drops pages from the index.
const guideEntries: Record<string, string> = existsSync(guidesDir)
  ? Object.fromEntries(
      readdirSync(guidesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => [`guide-${entry.name}`, resolve(guidesDir, entry.name, 'index.html')])
        // Key on the page, not the folder. A directory without an index.html — a
        // draft, a stray assets folder — would otherwise hand Rollup an input path
        // that does not exist, and the build would die with a resolution error
        // that reads like a Vite bug rather than a missing file.
        .filter(([, page]) => existsSync(page)),
    )
  : {};

// The canonical host. Every canonical tag, og:url and JSON-LD URL in the guides
// names the apex, so the sitemap must agree with them — a sitemap that lists a
// different host than the canonicals is a sitemap that argues with itself.
const ORIGIN = 'https://sliceready.app';

// The sitemap is GENERATED from the guides on disk, for the same reason the entries
// above are: a hand-written list is a list somebody forgets to update, and a guide
// missing from the sitemap is a guide Google has to stumble onto.
function sitemap() {
  return {
    name: 'sliceready-sitemap',
    generateBundle() {
      const urls = [
        `${ORIGIN}/`,
        `${ORIGIN}/guides/`,
        ...Object.keys(guideEntries)
          .map((key) => key.replace(/^guide-/, ''))
          .sort()
          .map((slug) => `${ORIGIN}/guides/${slug}/`),
      ];
      const body = urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n');
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [sitemap()],
  // Not a SPA: there is no router, and the guides are separate documents. Left on
  // the default 'spa', dev and preview answer every unmatched path with the app's
  // index.html — so /guides/<slug> (no trailing slash) silently served the app
  // instead of the guide, which is exactly the URL the canonical tag and the
  // footer link point at. 'mpa' turns that lie into an honest 404 locally and
  // matches how a static host resolves the directory index.
  appType: 'mpa',
  build: {
    rollupOptions: {
      // Naming any input replaces Vite's implicit index.html entry, so the app
      // itself has to be listed here too or the SPA stops being built at all.
      input: {
        main: resolve(here, 'index.html'),
        // The guides index is a file directly under guides/, not one of the <slug>/
        // directories, so the discovery above steps straight past it.
        //
        // Unlike the guide entries, this one is deliberately NOT existence-guarded.
        // The index is the only inbound link most guides have — without it they are
        // orphans no crawler ever reaches — so a missing index is not a case to
        // degrade around. It should break the build, loudly, right here.
        guides: resolve(guidesDir, 'index.html'),
        ...guideEntries,
      },
    },
  },
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
