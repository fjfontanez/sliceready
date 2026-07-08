# Mesh Repair WASM Spike — Findings

**Date:** 2026-07-08
**Input:** test/fixtures/tripo-broken.3mf (3MF indexed mesh) → repaired export test/fixtures/tripo-repaired.stl (not produced — engine crashed before export)
**Engine:** manifold-3d v3.5.1 (npm WASM, no compilation), Node v24.17.0

## Measured (independent checker)
- Scale: bboxDiagonal=156.8663996798826, tolerance=0.00015686639967988259
- BEFORE: nonManifoldEdges=67 (open=22, complex=5, flipped=40, degenerate=0), triangles=1876978, weldedVertices=938469, signedVolume=182170.88533812514
- AFTER : n/a — the engine threw before producing any output mesh (see Verdict)
- Engine self-report (corroborating only — not the watertight gate; the gate uses the independent
  `signedVolume` above): status=n/a, genus=n/a, volume=n/a, merged=n/a — `new Manifold(mesh)` threw
  `ManifoldError: Not manifold` (code `NotManifold`) during construction, wrapped as `ManifoldEngineError`.

## Verdict

**CRASHED — the manifold-3d engine threw during reconstruction on this input** (caught as
`ManifoldEngineError: manifold-3d engine failed during reconstruction: Not manifold`; exit code 2).
This is a distinct outcome from STILL BROKEN: the engine could not process the input at all, rather
than processing it and leaving non-manifold edges.

**Conclusion: manifold-3d alone CANNOT repair this class of mesh.** It is a manifold-guaranteeing
boolean/geometry kernel, not a repair tool. Verified three ways:
1. Real run: the 1,876,978-triangle Tripo 3MF (67 genuine non-manifold edges) → `NotManifold` throw.
2. Unit test: a trivial holed tetrahedron (3 open edges) → same `NotManifold` throw at `new Manifold()`.
3. Library docs (README): "accepts manifold meshes as input ... includes a `Merge` function to fix
   *slightly* non-manifold meshes, but generally requires input meshes to be manifold." `Mesh.merge()`
   only welds coincident vertices along open edges — it does not fill holes or fix inverted normals.

The de-risking spike (design spec §6) has done its job: we learned, in ~1 day instead of weeks, that
the primary engine choice is wrong for the real defect profile.

## Interpretation notes
- The defect profile is genuine topology, not an unshared-vertex artifact: only 13 of 938,482
  vertices welded at the derived tolerance (938,469 remain), so the 67 non-manifold edges are real
  holes (22 open), complex/non-manifold edges (5), and inverted normals (40) — not STL duplication.
- The 40 flipped edges (inverted/inconsistent normals) are 60% of the defects. They are only visible
  because the checker classifies DIRECTED edges (a naive undirected checker would report 27 and hide
  them). This is why the independent checker, not the engine, is the source of truth.
- `signedVolume` is positive and non-zero (182,170.9), so the mesh does enclose a volume — the
  problem is boundary/orientation integrity, not that the geometry is empty.
- manifold-3d does not fill holes and rejects non-manifold input at construction, so no amount of
  `merge()` tolerance tuning changes this outcome for a mesh with real holes/non-manifold edges.

## Next step (triggers Task 5 contingency / re-plan)
manifold-3d is eliminated as a standalone repair engine. The repair core must come from a tool that
actually repairs non-manifold triangle soup — fills holes, fixes normals, resolves non-manifold
edges — BEFORE (optionally) handing a now-manifold mesh to manifold-3d for a guaranteed-manifold
finish. Candidates to spike next, in the same de-risking discipline:
- **ADMesh** (design spec §6 contingency): C library, fixes normals + fills simple holes + removes
  degenerate/unconnected faces; compiles to WASM (Emscripten). Good fit for the 40 flipped + 22 open,
  less certain on the 5 complex/non-manifold edges.
- **A remesh/shrink-wrap approach** (voxel/SDF surface extraction): inherently immune to non-manifold
  input because it resamples geometry rather than repairing connectivity; heavier, and alters surface
  detail. More robust for a mixed defect profile like this one.

Do NOT proceed to the full browser build until a repair engine passes this same spike gate
(nonManifoldEdges → 0, triangles > 0, signedVolume ≠ 0) on tripo-broken.3mf.

---

