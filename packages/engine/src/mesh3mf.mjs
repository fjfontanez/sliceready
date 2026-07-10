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
