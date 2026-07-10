# Mesh Repair — WASM De-Risking Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove — or disprove — that a clean WASM repair path turns the real broken Tripo mesh (with ~108 non-manifold edges) into a watertight, manifold mesh, before investing weeks in the full browser tool.

**Architecture:** A minimal Node.js CLI harness (NOT the browser tool — the browser/Web Worker wiring is deferred UI work). It parses the real 3MF container (a shared, indexed mesh) directly into a mesh buffer, feeds it to the `manifold-3d` WASM engine (welding + manifold reconstruction), exports the repaired result as binary STL, and — critically — measures manifold-ness with an **independent edge-integrity checker** that does not trust the engine's self-report. The spike answers one yes/no question with a number attached.

**Tech Stack:** Node.js 18+ (ESM), `manifold-3d` (npm WASM build, zero compilation), `fflate` (tiny pure-JS zip lib, for unzipping the 3MF container), Node's built-in `node:test` runner and `node:assert` (no test-framework dependency), Node's `DataView`/typed arrays for STL binary I/O.

## Global Constraints

- **Node.js 18+, ESM only** — all files use `.mjs`, `import`/`export`, top-level `await` where needed.
- **Engine ordering is fixed:** try `manifold-3d` FIRST (no compilation, npm-ready). ADMesh (Emscripten build) is a contingency only if `manifold-3d` fails — see Task 5. Do NOT start an ADMesh build unless Task 4 records a failure.
- **The gate is the independent checker, never the library's self-report.** Success = our own `openEdges + complexEdges + flippedEdges === 0` (i.e. `nonManifoldEdges === 0`) on the exported file, AND the exported file is non-empty/non-degenerate (see Task 3's watertight gate). `manifold.status()`/`genus()`/`volume()` are logged as corroborating info only.
- **Primary intake is 3MF** (the indexed mesh is parsed directly from the container). STL *intake* and 3MF *export* are deferred to the build phase — both are real product intake paths (3MF primary, especially Bambu; STL secondary), but neither is the risk being de-risked here. The de-risked risk is the repair core, not the container format. The spike's *output* is always binary STL via `buildBinaryStl`.
- **This spike is intentionally Node, not browser.** That deviation from the design spec's client-side architecture is deliberate and scoped to de-risking; do not add browser/Worker/three.js code here.
- **A real input fixture is required.** `spike/test/fixtures/tripo-broken.3mf` must be the actual broken Tripo file. If it is absent, the spike CANNOT report a valid verdict — stop and request it (see Prerequisites).
- **All command blocks are cwd-independent.** Every `Run:`/commit block below resolves the repo root with `git rev-parse --show-toplevel` and `cd`s explicitly before running anything — do not assume the shell is already inside `spike/` from a previous step.

## Prerequisites

Before Task 3 can produce a real verdict, the actual broken Tripo mesh must be present at:

```
spike/test/fixtures/tripo-broken.3mf
```

This file is **already present** (a ~32MB 3MF/zip whose `3D/3dmodel.model` part decompresses to ~155MB of XML). Tasks 1–2 build and self-test entirely on synthetic fixtures generated in-test, so they can proceed regardless. Task 3's *unit test* also runs on a synthetic mesh; only Task 3's *real run step* and Task 4's verdict consume `tripo-broken.3mf`. Without the real fixture the spike cannot produce a valid verdict — stop and request it.

The decompressed XML is large (~155MB as a single string). The parser therefore must handle it **without a DOM parser** — a single-pass, full in-memory regex scan (no DOM tree), never `DOMParser`/XML tree construction. Only the `3D/3dmodel.model` part is decompressed (via fflate's `unzipSync` filter option) — other archive entries are never inflated, which further reduces peak memory. The parser's intermediate JS number arrays (`vertCoords`/`triIndices`, built via `push`) roughly double peak memory versus the final typed arrays they get converted into. If Node runs out of memory on this input, re-run with `node --max-old-space-size=4096 run.mjs` (or higher).

---

### Task 1: Spike scaffold + 3MF mesh parser + binary STL serializer

**Files:**
- Create: `spike/package.json`
- Create: `spike/src/mesh3mf.mjs` (3MF intake parser)
- Create: `spike/src/stl.mjs` (binary STL serializer — the spike's export format)
- Test: `spike/test/mesh3mf.test.mjs`

**Interfaces:**
- Produces:
  - `parse3mf(zipBytes: Uint8Array): { vertProperties: Float32Array, triVerts: Uint32Array }` — unzips the 3MF container with `fflate` (only the `3D/3dmodel.model` entry is decompressed, via `unzipSync`'s `filter` option), locates that part, and extracts the mesh's **shared, indexed** geometry directly: every `<vertex x y z/>` becomes three entries in `vertProperties` (length `3 * vertexCount`, indexed — NOT expanded per-triangle), and every `<triangle v1 v2 v3/>` contributes its three actual indices to `triVerts` (length `3 * triangleCount`). Throws a clear error if the model part or its `<mesh>`/`<vertices>`/`<triangles>` are missing. Because 3MF already stores connectivity as shared indices, the mesh's non-manifold defects are GENUINE topology, not unwelded-vertex artifacts. **This spike assumes a single-object, single-`<mesh>` 3MF**: if more than one `<mesh>` (or `<object type="model">`) is found, `parse3mf` throws rather than silently concatenating multiple meshes' vertices without offsetting their triangle indices — a genuine multi-mesh corruption risk this spike does not attempt to solve. It also assumes `<build><item>` entries carry no `transform` attribute (identity placement only) — any item transform throws, since the spike does not apply affine transforms to geometry (a reflection would otherwise silently flip `signedVolume`). Triangle indices are bounds-checked against the parsed vertex count; an out-of-range index throws instead of propagating `undefined`/`NaN` into `buildBinaryStl`/`analyzeManifold`.
  - `buildBinaryStl({ vertProperties, triVerts }): Uint8Array` — serializes a mesh buffer to binary STL (normals written as zero; slicers recompute them). Lives in `spike/src/stl.mjs`. UNCHANGED behavior from the original plan; STL is the spike's export path (3MF export is deferred to the build phase).

- [ ] **Step 1: Initialize the spike package**

Run:
```bash
mkdir -p "$(git rev-parse --show-toplevel)/spike" && cd "$(git rev-parse --show-toplevel)/spike"
npm init -y
npm pkg set type=module
npm install manifold-3d fflate
echo "node_modules/" > .gitignore
```
Expected: `node_modules/manifold-3d` and `node_modules/fflate` present, `package.json` has `"type": "module"`, `.gitignore` present.

- [ ] **Step 2: Write the failing test**

Create `spike/test/mesh3mf.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { parse3mf } from '../src/mesh3mf.mjs';
import { buildBinaryStl } from '../src/stl.mjs';

// A closed tetrahedron authored as a SHARED, INDEXED mesh — exactly how 3MF
// stores geometry: 4 vertices, 4 triangles referencing them by index.
const TETRA_VERTICES = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1],
];
const TETRA_TRIANGLES = [
  [0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3],
];

// A second tetra's vertex/triangle set with a realistic negative
// high-precision decimal coordinate on vertex 0 — proves parseFloat-based
// extraction round-trips real-world 3MF coordinates, not just 0/1 integers.
const PRECISE_VERTICES = [
  [-26.025390, 0.000146, 17.584228], [1, 0, 0], [0, 1, 0], [0, 0, 1],
];

function verticesXml(vertices) {
  return vertices.map(([x, y, z]) => `<vertex y="${y}" x="${x}" z="${z}" />`).join('');
}

function trianglesXml(triangles) {
  return triangles.map(([v1, v2, v3]) => `<triangle v2="${v2}" v1="${v1}" v3="${v3}" />`).join('');
}

// Build a minimal-but-valid <object>/<mesh> block with attributes in mixed
// order to prove the parser extracts by attribute NAME, not position.
function objectXml(id, vertices, triangles) {
  return `<object id="${id}" type="model">
      <mesh>
        <vertices>${verticesXml(vertices)}</vertices>
        <triangles>${trianglesXml(triangles)}</triangles>
      </mesh>
    </object>`;
}

function tetraModelXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    ${objectXml(1, TETRA_VERTICES, TETRA_TRIANGLES)}
  </resources>
  <build><item objectid="1" /></build>
</model>`;
}

// Same shape as tetraModelXml but with TWO <object>/<mesh> blocks — a
// multi-object/multi-mesh 3MF, which this spike must reject rather than
// silently concatenate (concatenating would corrupt triangle indices across
// meshes since they'd share one vertProperties array without an offset).
function multiMeshModelXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    ${objectXml(1, TETRA_VERTICES, TETRA_TRIANGLES)}
    ${objectXml(2, TETRA_VERTICES, TETRA_TRIANGLES)}
  </resources>
  <build><item objectid="1" /><item objectid="2" /></build>
</model>`;
}

// Same shape as tetraModelXml but the <build><item> carries a `transform`
// attribute — this spike does not apply affine transforms to geometry, so
// parse3mf must reject it rather than silently returning the wrong absolute
// geometry.
function transformedItemModelXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    ${objectXml(1, TETRA_VERTICES, TETRA_TRIANGLES)}
  </resources>
  <build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0" /></build>
</model>`;
}

// One triangle references vertex index -1, which is out of range. parse3mf must
// throw rather than let Uint32Array.from wrap it to 4294967295 and emit NaN bytes
// downstream.
function negativeTriangleIndexModelXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    ${objectXml(1, TETRA_VERTICES, [[-1, 0, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]])}
  </resources>
  <build><item objectid="1" /></build>
</model>`;
}

function preciseVertexModelXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    ${objectXml(1, PRECISE_VERTICES, TETRA_TRIANGLES)}
  </resources>
  <build><item objectid="1" /></build>
</model>`;
}