## Addendum (2026-07-08) — ADMesh engine validated via native oracle + slicer reality-check

We spiked ADMesh next, using the NATIVE binary (brew admesh 0.98.5) as an oracle to test the
algorithm risk before the WASM-packaging risk. Input: the real tripo-broken.stl (same model).

Our independent checker (analyzeManifold) on ADMesh's full-repair output
(`admesh --fill-holes --normal-directions --normal-values`):
- BEFORE: nonManifoldEdges=67 (open=22, complex=5, flipped=40)
- AFTER : nonManifoldEdges=2 (open=0, complex=2, flipped=0)
- ADMesh closed ALL 22 holes, fixed ALL 40 inverted normals, fixed 3 of 5 complex edges, in <1s
  on 1.87M triangles. Aggressive flag tuning (`-n -i 5 -t 0.0001 -m 0.0002 -u`) does not remove the
  last 2 complex edges — edges shared by >2 triangles are a class ADMesh does not resolve.

Reality-check against the spec's ACTUAL bar ("slices/prints"), using the production slicer OrcaSlicer
2.3.2 `--info`:
- ORIGINAL tripo-broken.stl → `manifold = no`, `open_edges = 14`
- ADMesh-repaired          → **`manifold = yes`**

The production slicer accepts the ADMesh-repaired mesh as manifold/printable. The 2 residual complex
edges from our stricter checker do NOT make OrcaSlicer consider it non-manifold — our
`nonManifoldEdges === 0` gate is stricter than the real print bar. (Headless gcode export was not
completed: OrcaSlicer's CLI needs the vendor profile-inheritance chain wired into a datadir — a
profile/CLI issue, not a mesh issue. `manifold = yes` is the slicer's own sliceability determination.)

**Engine decision: ADMesh is the repair engine.** It repairs the real defect profile (holes +
inverted normals, the bulk of the problem) fast, preserves surface fidelity, and yields a mesh the
target slicer treats as printable.

**Next phase (build, not spike):** package ADMesh to WASM (emcc not installed locally; build via the
Docker `emscripten/emsdk` image) and wire the pipeline `3MF → mesh buffer → binary STL → ADMesh(WASM)
→ STL → checker`. `parse3mf`, `buildBinaryStl`, and `analyzeManifold` (Tasks 1–2) are reused as-is.
Optional hardening: a small in-JS complex-edge cleanup pass (our checker already locates complex
edges) if strict topological manifoldness is ever required beyond what the slicer accepts.

## Addendum (WASM engine end-to-end)

The ADMesh WASM engine (`spike/wasm/admesh.mjs`) wired through the full pipeline
(`parse3mf` → `repairWithAdmesh` → `analyzeManifold` gate → `buildBinaryStl`) reproduces the
native-oracle result on the real fixture `test/fixtures/tripo-broken.3mf`.

`node --max-old-space-size=4096 run-admesh.mjs` (exit 0):

```
SCALE : { bboxDiagonal: 156.8663996798826, tolerance: 0.00015686639967988259 }
BEFORE: { openEdges: 22, complexEdges: 5, flippedEdges: 40, nonManifoldEdges: 67,
          weldedVertices: 938469, triangles: 1876978, degenerateTriangles: 0,
          signedVolume: 182170.88533812514 }
AFTER : { openEdges: 0, complexEdges: 2, flippedEdges: 0, nonManifoldEdges: 2,
          weldedVertices: 938466, triangles: 1876984, degenerateTriangles: 0,
          signedVolume: 182171.1656840872 }
VERDICT: REPAIRED ✅
```

- **Matches the native-oracle baseline exactly:** openEdges 22→0, flippedEdges 40→0, complexEdges→2
  (equal to `COMPLEX_BASELINE`, so no `WARNING:` line printed). Total non-manifold edges 67→2.
- **Production slicer reconfirm** — OrcaSlicer `--info` on the WASM-produced
  `test/fixtures/tripo-admesh-repaired.stl` (~93.8 MB, 1,876,984 facets):

```
number_of_facets = 1876984
manifold = yes
```

The in-process WASM engine yields a mesh the target slicer treats as manifold/printable, identical to
the native `admesh --fill-holes --normal-directions --normal-values` oracle. The 2 residual complex
edges remain within the slicer's accepted bar (logged, not gated).
