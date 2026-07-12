import { unzipSync, strFromU8 } from 'fflate';

// 3MF is a zip (OPC package). Geometry lives in the `3D/3dmodel.model` part as
// XML: <object type="model"><mesh><vertices><vertex x= y= z=/>...</vertices>
// <triangles><triangle v1= v2= v3=/>...</triangles></mesh></object>. Unlike
// binary STL (which stores unshared per-triangle vertices), 3MF stores a
// SHARED, INDEXED mesh — so we keep the indices as authored and any
// non-manifold defect is genuine topology, not an unwelded-vertex artifact.
//
// Memory note: this loads the decompressed model part (~155MB for the real
// Tripo fixture) as one string and scans it with regexes — no DOM tree is ever
// built. It walks that string several times, cheaply; the win is the absence of
// a parse tree, not a single pass. The intermediate JS number arrays
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

// The units 3MF permits on <model>, in millimetres — the unit STL is read as.
//
// A Map, not an object literal, and that is not stylistic. A plain-object lookup
// walks the prototype chain, so `unit="constructor"` would resolve to the Object
// function and `unit="__proto__"` to Object.prototype — both non-undefined, both
// slipping past the "unknown unit" throw below, and both ending up multiplied
// into a coordinate as NaN. The file would then fail with "malformed vertex
// coordinate" when its actual defect is the unit attribute: an honest error, in
// the wrong place. A Map has no such keys to inherit.
const MM_PER_UNIT = new Map([
  ['micron', 0.001],
  ['millimeter', 1],
  ['centimeter', 10],
  ['inch', 25.4],
  ['foot', 304.8],
  ['meter', 1000],
]);

// Absent, the 3MF specification's default is the millimetre. An unknown unit is
// REJECTED rather than assumed: guessing a scale is how a model silently prints
// at the wrong size, and a wrong size that looks plausible is worse than an
// error that stops you.
function millimetresPerUnit(xml) {
  const model = /<model\b([^>]*)>/.exec(xml);
  // Both quote styles, like every sibling attribute regex above. XML permits
  // single quotes, and a `unit='inch'` this regex failed to see would fall
  // through to the millimetre default and print 25.4x too small — the exact
  // silent-wrong-scale failure this function exists to prevent.
  const unit = model && /\bunit\s*=\s*["']([^"']*)["']/.exec(model[1]);
  if (!unit) return 1;
  const key = unit[1].trim().toLowerCase();
  const mm = MM_PER_UNIT.get(key);
  if (mm === undefined) {
    throw new Error(
      `3MF declares an unrecognised unit "${unit[1]}" — refusing to guess a scale. ` +
        `Known units: ${[...MM_PER_UNIT.keys()].join(', ')}.`,
    );
  }
  return mm;
}

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

  // The SAME guard for <component>, and it is not redundant. The mesh-count check
  // above deliberately tolerates a <components> assembly — an outer object with no
  // <mesh> of its own referencing an inner one that owns the single real mesh — so
  // that a legitimate single-mesh file is not misread as multi-object. But a
  // <component> carries its own transform attribute, which means the one assembly
  // shape we allow is precisely the shape that can smuggle an unapplied transform
  // past the <build><item> guard: wrong absolute geometry, and a reflection would
  // flip signedVolume. Refuse it on the same terms, rather than let the exception
  // swallow the rule.
  const componentRe = /<component\b[^>]*>/g;
  let cm;
  while ((cm = componentRe.exec(xml)) !== null) {
    if (/\btransform\s*=/.test(cm[0])) {
      throw new Error(
        'parse3mf: <component> transforms not supported by this spike — export the model pre-baked at identity',
      );
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

  // A 3MF states its unit on <model>. STL states nothing, and every slicer reads
  // an STL as millimetres — so a 3MF authored in inches, passed through with its
  // coordinates untouched, prints 25.4x too small. Silently. Reading the
  // attribute and scaling to millimetres is the whole fix; ignoring it was the
  // one failure mode this project refuses to have.
  const scale = millimetresPerUnit(xml);
  // Scope the vertex/triangle scans to this single <mesh>...</mesh> span, not
  // the whole model part — belt-and-suspenders with the multi-mesh guard
  // above, and keeps the regex scans tight to the geometry they own.
  const meshXml = xml.slice(meshStart, meshEnd + meshCloseTag.length);

  // Extract by attribute NAME (x/y/z and v1/v2/v3 may appear in any order),
  // never by position. Regex scans over the mesh span rather than a DOM tree:
  // the point is that no parse tree is ever materialised, not that the file is
  // read once — it is walked several times, cheaply.
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
    const px = parseFloat(x[1]);
    const py = parseFloat(y[1]);
    const pz = parseFloat(z[1]);
    // Same trap as the triangle indices: parseFloat('abc') is NaN, and NaN fails
    // every comparison silently. A NaN coordinate would flow into the bounding
    // box, the tolerance, the repair and the STL, poisoning all of them without
    // ever raising anything. Catch it at the only place it can still be named.
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) {
      throw new Error(`parse3mf: malformed vertex coordinate (x="${x[1]}", y="${y[1]}", z="${z[1]}")`);
    }
    vertCoords.push(px * scale, py * scale, pz * scale);
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
    // Both clauses are needed; neither subsumes the other.
    //
    // `< 0` catches a negative index (v1="-1"). It has to be checked here rather
    // than by the upper-bound check at the end, because a negative never exceeds
    // maxIndex — and Uint32Array.from would wrap it to 4294967295.
    //
    // `Number.isInteger` catches NaN, which `< 0` cannot: parseInt('abc') is NaN,
    // and `NaN < 0` is false, and `NaN > maxIndex` is false too. A malformed index
    // therefore sailed past BOTH range guards and Uint32Array.from turned it into
    // 0 — a triangle silently rewired to vertex zero, in a file the parser called
    // valid.
    //
    // isInteger alone will not do the job either: Number.isInteger(-1) is true.
    if (!Number.isInteger(i1) || !Number.isInteger(i2) || !Number.isInteger(i3) ||
        i1 < 0 || i2 < 0 || i3 < 0) {
      throw new Error(
        `parse3mf: malformed triangle index (v1="${v1[1]}", v2="${v2[1]}", v3="${v3[1]}")`,
      );
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
