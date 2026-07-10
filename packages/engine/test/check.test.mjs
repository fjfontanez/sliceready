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
