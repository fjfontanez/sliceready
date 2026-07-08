# Mesh Repair — Design Spec

**Date:** 2026-07-07
**Status:** Approved (design), WASM spike FAILED with manifold-3d (rejects non-manifold input; not a repair tool) — repair-engine spike required before build (see spike/FINDINGS.md)
**Working name:** `mesh-repair`

## 1. Purpose

A single-page web tool that automatically repairs STL and 3MF meshes — the kind of
broken geometry that AI model generators (Tripo, Meshy, Rodin, etc.) routinely produce
and that blocks slicing/printing (e.g. non-manifold edges, holes, flipped normals).

The tool is a **free, standalone promotion vehicle for SliceMargin**. It is not monetized
directly; its job is to solve a real, growing pain in one click and convert users toward
SliceMargin via a non-invasive CTA.

## 2. Scope

### In scope — automatic, deterministic repair (no human judgment)
- Non-manifold edges (the primary target, e.g. the "108 non-manifold edges" case)
- Holes / non-watertight surfaces
- Inverted / inconsistent normals
- Degenerate faces
- Floating disconnected islands (auto-remove)

### Explicitly out of scope (anti-scope guardrails)
- **No interactive editing / sculpting.** The tool never lets the user "point and smooth"
  a region. Cosmetic edits (e.g. removing an aesthetically unwanted-but-topologically-valid
  blob) require human judgment and a WebGL sculpt UI — that is a different, months-long
  product competing against free mature tools (Meshmixer, Blender, Nomad). Deliberately excluded.
- No login / accounts.
- No backend / server-side processing.
- No file storage.

## 3. Architecture

Everything runs **client-side in the browser**. The mesh file never leaves the user's
machine — this is a privacy guarantee AND the cost model (hosting stays ~$0 regardless of
traffic; success does not create a compute bill).

### Flow
```
Drop STL/3MF file
  → parse (STL / 3MF container)
  → repair in a Web Worker (WASM)   ← off the main thread, UI never freezes
  → 3D preview (before / after)
  → download repaired file
  → CTA to SliceMargin
```

### Repair engine (WASM)
Candidate libraries (final choice pending the spike in §6):
- **ADMesh** — small C library, STL-focused repair (holes, normals, degenerate faces),
  compiles cleanly to WASM.
- **manifold-3d** — available on npm as a WASM build; guarantees manifold output.
- **lib3mf** — official 3MF consortium library, for parsing/writing the 3MF container
  (the mesh inside is then repaired by the engine above).

### Viewer
- **three.js** for the before/after 3D preview.

### Performance & compatibility
- Repair executes inside a **Web Worker** so the main thread (UI) never blocks, even for
  multi-million-triangle meshes. A live progress bar is shown while the worker processes.
- A **soft size cap** (target ~150 MB / configurable triangle count) with a friendly
  warning ("your model is large, this may take a moment") rather than a hard rejection.
- This combination serves both old/low-power browsers and very large AI meshes without
  sacrificing either.

### UI messaging
- The page states clearly that repair runs **locally** and the model is **never uploaded**.
- SliceMargin banner/CTA is visible but non-invasive. The product is the generosity;
  SliceMargin is the upsell.

## 4. Components (isolated units)

- **File intake** — drag/drop + file picker; detects STL (ASCII/binary) vs 3MF.
- **Parser** — STL parser and 3MF (zip/XML container) reader → normalized mesh buffer.
- **Repair worker** — Web Worker wrapping the WASM engine; receives mesh, returns repaired
  mesh + a report (what was fixed, counts).
- **Viewer** — three.js before/after preview with a simple toggle.
- **Exporter** — writes repaired mesh back to STL / 3MF for download.
- **Promo shell** — layout, copy, privacy messaging, SliceMargin CTA.

Each unit communicates through a plain mesh-buffer interface and can be tested in isolation.

## 5. Error handling

- Unsupported / corrupt file → clear message, no crash.
- File over soft cap → warning + option to proceed at the user's risk.
- Repair fails or cannot fully fix → surface what was and wasn't fixed; never silently
  hand back a still-broken file claiming success.
- WASM load failure → graceful fallback message.

## 6. Primary risk & de-risking

**The one real risk:** that a *clean* WASM repair path exists for our targets. ADMesh and
manifold are strong candidates, but this must be proven before committing to the full build.

**De-risking spike (1 day, do first):** compile/wire the WASM pipeline and run it against the
real Tripo file with 108 non-manifold edges. Success criterion: output is watertight/manifold
and slices/prints. If it passes, the rest is UI. If not, we learn it before investing weeks.

## 7. Success criteria

- A user drops the broken Tripo STL/3MF and downloads a manifold, printable file, in the
  browser, with no upload.
- Works on a modest laptop and does not freeze on large meshes.
- Clear path/CTA from the tool to SliceMargin.
