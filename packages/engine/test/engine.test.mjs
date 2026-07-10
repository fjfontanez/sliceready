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
