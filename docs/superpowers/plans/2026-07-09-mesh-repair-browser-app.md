# Mesh Repair Browser App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the client-side browser app around the already-validated ADMesh WASM engine: drop a broken STL/3MF, see the defects, get a repaired binary STL back, never upload anything.

**Architecture:** An npm workspace splits the validated engine (`packages/engine`, plain `.mjs`, Node-tested) from the app (`apps/web`, Vite + TypeScript, no UI framework). The app owns a Web Worker that runs `repairMesh` off the main thread; the main thread arms a per-phase heartbeat watchdog whose only recovery from a hung WASM call is `worker.terminate()`. A three.js viewer toggles before/after with the same camera and overlays the defect edges on "before".

**Tech Stack:** Node 24, npm workspaces, Vite, TypeScript, Vitest (app), `node:test` (engine), three.js, fflate, ADMesh compiled to WASM via Emscripten.

**Spec:** `docs/superpowers/specs/2026-07-09-mesh-repair-browser-app-design.md`

## Global Constraints

- **Export format is binary STL only.** 3MF export is out of scope (GitHub issue #1). Never write a 3MF.
- **The mesh never leaves the browser.** No network calls with mesh data. No backend.
- **No `SharedArrayBuffer`, no threads.** The deploy must work without `COOP`/`COEP` headers.
- **The watchdog is mandatory**, not optional hardening. A hung WASM call inside a worker cannot be interrupted cooperatively; `worker.terminate()` from the main thread is the only recovery.
- **Honest reporting:** if `report.pass === false`, no UI string may say "repaired". State what remains, still offer the download.
- **Engine changes are additive.** Existing engine behavior and its existing tests must keep passing untouched.
- **The app never imports engine internals.** Only `@mesh-repair/engine` (and its declared subpath exports). Never `packages/engine/src/*` by relative path.
- Engine source stays plain ESM `.mjs` with no TypeScript. App source is TypeScript.
- Commit messages: conventional commits. No AI attribution, no `Co-Authored-By`.
- Phase names, exactly, in order: `parse`, `analyze-before`, `repair`, `analyze-after`, `export`.

---

### Task 1: Promote the spike to an npm workspace

The engine has 5 source modules, a WASM build, and passing tests. It is production code wearing the name "spike". This task moves it and nothing else — no behavior changes.

The `manifold-3d` experiment (`src/repair.mjs`, `test/repair.test.mjs`) is **deleted**, not moved. It is a recorded negative result: `spike/FINDINGS.md` holds the verdict and git history holds the code. Carrying it forward would drag the `manifold-3d` dependency — a library we proved is not a repair tool — into the production engine's dependency tree. `spike/run.mjs` is the manifold-3d spike harness — it imports `repairWithManifold` from `src/repair.mjs` — so it is deleted along with it; `run-admesh.mjs` has no such import and is the one that moves.

**Files:**
- Create: `package.json` (root)
- Create: `packages/engine/package.json`
- Move: `spike/src/{mesh3mf,stl,check,repair-admesh,engine}.mjs` → `packages/engine/src/`
- Move: `spike/wasm/` → `packages/engine/wasm/`
- Move: `spike/test/{mesh3mf,check,repair-admesh,engine}.test.mjs` → `packages/engine/test/`
- Move: `spike/test/fixtures/` → `packages/engine/test/fixtures/`
- Move: `spike/run-admesh.mjs` → `packages/engine/scripts/`
- Delete: `spike/src/repair.mjs`, `spike/test/repair.test.mjs`, `spike/run.mjs`, `spike/package.json`, `spike/package-lock.json` (note: Step 1 deletes the first two through their post-move paths under `packages/engine/`, because `git mv` relocates them first)
- Keep in place: `spike/FINDINGS.md`

**Interfaces:**
- Consumes: nothing.
- Produces: workspace package `@mesh-repair/engine`, whose `"."` export resolves to `src/engine.mjs` (exporting `repairMesh`) and whose `"./check"` export resolves to `src/check.mjs` (exporting `analyzeManifold`, `bboxDiagonal`).

- [ ] **Step 1: Move the engine with git mv, preserving history**

```bash
mkdir -p packages/engine/scripts
git mv spike/src packages/engine/src
git mv spike/wasm packages/engine/wasm
git mv spike/test packages/engine/test
git mv spike/run-admesh.mjs packages/engine/scripts/run-admesh.mjs
git rm -qf packages/engine/src/repair.mjs packages/engine/test/repair.test.mjs spike/run.mjs
git rm -qf spike/package.json spike/package-lock.json
```

The `-f` is required, not decorative. After `git mv`, the moved files are staged as new paths with no blob at that path in `HEAD`, so a bare `git rm` refuses with `error: the following file has changes staged in the index` and **aborts the whole command** — leaving `spike/run.mjs` undeleted too.

- [ ] **Step 2: Repoint the moved dev script at its new relative depth**

`scripts/run-admesh.mjs` is the only script that moves — `run.mjs` was deleted with the manifold-3d spike in Step 1. It previously sat at `spike/` and imported `./src/...`. From `packages/engine/scripts/` the sources are one level up.

Run: `rg -n "from '\./src/|from \"\./src/" packages/engine/scripts/`
For every hit, change `'./src/X.mjs'` to `'../src/X.mjs'`.

Then check fixture paths the same way:
Run: `rg -n "test/fixtures" packages/engine/scripts/`
For every hit, change `'test/fixtures/...'` to a path resolved from the script's own location:

```js
import { fileURLToPath } from 'node:url';
const fixture = fileURLToPath(new URL('../test/fixtures/tripo-broken.3mf', import.meta.url));
```

Then verify no dangling reference to the deleted manifold-3d spike survived the move:

Run: `rg -n "repair\.mjs|manifold-3d" packages/engine/`
Expected: no output. Any hit is a dangling reference to the deleted manifold-3d spike.

- [ ] **Step 3: Write the root workspace manifest**

Create `package.json`:

```json
{
  "name": "mesh-repair",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "dev": "npm run dev -w apps/web",
    "build": "npm run build -w apps/web"
  }
}
```

- [ ] **Step 4: Write the engine package manifest**

Create `packages/engine/package.json`:

```json
{
  "name": "@mesh-repair/engine",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/engine.mjs",
    "./check": "./src/check.mjs",
    "./wasm/admesh.wasm": "./wasm/admesh.wasm"
  },
  "scripts": {
    "test": "node --test"
  },
  "dependencies": {
    "fflate": "^0.8.3"
  }
}
```

`manifold-3d` is deliberately absent. It was proven not to be a repair tool (see `spike/FINDINGS.md`).

The test script passes **no path**. On Node 24, `node --test test/` treats `test/` as a module to load rather than a directory to walk, and fails with `MODULE_NOT_FOUND` before discovering anything. Bare `node --test` uses default discovery, which finds `test/*.test.mjs` correctly. (It works on Node 18, which is how this trap survives review.)

- [ ] **Step 5: Install and run the engine tests unchanged**

Run: `npm install && npm test`
Expected: PASS. Every test in `packages/engine/test/` passes. `repair.test.mjs` is gone, so the total count drops — that is the deletion above, not a regression. If any *other* test fails, a path was missed in Step 2; fix it before continuing.

- [ ] **Step 6: Verify the WASM build script still resolves its paths**

Run: `rg -n "spike" packages/engine/wasm/build.sh packages/engine/scripts/ docs/`
Expected: the only hits under `packages/engine/` are comments naming `spike/FINDINGS.md`, which genuinely stays at `spike/` — leave those alone. Any hit that is part of a **path the runtime or the build resolves** (an `import` specifier, a `cd`, a file argument in `build.sh`) is a real break; rewrite it. Hits in `docs/` are prose and may stay.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(engine): promote spike to packages/engine npm workspace"
```

---

### Task 2: Engine — expose defect edges from `analyzeManifold`

`analyzeManifold` already classifies every directed edge as open, flipped, or complex (`check.mjs:104-112`), then throws the classification away and returns counters. The viewer needs the geometry of those edges. This adds an opt-in option — opt-in because a severely damaged multi-million-triangle mesh would materialize a large array, and the engine's own tests do not want it.

**Files:**
- Modify: `packages/engine/src/check.mjs`
- Test: `packages/engine/test/check.test.mjs`

**Interfaces:**
- Consumes: `analyzeManifold(mesh, { tolerance })` from Task 1.
- Produces: `analyzeManifold(mesh, { tolerance, collectDefectEdges = false, maxDefectEdges = 100_000 })`. When `collectDefectEdges` is `true`, the returned object additionally carries `defectEdges: { open: Float32Array, flipped: Float32Array, truncated: boolean }` — `open`/`flipped` are each a flat `[x,y,z, x,y,z, ...]` array of vertex **pairs** (6 floats per edge), the layout `THREE.LineSegments` consumes directly. `maxDefectEdges` caps how many edges of each kind are collected — a hard cap so the opt-in cannot blow up memory on a catastrophically damaged mesh; `openEdges`/`flippedEdges` still report the true totals regardless of the cap. `truncated` is `true` when the true total for either kind exceeds what was collected. When `collectDefectEdges` is `false`, `defectEdges` is `undefined`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/engine/test/check.test.mjs`:

```js
// A cube with its top face (z-max) removed: 10 triangles, a 4-edge square hole.
// Same fixture shape as engine.test.mjs — ADMesh's 4-triangle floor does not
// apply to analyzeManifold, but reusing it keeps the expected counts obvious.
const HOLED_CUBE_V = [
  [0.13, 0.19, 0.07], [10.37, 0.19, 0.07], [10.37, 10.23, 0.07], [0.13, 10.23, 0.07],
  [0.13, 0.19, 10.41], [10.37, 0.19, 10.41], [10.37, 10.23, 10.41], [0.13, 10.23, 10.41],
];
const HOLED_CUBE_F = [
  [0, 2, 1], [0, 3, 2],
  [0, 1, 5], [0, 5, 4],
  [3, 7, 6], [3, 6, 2],
  [0, 4, 7], [0, 7, 3],
  [1, 2, 6], [1, 6, 5],
];
function unsharedMesh(v, f) {
  const vertProperties = new Float32Array(f.length * 9);
  const triVerts = new Uint32Array(f.length * 3);
  let vp = 0;
  for (let t = 0; t < f.length; t++) {
    for (let c = 0; c < 3; c++) {
      const [x, y, z] = v[f[t][c]];
      vertProperties[vp++] = x; vertProperties[vp++] = y; vertProperties[vp++] = z;
    }
    triVerts[t * 3] = t * 3; triVerts[t * 3 + 1] = t * 3 + 1; triVerts[t * 3 + 2] = t * 3 + 2;
  }
  return { vertProperties, triVerts };
}

test('analyzeManifold omits defectEdges unless asked', () => {
  const r = analyzeManifold(unsharedMesh(HOLED_CUBE_V, HOLED_CUBE_F), { tolerance: 1e-4 });
  assert.equal(r.openEdges, 4);
  assert.equal(r.defectEdges, undefined);
});

test('analyzeManifold collects the open-edge segments when asked', () => {
  const r = analyzeManifold(unsharedMesh(HOLED_CUBE_V, HOLED_CUBE_F), {
    tolerance: 1e-4,
    collectDefectEdges: true,
  });
  assert.equal(r.openEdges, 4);
  assert.ok(r.defectEdges.open instanceof Float32Array);
  // 4 open edges * 2 endpoints * 3 floats
  assert.equal(r.defectEdges.open.length, 24);
  assert.equal(r.defectEdges.flipped.length, 0, 'the holed cube is consistently wound');
  // Every endpoint of the boundary loop lies on the missing top face (z = 10.41).
  for (let i = 2; i < r.defectEdges.open.length; i += 3) {
    assert.ok(Math.abs(r.defectEdges.open[i] - 10.41) < 1e-3, `endpoint ${i} is not on the hole rim`);
  }
});

test('analyzeManifold caps the collected defect edges and says so', () => {
  const r = analyzeManifold(unsharedMesh(HOLED_CUBE_V, HOLED_CUBE_F), {
    tolerance: 1e-4,
    collectDefectEdges: true,
    maxDefectEdges: 2,
  });
  assert.equal(r.openEdges, 4, 'the count is the true total, not the collected total');
  assert.equal(r.defectEdges.open.length, 12, 'only 2 edges collected * 6 floats');
  assert.equal(r.defectEdges.truncated, true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @mesh-repair/engine`
Expected: FAIL — the first new test may pass incidentally (`defectEdges` is already `undefined`), the second fails with `Cannot read properties of undefined (reading 'open')`.

- [ ] **Step 3: Implement the collection**

In `packages/engine/src/check.mjs`, change the signature:

```js
export function analyzeManifold(mesh, { tolerance = 1e-4, collectDefectEdges = false, maxDefectEdges = 100_000 } = {}) {
```

Replace the classification loop (currently `check.mjs:101-112`) with:

```js
  let openEdges = 0;
  let complexEdges = 0;
  let flippedEdges = 0;
  // Only populated when collectDefectEdges is true. On a badly damaged
  // multi-million-triangle mesh these arrays are large, so the caller opts in.
  const openKeys = [];
  const flippedKeys = [];
  const keys = new Set([...forward.keys(), ...backward.keys()]);
  for (const key of keys) {
    const f = forward.get(key) || 0;
    const b = backward.get(key) || 0;
    const total = f + b;
    if (total === 1) { openEdges++; if (collectDefectEdges && openKeys.length < maxDefectEdges) openKeys.push(key); }
    else if (total > 2) complexEdges++;
    else if (total === 2 && (f === 2 || b === 2)) { // both uses same direction = orientation defect
      flippedEdges++;
      if (collectDefectEdges && flippedKeys.length < maxDefectEdges) flippedKeys.push(key);
    }
  }

  // Edge keys are `${a}_${b}` over canonical (welded) vertex ids, so both
  // endpoints resolve through repPosition. Emits the flat vertex-pair layout
  // THREE.LineSegments reads directly: [x,y,z, x,y,z, ...].
  const toSegments = (edgeKeys) => {
    const out = new Float32Array(edgeKeys.length * 6);
    let i = 0;
    for (const key of edgeKeys) {
      const sep = key.indexOf('_');
      const p = repPosition[Number(key.slice(0, sep))];
      const q = repPosition[Number(key.slice(sep + 1))];
      out[i++] = p.x; out[i++] = p.y; out[i++] = p.z;
      out[i++] = q.x; out[i++] = q.y; out[i++] = q.z;
    }
    return out;
  };
```

Then extend the return object (currently `check.mjs:114-123`) with one property, leaving every existing property exactly as it is:

```js
    signedVolume,
    defectEdges: collectDefectEdges
      ? {
          open: toSegments(openKeys),
          flipped: toSegments(flippedKeys),
          // The overlay is a visual cue, not an inventory. Past the cap we stop
          // collecting; openEdges/flippedEdges still report the true totals.
          truncated: openEdges > openKeys.length || flippedEdges > flippedKeys.length,
        }
      : undefined,
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @mesh-repair/engine`
Expected: PASS, all tests, including the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/check.mjs packages/engine/test/check.test.mjs
git commit -m "feat(engine): opt-in defect-edge segments from analyzeManifold"
```

---

### Task 3: Engine — progress callback, geometry passthrough, and `report.warnings`

Three changes to `engine.mjs`, all additive, all needed by the worker and viewer:

1. `onProgress(phase, info)` — the worker turns these into watchdog heartbeats.
2. `beforeMesh` / `afterMesh` in the return value — the viewer needs both geometries; re-parsing the file on the main thread would duplicate work the worker already did.
3. `report.warnings` replaces the `console.warn` at `engine.mjs:29`. A warning that exists only in the developer console does not exist for the user.

`report.pass` keeps its exact current definition. Exceeding the complex-edge baseline is a warning, never a failure.

**Files:**
- Modify: `packages/engine/src/engine.mjs`
- Test: `packages/engine/test/engine.test.mjs`

**Interfaces:**
- Consumes: `analyzeManifold(mesh, { tolerance, collectDefectEdges })` from Task 2.
- Produces:
  - `buildWarnings(after, baseline)` → `string[]`. Exported for direct unit testing.
  - `COMPLEX_BASELINE` → `2`. Exported.
  - `repairMesh(fileBytes, kind, { onProgress, collectDefectEdges })` → `Promise<{ stl: Uint8Array, report: { before, after, pass: boolean, warnings: string[] }, beforeMesh: { vertProperties: Float32Array, triVerts: Uint32Array }, afterMesh: { vertProperties: Float32Array, triVerts: Uint32Array } }>`.
  - `onProgress` is called once per phase, on **entering** it, in the order `parse`, `analyze-before`, `repair`, `analyze-after`, `export`. Its second argument is `{}` for `parse` and `{ triangles: number }` for every later phase.

- [ ] **Step 1: Write the failing tests**

Append to `packages/engine/test/engine.test.mjs`. The file already imports `repairMesh` (line 3) and `buildBinaryStl` (line 4), and defines `V`, `F`, and `buf` at module scope. Reuse all of them — re-importing an already-bound name is a `SyntaxError`, not a warning. Append ONLY the import shown below.

```js
import { buildWarnings, COMPLEX_BASELINE } from '../src/engine.mjs';

test('buildWarnings is silent at or below the slicer-validated baseline', () => {
  assert.deepEqual(buildWarnings({ complexEdges: COMPLEX_BASELINE }, COMPLEX_BASELINE), []);
  assert.deepEqual(buildWarnings({ complexEdges: 0 }, COMPLEX_BASELINE), []);
});

test('buildWarnings warns above the baseline and names both numbers', () => {
  const warnings = buildWarnings({ complexEdges: 7 }, COMPLEX_BASELINE);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /7/);
  assert.match(warnings[0], /2/);
});

