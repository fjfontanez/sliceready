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