// Assemble a real 3MF (zip) in-test with the parts the parser needs.
function makeThreeMf(modelXml) {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;
  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(modelXml),
  });
}

function makeTetra3mf() {
  return makeThreeMf(tetraModelXml());
}

test('parse3mf extracts indexed vertices and triangles from the model part', () => {
  const { vertProperties, triVerts } = parse3mf(makeTetra3mf());
  // Indexed — 4 shared vertices (12 floats), NOT expanded per-triangle (which
  // would be 36). 4 triangles → 12 indices.
  assert.equal(vertProperties.length, 12);
  assert.equal(triVerts.length, 12);
  // Triangle indices match the authored connectivity exactly.
  assert.deepEqual([...triVerts], [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);
  // Vertex 1 is (1,0,0): its x lives at index 3, extracted by name despite
  // the y="" attribute appearing before x="" in the XML.
  assert.equal(vertProperties[3], 1);
  assert.equal(vertProperties[4], 0);
  assert.equal(vertProperties[5], 0);
});

test('parse3mf throws when the model part is missing', () => {
  const noModel = zipSync({ '[Content_Types].xml': strToU8('<Types />') });
  assert.throws(() => parse3mf(noModel), /3dmodel\.model/);
});

test('parse3mf throws on a multi-object/multi-mesh 3MF (unsupported by this spike)', () => {
  const multiMesh = makeThreeMf(multiMeshModelXml());
  assert.throws(() => parse3mf(multiMesh), /multi-object|multi-mesh/);
});

test('parse3mf throws on a <build><item> carrying a transform attribute', () => {
  const transformed = makeThreeMf(transformedItemModelXml());
  assert.throws(() => parse3mf(transformed), /transform/);
});

test('parse3mf throws on a negative triangle index', () => {
  const negIdx = makeThreeMf(negativeTriangleIndexModelXml());
  assert.throws(() => parse3mf(negIdx), /negative triangle index/);
});

test('parse3mf round-trips a realistic negative high-precision decimal coordinate', () => {
  const { vertProperties } = parse3mf(makeThreeMf(preciseVertexModelXml()));
  const EPS = 1e-4; // float32 precision tolerance, well above real rounding error
  assert.ok(
    Math.abs(vertProperties[0] - -26.02539) < EPS,
    `expected x≈-26.025390, got ${vertProperties[0]}`,
  );
  assert.ok(
    Math.abs(vertProperties[1] - 0.000146) < EPS,
    `expected y≈0.000146, got ${vertProperties[1]}`,
  );
  assert.ok(
    Math.abs(vertProperties[2] - 17.584228) < EPS,
    `expected z≈17.584228, got ${vertProperties[2]}`,
  );
});

test('buildBinaryStl serializes an indexed mesh to the expected byte length', () => {
  // Author an indexed mesh directly (same shape parse3mf produces) and confirm
  // the STL export path is exactly 84 + 50 * triCount bytes.
  const mesh = {
    vertProperties: Float32Array.from(TETRA_VERTICES.flat()),
    triVerts: Uint32Array.from(TETRA_TRIANGLES.flat()),
  };
  const stl = buildBinaryStl(mesh);
  const triCount = mesh.triVerts.length / 3;
  assert.equal(stl.length, 84 + 50 * triCount);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)/spike" && node --test test/mesh3mf.test.mjs`
Expected: FAIL — `Cannot find module '../src/mesh3mf.mjs'`.

- [ ] **Step 4: Implement the 3MF parser and the STL serializer**

Create `spike/src/mesh3mf.mjs`:
```javascript
import { unzipSync, strFromU8 } from 'fflate';

// 3MF is a zip (OPC package). Geometry lives in the `3D/3dmodel.model` part as
// XML: <object type="model"><mesh><vertices><vertex x= y= z=/>...</vertices>
// <triangles><triangle v1= v2= v3=/>...</triangles></mesh></object>. Unlike
// binary STL (which stores unshared per-triangle vertices), 3MF stores a
// SHARED, INDEXED mesh — so we keep the indices as authored and any
// non-manifold defect is genuine topology, not an unwelded-vertex artifact.
//
// Memory note: this loads the decompressed model part (~155MB for the real
// Tripo fixture) as one string and performs a single-pass, full in-memory
// regex scan — no DOM tree is built. The intermediate JS number arrays
// (vertCoords/triIndices, built via push) roughly double peak memory versus
// the final typed arrays they get converted into. Acceptable for the spike
// (and consistent with the spec's soft size-cap idea); if Node runs short on
// heap, re-run with `node --max-old-space-size=4096`. Only the
// 3D/3dmodel.model part is decompressed (via fflate's unzipSync `filter`
// option below) — other archive entries are never inflated, further reducing
// peak memory.
//
// Spike-scope limitations (fail loud rather than silently produce wrong
// geometry): a 3MF with more than one <mesh> (multi-object) is rejected —
// concatenating multiple meshes' vertices without offsetting their triangle
// indices would silently corrupt connectivity. A <build><item> carrying a
// `transform` attribute is also rejected — this spike does not apply affine
// transforms, so a transformed item would silently return the wrong absolute
// geometry (and a reflection would flip signedVolume).

// Precompiled once at module scope rather than re-constructed on every
// attribute read (this loop runs millions of times on the real fixture).
// Non-global regexes have no `lastIndex` state, so reusing them across calls
// on different input strings is safe.
const X_ATTR_RE = /\bx\s*=\s*["']([^"']*)["']/;
const Y_ATTR_RE = /\by\s*=\s*["']([^"']*)["']/;
const Z_ATTR_RE = /\bz\s*=\s*["']([^"']*)["']/;
const V1_ATTR_RE = /\bv1\s*=\s*["']([^"']*)["']/;
const V2_ATTR_RE = /\bv2\s*=\s*["']([^"']*)["']/;
const V3_ATTR_RE = /\bv3\s*=\s*["']([^"']*)["']/;

export function parse3mf(zipBytes) {
  // Only decompress the model part — other zip entries (thumbnails, other OPC
  // parts, etc.) are never inflated, which also caps peak memory.
  const entries = unzipSync(zipBytes, {
    filter: (f) => f.name.toLowerCase().replace(/^\/+/, '') === '3d/3dmodel.model',
  });
  // Match the model part case-insensitively; OPC part names are conventionally
  // `3D/3dmodel.model` but casing can vary between producers. This looks the
  // part up by its conventional path rather than resolving `_rels/.rels` to
  // find it — a deliberate spike simplification that matches the fixture.
  const modelKey = Object.keys(entries).find(
    (name) => name.toLowerCase().replace(/^\/+/, '') === '3d/3dmodel.model',
  );
  if (!modelKey) {
    throw new Error('3MF is missing its 3D/3dmodel.model part');
  }
  const xml = strFromU8(entries[modelKey]);

  // Spike-scope guard: reject multi-object/multi-mesh 3MF outright rather
  // than silently concatenating multiple meshes' vertices without offsetting
  // their triangle indices (which would corrupt connectivity across meshes).
  // Counted from `<mesh\b` occurrences only — the true proxy for "how many
  // meshes" — NOT from `<object type="model">` occurrences: a single-mesh
  // file can legitimately use a <components> assembly (an outer object with
  // no <mesh> referencing an inner object that owns the one real <mesh>),
  // which would otherwise false-positive as multi-object.
  const meshMatches = xml.match(/<mesh\b/g) || [];
  const meshCount = meshMatches.length;
  if (meshCount > 1) {
    throw new Error(
      `parse3mf: multi-object/multi-mesh 3MF not supported by this spike (found ${meshCount} meshes) — export a single-object model`,
    );
  }

  // Spike-scope guard: reject any <build><item> carrying a transform
  // attribute (any value) — this spike does not apply affine transforms to
  // geometry, so a transformed item would silently return the wrong absolute
  // geometry (and a reflection would silently flip signedVolume). Items with
  // no transform attribute (identity placement) are unaffected.
  const buildMatch = xml.match(/<build\b[^>]*>([\s\S]*?)<\/build>/);
  if (buildMatch) {
    const itemRe = /<item\b[^>]*>/g;
    let im;
    while ((im = itemRe.exec(buildMatch[1])) !== null) {
      if (/\btransform\s*=/.test(im[0])) {
        throw new Error(
          'parse3mf: <build> item transforms not supported by this spike — export the model pre-baked at identity',
        );
      }
    }
  }

  // Derived from the SAME word-boundary pattern as the meshCount regex above
  // (not a bare `indexOf('<mesh')`) so the two agree — a `<meshgroup>`-style
  // element preceding the real <mesh> would otherwise make the slice start
  // at the wrong tag and silently absorb spurious geometry.
  const meshStartMatch = /<mesh\b/.exec(xml);
  const meshStart = meshStartMatch ? meshStartMatch.index : -1;
  if (meshStart === -1) {
    throw new Error('3MF model part has no <mesh> element');
  }
  const meshCloseTag = '</mesh>';
  const meshEnd = xml.indexOf(meshCloseTag, meshStart);
  if (meshEnd === -1) {
    throw new Error('3MF model part has no <mesh> element');
  }
  // Scope the vertex/triangle scans to this single <mesh>...</mesh> span, not
  // the whole model part — belt-and-suspenders with the multi-mesh guard
  // above, and keeps the regex scans tight to the geometry they own.
  const meshXml = xml.slice(meshStart, meshEnd + meshCloseTag.length);

  // Extract by attribute NAME (x/y/z and v1/v2/v3 may appear in any order),
  // never by position. A single-pass, full in-memory regex scan over the mesh
  // span keeps memory to one pass rather than building a DOM tree.
  const vertCoords = [];
  const vertexRe = /<vertex\b([^>]*)>/g;
  let vm;
  let sawVertices = false;
  while ((vm = vertexRe.exec(meshXml)) !== null) {
    sawVertices = true;
    const attrs = vm[1];
    const x = X_ATTR_RE.exec(attrs);
    const y = Y_ATTR_RE.exec(attrs);
    const z = Z_ATTR_RE.exec(attrs);
    if (!x || !y || !z) {
      throw new Error('3MF <vertex> is missing an x/y/z attribute');
    }
    vertCoords.push(parseFloat(x[1]), parseFloat(y[1]), parseFloat(z[1]));
  }
  if (!sawVertices) {
    throw new Error('3MF mesh has no <vertex> elements');
  }
  const vertexCount = vertCoords.length / 3;

  const triIndices = [];
  const triangleRe = /<triangle\b([^>]*)>/g;
  let tm;
  let maxIndex = -1;
  while ((tm = triangleRe.exec(meshXml)) !== null) {
    const attrs = tm[1];
    const v1 = V1_ATTR_RE.exec(attrs);
    const v2 = V2_ATTR_RE.exec(attrs);
    const v3 = V3_ATTR_RE.exec(attrs);
    if (!v1 || !v2 || !v3) {
      throw new Error('3MF <triangle> is missing a v1/v2/v3 attribute');
    }
    const i1 = parseInt(v1[1], 10);
    const i2 = parseInt(v2[1], 10);
    const i3 = parseInt(v3[1], 10);
    // Reject negative indices inline, during the loop, rather than only
    // tracking a max: a negative index (e.g. v1="-1") would never exceed
    // maxIndex, so the upper-bound check alone lets it through — and
    // Uint32Array.from later wraps -1 to 4294967295, silently propagating
    // NaN downstream instead of throwing here.
    if (i1 < 0 || i2 < 0 || i3 < 0) {
      throw new Error(`parse3mf: negative triangle index (v1=${i1}, v2=${i2}, v3=${i3})`);
    }
    if (i1 > maxIndex) maxIndex = i1;
    if (i2 > maxIndex) maxIndex = i2;
    if (i3 > maxIndex) maxIndex = i3;
    triIndices.push(i1, i2, i3);
  }
  if (triIndices.length === 0) {
    throw new Error('3MF mesh has no <triangle> elements');
  }
  // Bounds-check triangle indices against the parsed vertex count so an
  // out-of-range index throws here rather than propagating undefined/NaN
  // into buildBinaryStl/analyzeManifold. Tracking the max index during the
  // loop above and comparing once here (instead of checking every index
  // individually) keeps this O(n) with a single comparison at the end.
  // Negative indices are already rejected above, so this check only needs to
  // cover the upper bound.
  if (maxIndex >= vertexCount) {
    throw new Error(`parse3mf: triangle index ${maxIndex} out of range (vertexCount=${vertexCount})`);
  }

  return {
    vertProperties: Float32Array.from(vertCoords),
    triVerts: Uint32Array.from(triIndices),
  };
}
```

Create `spike/src/stl.mjs`:
```javascript
// Binary STL export: 80-byte header, uint32 triangle count, then 50 bytes/
// triangle (12-byte zero normal + 3 * 12-byte vertices + 2-byte attribute).
// The spike parses 3MF for intake but exports repaired meshes as binary STL —
// STL remains the export format; 3MF export is a deferred build-phase item.
// This consumes the shared/indexed mesh buffer as-is: each triVerts entry
// indexes into vertProperties, so a shared vertex is written once per corner
// that references it (STL has no shared-vertex concept).
export function buildBinaryStl({ vertProperties, triVerts }) {
  const triCount = triVerts.length / 3;
  const out = new Uint8Array(84 + triCount * 50);
  const dv = new DataView(out.buffer);
  dv.setUint32(80, triCount, true);
  let o = 84;
  for (let t = 0; t < triCount; t++) {
    o += 12; // normal left as zero; slicers recompute
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

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd "$(git rev-parse --show-toplevel)/spike" && node --test test/mesh3mf.test.mjs`
Expected: PASS — 7 tests.

- [ ] **Step 6: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add spike/package.json spike/package-lock.json spike/.gitignore spike/src/mesh3mf.mjs spike/src/stl.mjs spike/test/mesh3mf.test.mjs && git commit -m "feat(spike): 3MF indexed-mesh parser and binary STL serializer"
```

---

### Task 2: Independent edge-integrity checker

This is the spike's source of truth. It welds vertices by position tolerance (STL vertices are not shared), then counts edges by incidence. It never calls the WASM engine.

**Files:**
- Create: `spike/src/check.mjs`
- Test: `spike/test/check.test.mjs`

**Interfaces:**
- Consumes: mesh buffers of the shape `{ vertProperties: Float32Array, triVerts: Uint32Array }` (from Task 1).
- Produces:
  - `analyzeManifold(mesh, { tolerance = 1e-4 } = {}): { openEdges, complexEdges, flippedEdges, nonManifoldEdges, weldedVertices, triangles, degenerateTriangles, signedVolume }` where `openEdges` = undirected edges used by exactly 1 triangle (holes/boundaries), `complexEdges` = undirected edges used by > 2 triangles, `flippedEdges` = undirected edges used by exactly 2 triangles that both traverse it in the SAME direction (inverted/inconsistent normals — a healthy 2-manifold edge is traversed once in each direction by its two adjacent triangles), `nonManifoldEdges = openEdges + complexEdges + flippedEdges`, `degenerateTriangles` = triangles with two or more identical welded corner ids (zero-area; excluded entirely from directed-edge accounting so a collapsed corner cannot corrupt a real edge's incidence count; logged, not gated on), `signedVolume` = independent enclosed-volume estimate computed via the divergence theorem (`(1/6) * Σ dot(p0, cross(p1, p2))` over each triangle's welded corner positions) — this is the value `run.mjs` gates on, never the engine's self-reported `manifold.volume()`.

- [ ] **Step 1: Write the failing test**

Create `spike/test/check.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeManifold } from '../src/check.mjs';

// A closed tetrahedron: 4 vertices, 4 triangles, every edge shared by exactly 2.
const TETRA = {
  v: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
  f: [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]],
};

