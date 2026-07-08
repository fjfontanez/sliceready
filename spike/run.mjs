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
