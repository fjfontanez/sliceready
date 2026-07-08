import { parse3mf } from './mesh3mf.mjs';
import { parseBinaryStl, buildBinaryStl } from './stl.mjs';
import { analyzeManifold, bboxDiagonal } from './check.mjs';
import { repairWithAdmesh } from './repair-admesh.mjs';

// Same validated baseline as run-admesh.mjs (see spike/FINDINGS.md): the
// native repair run left exactly 2 residual complex edges while OrcaSlicer
// still reported manifold = yes. Exceeding it is a signal to re-check against
// the slicer, not a hard failure — pass/fail stays driven by openEdges/
// flippedEdges/signedVolume alone.
const COMPLEX_BASELINE = 2;

// Framework-agnostic repair entry point for the browser/Worker layer.
export async function repairMesh(fileBytes, kind) {
  const bytes = fileBytes instanceof Uint8Array ? fileBytes : new Uint8Array(fileBytes);
  let parsed;
  if (kind === '3mf') parsed = parse3mf(bytes);
  else if (kind === 'stl') parsed = parseBinaryStl(bytes);
  else throw new Error(`unsupported kind: ${kind} (expected 'stl' or '3mf')`);

  const d = bboxDiagonal(parsed.vertProperties);
  const tolerance = !Number.isFinite(d) || d === 0 ? 1e-6 : Math.max(1e-6, d * 1e-6);
  const before = analyzeManifold(parsed, { tolerance });

  const { mesh } = await repairWithAdmesh(parsed);
  const after = analyzeManifold(mesh, { tolerance });
  const pass = after.openEdges === 0 && after.flippedEdges === 0 && after.triangles > 0 && Math.abs(after.signedVolume) > 0;
  if (after.complexEdges > COMPLEX_BASELINE) {
    console.warn(`WARNING: complexEdges (${after.complexEdges}) exceeds the slicer-validated baseline (${COMPLEX_BASELINE}) — re-check against the production slicer before trusting the REPAIRED verdict.`);
  }

  return { stl: buildBinaryStl(mesh), report: { before, after, pass } };
}