// Expand an indexed mesh into STL-style unshared per-corner vertices.
function toBuffer({ v, f }) {
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

test('closed tetrahedron has zero non-manifold edges after welding', () => {
  const r = analyzeManifold(toBuffer(TETRA));
  assert.equal(r.weldedVertices, 4);
  assert.equal(r.openEdges, 0);
  assert.equal(r.complexEdges, 0);
  assert.equal(r.flippedEdges, 0);
  assert.equal(r.nonManifoldEdges, 0);
  assert.ok(Math.abs(r.signedVolume - 1 / 6) < 1e-6, `expected enclosed volume ~1/6, got ${r.signedVolume}`);
});

test('tetrahedron missing a face exposes 3 open edges', () => {
  const holed = { v: TETRA.v, f: TETRA.f.slice(0, 3) };
  const r = analyzeManifold(toBuffer(holed));
  assert.equal(r.openEdges, 3);
  assert.equal(r.complexEdges, 0);
  assert.equal(r.flippedEdges, 0);
  assert.equal(r.nonManifoldEdges, 3);
  assert.equal(r.signedVolume, 0, 'an open mesh whose remaining faces all touch the origin vertex encloses no volume');
});

test('a deliberately flipped face introduces flipped edges (orientation defect)', () => {
  // Same tetrahedron, but the first face's winding is reversed relative to its
  // neighbors — the geometry is unchanged, only the normal direction is wrong.
  const flippedFace = { v: TETRA.v, f: [[0, 1, 2], TETRA.f[1], TETRA.f[2], TETRA.f[3]] };
  const r = analyzeManifold(toBuffer(flippedFace));
  assert.equal(r.flippedEdges, 3);
  assert.equal(r.openEdges, 0);
  assert.equal(r.complexEdges, 0);
  assert.equal(r.nonManifoldEdges, 3);
});

test('a degenerate triangle does not corrupt an otherwise-open edge\'s incidence count', () => {
  // Same holed tetrahedron as above (3 real open edges from the missing
  // face), plus one extra degenerate triangle that reuses vertex 1 twice
  // (corners v1, v1, v2 — two identical positions collapse to the same
  // welded id) and shares its one surviving edge {1,2} with a real open
  // edge. Before the fix, this collapsed triangle still bumped
  // directed-edge counts for {1,2}, corrupting it from open (incidence 1)
  // to complex (incidence 3) and masking the real defect.
  const holed = { v: TETRA.v, f: TETRA.f.slice(0, 3) };
  const withDegenerate = { v: holed.v, f: [...holed.f, [1, 1, 2]] };
  const r = analyzeManifold(toBuffer(withDegenerate));
  assert.equal(r.degenerateTriangles, 1);
  assert.equal(r.openEdges, 3);
  assert.equal(r.complexEdges, 0);
  assert.equal(r.flippedEdges, 0);
  assert.equal(r.nonManifoldEdges, 3);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)/spike" && node --test test/check.test.mjs`
Expected: FAIL — `Cannot find module '../src/check.mjs'`.

- [ ] **Step 3: Implement the checker**

Create `spike/src/check.mjs`:
```javascript
// Independent manifold verifier. Welds coincident vertices using a
// tolerance-sized spatial hash grid, then classifies DIRECTED edges by how
// many triangles use them and in which direction: undirected incidence 1 =
// open (hole/boundary), undirected incidence 2 with opposite directions =
// healthy manifold edge, undirected incidence 2 with the SAME direction twice
// = flipped (inverted/inconsistent winding), undirected incidence >2 = complex.
export function analyzeManifold(mesh, { tolerance = 1e-4 } = {}) {
  const { vertProperties, triVerts } = mesh;
  const vertexCount = vertProperties.length / 3;
  const canonical = new Uint32Array(vertexCount);

  // Weld by spatial hashing on a tolerance-sized grid, but — critically — also
  // check the 26 neighboring cells (not just the vertex's own cell) for an
  // existing representative within `tolerance`. Checking only the exact cell
  // misses coincident vertices that straddle a cell boundary.
  const grid = new Map(); // cellKey -> [{ id, x, y, z }]
  const cellOf = (v) => Math.floor(v / tolerance);
  const cellKey = (cx, cy, cz) => `${cx},${cy},${cz}`;
  const repPosition = []; // canonical id -> { x, y, z } of its welded representative

  let nextId = 0;
  for (let i = 0; i < vertexCount; i++) {
    const x = vertProperties[i * 3];
    const y = vertProperties[i * 3 + 1];
    const z = vertProperties[i * 3 + 2];
    const cx = cellOf(x), cy = cellOf(y), cz = cellOf(z);

    let foundId = -1;
    for (let dx = -1; dx <= 1 && foundId === -1; dx++) {
      for (let dy = -1; dy <= 1 && foundId === -1; dy++) {
        for (let dz = -1; dz <= 1 && foundId === -1; dz++) {
          const bucket = grid.get(cellKey(cx + dx, cy + dy, cz + dz));
          if (!bucket) continue;
          for (const rep of bucket) {
            if (Math.hypot(x - rep.x, y - rep.y, z - rep.z) <= tolerance) { foundId = rep.id; break; }
          }
        }
      }
    }

    if (foundId === -1) {
      foundId = nextId++;
      const key = cellKey(cx, cy, cz);
      let bucket = grid.get(key);
      if (!bucket) { bucket = []; grid.set(key, bucket); }
      bucket.push({ id: foundId, x, y, z });
      repPosition.push({ x, y, z }); // canonical id -> its first-seen (welded) position
    }
    canonical[i] = foundId;
  }

  // Classify DIRECTED edges: a properly wound 2-manifold edge is used exactly
  // once in each direction by its two adjacent triangles. `forward`/`backward`
  // track, per undirected edge, how many triangles traversed it in each
  // direction — this is what lets us detect flipped/inconsistent normals,
  // which raw undirected incidence counting cannot see. Degenerate triangles
  // are filtered out entirely before this is ever called (see the triangle
  // loop below), so `a`/`b` here are always guaranteed distinct.
  const forward = new Map();
  const backward = new Map();
  const bumpDirected = (a, b) => {
    if (a < b) forward.set(`${a}_${b}`, (forward.get(`${a}_${b}`) || 0) + 1);
    else backward.set(`${b}_${a}`, (backward.get(`${b}_${a}`) || 0) + 1);
  };

  const triangles = triVerts.length / 3;
  let degenerateTriangles = 0;
  // Independent enclosed-volume estimate via the divergence theorem: summing
  // (1/6) * dot(p0, cross(p1, p2)) over every triangle's welded corner
  // positions gives the signed volume of the mesh regardless of the engine's
  // own self-reported volume. A degenerate (collapsed-corner) triangle has
  // zero area and contributes exactly 0 to this sum (dot(v, cross(v, w)) === 0),
  // so it is safe to include here
  // even though it is excluded from directed-edge accounting below.
  let signedVolume = 0;
  for (let t = 0; t < triangles; t++) {
    const a = canonical[triVerts[t * 3]];
    const b = canonical[triVerts[t * 3 + 1]];
    const c = canonical[triVerts[t * 3 + 2]];

    const p0 = repPosition[a];
    const p1 = repPosition[b];
    const p2 = repPosition[c];
    signedVolume += (
      p0.x * (p1.y * p2.z - p1.z * p2.y)
      - p0.y * (p1.x * p2.z - p1.z * p2.x)
      + p0.z * (p1.x * p2.y - p1.y * p2.x)
    ) / 6;

    if (a === b || b === c || c === a) {
      // Zero-area (collapsed-corner) triangle: it contributes no valid face
      // incidence to any edge, so all three of its directed edges are
      // skipped entirely rather than corrupting the incidence count of a
      // real edge it happens to share a pair of ids with.
      degenerateTriangles++;
      continue;
    }
    bumpDirected(a, b); bumpDirected(b, c); bumpDirected(c, a);
  }

  let openEdges = 0;
  let complexEdges = 0;
  let flippedEdges = 0;
  const keys = new Set([...forward.keys(), ...backward.keys()]);
  for (const key of keys) {
    const f = forward.get(key) || 0;
    const b = backward.get(key) || 0;
    const total = f + b;
    if (total === 1) openEdges++;
    else if (total > 2) complexEdges++;
    else if (total === 2 && (f === 2 || b === 2)) flippedEdges++; // both uses same direction = orientation defect
  }

  return {
    openEdges,
    complexEdges,
    flippedEdges,
    nonManifoldEdges: openEdges + complexEdges + flippedEdges,
    weldedVertices: nextId,
    triangles,
    degenerateTriangles,
    signedVolume,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd "$(git rev-parse --show-toplevel)/spike" && node --test test/check.test.mjs`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add spike/src/check.mjs spike/test/check.test.mjs && git commit -m "feat(spike): independent manifold edge-integrity checker"
```

---

### Task 3: manifold-3d repair pipeline + real run

**Files:**
- Create: `spike/src/repair.mjs`
- Create: `spike/run.mjs`
- Test: `spike/test/repair.test.mjs`

**Interfaces:**
- Consumes: mesh buffers (Task 1), `analyzeManifold` (Task 2).
- Produces:
  - `repairWithManifold(mesh): Promise<{ mesh: { vertProperties: Float32Array, triVerts: Uint32Array }, status: string, genus: number, volume: number, merged: unknown }>` — welds via `Mesh.merge()` (its return value is captured as `merged`), constructs a `Manifold`, returns the reconstructed mesh plus the engine's self-reported diagnostics. Throws the exported `ManifoldEngineError` if the WASM engine itself fails/aborts during mesh construction (`new Mesh(...)`), vertex welding (`mesh.merge()`), `new Manifold(mesh)`, or `manifold.getMesh()` — callers must catch this and treat it as a distinct CRASHED outcome, not a JS-level bug.

- [ ] **Step 1: Write the failing test**

Create `spike/test/repair.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairWithManifold } from '../src/repair.mjs';
import { analyzeManifold } from '../src/check.mjs';

// Closed tetrahedron with STL-style unshared vertices; already watertight after weld.
const TETRA = {
  v: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
  f: [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]],
};
function toBuffer({ v, f }) {
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

test('repairWithManifold produces a watertight mesh from unshared STL vertices', async () => {
  const { mesh, status } = await repairWithManifold(toBuffer(TETRA));
  assert.equal(status, 'NoError');
  const r = analyzeManifold(mesh);
  // Decision keys off the independent checker's signedVolume, never the engine's
  // self-reported volume() — same posture as run.mjs's watertight gate.
  assert.ok(r.signedVolume > 0, 'expected positive independently-computed volume');
  assert.equal(r.flippedEdges, 0);
  assert.equal(r.nonManifoldEdges, 0);
});

test('repairWithManifold does not throw on an input with real holes (baseline)', async () => {
  // Same holed fixture as Task 2's "3 open edges" test. Whether manifold-3d
  // actually closes the hole is the open question this spike answers — we
  // only hard-assert that the engine returns a usable mesh without throwing;
  // whether the hole closed is recorded as an observation, not asserted.
  const holed = { v: TETRA.v, f: TETRA.f.slice(0, 3) };
  const { mesh } = await repairWithManifold(toBuffer(holed));
  assert.ok(mesh.vertProperties.length > 0, 'expected repairWithManifold to return a non-empty mesh');
  const r = analyzeManifold(mesh);
  console.log('baseline holed-tetrahedron repair result (observation, not asserted):', r);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)/spike" && node --test test/repair.test.mjs`
Expected: FAIL — `Cannot find module '../src/repair.mjs'`.

- [ ] **Step 3: Implement the repair pipeline**

Create `spike/src/repair.mjs`:
```javascript
import Module from 'manifold-3d';

let wasmPromise;
async function getWasm() {
  if (!wasmPromise) {
    wasmPromise = (async () => {
      const wasm = await Module();
      wasm.setup();
      return wasm;
    })();
  }
  return wasmPromise;
}

// Tag thrown when the manifold-3d WASM engine itself fails or aborts during
// reconstruction (as opposed to a JS-level bug in this file). run.mjs uses
// this tag to print VERDICT: CRASHED instead of silently propagating a raw
// WASM abort or misreporting it as STILL BROKEN.
export class ManifoldEngineError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ManifoldEngineError';
  }
}

// Weld coincident vertices, then let manifold-3d reconstruct a guaranteed-manifold
// solid. status() reporting NoError means the engine accepted the topology; our
// independent checker (Task 2) is still the gate on the exported result.
export async function repairWithManifold(input) {
  const { Manifold, Mesh } = await getWasm();

  let mesh;
  let merged;
  let manifold;
  let out;
  let statusVal;
  try {
    mesh = new Mesh({
      numProp: 3,
      vertProperties: Float32Array.from(input.vertProperties),
      triVerts: Uint32Array.from(input.triVerts),
    });
    // merge()'s return value is captured here (not discarded) and threaded
    // back out to the caller as `merged`; run.mjs logs it alongside the
    // other engine diagnostics.
    merged = mesh.merge(); // welds coincident vertices in place (fixes unshared STL corners)
    manifold = new Manifold(mesh);
    statusVal = manifold.status();
    out = manifold.getMesh();
  } catch (err) {
    // mesh/manifold may be only partially constructed (or not constructed at
    // all) if the WASM engine aborted during Mesh construction or merge() —
    // guard both deletes rather than assuming either handle exists.
    mesh?.delete?.();
    manifold?.delete?.();
    throw new ManifoldEngineError(`manifold-3d engine failed during reconstruction: ${err.message}`, { cause: err });
  }

  // manifold.status() returns a Manifold.Error enum value (0 = NoError); this
  // spike only distinguishes NoError by name — all other codes are passed
  // through as their raw stringified value rather than mapped to a name.
  const status = typeof statusVal === 'string' ? statusVal : (statusVal?.value ?? String(statusVal));

  const result = {
    mesh: {
      vertProperties: Float32Array.from(out.vertProperties),
      triVerts: Uint32Array.from(out.triVerts),
    },
    status: status === '0' || status === 0 ? 'NoError' : String(status),
    genus: manifold.genus(),
    volume: manifold.volume(),
    merged,
  };

  manifold.delete();
  mesh.delete?.();
  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd "$(git rev-parse --show-toplevel)/spike" && node --test test/repair.test.mjs`
Expected: PASS — 2 tests. If `status` comes back as a numeric enum, the normalization in `repair.mjs` maps `0` → `'NoError'`; if it fails on the mapping, log the raw `manifold.status()` value and adjust the comparison to the observed shape (this is expected spike calibration, not a rewrite).

- [ ] **Step 5: Write the real-run CLI**

Create `spike/run.mjs`:
```javascript
import { readFileSync, writeFileSync } from 'node:fs';
import { buildBinaryStl } from './src/stl.mjs';
import { parse3mf } from './src/mesh3mf.mjs';
import { analyzeManifold } from './src/check.mjs';
import { repairWithManifold, ManifoldEngineError } from './src/repair.mjs';

const inPath = process.argv[2] ?? 'test/fixtures/tripo-broken.3mf';
const outPath = process.argv[3] ?? 'test/fixtures/tripo-repaired.stl';

// Intake is 3MF (shared, indexed mesh parsed directly); export stays binary STL.
const parsed = parse3mf(new Uint8Array(readFileSync(inPath)));

// Derive a relative weld tolerance from the mesh's own scale instead of
// trusting a fixed absolute default — a 1e-4 tolerance is meaningless on a
// 2000mm model and overly aggressive on a 2mm one. The 1e-6 floor only
// guards a degenerate (near-zero or exactly zero) bounding box; it is
// deliberately far below any real model's scale so it never dominates the
// relative term the way a flat 1e-4 floor would for anything <= 100 units.
function bboxDiagonal(vertProperties) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertProperties.length; i += 3) {
    const x = vertProperties[i], y = vertProperties[i + 1], z = vertProperties[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
}

const bboxDiag = bboxDiagonal(parsed.vertProperties);
// Guard both the zero-bbox and empty-mesh cases: an empty vertProperties leaves the
// min/max sentinels untouched, so bboxDiagonal returns Infinity (not 0) — fall back
// to the 1e-6 floor in either case rather than deriving a nonsensical tolerance.
const tolerance = !Number.isFinite(bboxDiag) || bboxDiag === 0 ? 1e-6 : Math.max(1e-6, bboxDiag * 1e-6);
console.log('SCALE :', { bboxDiagonal: bboxDiag, tolerance });
// Note: our 3MF intake is already indexed/shared, so analyzeManifold's
// tolerance-based weld here REVALIDATES existing shared connectivity rather
// than reconstructing it from scratch (its original role against unshared
// STL vertices). Harmless at this derived tolerance — noted for clarity, not
// a behavior change.

const before = analyzeManifold(parsed, { tolerance });
console.log('BEFORE:', before);

let mesh, status, genus, volume, merged;
try {
  ({ mesh, status, genus, volume, merged } = await repairWithManifold(parsed));
} catch (err) {
  if (err instanceof ManifoldEngineError) {
    console.error('VERDICT: CRASHED ❌', err.message);
    process.exit(2);
  }
  throw err; // unexpected JS-level bug in this harness — do not mask it as a spike result
}
// The engine's self-reported volume is logged here as corroborating info
// only — the watertight gate below never reads it (see `after.signedVolume`).
console.log('ENGINE:', { status, genus, volume, merged });

const after = analyzeManifold(mesh, { tolerance });
console.log('AFTER :', after);
if (after.degenerateTriangles > 0) {
  console.log(`NOTE  : ${after.degenerateTriangles} degenerate (zero-area) triangle(s) after repair — does not fail the gate by itself, record in FINDINGS.`);
}

writeFileSync(outPath, buildBinaryStl(mesh));
console.log(`Wrote ${outPath}`);

// Watertight requires: our checker sees zero non-manifold edges AND the
// engine actually produced geometry. `nonManifoldEdges === 0` alone is
// vacuously true on an empty or collapsed-to-a-point output — triangles > 0
// and a non-zero INDEPENDENTLY computed enclosed volume rule that out. The
// gate reads `after.signedVolume` (this checker's own divergence-theorem
// computation over the welded, exported mesh) — never `manifold.volume()`;
// the engine's self-report is never allowed to gate a verdict about itself.
const watertight = after.nonManifoldEdges === 0 && after.triangles > 0 && Math.abs(after.signedVolume) > 0;
console.log(watertight ? 'VERDICT: WATERTIGHT ✅' : 'VERDICT: STILL BROKEN ❌');
process.exit(watertight ? 0 : 1);
```

- [ ] **Step 6: Run against the real Tripo fixture**

Prerequisite: `spike/test/fixtures/tripo-broken.3mf` exists (see Prerequisites — already present). Run:
```bash
cd "$(git rev-parse --show-toplevel)/spike" && node run.mjs
```
If Node runs out of memory decompressing/scanning the ~155MB model XML, re-run with `node --max-old-space-size=4096 run.mjs`. Expected output: a `SCALE` line (bbox diagonal + derived tolerance), a `BEFORE` line whose `nonManifoldEdges` is near the reported ~108, an `ENGINE` line, an `AFTER` line, and a `VERDICT` line — `WATERTIGHT`, `STILL BROKEN`, or `CRASHED` (see Interpretation notes in Task 4). Record all blocks verbatim — they are the spike's data. Exit code 0 = watertight, 1 = still broken, 2 = engine crashed.

- [ ] **Step 7: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add spike/src/repair.mjs spike/run.mjs spike/test/repair.test.mjs && git commit -m "feat(spike): manifold-3d repair pipeline and real-run CLI"
```

---

### Task 4: Record the verdict

**Files:**
- Create: `spike/FINDINGS.md`
- Modify: `docs/superpowers/specs/2026-07-07-mesh-repair-design.md:4` (update the Status line)

**Interfaces:** none — this task produces the decision that gates all future work.

- [ ] **Step 1: Write the findings report**

Create `spike/FINDINGS.md` with the real numbers from Task 3 Step 6. Use this exact structure (fill the bracketed values from the run output — do not leave brackets):
```markdown
# Mesh Repair WASM Spike — Findings

**Date:** 2026-07-08
**Input:** test/fixtures/tripo-broken.3mf (3MF indexed mesh) → repaired export test/fixtures/tripo-repaired.stl
**Engine:** manifold-3d (npm WASM, no compilation)

## Measured (independent checker)
- Scale: bboxDiagonal=[D], tolerance=[TOL]
- BEFORE: nonManifoldEdges=[N] (open=[O], complex=[C], flipped=[F], degenerate=[DEG]), triangles=[T], weldedVertices=[W], signedVolume=[SV]
- AFTER : nonManifoldEdges=[N] (open=[O], complex=[C], flipped=[F], degenerate=[DEG]), triangles=[T], weldedVertices=[W], signedVolume=[SV]
- Engine self-report (corroborating only — not the watertight gate; the gate uses the independent
  `signedVolume` above): status=[status], genus=[g], volume=[v], merged=[merge() return value]

## Verdict
[WATERTIGHT — manifold-3d alone is sufficient. Output is topologically manifold + non-degenerate
per our independent checker; actual slice/print not independently verified in this spike.
Proceed to plan the full browser build.]
OR
[STILL BROKEN — welding was not enough; genuine holes remain, or the exported mesh was
empty/degenerate (triangles=0 or signedVolume≈0). manifold-3d does not fill holes. Trigger Task 5
(ADMesh contingency) as a separate spike before any build.]
OR
[CRASHED — the manifold-3d engine threw/aborted during reconstruction on this input (caught as
`ManifoldEngineError`); record the caught error message here. This is a distinct outcome from
STILL BROKEN: the engine could not process the input at all, rather than processing it and
leaving non-manifold edges.]

## Interpretation notes
- If AFTER open edges == 0 but BEFORE open edges > 0, welding closed them → the "non-manifold"
  report was unshared vertices, not real holes. Easiest possible outcome.
- If AFTER open edges > 0, there are real boundary loops manifold-3d cannot close.
- If AFTER flipped edges > 0, the engine reconstructed a topologically closed mesh but left at
  least one edge with inconsistent winding — note it separately from open/complex edges.
- If `degenerateTriangles` is nonzero (BEFORE or AFTER), note it: zero-area triangles don't fail
  the watertight gate by themselves but are relevant to whether the output actually slices/prints.
- The watertight gate reads this checker's own `signedVolume` (divergence theorem over the welded,
  exported mesh), never `manifold.volume()` — the engine self-report above is corroborating only.
- If the checker and engine disagree (checker says watertight, status != NoError, or vice
  versa), note it — it likely means positions were not bit-identical and tolerance welding
  matters; capture the tolerance used.
- Weld counts (and therefore `signedVolume`) are approximate under chained near-tolerance vertex
  drift: the weld is greedy/insertion-order dependent, not a true transitive clustering. Acceptable
  for spike scope; upgrade to union-find clustering if this checker is promoted beyond the spike.
- If `run.mjs` printed `VERDICT: CRASHED`, that is its own outcome above — do not force it into
  STILL BROKEN, they have different follow-up actions.
```

- [ ] **Step 2: Update the design spec status**

In `docs/superpowers/specs/2026-07-07-mesh-repair-design.md`, change line 4 from:
```
**Status:** Approved (design), pending WASM spike validation
```
to one of (pick per verdict):
```
**Status:** Approved (design), WASM spike PASSED with manifold-3d — cleared for full build
```
or
```
**Status:** Approved (design), WASM spike FAILED with manifold-3d — ADMesh contingency required
```

- [ ] **Step 3: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add spike/FINDINGS.md docs/superpowers/specs/2026-07-07-mesh-repair-design.md && git commit -m "docs(spike): record WASM de-risking verdict"
```

---

### Task 5 (CONTINGENCY — only if Task 4 verdict is STILL BROKEN): ADMesh fallback trigger

Do NOT execute this task if manifold-3d passed. manifold-3d guarantees manifold topology but does **not** fill genuine holes; ADMesh does hole-filling but does not guarantee manifold output. If real boundary loops remain, that is a materially different spike (Emscripten toolchain, `admesh` C sources, `--fill-holes` path) and deserves its own plan rather than being bolted on here.

- [ ] **Step 1: Stop and re-plan**

Record in `spike/FINDINGS.md` under a new `## Next spike` heading: the exact `openEdges` count that remained, and a one-line hypothesis (e.g. "N boundary loops from disconnected islands — needs ADMesh `--fill-holes` or a winding-number remesh"). Then return to the brainstorming/writing-plans cycle for an ADMesh spike. Do not proceed to the full browser build on a failed core.

---

## Self-Review

- **Spec coverage (§6 de-risking spike):** Tasks 1–3 compile/wire the WASM pipeline and run it against the real Tripo 3MF; Task 1's `parse3mf` reads the container's shared, indexed mesh directly (so the ~108 non-manifold edges are genuine topology, not unwelded-STL-vertex artifacts), and repaired output is exported as binary STL via `buildBinaryStl`; Task 3 Step 6 is the "run against 108 non-manifold edges" step; the watertight/manifold criterion is enforced by the independent checker in Task 2 (now including orientation/flipped-edge, degenerate-triangle, and independent signed-volume detection) and gated in Task 3, whose `run.mjs` gate reads only `after.signedVolume` — never the engine's self-reported `manifold.volume()` — so Global Constraints line 15's invariant ("the gate is the independent checker, never the library's self-report") is actually upheld by the code, not just stated. Task 4 records the pass/fail/crashed decision the spec demands ("we learn it before investing weeks"). Note: this spike proves the mesh is topologically manifold and non-degenerate per our own checker — it does **not** independently verify that the output actually slices/prints, which is a narrower claim than the design spec's "slices/prints" wording; see FINDINGS.md verdict phrasing. ✅
- **Out-of-scope respected:** no interactive editing, no backend, no accounts, no browser UI. Intake is 3MF (primary product path); STL *intake* and 3MF *export* are explicitly deferred to the build phase. The spike is deliberately narrower than the product. ✅
- **Placeholder scan:** all code blocks are complete (real `fflate` `unzipSync`/`zipSync`/`strFromU8`/`strToU8` calls, no stubs); the only bracketed values are in `FINDINGS.md`, which are runtime measurements the executor fills from real output (not code placeholders). ✅
- **Type consistency:** mesh buffer shape `{ vertProperties: Float32Array, triVerts: Uint32Array }` is identical across `parse3mf` (3MF intake), `analyzeManifold`, `repairWithManifold`, and `buildBinaryStl` (STL export) — `parse3mf` produces exactly the same shape Tasks 2–3 consume, so the intake swap needs no changes downstream. `analyzeManifold` field names (`openEdges`, `complexEdges`, `flippedEdges`, `nonManifoldEdges`, `weldedVertices`, `triangles`, `degenerateTriangles`, `signedVolume`) match between Task 2's implementation and its consumers (Task 3's test, `run.mjs` logging and gating, Task 4's `FINDINGS.md` template). `repairWithManifold`'s result shape (`mesh`, `status`, `genus`, `volume`, `merged`) and its `ManifoldEngineError` throw path — now covering mesh construction and welding as well as `Manifold`/`getMesh()` — match between `repair.mjs` and `run.mjs`'s try/catch. `parseBinaryStl` (STL *intake*) is removed from the plan; `buildBinaryStl` (STL *export*) remains and now lives in `src/stl.mjs`. ✅
- **Risk the spike does NOT cover:** performance on multi-million-triangle meshes, browser/Worker execution, STL *intake*, and 3MF *export* are all deferred by design — the spike answers only "does a clean WASM repair path exist for our targets," which is the single risk §6 names.
