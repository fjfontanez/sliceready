# AGENTS.md — mesh-repair code review contract

A client-side mesh repair tool. ADMesh compiled to WASM repairs broken STL/3MF meshes
inside a Web Worker; nothing is uploaded. Two npm workspaces:

- `packages/engine` — plain ESM `.mjs`, tested with `node:test`. No TypeScript, no bundler.
- `apps/web` — Vite + TypeScript (`strict`, `noUncheckedIndexedAccess`), Vitest + happy-dom,
  Playwright e2e. No UI framework.

Reviewed file types (`.gga`): `*.ts,*.tsx,*.js,*.jsx,*.mjs`.
Excluded: test files, `*.d.ts`, and `admesh.mjs` (generated Emscripten glue).

---

## ALL FILES

- REJECT if a comment, identifier, string literal, or UI copy is written in any language other
  than English.
- REJECT if any network call carries mesh data: `fetch(`, `XMLHttpRequest`, `sendBeacon`,
  `WebSocket`. The page promises the model never leaves the user's computer. Fetching the
  `.wasm` asset is the only sanctioned request.
- REJECT if `SharedArrayBuffer` or a threaded WASM build is introduced. The deploy must work
  without `COOP`/`COEP` headers.
- REJECT if code writes a 3MF file. Export is binary STL only (tracked: issue #1).
- REJECT if a comment claims a behavior the code does not have, or explains where the code came
  from rather than a constraint the code cannot express.
- REQUIRE that a verification command in a comment or doc actually passes against the file it
  describes. A grep whose own explanatory comment matches its pattern is a false positive.
- PREFER deleting dead code over commenting it out.

## packages/engine — `**/*.mjs`

- REJECT if `console.log` or `console.warn` survives at statement level
  (`rg -n "^\s*console\.(warn|log)" packages/engine/src/`). Warnings the user must see belong in
  `report.warnings`; a warning that exists only in the developer console does not exist.
- REJECT if a change to `analyzeManifold`'s return value renames or repurposes an existing
  property. Engine changes are additive; the app and its tests read those names.
- REJECT if `defectEdges` is materialized when `collectDefectEdges` is false, or if the
  `maxDefectEdges` cap is removed. A severely damaged multi-million-triangle mesh must not blow
  up memory.
- REJECT if `report.pass` gains or loses a term. It is exactly
  `after.openEdges === 0 && after.flippedEdges === 0 && after.triangles > 0 && Math.abs(after.signedVolume) > 0`.
  Residual complex edges are a warning, never a failure.
- REJECT if a phase is entered without first calling `onProgress(phase, info)`. The Worker turns
  those calls into watchdog heartbeats; a silent phase is a phase the watchdog cannot time.
  Phases, in order: `parse`, `analyze-before`, `repair`, `analyze-after`, `export`.
- REJECT if `getModule()` caches a rejected promise. A transient `.wasm` fetch failure must not
  poison every later repair in the session.
- REJECT if a rejection from `createAdmesh()` loses its `code: 'engine-load'` marker. Custom
  `Error` properties do not survive `postMessage`'s structured clone — the code must be forwarded
  as an explicit message field.
- REJECT if `configureAdmesh` stops throwing when called after the module is instantiated. The
  instance is cached; a late reconfiguration would be silently ignored, and silent is the one
  thing it must not be.
- REQUIRE that the engine stays free of browser and bundler knowledge. The caller supplies
  `locateFile`; the engine never reaches for `import.meta.url` to find its own asset.
- REQUIRE that a mesh handed to `repairWithAdmesh` is size-validated in JS first. ADMesh rejects
  STL under 284 bytes / 4 triangles, and mis-detects binary-vs-ASCII on round coordinates with
  zero normals — which hangs it.
- PREFER a spatial-hash weld with neighbor-cell checks over exact-cell lookup. Coincident
  vertices straddle cell boundaries.

## apps/web — `**/*.ts`

### Boundaries

- REJECT if anything under `apps/` imports `packages/engine/src/*` by relative path. The only
  legal specifiers are `@mesh-repair/engine`, `@mesh-repair/engine/check`, and
  `@mesh-repair/engine/wasm/admesh.wasm?url`.
- REJECT if `as any` or `as unknown as` appears. `as BlobPart` in `download.ts` is sanctioned and
  documented: TypeScript ≥ 5.9 narrowed `BlobPart`, and `Uint8Array<ArrayBufferLike>` admits
  `SharedArrayBuffer`, which this app never creates.
- REJECT if `tsconfig.json` loosens `strict` or `noUncheckedIndexedAccess`, or if `include` is
  widened to cover `vite.config.ts` without also fixing the `test` key's type source.
- REQUIRE `defineConfig` in `vite.config.ts` to be imported from `vitest/config`, not `vite` —
  the `test` key is Vitest's surface.

### The watchdog — `repair-client.ts`

The watchdog is not defensive hardening. ADMesh can hang, a hung WASM call inside a Worker cannot
be interrupted cooperatively, and `worker.terminate()` from the main thread is the only recovery.

- REJECT if any code path leaves the client awaiting the worker with no timer armed. `arm('parse')`
  runs before `postMessage`; every `progress` message disarms and re-arms.
- REJECT if `bytes.byteLength` is read after `postMessage(..., [bytes])` transfers the buffer.
  A detached buffer reports `0`, silently shrinking every budget to its base.
- REJECT if `WorkerLike.onmessage` is typed as anything but `((ev: MessageEvent) => void) | null`,
  or `onerror` as anything but `((ev: ErrorEvent) => void) | null`. Under `strictFunctionTypes`
  handler parameters are contravariant: widening either makes a real DOM `Worker` unassignable
  (`TS2345`). Narrower, not wider.
- REJECT if a `.wasm` load failure and a mesh the engine ran on and rejected collapse into the
  same error class. `EngineLoadError`, `RepairTimeoutError` and `RepairFailedError` map to three
  distinct user-facing states.
- REJECT if an error is classified by regex-matching its `message`. The error classes are the
  whole mechanism.
- REQUIRE that the same buffer never appears twice in a `postMessage` transfer list — a duplicate
  is a runtime `DataCloneError`.
- REQUIRE that the `repair` phase's lack of a heartbeat stays documented as an accepted gap. It is
  one opaque WASM call. Do not invent a fake heartbeat.

### Honest reporting

- REJECT if any UI string contains "repaired" (any case) on a path reachable when
  `report.pass === false`. This includes button labels — that is what `downloadLabel(ok)` exists
  for.
- REJECT if the download is hidden on a failed repair. The file is the user's either way.
- REJECT if `defectEdges.truncated` is true and the UI does not say the overlay is partial.
- REQUIRE that a negative `before - after` delta is surfaced, never dropped by a `> 0` guard that
  silently hides a regression.

### DOM and lifecycle

- REJECT if `flatShading: true` is removed from `MESH_MATERIAL_PARAMS`. `toBufferGeometry` emits
  no `normal` attribute; without both, `MeshStandardMaterial` renders unlit. It is a correctness
  requirement, not a style choice.
- REJECT if `viewer.clear()` disposes the shared mesh material, or fails to dispose the per-`show()`
  overlay materials.
- REJECT if an `await` in `handleFile` is not followed by a `generation` check. A slow first repair
  must never paint over a newer file's result.
- REJECT if `await file.arrayBuffer()` sits outside the `try`. It rejects with `NotReadableError`
  when the file moved after selection, and `handleFile` is called as `void handleFile(file)`.
- REJECT if `URL.revokeObjectURL` runs synchronously after `link.click()`. It races the browser's
  fetch of the blob URL and can cancel a ~94 MB download.
- REQUIRE user-controlled strings (filenames) to reach the DOM via `textContent`, never `innerHTML`.

## Tests

- REJECT if a test would pass against a stub or a constant. Name what it pins.
- REJECT if an `import` added to an existing test file re-binds a name that file already imports.
  It is a parse-time `SyntaxError` that kills every test in the file, not a warning.
- REJECT if an engine `test` script passes a path to `node --test`. On Node ≥ 22 a directory
  argument is loaded as a module and fails with `MODULE_NOT_FOUND`. Bare `node --test` discovers.
- REJECT if a promise that a fake timer will reject is not given an inert `.catch()` at creation.
  Vitest reports every test as passed and exits `1` with `Errors: 1 error`.
- REJECT if a suite is declared green on assertion counts alone. Check the exit code.
- REJECT if the Playwright e2e is made to skip when its fixture is missing. It must fail loudly;
  `MESH_REPAIR_SKIP_E2E=1` is the deliberate opt-out.
- REQUIRE the e2e to run against the production build (`vite build && vite preview`), never the
  dev server. It must exercise the artifact users receive.
- PREFER testing a pure function extracted from untestable glue over contorting the glue.
  `main.ts` and `viewer.ts` construct a `WebGLRenderer` and cannot be unit-tested.

## Commits

- REJECT if a commit message is not a conventional commit.
- REJECT if a commit message or body contains `Co-Authored-By`, "Generated with", or any other AI
  attribution.
- REJECT if `dist/`, `test-results/`, `playwright-report/`, or a mesh fixture (`*.stl`, `*.3mf`)
  is staged.

## Project skills

| Trigger | Skill | Location |
|---|---|---|
| Opening a PR, pushing a branch, "ready to merge" | `pre-pr-checks` | `.claude/skills/pre-pr-checks/SKILL.md` |

## Response Format

FIRST LINE must be exactly:
STATUS: PASSED
or
STATUS: FAILED

If FAILED, list: `file:line - rule violated - issue`
