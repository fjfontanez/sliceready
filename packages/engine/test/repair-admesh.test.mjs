import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairWithAdmesh, AdmeshEngineError } from '../src/repair-admesh.mjs';
import { parseBinaryStl, buildBinaryStl } from '../src/stl.mjs';
import { analyzeManifold } from '../src/check.mjs';

// ADMesh rejects any binary STL below its own hard floor: stl_count_facets()
// enforces STL_MIN_FILE_SIZE = 284 bytes (84-byte header + 4 triangles * 50
// bytes each), setting stl->error before stl_repair ever runs. A holed
// tetrahedron (3 triangles / 234 bytes) is below that floor and therefore
// UNREPAIRABLE by ADMesh — it is not a valid regression fixture. Use a holed
// cube instead: 12 triangles minus the top face = 10 triangles / 584 bytes
// total, safely above the 284-byte / 4-triangle floor.
//
// Axis-aligned cube (fractional, non-round bounds so ADMesh's binary/ASCII
// auto-detection is also safe), top face removed → 10 triangles, a 4-edge
// square hole.
const CUBE_V = [
  [0.13, 0.19, 0.07], [10.37, 0.19, 0.07], [10.37, 10.23, 0.07], [0.13, 10.23, 0.07], // z-min
  [0.13, 0.19, 10.41], [10.37, 0.19, 10.41], [10.37, 10.23, 10.41], [0.13, 10.23, 10.41], // z-max
];
// 10 outward-CCW triangles; the two top-face tris ([4,5,6],[4,6,7]) are omitted → hole.
const HOLED_CUBE_F = [
  [0, 2, 1], [0, 3, 2],           // bottom (z-min)
  [0, 1, 5], [0, 5, 4],           // front (y-min)
  [3, 7, 6], [3, 6, 2],           // back (y-max)
  [0, 4, 7], [0, 7, 3],           // left (x-min)
  [1, 2, 6], [1, 6, 5],           // right (x-max)
];
function toBuffer(v, f) {
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

test('parseBinaryStl round-trips buildBinaryStl', () => {
  const src = toBuffer(CUBE_V, HOLED_CUBE_F);
  const back = parseBinaryStl(buildBinaryStl(src));
  assert.equal(back.triVerts.length, src.triVerts.length);
  assert.deepEqual([...back.vertProperties], [...src.vertProperties]);
});

test('repairWithAdmesh closes the open edges of a holed cube', async () => {
  const holed = toBuffer(CUBE_V, HOLED_CUBE_F);
  // Tolerance is relative to the fixture's ~10-unit extent, not tied to the
  // exact (intentionally fractional) coordinate values above.
  const before = analyzeManifold(holed, { tolerance: 1e-2 });
  assert.equal(before.openEdges, 4, 'the missing top face leaves a 4-edge square hole');

  const { mesh, ok } = await repairWithAdmesh(holed);
  assert.equal(ok, true);
  const after = analyzeManifold(mesh, { tolerance: 1e-2 });
  assert.equal(after.openEdges, 0, 'ADMesh should fill the hole');
  assert.equal(after.flippedEdges, 0);
  assert.ok(Math.abs(after.signedVolume) > 0);
});
