import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairWithManifold, ManifoldEngineError } from '../src/repair.mjs';
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

test('repairWithManifold throws ManifoldEngineError on non-manifold (holed) input', async () => {
  // The open question this spike answers: manifold-3d is NOT a repair tool.
  // Verified empirically (manifold-3d v3.5.1) and against the library's own
  // docs ("accepts manifold meshes as input ... generally requires input
  // meshes to be manifold"). `new Manifold()` throws NotManifold on any
  // genuinely non-manifold mesh — a hole is enough. `mesh.merge()` only welds
  // coincident vertices; it does not fill holes or fix topology. So on the
  // holed tetrahedron (3 open edges), repairWithManifold surfaces the engine
  // failure as ManifoldEngineError, which run.mjs reports as VERDICT: CRASHED.
  const holed = { v: TETRA.v, f: TETRA.f.slice(0, 3) };
  await assert.rejects(
    () => repairWithManifold(toBuffer(holed)),
    (err) => err instanceof ManifoldEngineError && /not manifold/i.test(err.message),
    'manifold-3d must reject non-manifold input at construction',
  );
});
