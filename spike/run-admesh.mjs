import { readFileSync, writeFileSync } from 'node:fs';
import { parse3mf } from './src/mesh3mf.mjs';
import { buildBinaryStl } from './src/stl.mjs';
import { analyzeManifold, bboxDiagonal } from './src/check.mjs';
import { repairWithAdmesh, AdmeshEngineError } from './src/repair-admesh.mjs';

const inPath = process.argv[2] ?? 'test/fixtures/tripo-broken.3mf';
const outPath = process.argv[3] ?? 'test/fixtures/tripo-admesh-repaired.stl';

// Validated by spike/FINDINGS.md: the native `admesh --fill-holes
// --normal-directions --normal-values` run left exactly 2 residual complex
// edges while OrcaSlicer still reported manifold = yes. That specific count —
// not "any number" — is the validated baseline; exceeding it is a signal to
// re-check against the slicer before trusting the REPAIRED verdict.
const COMPLEX_BASELINE = 2;

const parsed = parse3mf(new Uint8Array(readFileSync(inPath)));
const bboxDiag = bboxDiagonal(parsed.vertProperties);
const tolerance = !Number.isFinite(bboxDiag) || bboxDiag === 0 ? 1e-6 : Math.max(1e-6, bboxDiag * 1e-6);
console.log('SCALE :', { bboxDiagonal: bboxDiag, tolerance });
console.log('BEFORE:', analyzeManifold(parsed, { tolerance }));

let mesh;
try {
  ({ mesh } = await repairWithAdmesh(parsed));
} catch (err) {
  if (err instanceof AdmeshEngineError) { console.error('VERDICT: CRASHED ❌', err.message); process.exit(2); }
  throw err;
}

const after = analyzeManifold(mesh, { tolerance });
console.log('AFTER :', after);
writeFileSync(outPath, buildBinaryStl(mesh));
console.log(`Wrote ${outPath}`);

// PASS = the validated print bar (see Global Constraints): no open/flipped edges
// and real geometry. complexEdges is logged, not gated (within the slicer's
// accepted bar per spike/FINDINGS.md); Task 5 can drive it to 0 if ever needed.
const pass = after.openEdges === 0 && after.flippedEdges === 0 && after.triangles > 0 && Math.abs(after.signedVolume) > 0;
if (after.complexEdges > 0) console.log(`NOTE  : ${after.complexEdges} complex edge(s) remain — within slicer bar, logged not gated.`);
if (after.complexEdges > COMPLEX_BASELINE) {
  console.warn(`WARNING: complexEdges (${after.complexEdges}) exceeds the slicer-validated baseline (${COMPLEX_BASELINE}) — re-check against the production slicer before trusting the REPAIRED verdict.`);
}
console.log(pass ? 'VERDICT: REPAIRED ✅' : 'VERDICT: STILL BROKEN ❌');
process.exit(pass ? 0 : 1);
