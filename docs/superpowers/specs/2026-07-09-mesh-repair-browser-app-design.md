# Mesh Repair — Browser App Design Spec

**Date:** 2026-07-09
**Status:** Approved (design)
**Depends on:** `2026-07-07-mesh-repair-design.md` (product spec), the validated ADMesh WASM engine on branch `spike/wasm-derisk`

## 1. Purpose

Build the browser application around the already-validated repair engine. The engine
(`repairMesh(bytes, kind) -> { stl, report }`) repairs the real broken Tripo mesh from 67
non-manifold edges down to 2 residual complex edges, and OrcaSlicer reports the result as
`manifold = yes`. The algorithm risk is closed. What remains is the application: intake,
off-main-thread execution with a hang guard, a before/after viewer, honest reporting,
download, and the SliceMargin CTA.

## 2. Scope

### In scope
- Drag/drop and file-picker intake for STL and 3MF.
- Repair executed in a Web Worker, guarded by a mandatory watchdog.
- three.js before/after viewer with a toggle and a defect-edge overlay on the "before" mesh.
- A report showing what was fixed and what was not.
- Download of the repaired mesh as **binary STL**.
- Promo shell: privacy messaging and a non-invasive SliceMargin CTA.

### Out of scope
- **3MF export.** The engine returns binary STL only. Tracked as a separate GitHub issue,
  deliberately excluded from this spec (see §9).
- Everything already excluded by the product spec §2: interactive editing, accounts,
  backend, file storage.

## 3. Repository structure

The engine is no longer a spike. It is production code with a clean boundary and 17 passing
tests. It gets promoted, and the boundary gets enforced by module resolution rather than by
discipline.

```
packages/engine/            # promoted from spike/
  src/{mesh3mf,stl,check,repair-admesh,engine}.mjs
  wasm/{admesh.wasm,admesh.mjs,build.sh,repair_wrapper.c,ADMESH-LICENSE,SOURCE-OFFER.md}
  test/
apps/web/
  index.html
  src/main.ts               # state machine, wiring
  src/dropzone.ts           # intake + file-kind detection
  src/repair-client.ts      # owns the Worker and the watchdog
  src/worker/repair.worker.ts
  src/viewer.ts             # three.js scene, toggle, defect overlay
  src/report.ts             # renders the repair report
  src/promo.ts              # privacy copy + SliceMargin CTA
```

npm workspaces. `apps/web` depends on `@mesh-repair/engine` through the workspace package
entry point. It must never reach into `packages/engine/src/*` directly.

**Stack:** Vite + TypeScript, no UI framework. The app is one screen and a five-state machine;
a framework would add runtime weight and indirection without buying anything. Vite handles
Worker bundling and `.wasm` asset resolution natively.

**Deployment:** fully static. The app uses no threads and no `SharedArrayBuffer`, so it does
**not** require `COOP`/`COEP` headers. Any static host works.

## 4. Engine changes

Three additive changes. No existing behavior is modified; the 17 tests must keep passing.

### 4.1 `check.mjs` — expose defect edges

`analyzeManifold` already classifies every directed edge as open, flipped, or complex, then
discards the classification and returns only counters. Add an opt-in option:

```
analyzeManifold(mesh, { tolerance, collectDefectEdges = false })
```

When `collectDefectEdges` is `true`, the returned report additionally carries the endpoint
coordinates of the open and flipped edges, taken from the welded representative positions
(`repPosition`), as flat `Float32Array`s of `[x,y,z, x,y,z, ...]` vertex pairs — the layout
three.js `LineSegments` consumes directly.

It is opt-in because a severely damaged multi-million-triangle mesh could materialize a large
array. The app requests it; the engine's own tests do not.

### 4.2 `engine.mjs` — progress callback and geometry passthrough

`repairMesh(fileBytes, kind, { onProgress })` invokes `onProgress(phase)` as it enters each
phase. The worker forwards these as heartbeats.

`repairMesh` additionally returns `beforeMesh` and `afterMesh` (each `{ vertProperties, triVerts }`).
The viewer needs both; re-parsing the source file on the main thread to recover the "before"
geometry would duplicate work already done inside the worker.

### 4.3 `engine.mjs` — warnings become data, not console output

Today, when residual `complexEdges` exceed the slicer-validated baseline of 2, `engine.mjs`
emits a `console.warn`. A warning that exists only in the developer console does not exist for
the user. It becomes `report.warnings: string[]`, and the UI renders it.

`report.pass` remains driven solely by `openEdges === 0 && flippedEdges === 0 && triangles > 0
&& |signedVolume| > 0`. Exceeding the complex-edge baseline is a warning, never a failure.

## 5. Worker protocol and watchdog