test('repairMesh reports phases in order, with triangle counts after parse', async () => {
  const stlIn = buildBinaryStl(buf(V, F));
  const seen = [];
  await repairMesh(stlIn, 'stl', { onProgress: (phase, info) => seen.push([phase, info]) });

  assert.deepEqual(
    seen.map(([phase]) => phase),
    ['parse', 'analyze-before', 'repair', 'analyze-after', 'export'],
  );
  assert.deepEqual(seen[0][1], {}, 'triangle count is unknown before parsing');
  for (const [phase, info] of seen.slice(1)) {
    assert.equal(info.triangles, 10, `phase ${phase} should carry the parsed triangle count`);
  }
});

test('repairMesh returns both geometries and an empty warnings array on a clean repair', async () => {
  const stlIn = buildBinaryStl(buf(V, F));
  const { report, beforeMesh, afterMesh } = await repairMesh(stlIn, 'stl');

  assert.deepEqual(report.warnings, []);
  assert.ok(beforeMesh.vertProperties instanceof Float32Array);
  assert.ok(afterMesh.triVerts instanceof Uint32Array);
  assert.equal(beforeMesh.triVerts.length / 3, 10, 'before = the 10-triangle holed cube');
  assert.ok(afterMesh.triVerts.length / 3 >= 10, 'after = the cube with the hole filled');
});

