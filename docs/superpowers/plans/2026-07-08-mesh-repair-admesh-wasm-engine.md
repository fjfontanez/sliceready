# Mesh Repair — ADMesh WASM Engine + Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package ADMesh into a browser-ready WASM module and wire it into the existing spike pipeline so a broken 3MF/STL is repaired to a sliceable, manifold-per-slicer mesh entirely in-process — validated in Node first, reusing `parse3mf`, `buildBinaryStl`, and `analyzeManifold`.

**Architecture:** Compile ADMesh's six library `.c` files plus a thin C wrapper to WASM with Emscripten, run inside the official `emscripten/emsdk` Docker image (no local `emcc` needed). The wrapper exposes one `repair(inPath, outPath, ...)` entry point that calls `stl_open` → `stl_repair` (with the exact flag configuration validated against OrcaSlicer in `spike/FINDINGS.md`, not the broader default "fixall") → `stl_write_binary`; JS passes the STL in and out through Emscripten's in-memory filesystem (MEMFS). The full pipeline is: `parse3mf`/`parseBinaryStl` → `buildBinaryStl` → MEMFS → ADMesh(WASM) repair → repaired STL → `parseBinaryStl` → `analyzeManifold` acceptance gate. This plan is Node-only (the browser UI, Web Worker, three.js viewer, and promo shell are a separate follow-up plan that consumes this engine).

**Tech Stack:** Docker (`emscripten/emsdk` image), Emscripten `emcc`, ADMesh C source (github.com/admesh/admesh, GPLv2), Node.js 18+ (ESM), and the existing spike modules (`mesh3mf.mjs`, `stl.mjs`, `check.mjs`).

## Global Constraints