### 5.1 Protocol

The main thread transfers the file's `ArrayBuffer` to the worker (zero copy). The worker loads
the WASM module, runs `repairMesh`, and transfers the results back.

| Direction | Message |
|---|---|
| main → worker | `{ type: 'repair', bytes: ArrayBuffer, kind: 'stl' \| '3mf' }` |
| worker → main | `{ type: 'progress', phase }` — one per phase entered |
| worker → main | `{ type: 'done', stl, report, beforeMesh, afterMesh }` |
| worker → main | `{ type: 'error', message }` |

Phases, in order: `parse`, `analyze-before`, `repair`, `analyze-after`, `export`.

### 5.2 Watchdog

ADMesh can hang. A hung WASM call inside a worker cannot be interrupted cooperatively; the only
recovery is `worker.terminate()` from the main thread. The watchdog is therefore not a defensive
nicety — it is the sole recovery path, and it is mandatory.

`repair-client.ts` arms a **per-phase deadline**. On every `progress` message it disarms the
current deadline and arms the next phase's. If a deadline expires, it calls `worker.terminate()`
and transitions the app to the timeout error state.

Each phase budget is `base + k × triangleCount`, so a slow large mesh is not mistaken for a dead
one. `k` is measured empirically against the real Tripo fixture and multiplied by a safety factor.

**Stated limitation:** the `repair` phase is a single opaque WASM call. No heartbeat is possible
inside it without instrumenting the C source. That phase therefore has no progress detection —
only a hard ceiling. This is a known and accepted gap.

Because the WASM module is instantiated inside the worker, `terminate()` reclaims it. A hang
cannot leak across repairs.

## 6. Viewer

One three.js scene, one camera, two `BufferGeometry` objects built from `beforeMesh` and
`afterMesh`. The toggle swaps their visibility — sharing the camera is what makes the comparison
meaningful.

Over the "before" mesh, a `LineSegments` overlay draws the defect edges from §4.1: open edges in
red, flipped edges in a second color. On most real meshes the damage (14 open edges among 200k
triangles) is invisible to the naked eye; without the overlay the toggle communicates nothing and
the numeric report carries the entire burden of persuasion.

Camera fits the mesh bounding box. `OrbitControls` for inspection. Geometries are disposed when a
new file is loaded.

## 7. States and error handling

```
idle → reading → repairing(phase) → done
                      ↓
                    error
```

| Condition | Behavior |
|---|---|
| Unsupported or corrupt file | Clear message, return to `idle`. No crash. |
| Over the soft size cap | Warning with an explicit "proceed anyway" action. Never a hard rejection. |
| Watchdog deadline expired | Worker terminated. Message explains the model may be too complex. |
| WASM fails to load | Graceful message; the tool is unusable but the page is not broken. |

**Honest reporting rule.** If `report.pass` is `false`, the UI does not say "repaired". It states
which defects remain, with counts, and still offers the download. The tool never hands back a
broken file while claiming success. This enforces product spec §5 in code rather than in prose.

`report.warnings` are rendered whenever present, including on a passing repair.

## 8. Testing

- **Engine:** the existing 17 Node tests keep passing unchanged. New tests cover
  `collectDefectEdges` (a known-holed fixture yields the expected edge count) and `onProgress`
  (phases fire in order).
- **Watchdog and state machine:** unit-tested on the main thread with fake timers and a fake
  worker — a stub that emits scripted heartbeats, or stops emitting them to simulate a hang.
  No WebGL, no browser, deterministic.
- **Viewer:** builds `BufferGeometry` from a mesh and asserts vertex and index counts. No WebGL
  context needed in CI.
- **End-to-end (Playwright):** drops the real Tripo fixture, asserts a repaired STL is produced
  and the report matches the validated baseline. The fixture is ~32 MB and gitignored, so this
  suite is **local-only** and must be explicitly marked as such. A CI run that silently skips it
  must not be reported as a pass.

## 9. Deferred

**3MF export.** The user drops a 3MF and downloads an STL. Writing 3MF back would require welding
ADMesh's unshared triangle soup into indexed vertices, and deciding what to do with the original
container's materials, colors, transforms, and units — none of which survive ADMesh, which
operates on bare geometry. A 3MF that silently lost its color is worse than an honest STL. Every
slicer consumes STL. Tracked as a GitHub issue; deliberately not in this spec.

## 10. Success criteria

- A user drops the broken Tripo 3MF, sees the defects highlighted, toggles to the repaired mesh,
  and downloads a manifold binary STL — with no upload and no frozen UI.
- A hung repair is killed by the watchdog and surfaces a clear message instead of a dead tab.
- A partial repair is reported as partial.
- The SliceMargin CTA is present and non-invasive.