test('repairMesh passes defect edges through when asked', async () => {
  const stlIn = buildBinaryStl(buf(V, F));
  const { report } = await repairMesh(stlIn, 'stl', { collectDefectEdges: true });
  assert.equal(report.before.defectEdges.open.length, 24, '4 open edges * 2 endpoints * 3 floats');
  assert.equal(report.after.defectEdges.open.length, 0, 'the hole is closed');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @mesh-repair/engine`
Expected: FAIL with `The requested module '../src/engine.mjs' does not provide an export named 'buildWarnings'`. If you instead see `SyntaxError: Identifier 'repairMesh' has already been declared`, you re-imported a name the file already binds — remove it from your import line.

- [ ] **Step 3: Rewrite `engine.mjs`**

Replace the whole file with:

```js
import { parse3mf } from './mesh3mf.mjs';
import { parseBinaryStl, buildBinaryStl } from './stl.mjs';
import { analyzeManifold, bboxDiagonal } from './check.mjs';
import { repairWithAdmesh } from './repair-admesh.mjs';

// Same validated baseline as scripts/run-admesh.mjs (see spike/FINDINGS.md): the
// native repair run left exactly 2 residual complex edges while OrcaSlicer
// still reported manifold = yes. Exceeding it is a signal to re-check against
// the slicer, not a hard failure — pass/fail stays driven by openEdges/
// flippedEdges/signedVolume alone.
export const COMPLEX_BASELINE = 2;

// Surfaced through report.warnings so the UI can render them. A console.warn
// here would be invisible to the only person who needs to see it: the user.
export function buildWarnings(after, baseline = COMPLEX_BASELINE) {
  const warnings = [];
  if (after.complexEdges > baseline) {
    warnings.push(
      `${after.complexEdges} complex edges remain, above the slicer-validated baseline of ${baseline}. `
      + 'The repaired mesh may still fail to slice — check it in your slicer before printing.',
    );
  }
  return warnings;
}

// Framework-agnostic repair entry point for the browser/Worker layer.
// onProgress(phase, info) fires on ENTERING each phase; the Worker forwards
// these as watchdog heartbeats, so a phase must never be entered silently.
export async function repairMesh(fileBytes, kind, { onProgress = () => {}, collectDefectEdges = false } = {}) {
  const bytes = fileBytes instanceof Uint8Array ? fileBytes : new Uint8Array(fileBytes);

  onProgress('parse', {});
  let parsed;
  if (kind === '3mf') parsed = parse3mf(bytes);
  else if (kind === 'stl') parsed = parseBinaryStl(bytes);
  else throw new Error(`unsupported kind: ${kind} (expected 'stl' or '3mf')`);

  const triangles = parsed.triVerts.length / 3;
  const d = bboxDiagonal(parsed.vertProperties);
  const tolerance = !Number.isFinite(d) || d === 0 ? 1e-6 : Math.max(1e-6, d * 1e-6);

  onProgress('analyze-before', { triangles });
  const before = analyzeManifold(parsed, { tolerance, collectDefectEdges });

  onProgress('repair', { triangles });
  const { mesh } = await repairWithAdmesh(parsed);

  onProgress('analyze-after', { triangles });
  const after = analyzeManifold(mesh, { tolerance, collectDefectEdges });

  const pass = after.openEdges === 0 && after.flippedEdges === 0 && after.triangles > 0 && Math.abs(after.signedVolume) > 0;

  onProgress('export', { triangles });
  return {
    stl: buildBinaryStl(mesh),
    report: { before, after, pass, warnings: buildWarnings(after) },
    beforeMesh: parsed,
    afterMesh: mesh,
  };
}
```

Note the `onProgress('parse', {})` sits **before** the `kind` validation, so an unsupported kind still throws exactly as before — the existing `repairMesh rejects an unknown kind` test must keep passing.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @mesh-repair/engine`
Expected: PASS, including the pre-existing `repairMesh repairs a holed STL and reports pass` and `repairMesh rejects an unknown kind`.

- [ ] **Step 5: Verify no `console.warn` survives in the engine**

Run: `rg -n "^\s*console\.(warn|log)" packages/engine/src/`
Expected: no output.

The `^\s*` anchor matters: `engine.mjs` now carries a comment explaining why a `console.warn` would be wrong here, and an unanchored search matches its own prose.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/engine.mjs packages/engine/test/engine.test.mjs
git commit -m "feat(engine): progress callback, geometry passthrough, report.warnings"
```

---

### Task 4: Engine — make the WASM binary locatable from a bundler

`repair-admesh.mjs:11` calls `createAdmesh()` with no arguments. Emscripten's generated loader then resolves `admesh.wasm` relative to `import.meta.url`. Inside a Vite-bundled Web Worker that URL is the bundle's, not the package's, so the fetch 404s at runtime.

This is not covered by the design spec — it surfaced while reading the code. The fix is one injected option, and it keeps the engine free of any bundler knowledge: the **caller** supplies the URL.

**Files:**
- Modify: `packages/engine/src/repair-admesh.mjs`
- Test: `packages/engine/test/repair-admesh.test.mjs`

**Interfaces:**
- Consumes: `repairWithAdmesh(input)` from Task 1.
- Produces: `configureAdmesh({ locateFile })`. Call it **before** the first `repairWithAdmesh`. `locateFile` is Emscripten's hook: `(path: string, scriptDirectory: string) => string`. Calling it after the module is instantiated throws `AdmeshEngineError`, because the instance is cached and a late reconfiguration would silently not apply.

- [ ] **Step 1: Write the failing test**

Append to `packages/engine/test/repair-admesh.test.mjs`:

The file already imports `repairWithAdmesh` and `AdmeshEngineError` (line 3), and defines `CUBE_V`, `HOLED_CUBE_F`, and `toBuffer` at module scope. Reuse all of them — re-importing an already-bound name is a `SyntaxError`, not a warning. Append ONLY the import shown below. Verify the names first with `rg -n "^import|CUBE_V|HOLED_CUBE_F|toBuffer" packages/engine/test/repair-admesh.test.mjs`.

```js
import { configureAdmesh } from '../src/repair-admesh.mjs';

test('configureAdmesh throws once the module is already instantiated', async () => {
  // Force instantiation here rather than relying on an earlier test in this
  // file having run first: the cached module is process-wide state, and a test
  // whose truth depends on declaration order proves nothing when run alone.
  // The fixture is BUILT by this file's own toBuffer helper — there is no
  // pre-made mesh object to reference. 10 triangles / 584 bytes, clearing
  // ADMesh's 4-triangle / 284-byte floor.
  await repairWithAdmesh(toBuffer(CUBE_V, HOLED_CUBE_F));

  assert.throws(
    () => configureAdmesh({ locateFile: () => '/nope.wasm' }),
    AdmeshEngineError,
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @mesh-repair/engine`
Expected: FAIL with `does not provide an export named 'configureAdmesh'`. If you instead see `SyntaxError: Identifier 'repairWithAdmesh' has already been declared` (or `'AdmeshEngineError'`), you re-imported a name the file already binds — remove it from your import line.

- [ ] **Step 3: Implement**

In `packages/engine/src/repair-admesh.mjs`, replace the module cache block (currently lines 8-13) with:

```js
let modPromise;
let moduleOptions = {};

// Supplies Emscripten's options — in practice { locateFile } — before the
// module is instantiated. A bundler rewrites import.meta.url inside the
// generated loader, so the default resolution of admesh.wasm cannot be
// trusted there; the caller, who knows its own asset URLs, hands us one.
// Must be called before the first repairWithAdmesh: the instance is cached,
// so a late call would be silently ignored. We throw instead.
export function configureAdmesh(options) {
  if (modPromise) throw new AdmeshEngineError('configureAdmesh called after the ADMesh module was instantiated');
  moduleOptions = options;
}

function getModule() {
  // Instantiate the Emscripten module once and reuse it.
  if (!modPromise) modPromise = createAdmesh(moduleOptions);
  return modPromise;
}
```

`export class AdmeshEngineError` must stay above `configureAdmesh` in the file — it is referenced at call time, but keeping the declaration first avoids any temporal-dead-zone surprise for a reader.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @mesh-repair/engine`
Expected: PASS. All pre-existing `repair-admesh` tests still pass, because `createAdmesh({})` behaves exactly as `createAdmesh()`.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/repair-admesh.mjs packages/engine/test/repair-admesh.test.mjs
git commit -m "feat(engine): allow the caller to locate admesh.wasm"
```

---

### Task 5: App scaffold — Vite, TypeScript, Vitest, promo shell

One screen, no framework. This task produces a page that builds, serves, states the privacy guarantee, and links to SliceMargin. No repair yet.

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.ts`
- Create: `apps/web/src/promo.ts`
- Create: `apps/web/src/styles.css`
- Test: `apps/web/test/promo.test.ts`

**Interfaces:**
- Consumes: `@mesh-repair/engine` (declared as a workspace dependency; not imported yet).
- Produces: `renderPromo(root: HTMLElement): void` — mounts the header, the privacy line, and the SliceMargin CTA.

- [ ] **Step 1: Write the app manifest and config**

Create `apps/web/package.json`:

```json
{
  "name": "@mesh-repair/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "@mesh-repair/engine": "*",
    "three": "^0.169.0"
  },
  "devDependencies": {
    "@types/three": "^0.169.0",
    "happy-dom": "^15.11.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

`three` ships no `.d.ts` files of its own — `@types/three` is a separate package, and without it `tsc --noEmit` fails with `TS7016` on `geometry.ts` and `viewer.ts`. Vitest would still pass, because esbuild strips types without checking them.

Create `apps/web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src", "test"]
}
```

Create `apps/web/vite.config.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/test/promo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderPromo, SLICEMARGIN_URL } from '../src/promo';

describe('renderPromo', () => {
  it('states the privacy guarantee in plain language', () => {
    const root = document.createElement('div');
    renderPromo(root);
    expect(root.textContent).toMatch(/never leaves your (computer|browser|machine)/i);
  });

  it('links to SliceMargin', () => {
    const root = document.createElement('div');
    renderPromo(root);
    const cta = root.querySelector<HTMLAnchorElement>('a[data-testid="slicemargin-cta"]');
    expect(cta).not.toBeNull();
    expect(cta!.href).toContain(SLICEMARGIN_URL);
    expect(cta!.rel).toContain('noopener');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -w @mesh-repair/web`
Expected: FAIL — `Failed to resolve import "../src/promo"`.

- [ ] **Step 4: Implement the promo shell**

Create `apps/web/src/promo.ts`:

```ts
export const SLICEMARGIN_URL = 'https://slicemargin.com';

export function renderPromo(root: HTMLElement): void {
  const header = document.createElement('header');
  header.innerHTML = `
    <h1>Mesh Repair</h1>
    <p class="tagline">Fix broken STL and 3MF meshes so they slice and print.</p>
    <p class="privacy">Everything runs in your browser. Your model never leaves your computer.</p>
  `;

  const footer = document.createElement('footer');
  const cta = document.createElement('a');
  cta.dataset.testid = 'slicemargin-cta';
  cta.href = SLICEMARGIN_URL;
  cta.target = '_blank';
  cta.rel = 'noopener noreferrer';
  cta.textContent = 'Price your prints with SliceMargin';
  footer.append(cta);

  root.append(header, footer);
}
```

Create `apps/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mesh Repair — fix broken STL and 3MF meshes in your browser</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Create `apps/web/src/main.ts`:

```ts
import './styles.css';
import { renderPromo } from './promo';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app not found');
renderPromo(root);
```

Create `apps/web/src/styles.css`:

```css
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; padding: 2rem; max-width: 60rem; margin-inline: auto; }
.privacy { font-weight: 600; }
footer { margin-top: 3rem; }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm install && npm test -w @mesh-repair/web`
Expected: PASS, 2 tests.

- [ ] **Step 6: Verify the app builds and serves**

Run: `npm run build -w @mesh-repair/web`
Expected: exit 0, a `dist/` directory is produced.

- [ ] **Step 7: Ignore the build output before it gets committed**

Step 6 just created `dist/`. Step 8's `git add apps/web` would commit it, and every later build rewrites its content-hashed filenames — the repo would accumulate churn forever.

Append to the root `.gitignore`:

```gitignore
# Build and test output
dist/
test-results/
playwright-report/
```

Verify: `git status --short apps/web` shows no `dist/` entries.

- [ ] **Step 8: Commit**

```bash
git add .gitignore apps/web package.json package-lock.json
git commit -m "feat(web): Vite + TypeScript scaffold with promo shell"
```

---

### Task 6: App — file intake and kind detection

**Files:**
- Create: `apps/web/src/dropzone.ts`
- Test: `apps/web/test/dropzone.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `detectKind(fileName: string): 'stl' | '3mf' | null` — by extension, case-insensitive. `null` means unsupported.
  - `SOFT_CAP_BYTES: number` = `150 * 1024 * 1024`.
  - `isOverSoftCap(sizeBytes: number): boolean`.
  - `mountDropzone(root: HTMLElement, onFile: (file: File) => void): void` — wires drag/drop and a file picker, calls `onFile` for every accepted drop or selection. It does **not** validate; validation is the caller's job so the state machine owns all error copy.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/dropzone.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { detectKind, isOverSoftCap, SOFT_CAP_BYTES, mountDropzone } from '../src/dropzone';

describe('detectKind', () => {
  it('recognizes stl and 3mf regardless of case', () => {
    expect(detectKind('frog.stl')).toBe('stl');
    expect(detectKind('FROG.STL')).toBe('stl');
    expect(detectKind('cute+frog+3d+model.3mf')).toBe('3mf');
    expect(detectKind('frog.3MF')).toBe('3mf');
  });

  it('returns null for anything else', () => {
    expect(detectKind('frog.obj')).toBeNull();
    expect(detectKind('frog')).toBeNull();
    expect(detectKind('frog.stl.zip')).toBeNull();
    expect(detectKind('.stl')).toBeNull();
  });
});

describe('isOverSoftCap', () => {
  it('is exclusive at the cap', () => {
    expect(isOverSoftCap(SOFT_CAP_BYTES)).toBe(false);
    expect(isOverSoftCap(SOFT_CAP_BYTES + 1)).toBe(true);
  });
});

describe('mountDropzone', () => {
  it('hands the dropped file to the caller and cancels the browser default', () => {
    const root = document.createElement('div');
    const onFile = vi.fn();
    mountDropzone(root, onFile);

    const file = new File([new Uint8Array([1, 2, 3])], 'frog.stl');
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } });
    root.querySelector('[data-testid="dropzone"]')!.dispatchEvent(event);

    expect(onFile).toHaveBeenCalledWith(file);
    expect(event.defaultPrevented).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @mesh-repair/web`
Expected: FAIL — `Failed to resolve import "../src/dropzone"`.

- [ ] **Step 3: Implement**

Create `apps/web/src/dropzone.ts`:

```ts
export type MeshKind = 'stl' | '3mf';

// The product spec sets a soft cap: warn, never hard-reject. 150 MB comfortably
// clears the real 94 MB Tripo STL fixture.
export const SOFT_CAP_BYTES = 150 * 1024 * 1024;

export function isOverSoftCap(sizeBytes: number): boolean {
  return sizeBytes > SOFT_CAP_BYTES;
}

export function detectKind(fileName: string): MeshKind | null {
  const dot = fileName.lastIndexOf('.');
  // dot <= 0 rejects both "frog" (no extension) and ".stl" (all extension).
  if (dot <= 0) return null;
  const ext = fileName.slice(dot + 1).toLowerCase();
  if (ext === 'stl') return 'stl';
  if (ext === '3mf') return '3mf';
  return null;
}

export function mountDropzone(root: HTMLElement, onFile: (file: File) => void): void {
  const zone = document.createElement('div');
  zone.dataset.testid = 'dropzone';
  zone.className = 'dropzone';
  zone.innerHTML = '<p>Drop an STL or 3MF file here</p>';

  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.stl,.3mf';
  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    if (file) onFile(file);
    // Reset so re-selecting the same file fires 'change' again.
    picker.value = '';
  });

  // Without preventDefault on dragover the browser navigates away to the file.
  zone.addEventListener('dragover', (event) => event.preventDefault());
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = (event as DragEvent).dataTransfer?.files?.[0];
    if (file) onFile(file);
  });

  zone.append(picker);
  root.append(zone);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @mesh-repair/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/dropzone.ts apps/web/test/dropzone.test.ts
git commit -m "feat(web): drag/drop intake with file-kind detection"
```

---

### Task 7: App — the worker and the watchdog

The load-bearing task. A hung WASM call cannot be interrupted from inside; `worker.terminate()` from the main thread is the only recovery. The watchdog arms a deadline per phase, disarms it on that phase's heartbeat, and kills the worker if a deadline expires.

The `repair` phase is one opaque WASM call. No heartbeat is possible inside it. It gets a hard ceiling and nothing more. This is a known, accepted gap — do not pretend otherwise in comments or copy.

`repairInWorker` takes a `WorkerLike`, not a `Worker`, so the tests drive it with a scripted stub: no browser, no WebGL, no real WASM, deterministic.

**Files:**
- Create: `apps/web/src/repair-client.ts`
- Create: `apps/web/src/worker/repair.worker.ts`
- Create: `apps/web/src/engine.d.ts`
- Modify: `packages/engine/src/engine.mjs` (re-export `configureAdmesh`; Task 3 already rewrote this file)
- Test: `apps/web/test/repair-client.test.ts`

**Interfaces:**
- Consumes: `MeshKind` from Task 6; `repairMesh` and its `onProgress` contract from Task 3; `configureAdmesh` from Task 4.
- Produces:
  - `type Phase = 'parse' | 'analyze-before' | 'repair' | 'analyze-after' | 'export'`
  - `PHASES: readonly Phase[]`
  - `class RepairTimeoutError extends Error { readonly phase: Phase }`
  - `class RepairFailedError extends Error {}`
  - `class EngineLoadError extends Error {}` — thrown when the worker's `error` event fires: the worker script or its `.wasm` asset failed to fetch or instantiate. Distinct from `RepairFailedError`, which means the engine ran and rejected the mesh.
  - `estimateTriangles(sizeBytes: number, kind: MeshKind): number`
  - `phaseBudgetMs(phase: Phase, triangles: number): number`
  - ```ts
    // Typed against the real DOM Worker's exact event types. Under
    // strictFunctionTypes handler parameters are checked CONTRAVARIANTLY: widening
    // `ev` to `ErrorEvent | Event` makes a real Worker UNassignable, because its own
    // handler only accepts `ErrorEvent`. Narrower here, not wider.
    export interface WorkerLike {
      postMessage(msg: unknown, transfer?: Transferable[]): void;
      terminate(): void;
      onmessage: ((ev: MessageEvent) => void) | null;
      onerror: ((ev: ErrorEvent) => void) | null;
    }
    ```
  - `interface RepairResult { stl: Uint8Array; report: Report; beforeMesh: MeshBuffers; afterMesh: MeshBuffers }`
  - `repairInWorker(worker: WorkerLike, bytes: ArrayBuffer, kind: MeshKind, opts?: { onPhase?: (phase: Phase) => void }): Promise<RepairResult>`
  - `createRepairWorker(): Worker` — the real one, wired to `repair.worker.ts`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/repair-client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  repairInWorker,
  phaseBudgetMs,
  estimateTriangles,
  RepairTimeoutError,
  RepairFailedError,
  EngineLoadError,
  PHASES,
  type WorkerLike,
} from '../src/repair-client';

class FakeWorker implements WorkerLike {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  posted: unknown[] = [];
  terminated = 0;
  postMessage(msg: unknown): void { this.posted.push(msg); }
  terminate(): void { this.terminated++; }
  emit(data: unknown): void { this.onmessage?.({ data } as MessageEvent); }
  crash(): void { this.onerror?.(new ErrorEvent('error')); }
}

const DONE = {
  type: 'done',
  stl: new Uint8Array([1, 2, 3]),
  report: { before: {}, after: {}, pass: true, warnings: [] },
  beforeMesh: { vertProperties: new Float32Array(), triVerts: new Uint32Array() },
  afterMesh: { vertProperties: new Float32Array(), triVerts: new Uint32Array() },
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// `arm()`'s setTimeout rejects this promise while fake timers advance, one
// microtask before `expect(...).rejects` can attach its handler. Node's
// unhandled-rejection tracker fires in that window and vitest exits 1 even
// though every assertion passes. An inert handler attached at creation closes
// the window without changing what the promise settles to.
const started = <T>(promise: Promise<T>): Promise<T> => {
  promise.catch(() => {});
  return promise;
};

// Stated limitation: the timeout tests below compute their expected deadline by
// calling phaseBudgetMs() themselves — a self-referential oracle. If the budget
// formula were gutted to a constant, those tests would still pass; only the two
// tests in THIS block would catch it. Keep them.
describe('phaseBudgetMs', () => {
  it('grows with triangle count so a big mesh is not mistaken for a dead one', () => {
    expect(phaseBudgetMs('repair', 2_000_000)).toBeGreaterThan(phaseBudgetMs('repair', 10));
  });

  it('gives every phase a positive budget at zero triangles', () => {
    for (const phase of PHASES) expect(phaseBudgetMs(phase, 0)).toBeGreaterThan(0);
  });
});

describe('estimateTriangles', () => {
  it('derives the exact triangle count from a binary STL size', () => {
    expect(estimateTriangles(84 + 50 * 12, 'stl')).toBe(12);
  });

  it('never returns a negative estimate for a truncated file', () => {
    expect(estimateTriangles(10, 'stl')).toBe(0);
  });
});

describe('repairInWorker', () => {
  it('resolves when every phase reports in and the worker is done', async () => {
    const worker = new FakeWorker();
    const seen: string[] = [];
    const promise = repairInWorker(worker, new ArrayBuffer(884), 'stl', {
      onPhase: (p) => seen.push(p),
    });

    for (const phase of PHASES) worker.emit({ type: 'progress', phase, triangles: 16 });
    worker.emit(DONE);

    await expect(promise).resolves.toMatchObject({ report: { pass: true } });
    expect(seen).toEqual([...PHASES]);
    expect(worker.terminated).toBe(0);
  });

  it('terminates the worker and reports the hung phase when a deadline expires', async () => {
    const worker = new FakeWorker();
    const promise = started(repairInWorker(worker, new ArrayBuffer(884), 'stl'));

    worker.emit({ type: 'progress', phase: 'parse', triangles: undefined });
    worker.emit({ type: 'progress', phase: 'analyze-before', triangles: 16 });
    worker.emit({ type: 'progress', phase: 'repair', triangles: 16 });
    // ADMesh hangs: no further heartbeat ever arrives.
    await vi.advanceTimersByTimeAsync(phaseBudgetMs('repair', 16) + 1);

    await expect(promise).rejects.toBeInstanceOf(RepairTimeoutError);
    await expect(promise).rejects.toMatchObject({ phase: 'repair' });
    expect(worker.terminated).toBe(1);
  });

  it('does not fire a stale deadline after the previous phase reported in', async () => {
    const worker = new FakeWorker();
    const promise = repairInWorker(worker, new ArrayBuffer(884), 'stl');

    worker.emit({ type: 'progress', phase: 'parse', triangles: undefined });
    await vi.advanceTimersByTimeAsync(phaseBudgetMs('parse', 16) - 1);
    worker.emit({ type: 'progress', phase: 'analyze-before', triangles: 16 });
    await vi.advanceTimersByTimeAsync(2);

    expect(worker.terminated).toBe(0);
    worker.emit(DONE);
    await expect(promise).resolves.toBeDefined();
  });

  it('rejects and terminates when the worker reports an engine error', async () => {
    const worker = new FakeWorker();
    const promise = started(repairInWorker(worker, new ArrayBuffer(884), 'stl'));
    worker.emit({ type: 'error', message: 'mesh too small or malformed for ADMesh' });

    await expect(promise).rejects.toBeInstanceOf(RepairFailedError);
    await expect(promise).rejects.toThrow(/too small/);
    expect(worker.terminated).toBe(1);
  });

  it('reports an engine load failure when the worker fires an error event', async () => {
    const worker = new FakeWorker();
    const promise = started(repairInWorker(worker, new ArrayBuffer(884), 'stl'));
    worker.crash();

    await expect(promise).rejects.toBeInstanceOf(EngineLoadError);
    expect(worker.terminated).toBe(1);
  });

  it('ignores messages that arrive after it has settled', async () => {
    const worker = new FakeWorker();
    const promise = started(repairInWorker(worker, new ArrayBuffer(884), 'stl'));
    worker.emit({ type: 'error', message: 'boom' });
    await expect(promise).rejects.toBeInstanceOf(RepairFailedError);

    worker.emit(DONE);
    expect(worker.terminated).toBe(1);
  });

  it('arms no timer once settled', async () => {
    const worker = new FakeWorker();
    const promise = repairInWorker(worker, new ArrayBuffer(884), 'stl');
    for (const phase of PHASES) worker.emit({ type: 'progress', phase, triangles: 16 });
    worker.emit(DONE);
    await promise;

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(worker.terminated).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @mesh-repair/web`
Expected: FAIL — `Failed to resolve import "../src/repair-client"`.

- [ ] **Step 3: Implement the client and the watchdog**

Create `apps/web/src/repair-client.ts`:

```ts
import type { MeshKind } from './dropzone';

export type Phase = 'parse' | 'analyze-before' | 'repair' | 'analyze-after' | 'export';

export const PHASES: readonly Phase[] = ['parse', 'analyze-before', 'repair', 'analyze-after', 'export'];

export interface MeshBuffers {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
}

export interface DefectEdges {
  open: Float32Array;
  flipped: Float32Array;
  truncated: boolean;
}

export interface ManifoldReport {
  openEdges: number;
  complexEdges: number;
  flippedEdges: number;
  nonManifoldEdges: number;
  weldedVertices: number;
  triangles: number;
  degenerateTriangles: number;
  signedVolume: number;
  defectEdges?: DefectEdges;
}

export interface Report {
  before: ManifoldReport;
  after: ManifoldReport;
  pass: boolean;
  warnings: string[];
}

export interface RepairResult {
  stl: Uint8Array;
  report: Report;
  beforeMesh: MeshBuffers;
  afterMesh: MeshBuffers;
}

// Typed against the real DOM Worker's exact event types. Under
// strictFunctionTypes handler parameters are checked CONTRAVARIANTLY: widening
// `ev` to `ErrorEvent | Event` makes a real Worker UNassignable, because its own
// handler only accepts `ErrorEvent`. Narrower here, not wider.
export interface WorkerLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
}

export class RepairTimeoutError extends Error {
  constructor(readonly phase: Phase) {
    super(`the "${phase}" phase stopped responding`);
    this.name = 'RepairTimeoutError';
  }
}

export class RepairFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepairFailedError';
  }
}

// A Worker `error` event is how a module/WASM load failure surfaces: the
// worker script or its .wasm asset failed to fetch or instantiate. It is a
// distinct user-facing state from "the engine ran and rejected this mesh".
export class EngineLoadError extends Error {
  constructor(message = 'the repair engine failed to load') {
    super(message);
    this.name = 'EngineLoadError';
  }
}

// base: fixed startup cost. perTriangle: marginal cost, so a legitimately slow
// large mesh is never mistaken for a dead one. Deliberately generous — this is
// a hang detector, not a performance budget. Calibrate against the real Tripo
// fixture (1,876,984 triangles) before changing any number here.
const BUDGETS: Record<Phase, { base: number; perTriangle: number }> = {
  'parse': { base: 5_000, perTriangle: 0.02 },
  'analyze-before': { base: 5_000, perTriangle: 0.05 },
  // The single opaque ADMesh WASM call. NO heartbeat is possible inside it
  // without instrumenting the C source, so this ceiling is the only guard.
  'repair': { base: 10_000, perTriangle: 0.10 },
  'analyze-after': { base: 5_000, perTriangle: 0.05 },
  'export': { base: 5_000, perTriangle: 0.02 },
};

export function phaseBudgetMs(phase: Phase, triangles: number): number {
  const { base, perTriangle } = BUDGETS[phase];
  // Ceil to whole milliseconds: setTimeout truncates fractional delays, and a
  // budget that silently loses its fraction is a budget nobody can reason about.
  return Math.ceil(base + perTriangle * Math.max(0, triangles));
}

// Used only for the `parse` deadline, before any real triangle count is known.
// Binary STL is exact. A 3MF is deflated XML; 12 bytes per triangle is a coarse
// floor drawn from the real fixture (32 MB zipped, ~1.88M triangles) and errs
// toward a larger estimate, i.e. a more generous deadline.
export function estimateTriangles(sizeBytes: number, kind: MeshKind): number {
  if (kind === 'stl') return Math.max(0, Math.floor((sizeBytes - 84) / 50));
  return Math.max(0, Math.floor(sizeBytes / 12));
}

export function repairInWorker(
  worker: WorkerLike,
  bytes: ArrayBuffer,
  kind: MeshKind,
  { onPhase }: { onPhase?: (phase: Phase) => void } = {},
): Promise<RepairResult> {
  return new Promise<RepairResult>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let triangles = estimateTriangles(bytes.byteLength, kind);

    const disarm = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      disarm();
      fn();
    };

    // A hung WASM call cannot be interrupted cooperatively. terminate() is the
    // only recovery, and it also reclaims the module instance, so a hang cannot
    // leak into the next repair.
    const fail = (error: Error): void => settle(() => { worker.terminate(); reject(error); });

    // Arms the deadline for the phase we just entered: the NEXT message must
    // arrive within this phase's budget, or the phase is considered dead.
    const arm = (phase: Phase): void => {
      disarm();
      timer = setTimeout(() => fail(new RepairTimeoutError(phase)), phaseBudgetMs(phase, triangles));
    };

    worker.onerror = () => fail(new EngineLoadError());

    worker.onmessage = ({ data }): void => {
      if (settled) return;
      const msg = data as { type: string; phase?: Phase; triangles?: number; message?: string } & Partial<RepairResult>;

      if (msg.type === 'progress' && msg.phase) {
        if (typeof msg.triangles === 'number') triangles = msg.triangles;
        onPhase?.(msg.phase);
        arm(msg.phase);
        return;
      }
      if (msg.type === 'done') {
        settle(() => resolve({
          stl: msg.stl!,
          report: msg.report!,
          beforeMesh: msg.beforeMesh!,
          afterMesh: msg.afterMesh!,
        }));
        return;
      }
      if (msg.type === 'error') {
        fail(new RepairFailedError(msg.message ?? 'the repair failed'));
      }
    };

    arm('parse');
    worker.postMessage({ type: 'repair', bytes, kind }, [bytes]);
  });
}

export function createRepairWorker(): Worker {
  return new Worker(new URL('./worker/repair.worker.ts', import.meta.url), { type: 'module' });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @mesh-repair/web`
Expected: PASS, all 11 `repair-client` tests (2 in `phaseBudgetMs`, 2 in `estimateTriangles`, 7 in `repairInWorker`).

- [ ] **Step 5: Implement the real worker**

Create `apps/web/src/worker/repair.worker.ts`:

```ts
import { repairMesh, configureAdmesh } from '@mesh-repair/engine';
import wasmUrl from '@mesh-repair/engine/wasm/admesh.wasm?url';
import type { MeshKind } from '../dropzone';

// Emscripten's loader resolves admesh.wasm from import.meta.url, which the
// bundler rewrites to the bundle's own URL. Hand it the real asset URL Vite
// emitted instead. Must run before the first repairMesh call.
configureAdmesh({ locateFile: (path: string) => (path.endsWith('.wasm') ? wasmUrl : path) });

self.onmessage = async (event: MessageEvent<{ bytes: ArrayBuffer; kind: MeshKind }>) => {
  const { bytes, kind } = event.data;
  try {
    const { stl, report, beforeMesh, afterMesh } = await repairMesh(new Uint8Array(bytes), kind, {
      // Always on: the overlay is the app's entire visual proof that a repair
      // happened. analyzeManifold caps the collected edge count internally, so
      // a catastrophically damaged mesh cannot blow up memory here.
      collectDefectEdges: true,
      onProgress: (phase: string, info: { triangles?: number }) => {
        self.postMessage({ type: 'progress', phase, triangles: info?.triangles });
      },
    });

    // Every buffer below is freshly allocated by the engine, so transferring
    // them is safe: nothing in this worker reads them afterwards.
    const transfer: Transferable[] = [
      stl.buffer,
      beforeMesh.vertProperties.buffer, beforeMesh.triVerts.buffer,
      afterMesh.vertProperties.buffer, afterMesh.triVerts.buffer,
    ];
    self.postMessage({ type: 'done', stl, report, beforeMesh, afterMesh }, transfer);
  } catch (error) {
    self.postMessage({ type: 'error', message: (error as Error).message });
  }
};
```

`configureAdmesh` needs a type declaration, since the engine is untyped `.mjs`. Create `apps/web/src/engine.d.ts`:

```ts
declare module '@mesh-repair/engine' {
  export interface MeshBuffers { vertProperties: Float32Array; triVerts: Uint32Array }
  export function configureAdmesh(options: { locateFile: (path: string) => string }): void;
  export function repairMesh(
    bytes: Uint8Array,
    kind: 'stl' | '3mf',
    options?: {
      collectDefectEdges?: boolean;
      onProgress?: (phase: string, info: { triangles?: number }) => void;
    },
  ): Promise<{ stl: Uint8Array; report: unknown; beforeMesh: MeshBuffers; afterMesh: MeshBuffers }>;
}
declare module '@mesh-repair/engine/wasm/admesh.wasm?url' {
  const url: string;
  export default url;
}
```

`configureAdmesh` is exported from `repair-admesh.mjs`, not `engine.mjs`. Re-export it so the app's single entry point stays honest — append to `packages/engine/src/engine.mjs`:

```js
export { configureAdmesh, AdmeshEngineError } from './repair-admesh.mjs';
```

- [ ] **Step 6: Verify a real Worker satisfies WorkerLike**

Run: `npm run build -w @mesh-repair/web`
Expected: exit 0. This is the check that matters: `createRepairWorker()` returns a real DOM `Worker` and hands it to `repairInWorker(worker: WorkerLike, ...)`. Under `strictFunctionTypes`, handler parameters are contravariant, so `WorkerLike`'s handler parameter types must be exactly as narrow as the DOM's — `MessageEvent` and `ErrorEvent`. Typing `onmessage` as `(ev: { data: unknown }) => void`, or `onerror` as `(ev: ErrorEvent | Event) => void`, each produce `error TS2345: Argument of type 'Worker' is not assignable to parameter of type 'WorkerLike'`.

- [ ] **Step 7: Verify the suite exits 0, not just "all green"**

Run: `npm test -w @mesh-repair/web; echo "exit=$?"`
Expected: `exit=0`. A passing assertion count is not a passing suite. The watchdog's timeout is delivered by a `setTimeout` callback firing inside `vi.advanceTimersByTimeAsync`, which rejects the promise one microtask before `expect(...).rejects` attaches its handler; Node's unhandled-rejection tracker fires in that window and vitest exits 1 with `Errors: 1 error` while reporting every test as passed. The `started()` helper closes that window. If you see a non-zero exit with all tests green, that is what happened.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/repair-client.ts apps/web/src/worker apps/web/src/engine.d.ts apps/web/test/repair-client.test.ts packages/engine/src/engine.mjs
git commit -m "feat(web): repair worker with per-phase heartbeat watchdog"
```

---

### Task 8: App — the three.js viewer

The geometry builders are pure functions over typed arrays, so they are unit-tested with no WebGL context. The scene itself is thin glue on top of them.

**Files:**
- Create: `apps/web/src/geometry.ts`
- Create: `apps/web/src/viewer.ts`
- Test: `apps/web/test/geometry.test.ts`

**Interfaces:**
- Consumes: `MeshBuffers`, `DefectEdges` from Task 7.
- Produces:
  - `toBufferGeometry(mesh: MeshBuffers): THREE.BufferGeometry`
  - `toLineGeometry(segments: Float32Array): THREE.BufferGeometry`
  - `createViewer(canvasHost: HTMLElement): Viewer`, where `Viewer` is `{ show(before: MeshBuffers, after: MeshBuffers, defects?: DefectEdges): void; toggle(which: 'before' | 'after'): void; dispose(): void }`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/geometry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toBufferGeometry, toLineGeometry } from '../src/geometry';

describe('toBufferGeometry', () => {
  it('carries every vertex and every index across', () => {
    const mesh = {
      vertProperties: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      triVerts: new Uint32Array([0, 1, 2]),
    };
    const geometry = toBufferGeometry(mesh);

    expect(geometry.getAttribute('position').count).toBe(3);
    expect(geometry.getIndex()!.count).toBe(3);
  });

  it('computes vertex normals so the mesh is not rendered flat black', () => {
    const mesh = {
      vertProperties: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      triVerts: new Uint32Array([0, 1, 2]),
    };
    expect(toBufferGeometry(mesh).getAttribute('normal')).toBeDefined();
  });
});

describe('toLineGeometry', () => {
  it('reads the flat vertex-pair layout as line endpoints', () => {
    // Two edges = 4 endpoints = 12 floats.
    const segments = new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]);
    expect(toLineGeometry(segments).getAttribute('position').count).toBe(4);
  });

  it('handles an empty defect set', () => {
    expect(toLineGeometry(new Float32Array()).getAttribute('position').count).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @mesh-repair/web`
Expected: FAIL — `Failed to resolve import "../src/geometry"`.

- [ ] **Step 3: Implement the geometry builders**

Create `apps/web/src/geometry.ts`:

```ts
import * as THREE from 'three';
import type { MeshBuffers } from './repair-client';

export function toBufferGeometry(mesh: MeshBuffers): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.vertProperties, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.triVerts, 1));
  // Without normals the standard material renders unlit.
  geometry.computeVertexNormals();
  return geometry;
}

// `segments` is the flat [x,y,z, x,y,z, ...] vertex-pair layout produced by
// analyzeManifold's collectDefectEdges option — exactly what LineSegments reads.
export function toLineGeometry(segments: Float32Array): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(segments, 3));
  return geometry;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @mesh-repair/web`
Expected: PASS.

- [ ] **Step 5: Implement the viewer**

Create `apps/web/src/viewer.ts`:

```ts
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { toBufferGeometry, toLineGeometry } from './geometry';
import type { DefectEdges, MeshBuffers } from './repair-client';

const OPEN_EDGE_COLOR = 0xff2d2d;
const FLIPPED_EDGE_COLOR = 0xffa500;

export interface Viewer {
  show(before: MeshBuffers, after: MeshBuffers, defects?: DefectEdges): void;
  toggle(which: 'before' | 'after'): void;
  dispose(): void;
}

export function createViewer(host: HTMLElement): Viewer {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(host.clientWidth, host.clientHeight);
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));

  const camera = new THREE.PerspectiveCamera(50, host.clientWidth / host.clientHeight, 0.1, 10_000);
  const controls = new OrbitControls(camera, renderer.domElement);

  // One scene, one camera, two meshes. Sharing the camera between before and
  // after is what makes the toggle a comparison rather than two pictures.
  const group = new THREE.Group();
  scene.add(group);

  const material = new THREE.MeshStandardMaterial({ color: 0x9bb7d4, flatShading: true });
  let beforeMesh: THREE.Mesh | undefined;
  let afterMesh: THREE.Mesh | undefined;
  let overlay: THREE.Group | undefined;

  const clear = (): void => {
    for (const object of [...group.children]) {
      group.remove(object);
      object.traverse((node) => {
        if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments) {
          node.geometry.dispose();
          // The overlay builds a fresh LineBasicMaterial per show(); disposing
          // only geometry abandons one material per defect layer per file drop.
          // The shared mesh `material` is disposed once, in dispose().
          if (node.material !== material) {
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            for (const m of materials) m.dispose();
          }
        }
      });
    }
    beforeMesh = afterMesh = overlay = undefined;
  };

  const frame = (): void => {
    controls.update();
    renderer.render(scene, camera);
  };
  renderer.setAnimationLoop(frame);

  return {
    show(before, after, defects) {
      clear();

      beforeMesh = new THREE.Mesh(toBufferGeometry(before), material);
      afterMesh = new THREE.Mesh(toBufferGeometry(after), material);
      afterMesh.visible = false;
      group.add(beforeMesh, afterMesh);

      if (defects) {
        overlay = new THREE.Group();
        overlay.add(new THREE.LineSegments(toLineGeometry(defects.open), new THREE.LineBasicMaterial({ color: OPEN_EDGE_COLOR })));
        overlay.add(new THREE.LineSegments(toLineGeometry(defects.flipped), new THREE.LineBasicMaterial({ color: FLIPPED_EDGE_COLOR })));
        group.add(overlay);
      }

      // Frame the model: 14 mm of a 200 mm frog is not a useful default view.
      const box = new THREE.Box3().setFromObject(beforeMesh);
      const size = box.getSize(new THREE.Vector3()).length();
      const center = box.getCenter(new THREE.Vector3());
      controls.target.copy(center);
      camera.position.copy(center).add(new THREE.Vector3(0, 0, size * 1.5));
      camera.near = size / 100;
      camera.far = size * 100;
      camera.updateProjectionMatrix();
    },

    toggle(which) {
      if (!beforeMesh || !afterMesh) return;
      beforeMesh.visible = which === 'before';
      afterMesh.visible = which === 'after';
      // Defects belong to the broken mesh. Showing them over the repaired one
      // would claim damage that is no longer there.
      if (overlay) overlay.visible = which === 'before';
    },

    dispose() {
      renderer.setAnimationLoop(null);
      clear();
      material.dispose();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
```

- [ ] **Step 6: Verify the build type-checks**

Run: `npm run build -w @mesh-repair/web`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/geometry.ts apps/web/src/viewer.ts apps/web/test/geometry.test.ts
git commit -m "feat(web): three.js before/after viewer with defect-edge overlay"
```

---

### Task 9: App — honest report and STL download

The rule from the spec, enforced in code: when `report.pass` is `false`, no string says "repaired". The summary is a pure function so the rule is directly testable.

**Files:**
- Create: `apps/web/src/report.ts`
- Create: `apps/web/src/download.ts`
- Test: `apps/web/test/report.test.ts`
- Test: `apps/web/test/download.test.ts`

**Interfaces:**
- Consumes: `Report` from Task 7.
- Produces:
  - `summarize(report: Report): { ok: boolean; headline: string; fixed: string[]; remaining: string[]; warnings: string[]; notes: string[] }`
  - `repairedFileName(originalName: string): string`
  - `downloadStl(stl: Uint8Array, fileName: string): void`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/report.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { summarize } from '../src/report';
import type { ManifoldReport, Report } from '../src/repair-client';

const counts = (over: Partial<ManifoldReport> = {}): ManifoldReport => ({
  openEdges: 0, complexEdges: 0, flippedEdges: 0, nonManifoldEdges: 0,
  weldedVertices: 100, triangles: 100, degenerateTriangles: 0, signedVolume: 5, ...over,
});

describe('summarize', () => {
  it('reports what was fixed on a passing repair', () => {
    const report: Report = {
      before: counts({ openEdges: 22, flippedEdges: 40, nonManifoldEdges: 67, complexEdges: 5 }),
      after: counts({ complexEdges: 2, nonManifoldEdges: 2 }),
      pass: true,
      warnings: [],
    };
    const summary = summarize(report);

    expect(summary.ok).toBe(true);
    expect(summary.headline).toMatch(/repaired/i);
    expect(summary.fixed.join(' ')).toMatch(/22/);
    expect(summary.fixed.join(' ')).toMatch(/40/);
    expect(summary.remaining).toEqual([]);
  });

  it('never claims "repaired" when the repair did not pass', () => {
    const report: Report = {
      before: counts({ openEdges: 22, nonManifoldEdges: 22 }),
      after: counts({ openEdges: 3, nonManifoldEdges: 3 }),
      pass: false,
      warnings: [],
    };
    const summary = summarize(report);

    expect(summary.ok).toBe(false);
    expect(summary.headline.toLowerCase()).not.toContain('repaired');
    expect(summary.headline).toMatch(/partial/i);
    expect(summary.remaining.join(' ')).toMatch(/3 open edges/i);
  });

  it('passes engine warnings straight through, even on a passing repair', () => {
    const report: Report = {
      before: counts(), after: counts({ complexEdges: 7 }), pass: true,
      warnings: ['7 complex edges remain, above the slicer-validated baseline of 2.'],
    };
    expect(summarize(report).warnings).toEqual(report.warnings);
  });

  it('says so when the defect overlay is truncated', () => {
    const report: Report = {
      before: { ...counts({ openEdges: 500_000 }), defectEdges: { open: new Float32Array(), flipped: new Float32Array(), truncated: true } },
      after: counts(), pass: true, warnings: [],
    };
    expect(summarize(report).notes[0]).toMatch(/partial view/i);
  });
});
```

Create `apps/web/test/download.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { repairedFileName } from '../src/download';

describe('repairedFileName', () => {
  it('replaces the extension and marks the file as repaired', () => {
    expect(repairedFileName('cute+frog+3d+model.3mf')).toBe('cute+frog+3d+model-repaired.stl');
    expect(repairedFileName('frog.STL')).toBe('frog-repaired.stl');
  });

  it('handles a name with dots in it', () => {
    expect(repairedFileName('v1.2.final.stl')).toBe('v1.2.final-repaired.stl');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @mesh-repair/web`
Expected: FAIL — `Failed to resolve import "../src/report"`.

- [ ] **Step 3: Implement**

Create `apps/web/src/report.ts`:

```ts
import type { Report } from './repair-client';

export interface Summary {
  ok: boolean;
  headline: string;
  fixed: string[];
  remaining: string[];
  warnings: string[];
  notes: string[];
}

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

// The product rule, enforced here rather than in prose: a failed repair never
// gets to call itself "repaired". The download is still offered — the user's
// file is theirs — but the copy tells the truth about what is left.
export function summarize(report: Report): Summary {
  const { before, after, pass, warnings } = report;

  const fixed: string[] = [];
  const closedHoles = before.openEdges - after.openEdges;
  const fixedNormals = before.flippedEdges - after.flippedEdges;
  const removedDegenerates = before.degenerateTriangles - after.degenerateTriangles;
  if (closedHoles > 0) fixed.push(`Closed holes along ${plural(closedHoles, 'open edge')}.`);
  if (fixedNormals > 0) fixed.push(`Corrected ${plural(fixedNormals, 'flipped edge')}.`);
  if (removedDegenerates > 0) fixed.push(`Removed ${plural(removedDegenerates, 'degenerate triangle')}.`);

  const remaining: string[] = [];
  if (after.openEdges > 0) remaining.push(`${plural(after.openEdges, 'open edge')} could not be closed.`);
  if (after.flippedEdges > 0) remaining.push(`${plural(after.flippedEdges, 'flipped edge')} could not be corrected.`);

  // The overlay is capped (see analyzeManifold's maxDefectEdges). Saying so is
  // the same honesty rule the headline obeys: never let the UI imply it showed
  // everything when it did not.
  const notes: string[] = [];
  if (before.defectEdges?.truncated) {
    notes.push('The highlighted defects are a partial view — this mesh has more damage than the viewer draws.');
  }

  return {
    ok: pass,
    headline: pass ? 'Mesh repaired — it should slice now.' : 'Partially fixed — this mesh is still not watertight.',
    fixed,
    remaining,
    warnings,
    notes,
  };
}
```

Create `apps/web/src/download.ts`:

```ts
export function repairedFileName(originalName: string): string {
  const dot = originalName.lastIndexOf('.');
  const stem = dot > 0 ? originalName.slice(0, dot) : originalName;
  return `${stem}-repaired.stl`;
}

export function downloadStl(stl: Uint8Array, fileName: string): void {
  // TypeScript 5.9 narrowed BlobPart to ArrayBufferView<ArrayBuffer>, and a bare
  // Uint8Array infers as Uint8Array<ArrayBufferLike> — which admits
  // SharedArrayBuffer and so no longer satisfies it. We never create one (no
  // threads, no SharedArrayBuffer, no COOP/COEP), so the cast is sound. Casting
  // beats `stl.slice()`, which would copy a buffer that can be ~94 MB.
  const url = URL.createObjectURL(new Blob([stl as BlobPart], { type: 'model/stl' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // The blob can be tens of megabytes, so it must be released — but NOT in this
  // same task. Revoking synchronously after click() races the browser's own
  // fetch of the blob URL and can cancel the download outright. One tick later
  // the download has started and the URL is safe to drop.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @mesh-repair/web`
Expected: PASS.

- [ ] **Step 5: Typecheck, because the tests do not**

Run: `npm run build -w @mesh-repair/web`
Expected: exit 0.

Vitest transpiles TypeScript with esbuild, which strips types without checking them. A green test run says nothing about whether this file compiles. `downloadStl` is exactly where that gap bites — `new Blob([stl])` on a bare `Uint8Array` is a `TS2322` under TypeScript 5.9, and `npm test` would never tell you.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/report.ts apps/web/src/download.ts apps/web/test/report.test.ts apps/web/test/download.test.ts
git commit -m "feat(web): honest repair summary and STL download"
```

---

### Task 10: App — wire the state machine

The five states from the spec, plus the four error conditions. This is the only module that knows about all the others, and it owns every user-facing string that describes an error.

**Files:**
- Create: `apps/web/src/state.ts`
- Modify: `apps/web/src/main.ts`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/test/state.test.ts`

**Interfaces:**
- Consumes: `detectKind`, `isOverSoftCap` (Task 6); `repairInWorker`, `createRepairWorker`, `RepairTimeoutError`, `RepairFailedError`, `EngineLoadError` (Task 7); `createViewer` (Task 8); `summarize`, `downloadStl`, `repairedFileName` (Task 9).
- Produces:
  - `type AppState = { kind: 'idle' } | { kind: 'reading' } | { kind: 'repairing'; phase: Phase } | { kind: 'done'; result: RepairResult; fileName: string } | { kind: 'error'; message: string }`
  - `errorMessageFor(error: unknown): string`
  - `validateFile(file: File): { kind: MeshKind } | { error: string } | { kind: MeshKind; warning: string }`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/state.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { errorMessageFor, validateFile } from '../src/state';
import { RepairTimeoutError, RepairFailedError, EngineLoadError } from '../src/repair-client';
import { SOFT_CAP_BYTES } from '../src/dropzone';

const fileOf = (name: string, size: number): File => {
  const file = new File([], name);
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

describe('validateFile', () => {
  it('accepts a supported file under the cap', () => {
    expect(validateFile(fileOf('frog.3mf', 1000))).toEqual({ kind: '3mf' });
  });

  it('rejects an unsupported extension with an actionable message', () => {
    const result = validateFile(fileOf('frog.obj', 1000));
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/STL|3MF/);
  });

  it('warns above the soft cap but still accepts the file', () => {
    const result = validateFile(fileOf('frog.stl', SOFT_CAP_BYTES + 1));
    expect(result).toMatchObject({ kind: 'stl' });
    expect(result).toHaveProperty('warning');
  });
});

describe('errorMessageFor', () => {
  it('explains a watchdog timeout without blaming the user', () => {
    const message = errorMessageFor(new RepairTimeoutError('repair'));
    expect(message).toMatch(/too long|stopped responding/i);
    expect(message).toMatch(/complex|large/i);
  });

  it('surfaces the engine message on a repair failure', () => {
    expect(errorMessageFor(new RepairFailedError('mesh too small'))).toMatch(/mesh too small/);
  });

  it('names the load failure when the engine never came up', () => {
    expect(errorMessageFor(new EngineLoadError())).toMatch(/engine failed to load/i);
  });

  it('falls back to a generic message for an unknown throw', () => {
    expect(errorMessageFor('boom')).toMatch(/something went wrong/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @mesh-repair/web`
Expected: FAIL — `Failed to resolve import "../src/state"`.

- [ ] **Step 3: Implement the state helpers**

Create `apps/web/src/state.ts`:

```ts
import { detectKind, isOverSoftCap, type MeshKind } from './dropzone';
import { RepairFailedError, RepairTimeoutError, EngineLoadError, type Phase, type RepairResult } from './repair-client';

export type AppState =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'repairing'; phase: Phase }
  | { kind: 'done'; result: RepairResult; fileName: string }
  | { kind: 'error'; message: string };

export type Validation =
  | { kind: MeshKind }
  | { kind: MeshKind; warning: string }
  | { error: string };

// A soft cap warns; it never hard-rejects. The user knows their machine.
export function validateFile(file: File): Validation {
  const kind = detectKind(file.name);
  if (!kind) return { error: `"${file.name}" is not a mesh we can read. Drop an STL or 3MF file.` };
  if (isOverSoftCap(file.size)) {
    return { kind, warning: 'This model is large. Repair may take a while and use a lot of memory.' };
  }
  return { kind };
}

export function errorMessageFor(error: unknown): string {
  if (error instanceof EngineLoadError) {
    return 'The repair engine failed to load. Check your connection and reload the page.';
  }
  if (error instanceof RepairTimeoutError) {
    return 'The repair took too long and was stopped. This model may be too large or too complex for your browser.';
  }
  if (error instanceof RepairFailedError) return error.message;
  return 'Something went wrong. Try reloading the page.';
}

export function phaseLabel(phase: Phase): string {
  const labels: Record<Phase, string> = {
    'parse': 'Reading the mesh…',
    'analyze-before': 'Finding the defects…',
    'repair': 'Repairing…',
    'analyze-after': 'Checking the result…',
    'export': 'Writing the STL…',
  };
  return labels[phase];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @mesh-repair/web`
Expected: PASS.

- [ ] **Step 5: Wire `main.ts`**

Replace `apps/web/src/main.ts` with:

```ts
import './styles.css';
import { renderPromo } from './promo';
import { mountDropzone } from './dropzone';
import { createRepairWorker, repairInWorker, type RepairResult } from './repair-client';
import { createViewer, type Viewer } from './viewer';
import { summarize } from './report';
import { downloadStl, repairedFileName } from './download';
import { errorMessageFor, phaseLabel, validateFile, type AppState } from './state';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app not found');

renderPromo(root);

const status = document.createElement('p');
status.dataset.testid = 'status';
const viewerHost = document.createElement('div');
viewerHost.className = 'viewer';
const actions = document.createElement('div');
actions.dataset.testid = 'actions';
root.append(status, viewerHost, actions);

let viewer: Viewer | undefined;

function render(state: AppState): void {
  actions.replaceChildren();

  if (state.kind === 'idle') { status.textContent = ''; return; }
  if (state.kind === 'reading') { status.textContent = 'Reading the file…'; return; }
  if (state.kind === 'repairing') { status.textContent = phaseLabel(state.phase); return; }
  if (state.kind === 'error') { status.textContent = state.message; return; }

  const summary = summarize(state.result.report);
  status.textContent = summary.headline;

  for (const line of [...summary.fixed, ...summary.remaining, ...summary.notes, ...summary.warnings]) {
    const p = document.createElement('p');
    p.textContent = line;
    actions.append(p);
  }

  const beforeButton = document.createElement('button');
  beforeButton.textContent = 'Before';
  beforeButton.addEventListener('click', () => viewer?.toggle('before'));
  const afterButton = document.createElement('button');
  afterButton.textContent = 'After';
  afterButton.addEventListener('click', () => viewer?.toggle('after'));

  const download = document.createElement('button');
  // Offered even when summary.ok is false: the file is the user's either way.
  download.textContent = 'Download repaired STL';
  download.addEventListener('click', () => downloadStl(state.result.stl, repairedFileName(state.fileName)));

  actions.append(beforeButton, afterButton, download);
}

async function handleFile(file: File): Promise<void> {
  const validation = validateFile(file);
  if ('error' in validation) { render({ kind: 'error', message: validation.error }); return; }
  if ('warning' in validation) status.textContent = validation.warning;

  render({ kind: 'reading' });
  const bytes = await file.arrayBuffer();
  let worker: Worker | undefined;

  try {
    worker = createRepairWorker();
    const result: RepairResult = await repairInWorker(worker, bytes, validation.kind, {
      onPhase: (phase) => render({ kind: 'repairing', phase }),
    });

    viewer?.dispose();
    viewer = createViewer(viewerHost);
    viewer.show(result.beforeMesh, result.afterMesh, result.report.before.defectEdges);
    render({ kind: 'done', result, fileName: file.name });
  } catch (error) {
    render({ kind: 'error', message: errorMessageFor(error) });
  } finally {
    // repairInWorker already terminates on failure; this covers the happy path.
    // terminate() is a no-op on an already-terminated worker.
    worker?.terminate();
  }
}

mountDropzone(root, (file) => { void handleFile(file); });
render({ kind: 'idle' });
```

Append to `apps/web/src/styles.css`:

```css
.dropzone { border: 2px dashed currentColor; border-radius: 0.5rem; padding: 3rem; text-align: center; }
.viewer { width: 100%; height: 30rem; margin-top: 1rem; }
button { margin-right: 0.5rem; }
```

- [ ] **Step 6: Verify the whole suite and the build**

Run: `npm test && npm run build -w @mesh-repair/web`
Expected: PASS, exit 0.

- [ ] **Step 7: Manually verify against the real fixture**

Run: `npm run dev`
Open the served URL, drop `packages/engine/test/fixtures/tripo-broken.3mf`.
Expected: phase labels advance, red defect edges appear on the "before" mesh, the toggle switches to a clean "after", `Mesh repaired — it should slice now.` appears, and the downloaded STL opens in a slicer as `manifold = yes`.

This is the spec's success criterion. If the WASM fails to load here, Task 4 or the `locateFile` wiring in Task 7 is wrong — fix it before committing.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/main.ts apps/web/src/state.ts apps/web/src/styles.css apps/web/test/state.test.ts
git commit -m "feat(web): wire intake, worker, viewer, report and download"
```

---

### Task 11: Local-only end-to-end test

The real Tripo fixture is ~32 MB and gitignored. A CI run that silently skips this suite must never be read as a pass — the runner therefore fails loudly when the fixture is missing **unless** the run explicitly opts out.

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/repair.e2e.ts`
- Modify: `apps/web/package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: the running dev server and the app from Task 10.
- Produces: `npm run test:e2e -w @mesh-repair/web`.

- [ ] **Step 1: Add Playwright**

```bash
npm install -D -w @mesh-repair/web @playwright/test
npx playwright install chromium
```

Add to `apps/web/package.json` scripts:

```json
"test:e2e": "playwright test"
```

- [ ] **Step 2: Write the config**

Create `apps/web/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  // A 1.88M-triangle repair is not a 30-second operation.
  timeout: 5 * 60 * 1000,
  use: { baseURL: 'http://localhost:5173' },
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true },
});
```

- [ ] **Step 3: Write the test**

Create `apps/web/e2e/repair.e2e.ts`:

```ts
import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../../../packages/engine/test/fixtures/tripo-broken.3mf', import.meta.url));

// The fixture is ~32 MB and gitignored, so this suite cannot run in CI. It must
// FAIL rather than skip when the fixture is absent: a silent skip reported as a
// green run is how a broken pipeline gets mistaken for a working one. CI opts
// out explicitly with MESH_REPAIR_SKIP_E2E=1.
test.beforeAll(() => {
  if (process.env.MESH_REPAIR_SKIP_E2E === '1') test.skip(true, 'explicitly opted out via MESH_REPAIR_SKIP_E2E');
  if (!existsSync(FIXTURE)) {
    throw new Error(`e2e fixture missing: ${FIXTURE}. Restore it, or set MESH_REPAIR_SKIP_E2E=1 to opt out on purpose.`);
  }
});

test('repairs the real broken Tripo mesh and offers the STL', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles(FIXTURE);

  await expect(page.getByTestId('status')).toContainText('Mesh repaired', { timeout: 4 * 60 * 1000 });
  await expect(page.getByRole('button', { name: 'Download repaired STL' })).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download repaired STL' }).click();
  expect((await download).suggestedFilename()).toBe('tripo-broken-repaired.stl');
});
```

- [ ] **Step 4: Run it**

Run: `npm run test:e2e -w @mesh-repair/web`
Expected: PASS, if `packages/engine/test/fixtures/tripo-broken.3mf` exists locally. If it does not, the run FAILS with the message above — that is correct behavior, not a bug.

- [ ] **Step 5: Document the local-only nature**

Create or append to `README.md`:

```markdown
## Tests

- `npm test` — engine (`node:test`) and app (Vitest) unit tests. Runs in CI.
- `npm run test:e2e -w @mesh-repair/web` — **local only.** Needs the ~32 MB
  gitignored fixture `packages/engine/test/fixtures/tripo-broken.3mf`. It fails
  loudly if the fixture is missing. Set `MESH_REPAIR_SKIP_E2E=1` to opt out on
  purpose — never let a silent skip be reported as a pass.
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/playwright.config.ts apps/web/e2e apps/web/package.json README.md package-lock.json
git commit -m "test(web): local-only e2e against the real Tripo fixture"
```