- **Node.js 18+, ESM only** — `.mjs`, `import`/`export`, top-level `await` where needed. Continue in the existing `spike/` package.
- **Build is reproducible via Docker** — the WASM artifacts are produced by running `emcc` inside `emscripten/emsdk`; do NOT require a local Emscripten install. The exact image tag is pinned (see Task 1) so the build is deterministic.
- **ADMesh is GPLv2.** The compiled `admesh.wasm`/`admesh.mjs` are a derivative work of ADMesh. Distributing them (including client-side in a browser) carries GPLv2 obligations: ship a license notice and an offer of corresponding source. This plan adds `spike/wasm/ADMESH-LICENSE`, pins the exact source commit in `spike/wasm/ADMESH-SOURCE-COMMIT.txt`, and ships `spike/wasm/SOURCE-OFFER.md` explaining how to obtain/rebuild that exact corresponding source; the business/legal decision about GPL in the SliceMargin promo tool is the user's and is flagged, not resolved, here.
- **The browser layer MUST bound repair execution time (flagged here, owned by the browser-app plan).** A pathological or ADMesh-misdetected input (see Task 2 Step 3's binary/ASCII auto-detection note) can make ADMesh spin unboundedly instead of failing fast. This plan is Node-only and does not implement a timeout, but the future browser/Worker layer that consumes `repairMesh` MUST run the WASM repair inside a Web Worker with a watchdog timeout that terminates the Worker on no-completion — a bounded failure is required, not a hang.
- **Acceptance gate matches the validated print bar, not the strict proxy.** The spike established (see `spike/FINDINGS.md`) that ADMesh repairs the real mesh to `manifold = yes` per OrcaSlicer while our stricter checker still reports ≤2 `complexEdges`. Therefore the pipeline PASS criterion is: `openEdges === 0 && flippedEdges === 0 && triangles > 0 && Math.abs(signedVolume) > 0`. `complexEdges` is logged and recorded, NOT gated on (it is within the slicer's accepted bar). Task 5 is an optional in-JS cleanup to drive `complexEdges` to 0 if strict topological manifoldness is ever required.
- **Reuse, don't reinvent.** `parse3mf`, `buildBinaryStl`, `analyzeManifold` are done and tested — import them; do not duplicate mesh logic. The only new STL code is re-adding a binary-STL *reader* (`parseBinaryStl`) to read ADMesh's output back.
- **All command blocks are cwd-independent** — every `Run:`/commit block resolves the repo root via `git rev-parse --show-toplevel` and `cd`s explicitly.
- **The real fixture is present:** `spike/test/fixtures/tripo-broken.3mf` (and `tripo-broken.stl`), both gitignored. WASM build artifacts (`spike/wasm/admesh.wasm`, `admesh.mjs`) are committed (they are the shippable engine); `node_modules` and fixtures stay gitignored.
- **RESIDUAL: a `stl_open` MEMFS file-handle leak is mitigated, not fully closed.** `repairWithAdmesh`'s pre-validation (Task 2 Step 4, `assertRepairableStlSize`) rejects undersized/malformed STL bytes before they ever reach MEMFS/ccall, which covers the common failure (ADMesh's own `STL_MIN_FILE_SIZE = 284`-byte / 4-triangle floor). It does NOT fix every `stl_open` failure path: on some other `stl_open` errors, ADMesh's `stl_close()` skips `fclose()` on the input file handle, and `repair_wrapper.c`'s `stl_clear_error()` + `stl_close()` call (which frees internal buffers) does not release that handle. A long-lived batch/Worker consumer that repeatedly feeds ADMesh other-cause `stl_open` failures could accumulate leaked MEMFS file handles over the life of one cached module instance; the mitigation here is recreating the WASM module instance after repeated failures, not a guaranteed fix. This is minor for the browser's typical one-repair-per-session usage, but is called out here rather than overstated as solved.

## Prerequisites

- Docker is available and can pull images (verified: Docker 29.6.1). The build pulls `emscripten/emsdk` once (~1GB). **Verify image architecture before building**: `docker manifest inspect emscripten/emsdk:3.1.74`. On Apple Silicon (arm64) this tag is amd64-only, so `build.sh` runs it with `--platform linux/amd64` explicitly (see Task 1 Step 3) — expect slower emulated build time, not a silent failure or a wrong-arch crash.
- The existing `spike/` package with `mesh3mf.mjs`, `stl.mjs`, `check.mjs`, `package.json`, tests, and the real fixtures is in place on branch `spike/wasm-derisk`.

---

### Task 1: Fetch ADMesh source, write the C wrapper, build to WASM via Docker

**Files:**
- Create: `spike/wasm/build.sh` (Docker-driven Emscripten build)
- Create: `spike/wasm/repair_wrapper.c` (thin C entry point over libadmesh)
- Create: `spike/wasm/.gitignore` (ignore the cloned `admesh-src/` build tree, keep the artifacts)
- Produce (committed): `spike/wasm/admesh.mjs`, `spike/wasm/admesh.wasm`
- Create: `spike/wasm/ADMESH-LICENSE` (copied from the cloned source's `COPYING`)
- Create: `spike/wasm/ADMESH-SOURCE-COMMIT.txt` (pinned upstream commit hash)
- Create: `spike/wasm/SOURCE-OFFER.md` (GPLv2 corresponding-source offer)

**Interfaces:**
- Produces (WASM module `admesh.mjs`, ES6, `MODULARIZE`d default export factory):
  - Exposes Emscripten `FS` (MEMFS) and `ccall`/`cwrap` on the runtime.
  - Exported C function `repair(inPathPtr, outPathPtr) -> int` (0 = success, non-zero = failure): reads the binary STL at `inPath` from MEMFS, runs `stl_repair` with the EXACT flag configuration validated against the production slicer in `spike/FINDINGS.md` (fill-holes, normal-directions, normal-values; `fixall=0`, `nearby=0` — not the broader default "fixall" superset), writes a binary STL to `outPath`. Called from JS via `ccall('repair', 'number', ['string','string'], [inPath, outPath])`.

- [ ] **Step 1: Fetch the ADMesh source (pinned), capture its commit, and record its license**

Run:
```bash
cd "$(git rev-parse --show-toplevel)/spike" && mkdir -p wasm && cd wasm
git clone --depth 1 https://github.com/admesh/admesh admesh-src
cp admesh-src/COPYING ADMESH-LICENSE
git -C admesh-src rev-parse HEAD > ADMESH-SOURCE-COMMIT.txt
printf 'admesh-src/\n' > .gitignore
```
Expected: `admesh-src/src/` contains `connect.c normals.c shared.c stl_io.c stlinit.c util.c admesh.c` and `stl.h`; `ADMESH-LICENSE` (GPLv2) present; `ADMESH-SOURCE-COMMIT.txt` contains a single 40-char commit hash.

Note: `--depth 1` makes `admesh-src/` a shallow clone (its own git history isn't fetched, and it's gitignored anyway). `ADMESH-SOURCE-COMMIT.txt` is what actually lets a recipient reconstruct the exact pinned source later (full clone + `checkout <hash>`), which is why it's captured explicitly here rather than left implicit.

Then create `spike/wasm/SOURCE-OFFER.md` (the GPLv2 corresponding-source offer for the compiled `admesh.wasm`/`admesh.mjs` — required because this plan ships a build artifact derived from GPLv2 source without shipping the source itself):
```markdown
# ADMesh — Corresponding Source Offer

`admesh.wasm` and `admesh.mjs` in this directory are compiled from
[ADMesh](https://github.com/admesh/admesh), licensed under the GNU General
Public License v2 — see `ADMESH-LICENSE`.

**Pinned source commit:** see `ADMESH-SOURCE-COMMIT.txt` in this directory.

To obtain or rebuild the exact corresponding source:

\`\`\`bash
git clone https://github.com/admesh/admesh admesh-src
git -C admesh-src checkout "$(cat ADMESH-SOURCE-COMMIT.txt)"
./build.sh   # builds admesh.wasm/admesh.mjs from admesh-src via Docker; see build.sh
\`\`\`
```

- [ ] **Step 2: Write the C wrapper**

Create `spike/wasm/repair_wrapper.c`:
```c
/* Thin Emscripten entry point over libadmesh. Reads a binary STL from MEMFS at
 * inPath, runs the EXACT ADMesh repair configuration validated against the
 * production slicer in spike/FINDINGS.md (fill holes, fix normal directions
 * and values — NOT the broader default "fixall" superset, and NOT nearby-facet
 * connection or reverse-all, neither of which was part of the validated run),
 * and writes a binary STL to outPath. Returns 0 on success, 1 on failure. File
 * I/O goes through MEMFS, which the JS side populates/reads via the Emscripten
 * FS API. */
#include <emscripten.h>
#include "stl.h"

EMSCRIPTEN_KEEPALIVE
int repair(const char *inPath, const char *outPath) {
  stl_file stl;
  /* No explicit stl_initialize() here — stl_open() calls it internally as
   * its first statement, so a separate call would be redundant. */
  stl_open(&stl, (char *)inPath);
  if (stl_get_error(&stl)) {
    /* ADMesh's stl_close() early-returns WITHOUT freeing internal buffers if
     * stl->error is set — that's a quirk of the library, not a defensive
     * check on our part. This module instance is cached and reused across
     * calls (see repair-admesh.mjs), so repeated failing inputs would
     * otherwise leak WASM heap. Clear the error first so stl_close() actually
     * frees.
     *
     * RESIDUAL (not fully closed by this fix): stl_open() itself skips
     * fclose() on the input file handle when it sets stl->error. Clearing
     * the error and calling stl_close() here frees ADMesh's internal
     * buffers, but does NOT retroactively close that already-skipped file
     * handle — a MEMFS fp can still leak on some stl_open failure paths.
     * repair-admesh.mjs's assertRepairableStlSize() pre-validation (Task 2
     * Step 4) keeps the most common cause (undersized/malformed STL, below
     * ADMesh's own 284-byte / 4-triangle floor) from ever reaching stl_open
     * at all, but does not guarantee every other stl_open failure is
     * leak-free. See the RESIDUAL note in Global Constraints. */
    stl_clear_error(&stl);
    stl_close(&stl);
    return 1;
  }

  /* Mirrors, EXACTLY, the CLI invocation validated against OrcaSlicer in
   * spike/FINDINGS.md: `admesh --fill-holes --normal-directions
   * --normal-values` (fixall=0). Nearby-facet connection and reverse-all were
   * NOT part of the validated run and are deliberately left off — running the
   * broader default "fixall" sequence would be an unvalidated superset.
   * tolerance/increment are left to ADMesh's computed defaults (flags 0 =>
   * auto). */
  stl_repair(&stl,
             0, /* fixall_flag             */
             0, /* exact_flag (auto)       */
             0, /* tolerance_flag          */
             0, /* tolerance               */
             0, /* increment_flag          */
             0, /* increment               */
             0, /* nearby_flag             */
             2, /* iterations              */
             0, /* remove_unconnected_flag */
             1, /* fill_holes_flag         */
             1, /* normal_directions_flag  */
             1, /* normal_values_flag      */
             0, /* reverse_all_flag        */
             0  /* verbose_flag            */);

  stl_write_binary(&stl, (char *)outPath, "mesh-repair");
  int err = stl_get_error(&stl);
  /* Same ADMesh quirk as above: clear the error before the final stl_close()
   * so buffers are freed regardless of outcome, since this module instance is
   * cached and reused for subsequent repairs. */
  stl_clear_error(&stl);
  stl_close(&stl);
  return err ? 1 : 0;
}
```

Note: `stl_get_error` is declared in `stl.h`. If the installed header names it differently, Step 4's build will fail loudly at compile time — read `admesh-src/src/stl.h` and use the actual error accessor (it is `stl_get_error`/`stl_clear_error` in current ADMesh). Do not guess silently; match the header.

- [ ] **Step 3: Write the Docker build script**

Create `spike/wasm/build.sh`:
```bash
#!/usr/bin/env bash
# Reproducible ADMesh -> WASM build. Runs emcc inside the official emscripten
# image so no local Emscripten install is needed. Produces admesh.mjs + admesh.wasm.
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="emscripten/emsdk:3.1.74"

# emscripten/emsdk:3.1.74 is amd64-only (verify with `docker manifest inspect
# "$IMAGE"`; prefer a multi-arch tag if one becomes available). On Apple
# Silicon (arm64) this means running under QEMU emulation. --platform is set
# explicitly rather than left to Docker's default so the emulation/build-time
# tradeoff is a visible, intentional choice, not a silent fallback.
PLATFORM_FLAG=()
if [ "$(uname -m)" = "arm64" ]; then
  PLATFORM_FLAG=(--platform linux/amd64)
fi

docker run --rm "${PLATFORM_FLAG[@]}" -v "$PWD":/src -w /src "$IMAGE" \
  emcc \
    admesh-src/src/connect.c \
    admesh-src/src/normals.c \
    admesh-src/src/shared.c \
    admesh-src/src/stl_io.c \
    admesh-src/src/stlinit.c \
    admesh-src/src/util.c \
    repair_wrapper.c \
    -I admesh-src/src \
    -O3 \
    -o admesh.mjs \
    -sMODULARIZE=1 \
    -sEXPORT_ES6=1 \
    -sFORCE_FILESYSTEM=1 \
    -sALLOW_MEMORY_GROWTH=1 \
    -sMAXIMUM_MEMORY=4GB \
    -sEXPORTED_RUNTIME_METHODS=FS,ccall,cwrap \
    -sEXPORTED_FUNCTIONS=_repair,_malloc,_free \
    -sENVIRONMENT=web,worker,node

echo "Built: $(ls -la admesh.mjs admesh.wasm)"
```

Note: `-sMAXIMUM_MEMORY=4GB` raises the growth ceiling above Emscripten's 2GB default — the real fixture is ~1.87M triangles plus ~94MB of in/out STL buffers living in MEMFS, which can approach the default ceiling. Treat 4GB as a starting calibration point, not a proven-sufficient number; if Task 3's real-fixture run OOMs, raise it further.

- [ ] **Step 4: Run the build**

Run:
```bash
cd "$(git rev-parse --show-toplevel)/spike/wasm" && chmod +x build.sh && ./build.sh
```
Expected: `admesh.mjs` and `admesh.wasm` produced, no compile errors. If `stl.h` includes cause missing-symbol or header errors, fix the `#include`/error-accessor name in `repair_wrapper.c` to match `admesh-src/src/stl.h` and rebuild — this is expected build calibration, not a redesign. Record the final artifact sizes.

- [ ] **Step 5: Smoke-test that the module loads and MEMFS works**

Run (from `spike/`):
```bash
cd "$(git rev-parse --show-toplevel)/spike" && node -e "import('./wasm/admesh.mjs').then(async (m)=>{const Mod=await m.default();Mod.FS.writeFile('/t.bin',new Uint8Array([1,2,3]));const b=Mod.FS.readFile('/t.bin');const rc=Mod.ccall('repair','number',['string','string'],['/nonexistent.stl','/out.stl']);console.log('MEMFS ok', b.length===3, 'repair callable, non-zero rc for missing input?', typeof rc==='number' && rc!==0);})"
```
Expected: `MEMFS ok true repair callable, non-zero rc for missing input? true`. (This actually exercises the exported `repair` function rather than just checking that `ccall`/`_repair` exist as symbols — `EXPORTED_RUNTIME_METHODS=FS,ccall,cwrap` guarantees `Mod.ccall` exists regardless of whether `repair` itself was exported correctly, so a bare existence check would be tautological.)

- [ ] **Step 6: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add spike/wasm/build.sh spike/wasm/repair_wrapper.c spike/wasm/.gitignore spike/wasm/admesh.mjs spike/wasm/admesh.wasm spike/wasm/ADMESH-LICENSE spike/wasm/ADMESH-SOURCE-COMMIT.txt spike/wasm/SOURCE-OFFER.md && git commit -m "feat(engine): build ADMesh to WASM via Docker emsdk"
```

---

### Task 2: Add a binary-STL reader and the JS repair binding

**Files:**
- Modify: `spike/src/stl.mjs` (add `parseBinaryStl`; update `buildBinaryStl` to write real computed facet normals instead of zeros)
- Create: `spike/src/repair-admesh.mjs` (`repairWithAdmesh`)
- Test: `spike/test/repair-admesh.test.mjs`

**Interfaces:**
- Consumes: `buildBinaryStl` (stl.mjs), the WASM module (`wasm/admesh.mjs`), and adds `parseBinaryStl`.
- Produces:
  - `parseBinaryStl(bytes: Uint8Array): { vertProperties: Float32Array, triVerts: Uint32Array }` — reads a binary STL into unshared per-corner vertices (`vertProperties` length `9 * triCount`, `triVerts` the sequence `0..3*triCount-1`). Throws on ASCII STL (mirrors the earlier removed reader). Throws on a truncated (< 84-byte) input before any offset-80 read.
  - `buildBinaryStl` (existing function from the earlier spike plan, updated in this task): same signature (`{vertProperties, triVerts} -> Uint8Array`), now writes each triangle's real computed normal instead of an all-zero one. This is correct STL regardless, and it also avoids an ADMesh binary/ASCII auto-detection misfire (see Step 3) — `parseBinaryStl` ignores the normal bytes on read, so this does not change any parsed geometry and the earlier round-trip tests still hold.
  - `repairWithAdmesh(mesh: { vertProperties, triVerts }): Promise<{ mesh: { vertProperties: Float32Array, triVerts: Uint32Array }, ok: boolean }>` — serializes the input mesh to binary STL via `buildBinaryStl`, validates the serialized size against ADMesh's own `STL_MIN_FILE_SIZE = 284`-byte / 4-triangle floor BEFORE writing to MEMFS, writes it to MEMFS under a per-call unique path, calls the WASM `repair`, reads the repaired STL back via `parseBinaryStl`. Throws `AdmeshEngineError` if the input is undersized/malformed or if `repair` returns non-zero.

- [ ] **Step 1: Write the failing test**

Create `spike/test/repair-admesh.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairWithAdmesh, AdmeshEngineError } from '../src/repair-admesh.mjs';
import { parseBinaryStl, buildBinaryStl } from '../src/stl.mjs';
import { analyzeManifold } from '../src/check.mjs';

// ADMesh rejects any binary STL below its own hard floor: stl_count_facets()
// enforces STL_MIN_FILE_SIZE = 284 bytes (84-byte header + 4 triangles * 50
// bytes each), setting stl->error before stl_repair ever runs. A holed
// tetrahedron (3 triangles / 234 bytes) is below that floor and therefore
// UNREPAIRABLE by ADMesh — it is not a valid regression fixture. Use a holed
// cube instead: 12 triangles minus the top face = 10 triangles / 584 bytes
// total, safely above the 284-byte / 4-triangle floor.
//
// Axis-aligned cube (fractional, non-round bounds so ADMesh's binary/ASCII
// auto-detection is also safe), top face removed → 10 triangles, a 4-edge
// square hole.
const CUBE_V = [
  [0.13, 0.19, 0.07], [10.37, 0.19, 0.07], [10.37, 10.23, 0.07], [0.13, 10.23, 0.07], // z-min
  [0.13, 0.19, 10.41], [10.37, 0.19, 10.41], [10.37, 10.23, 10.41], [0.13, 10.23, 10.41], // z-max
];
// 10 outward-CCW triangles; the two top-face tris ([4,5,6],[4,6,7]) are omitted → hole.
const HOLED_CUBE_F = [
  [0, 2, 1], [0, 3, 2],           // bottom (z-min)
  [0, 1, 5], [0, 5, 4],           // front (y-min)
  [3, 7, 6], [3, 6, 2],           // back (y-max)
  [0, 4, 7], [0, 7, 3],           // left (x-min)
  [1, 2, 6], [1, 6, 5],           // right (x-max)
];
function toBuffer(v, f) {
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

test('parseBinaryStl round-trips buildBinaryStl', () => {
  const src = toBuffer(CUBE_V, HOLED_CUBE_F);
  const back = parseBinaryStl(buildBinaryStl(src));
  assert.equal(back.triVerts.length, src.triVerts.length);
  assert.deepEqual([...back.vertProperties], [...src.vertProperties]);
});

test('repairWithAdmesh closes the open edges of a holed cube', async () => {
  const holed = toBuffer(CUBE_V, HOLED_CUBE_F);
  // Tolerance is relative to the fixture's ~10-unit extent, not tied to the
  // exact (intentionally fractional) coordinate values above.
  const before = analyzeManifold(holed, { tolerance: 1e-2 });
  assert.equal(before.openEdges, 4, 'the missing top face leaves a 4-edge square hole');

  const { mesh, ok } = await repairWithAdmesh(holed);
  assert.equal(ok, true);
  const after = analyzeManifold(mesh, { tolerance: 1e-2 });
  assert.equal(after.openEdges, 0, 'ADMesh should fill the hole');
  assert.equal(after.flippedEdges, 0);
  assert.ok(Math.abs(after.signedVolume) > 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)/spike" && node --test test/repair-admesh.test.mjs`
Expected: FAIL — `Cannot find module '../src/repair-admesh.mjs'`.

- [ ] **Step 3: Add `parseBinaryStl` to `stl.mjs`, and update `buildBinaryStl` to write real facet normals**

Add to `spike/src/stl.mjs` (alongside `buildBinaryStl`):
```javascript
// Binary STL reader → unshared per-corner vertices (callers weld via tolerance).
// Mirrors buildBinaryStl's layout: 80-byte header, uint32 count, 50 bytes/triangle.
export function parseBinaryStl(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 84) {
    throw new Error('Corrupt/too-short binary STL (< 84 bytes)');
  }
  if (bytes.byteLength >= 5 &&
      String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]) === 'solid') {
    const dv0 = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const triCount0 = dv0.getUint32(80, true);
    if (bytes.byteLength !== 84 + triCount0 * 50) {
      throw new Error('ASCII STL not supported by this reader — provide a binary STL');
    }
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triCount = dv.getUint32(80, true);
  const expected = 84 + triCount * 50;
  if (bytes.byteLength < expected) {
    throw new Error(`Corrupt binary STL: expected >= ${expected} bytes, got ${bytes.byteLength}`);
  }
  const vertProperties = new Float32Array(triCount * 9);
  const triVerts = new Uint32Array(triCount * 3);
  let src = 84, vp = 0;
  for (let t = 0; t < triCount; t++) {
    src += 12; // skip normal
    for (let c = 0; c < 3; c++) {
      vertProperties[vp++] = dv.getFloat32(src, true);
      vertProperties[vp++] = dv.getFloat32(src + 4, true);
      vertProperties[vp++] = dv.getFloat32(src + 8, true);
      src += 12;
    }
    triVerts[t * 3] = t * 3; triVerts[t * 3 + 1] = t * 3 + 1; triVerts[t * 3 + 2] = t * 3 + 2;
    src += 2; // attribute byte count
  }
  return { vertProperties, triVerts };
}
```

The `< 84` guard sits before ANY offset-80 `DataView` read (both the `solid`-prefix branch and the main read below it), so a truncated input throws a clear error instead of an unhelpful `RangeError`.

Also replace `buildBinaryStl` in `spike/src/stl.mjs` (it currently writes an all-zero 12-byte normal per facet) with a version that computes and writes a real facet normal:
```javascript
// Binary STL export: 80-byte header, uint32 triangle count, then 50 bytes/
// triangle (12-byte computed facet normal + 3 * 12-byte vertices + 2-byte
// attribute). The spike parses 3MF for intake but exports repaired meshes as
// binary STL — STL remains the export format; 3MF export is a deferred
// build-phase item. This consumes the shared/indexed mesh buffer as-is: each
// triVerts entry indexes into vertProperties, so a shared vertex is written
// once per corner that references it (STL has no shared-vertex concept).
export function buildBinaryStl({ vertProperties, triVerts }) {
  const triCount = triVerts.length / 3;
  const out = new Uint8Array(84 + triCount * 50);
  const dv = new DataView(out.buffer);
  dv.setUint32(80, triCount, true);
  let o = 84;
  for (let t = 0; t < triCount; t++) {
    const i0 = triVerts[t * 3] * 3;
    const i1 = triVerts[t * 3 + 1] * 3;
    const i2 = triVerts[t * 3 + 2] * 3;
    const x0 = vertProperties[i0], y0 = vertProperties[i0 + 1], z0 = vertProperties[i0 + 2];
    const x1 = vertProperties[i1], y1 = vertProperties[i1 + 1], z1 = vertProperties[i1 + 2];
    const x2 = vertProperties[i2], y2 = vertProperties[i2 + 1], z2 = vertProperties[i2 + 2];

    // Real facet normal (not zero). Besides being correct STL, this matters
    // for ADMesh's ASCII/binary auto-detection, which scans 128 bytes
    // starting at file offset 84 (the first facet's normal + first vertex)
    // for any byte >127. Round-number coordinates (e.g. 0/10) combined with
    // an all-zero normal can leave every byte in that window <=127,
    // misdetecting the file as ASCII — ADMesh then parses 0 facets and can
    // hang. A real, non-degenerate normal avoids that failure mode.
    const ux = x1 - x0, uy = y1 - y0, uz = z1 - z0;
    const vx = x2 - x0, vy = y2 - y0, vz = z2 - z0;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) { nx /= len; ny /= len; nz /= len; }
    dv.setFloat32(o, nx, true);
    dv.setFloat32(o + 4, ny, true);
    dv.setFloat32(o + 8, nz, true);
    o += 12;

    for (let c = 0; c < 3; c++) {
      const v = triVerts[t * 3 + c] * 3;
      dv.setFloat32(o, vertProperties[v], true);
      dv.setFloat32(o + 4, vertProperties[v + 1], true);
      dv.setFloat32(o + 8, vertProperties[v + 2], true);
      o += 12;
    }
    o += 2;
  }
  return out;
}
```
Note: this changes `buildBinaryStl`'s output bytes (real normals instead of zeros) but not its geometry — `parseBinaryStl` skips the 12-byte normal on read (`src += 12; // skip normal`), so the earlier spike plan's `parseBinaryStl round-trips buildBinaryStl` test (Step 1 above) still holds unchanged.

- [ ] **Step 4: Write the repair binding**

Create `spike/src/repair-admesh.mjs`:
```javascript
import createAdmesh from '../wasm/admesh.mjs';
import { buildBinaryStl, parseBinaryStl } from './stl.mjs';

export class AdmeshEngineError extends Error {
  constructor(message) { super(message); this.name = 'AdmeshEngineError'; }
}

let modPromise;
function getModule() {
  // Instantiate the Emscripten module once and reuse it.
  if (!modPromise) modPromise = createAdmesh();
  return modPromise;
}

// Monotonic counter for MEMFS paths. The module instance (and its MEMFS) is
// cached and reused across calls (see getModule above); a hardcoded
// /in.stl, /out.stl pair would let concurrent repairWithAdmesh calls clobber
// each other's files. A simple counter is enough — this only needs to be
// collision-proof against ourselves, not cryptographically unique.
let callCounter = 0;

// ADMesh's stl_count_facets() enforces a hard STL_MIN_FILE_SIZE = 284 bytes
// (84-byte header + 4 triangles * 50 bytes each) and sets stl->error before
// stl_repair ever runs on anything smaller. Reject undersized/malformed
// input HERE, before it ever reaches MEMFS/ccall — this keeps doomed inputs
// out of ADMesh entirely, which also sidesteps the fp-handle leak on
// stl_open's error path (see repair_wrapper.c and the RESIDUAL note in
// Global Constraints) for this common case.
function assertRepairableStlSize(stlBytes) {
  if (stlBytes.length < 284 || (stlBytes.length - 84) % 50 !== 0) {
    throw new AdmeshEngineError('mesh too small or malformed for ADMesh (< 4 triangles / wrong size)');
  }
}

// Repairs a mesh buffer by round-tripping binary STL through ADMesh (WASM) via
// MEMFS. Input/output are the shared { vertProperties, triVerts } shape.
export async function repairWithAdmesh(input) {
  const Mod = await getModule();
  const n = callCounter++;
  const inPath = `/in-${n}.stl`;
  const outPath = `/out-${n}.stl`;
  const stlBytes = buildBinaryStl(input);
  assertRepairableStlSize(stlBytes);
  Mod.FS.writeFile(inPath, stlBytes);

  const rc = Mod.ccall('repair', 'number', ['string', 'string'], [inPath, outPath]);
  if (rc !== 0) {
    try { Mod.FS.unlink(inPath); } catch { /* ignore */ }
    try { Mod.FS.unlink(outPath); } catch { /* ignore */ }
    throw new AdmeshEngineError(`ADMesh repair failed (rc=${rc})`);
  }

  // try/finally so a thrown parseBinaryStl (e.g. truncated/malformed ADMesh
  // output) still unlinks both per-call MEMFS files, instead of leaking them
  // on the parse-error path.
  try {
    const outBytes = Mod.FS.readFile(outPath); // Uint8Array
    const mesh = parseBinaryStl(outBytes);
    return { mesh, ok: true };
  } finally {
    try { Mod.FS.unlink(inPath); } catch { /* ignore */ }
    try { Mod.FS.unlink(outPath); } catch { /* ignore */ }
  }
}
```

Note: if `import createAdmesh from '../wasm/admesh.mjs'` fails to resolve the sibling `admesh.wasm` in Node, pass a `locateFile` option. Only add the `fileURLToPath` import if this fallback is actually applied — do not add it as an unused top-level import otherwise:
```javascript
import { fileURLToPath } from 'node:url';
// ...
const Mod = await createAdmesh({
  locateFile: (p) => fileURLToPath(new URL(`../wasm/${p}`, import.meta.url)),
});
```
Apply this calibration only if Step 6 reports a wasm-not-found error.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd "$(git rev-parse --show-toplevel)/spike" && node --test test/repair-admesh.test.mjs`
Expected: PASS — 2 tests. The holed cube's 4 open edges become 0 after ADMesh.

- [ ] **Step 6: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add spike/src/stl.mjs spike/src/repair-admesh.mjs spike/test/repair-admesh.test.mjs && git commit -m "feat(engine): JS binding for ADMesh WASM repair + binary STL reader"
```

---

### Task 3: End-to-end pipeline run on the real fixture

**Files:**
- Create: `spike/run-admesh.mjs`
- Modify: `spike/src/check.mjs` (add a shared, exported `bboxDiagonal` helper)
- Modify: `spike/FINDINGS.md` (append the WASM-engine end-to-end result)

**Interfaces:**
- Adds `bboxDiagonal(vertProperties: Float32Array): number` to `check.mjs`, exported so `run-admesh.mjs` and `engine.mjs` (Task 4) share one implementation instead of each keeping a local copy.
- Otherwise none new — orchestrates `parse3mf` → `repairWithAdmesh` → `analyzeManifold` → `buildBinaryStl` export.

- [ ] **Step 1: Extract a shared `bboxDiagonal` helper, then write the end-to-end CLI**

Add to `spike/src/check.mjs` (exported alongside `analyzeManifold`):
```javascript
// Bounding-box diagonal — used by callers to derive a scale-relative
// tolerance for analyzeManifold. Shared here so run-admesh.mjs and
// engine.mjs (and any future consumer) don't each maintain their own copy.
export function bboxDiagonal(vertProperties) {
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < vertProperties.length; i += 3) {
    const x = vertProperties[i], y = vertProperties[i + 1], z = vertProperties[i + 2];
    if (x < mnx) mnx = x; if (x > mxx) mxx = x;
    if (y < mny) mny = y; if (y > mxy) mxy = y;
    if (z < mnz) mnz = z; if (z > mxz) mxz = z;
  }
  return Math.hypot(mxx - mnx, mxy - mny, mxz - mnz);
}
```

Create `spike/run-admesh.mjs`:
```javascript
import { readFileSync, writeFileSync } from 'node:fs';
import { parse3mf } from './src/mesh3mf.mjs';
import { buildBinaryStl } from './src/stl.mjs';
import { analyzeManifold, bboxDiagonal } from './src/check.mjs';
import { repairWithAdmesh, AdmeshEngineError } from './src/repair-admesh.mjs';

const inPath = process.argv[2] ?? 'test/fixtures/tripo-broken.3mf';
const outPath = process.argv[3] ?? 'test/fixtures/tripo-admesh-repaired.stl';

// Validated by spike/FINDINGS.md: the native `admesh --fill-holes
// --normal-directions --normal-values` run left exactly 2 residual complex
// edges while OrcaSlicer still reported manifold = yes. That specific count —
// not "any number" — is the validated baseline; exceeding it is a signal to
// re-check against the slicer before trusting the REPAIRED verdict.
const COMPLEX_BASELINE = 2;

const parsed = parse3mf(new Uint8Array(readFileSync(inPath)));
const bboxDiag = bboxDiagonal(parsed.vertProperties);
const tolerance = !Number.isFinite(bboxDiag) || bboxDiag === 0 ? 1e-6 : Math.max(1e-6, bboxDiag * 1e-6);
console.log('SCALE :', { bboxDiagonal: bboxDiag, tolerance });
console.log('BEFORE:', analyzeManifold(parsed, { tolerance }));

let mesh;
try {
  ({ mesh } = await repairWithAdmesh(parsed));
} catch (err) {
  if (err instanceof AdmeshEngineError) { console.error('VERDICT: CRASHED ❌', err.message); process.exit(2); }
  throw err;
}

const after = analyzeManifold(mesh, { tolerance });
console.log('AFTER :', after);
writeFileSync(outPath, buildBinaryStl(mesh));
console.log(`Wrote ${outPath}`);

// PASS = the validated print bar (see Global Constraints): no open/flipped edges
// and real geometry. complexEdges is logged, not gated (within the slicer's
// accepted bar per spike/FINDINGS.md); Task 5 can drive it to 0 if ever needed.
const pass = after.openEdges === 0 && after.flippedEdges === 0 && after.triangles > 0 && Math.abs(after.signedVolume) > 0;
if (after.complexEdges > 0) console.log(`NOTE  : ${after.complexEdges} complex edge(s) remain — within slicer bar, logged not gated.`);
if (after.complexEdges > COMPLEX_BASELINE) {
  console.warn(`WARNING: complexEdges (${after.complexEdges}) exceeds the slicer-validated baseline (${COMPLEX_BASELINE}) — re-check against the production slicer before trusting the REPAIRED verdict.`);
}
console.log(pass ? 'VERDICT: REPAIRED ✅' : 'VERDICT: STILL BROKEN ❌');
process.exit(pass ? 0 : 1);
```

- [ ] **Step 2: Run against the real 3MF fixture**

Run:
```bash
cd "$(git rev-parse --show-toplevel)/spike" && node --max-old-space-size=4096 run-admesh.mjs
```
Expected (matching the native-oracle result recorded in FINDINGS): BEFORE `openEdges≈22, flippedEdges≈40`, AFTER `openEdges=0, flippedEdges=0, complexEdges≈2`, `VERDICT: REPAIRED ✅`, exit 0. A `complexEdges≈2` result matches `COMPLEX_BASELINE` exactly, so no `WARNING:` line should print — its absence confirms this run matches the FINDINGS baseline, not just an arbitrary passing count. Record all blocks verbatim.

- [ ] **Step 3: Independently reconfirm with the production slicer (optional but recommended)**

Run (OrcaSlicer `--info` on the WASM-produced output, mirroring the spike reality-check):
```bash
"/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer" --info "$(git rev-parse --show-toplevel)/spike/test/fixtures/tripo-admesh-repaired.stl" 2>&1 | grep -iE "manifold|open_edges|facets"
```
Expected: `manifold = yes`. If OrcaSlicer is unavailable (e.g. CI), skip and rely on the checker gate. Record the result.

- [ ] **Step 4: Append the end-to-end result to FINDINGS**

Add a short `## Addendum (WASM engine end-to-end)` section to `spike/FINDINGS.md` with the real `run-admesh.mjs` BEFORE/AFTER/VERDICT numbers and the OrcaSlicer `manifold` result, confirming the WASM engine reproduces the native-oracle outcome.

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add spike/run-admesh.mjs spike/src/check.mjs spike/FINDINGS.md && git commit -m "feat(engine): end-to-end ADMesh WASM repair pipeline on real fixture"
```

---

### Task 4: Engine module surface for the browser (framework-agnostic API)

**Files:**
- Create: `spike/src/engine.mjs`
- Test: `spike/test/engine.test.mjs`

**Interfaces:**
- Produces the single entry point the future browser/Worker layer will call:
  - `repairMesh(fileBytes: Uint8Array, kind: 'stl' | '3mf'): Promise<{ stl: Uint8Array, report: { before: object, after: object, pass: boolean } }>` — detects/uses the given container, parses to a mesh buffer (`parse3mf` or `parseBinaryStl`), repairs via `repairWithAdmesh`, measures before/after with `analyzeManifold` (scale-derived tolerance), and returns the repaired binary STL plus a report. This is framework-agnostic (no DOM, no worker assumptions) so it can be dropped into a Web Worker unchanged.

- [ ] **Step 1: Write the failing test**

Create `spike/test/engine.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairMesh } from '../src/engine.mjs';
import { buildBinaryStl } from '../src/stl.mjs';

// Holed cube as a binary STL input (kind: 'stl'). NOT a holed tetrahedron:
// ADMesh's stl_count_facets() enforces a hard STL_MIN_FILE_SIZE = 284-byte /
// 4-triangle floor and sets stl->error before stl_repair runs on anything
// smaller (a 3-triangle/234-byte tetrahedron is below it and unrepairable).
// This cube is 12 triangles minus the top face = 10 triangles / 584 bytes,
// safely above that floor. Fractional, non-round coordinates are a
// belt-and-suspenders measure against ADMesh's binary/ASCII auto-detection
// misfire (see stl.mjs's buildBinaryStl and repair-admesh.test.mjs).
const V = [
  [0.13, 0.19, 0.07], [10.37, 0.19, 0.07], [10.37, 10.23, 0.07], [0.13, 10.23, 0.07], // z-min
  [0.13, 0.19, 10.41], [10.37, 0.19, 10.41], [10.37, 10.23, 10.41], [0.13, 10.23, 10.41], // z-max
];
// 10 outward-CCW triangles; the two top-face tris ([4,5,6],[4,6,7]) are omitted → hole.
const F = [
  [0, 2, 1], [0, 3, 2],           // bottom (z-min)
  [0, 1, 5], [0, 5, 4],           // front (y-min)
  [3, 7, 6], [3, 6, 2],           // back (y-max)
  [0, 4, 7], [0, 7, 3],           // left (x-min)
  [1, 2, 6], [1, 6, 5],           // right (x-max)
];
function buf(v, f) {
  const vertProperties = new Float32Array(f.length * 9);
  const triVerts = new Uint32Array(f.length * 3);
  let vp = 0;
  for (let t = 0; t < f.length; t++) {
    for (let c = 0; c < 3; c++) { const [x, y, z] = v[f[t][c]]; vertProperties[vp++] = x; vertProperties[vp++] = y; vertProperties[vp++] = z; }
    triVerts[t * 3] = t * 3; triVerts[t * 3 + 1] = t * 3 + 1; triVerts[t * 3 + 2] = t * 3 + 2;
  }
  return { vertProperties, triVerts };
}

test('repairMesh repairs a holed STL and reports pass', async () => {
  const stlIn = buildBinaryStl(buf(V, F));
  const { stl, report } = await repairMesh(stlIn, 'stl');
  assert.ok(stl instanceof Uint8Array && stl.length > 84);
  assert.equal(report.before.openEdges, 4, 'the missing top face leaves a 4-edge square hole');
  assert.equal(report.after.openEdges, 0);
  assert.equal(report.pass, true);
});

test('repairMesh rejects an unknown kind', async () => {
  await assert.rejects(() => repairMesh(new Uint8Array([0]), 'obj'), /unsupported/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)/spike" && node --test test/engine.test.mjs`
Expected: FAIL — `Cannot find module '../src/engine.mjs'`.

- [ ] **Step 3: Implement the engine surface**

Create `spike/src/engine.mjs`:
```javascript
import { parse3mf } from './mesh3mf.mjs';
import { parseBinaryStl, buildBinaryStl } from './stl.mjs';
import { analyzeManifold, bboxDiagonal } from './check.mjs';
import { repairWithAdmesh } from './repair-admesh.mjs';

// Same validated baseline as run-admesh.mjs (see spike/FINDINGS.md): the
// native repair run left exactly 2 residual complex edges while OrcaSlicer
// still reported manifold = yes. Exceeding it is a signal to re-check against
// the slicer, not a hard failure — pass/fail stays driven by openEdges/
// flippedEdges/signedVolume alone.
const COMPLEX_BASELINE = 2;

// Framework-agnostic repair entry point for the browser/Worker layer.
export async function repairMesh(fileBytes, kind) {
  const bytes = fileBytes instanceof Uint8Array ? fileBytes : new Uint8Array(fileBytes);
  let parsed;
  if (kind === '3mf') parsed = parse3mf(bytes);
  else if (kind === 'stl') parsed = parseBinaryStl(bytes);
  else throw new Error(`unsupported kind: ${kind} (expected 'stl' or '3mf')`);

  const d = bboxDiagonal(parsed.vertProperties);
  const tolerance = !Number.isFinite(d) || d === 0 ? 1e-6 : Math.max(1e-6, d * 1e-6);
  const before = analyzeManifold(parsed, { tolerance });

  const { mesh } = await repairWithAdmesh(parsed);
  const after = analyzeManifold(mesh, { tolerance });
  const pass = after.openEdges === 0 && after.flippedEdges === 0 && after.triangles > 0 && Math.abs(after.signedVolume) > 0;
  if (after.complexEdges > COMPLEX_BASELINE) {
    console.warn(`WARNING: complexEdges (${after.complexEdges}) exceeds the slicer-validated baseline (${COMPLEX_BASELINE}) — re-check against the production slicer before trusting the REPAIRED verdict.`);
  }

  return { stl: buildBinaryStl(mesh), report: { before, after, pass } };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd "$(git rev-parse --show-toplevel)/spike" && node --test test/engine.test.mjs`
Expected: PASS — 2 tests.

- [ ] **Step 5: Run the full suite**

Run: `cd "$(git rev-parse --show-toplevel)/spike" && node --test`
Expected: all prior tests plus the new ones pass (mesh3mf 7, check 4, repair 2, repair-admesh 2, engine 2).

- [ ] **Step 6: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add spike/src/engine.mjs spike/test/engine.test.mjs && git commit -m "feat(engine): framework-agnostic repairMesh entry point"
```

---

### Task 5 (OPTIONAL / stretch): In-JS complex-edge cleanup to strict manifold

Only do this if strict topological manifoldness (complexEdges === 0) is required beyond the slicer's accepted bar. The spike showed OrcaSlicer treats the ADMesh output as `manifold = yes` with 2 complex edges, so this is not required to ship.

**Files:**
- Modify: `spike/src/check.mjs` (add `findComplexEdges` returning the offending triangle ids)
- Create: `spike/src/cleanup.mjs` (`dropComplexFacets(mesh): mesh`)
- Test: `spike/test/cleanup.test.mjs`

- [ ] **Step 1: Write the failing test** — construct a mesh with one edge shared by 3 triangles; assert `analyzeManifold` reports `complexEdges: 1`, then `dropComplexFacets` removes the excess facet so a re-check reports `complexEdges: 0` while keeping `openEdges` from regressing beyond what removing one facet implies. (Author the exact fixture and expected counts; do not leave TBD.)
- [ ] **Step 2–5:** implement `findComplexEdges` (reuse the directed-edge map already built in `analyzeManifold`, exposing which welded edge keys have incidence > 2 and the triangles touching them), implement `dropComplexFacets` (remove the minimal set of facets to bring every edge to incidence ≤ 2, preferring to keep the larger connected component), run tests, commit. Then optionally re-run `run-admesh.mjs` with a `--strict` flag that applies cleanup and assert `complexEdges === 0`.

---

## Self-Review

- **Goal coverage:** Task 1 produces the WASM engine (the plan's core risk: does ADMesh compile+run in WASM); Task 2 binds it in JS with a real repair test (holed cube, 4 open edges → 0 open edges); Task 3 proves the full pipeline on the real 3MF and reconfirms with the production slicer; Task 4 exposes the framework-agnostic `repairMesh` the browser layer will consume. ✅
- **Reuse:** `parse3mf`, `buildBinaryStl`, `analyzeManifold` are imported, not reimplemented; only `parseBinaryStl` (a genuine new need — reading ADMesh output) is added. ✅
- **Acceptance honesty:** the gate is `openEdges===0 && flippedEdges===0 && triangles>0 && signedVolume≠0`, matching the validated slicer bar; `complexEdges` is logged, not gated, but now also compared against `COMPLEX_BASELINE = 2` (the exact count validated in FINDINGS) with a visible `WARNING:` if exceeded, in both `run-admesh.mjs` and `engine.mjs`. Task 5 remains the strict-mode escape hatch. ✅
- **Type consistency:** every module exchanges `{ vertProperties: Float32Array, triVerts: Uint32Array }`; `repairWithAdmesh` returns `{ mesh, ok }`; `repairMesh` returns `{ stl, report }`; `analyzeManifold`'s field names (`openEdges`, `flippedEdges`, `complexEdges`, `triangles`, `signedVolume`, …) match all consumers. `bboxDiagonal` is now a single exported helper in `check.mjs`, consumed identically by `run-admesh.mjs` and `engine.mjs` instead of being duplicated. ✅ Note: `spike/run.mjs` from the PRIOR spike plan keeps its own pre-existing local `bboxDiagonal` and is intentionally NOT touched by this plan (out of scope here) — that duplication is accepted for now; a future cleanup could migrate `run.mjs` to import the shared `check.mjs` export instead.
- **Build reproducibility:** the WASM is built inside a pinned `emscripten/emsdk` image via Docker, no local emcc; `admesh-src/` is gitignored, artifacts committed. The image is amd64-only, so `build.sh` runs it under `--platform linux/amd64` explicitly on arm64 hosts rather than relying on silent Docker emulation. `-sMAXIMUM_MEMORY=4GB` bounds (but doesn't eliminate) the risk of the real ~1.87M-triangle fixture exceeding Emscripten's default 2GB growth ceiling. ✅
- **Repair configuration honesty:** `repair_wrapper.c`'s `stl_repair` call now uses the EXACT flags validated against OrcaSlicer in FINDINGS (`fixall=0`; fill-holes, normal-directions, normal-values only — nearby and reverse-all are NOT run), not the broader default "fixall" superset that was never validated. ✅
- **Hang root cause addressed, not just worked around:** `buildBinaryStl` now writes real computed facet normals instead of zeros, which is both correct STL and prevents the specific round-coordinate + zero-normal combination that made ADMesh misdetect a binary STL as ASCII (128-byte scan at offset 84) and hang. Both new test fixtures also use non-round coordinates independently of that fix, and the browser-app plan is put on notice (Global Constraints) that it MUST run repair in a Worker with a watchdog timeout regardless — this plan cannot guarantee ADMesh never hangs on adversarial input, only that its own fixtures and the real fixture don't trigger the known failure mode. ✅
- **Licensing:** GPLv2 is flagged in Global Constraints; `ADMESH-LICENSE`, the pinned `ADMESH-SOURCE-COMMIT.txt`, and `SOURCE-OFFER.md` (how to obtain/rebuild the corresponding source) are all shipped and committed — not just promised. The business decision about GPL in the promo tool is surfaced to the user, not silently made. ⚠️ (user decision)
- **Out of scope (deferred to the browser-app plan):** drag/drop intake UI, three.js before/after viewer, Web Worker + watchdog wiring (required — see Global Constraints), download UX, SliceMargin promo shell, and 3MF *export*. This plan stops at a validated, framework-agnostic engine.
- **Known calibration points (flagged, not hidden):** the exact ADMesh error-accessor name in `repair_wrapper.c` (match `stl.h`), the Emscripten `locateFile` option for resolving `admesh.wasm` under Node, the Docker image architecture on Apple Silicon, and `-sMAXIMUM_MEMORY=4GB` as a starting (not proven-sufficient) ceiling — all explicitly called out at their steps as expected build calibration.
