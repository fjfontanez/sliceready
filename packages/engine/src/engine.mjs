import { parse3mf } from './mesh3mf.mjs';
import { parseBinaryStl, buildBinaryStl } from './stl.mjs';
import { analyzeManifold, bboxDiagonal } from './check.mjs';
import { repairWithAdmesh } from './repair-admesh.mjs';

// Same validated baseline as scripts/run-admesh.mjs (see spike/FINDINGS.md): the
// native repair run left exactly 2 residual complex edges while OrcaSlicer
// still reported manifold = yes. Exceeding it is a signal to re-check against
// the slicer, not a hard failure — pass/fail stays driven by openEdges/
// flippedEdges/signedVolume alone.
export const COMPLEX_BASELINE = 2;

// Surfaced through report.warnings so the UI can render them. A console.warn
// here would be invisible to the only person who needs to see it: the user.
export function buildWarnings(after, baseline = COMPLEX_BASELINE) {
  const warnings = [];
  if (after.complexEdges > baseline) {
    warnings.push(
      `${after.complexEdges} complex edges remain, above the slicer-validated baseline of ${baseline}. `
      + 'The repaired mesh may still fail to slice — check it in your slicer before printing.',
    );
  }
  return warnings;
}

// Framework-agnostic repair entry point for the browser/Worker layer.
// onProgress(phase, info) fires on ENTERING each phase; the Worker forwards
// these as watchdog heartbeats, so a phase must never be entered silently.
export async function repairMesh(fileBytes, kind, { onProgress = () => {}, collectDefectEdges = false } = {}) {
  const bytes = fileBytes instanceof Uint8Array ? fileBytes : new Uint8Array(fileBytes);

  onProgress('parse', {});
  let parsed;
  if (kind === '3mf') parsed = parse3mf(bytes);
  else if (kind === 'stl') parsed = parseBinaryStl(bytes);
  else throw new Error(`unsupported kind: ${kind} (expected 'stl' or '3mf')`);

  const triangles = parsed.triVerts.length / 3;
  const d = bboxDiagonal(parsed.vertProperties);
  const tolerance = !Number.isFinite(d) || d === 0 ? 1e-6 : Math.max(1e-6, d * 1e-6);

  onProgress('analyze-before', { triangles });
  const before = analyzeManifold(parsed, { tolerance, collectDefectEdges });

  onProgress('repair', { triangles });
  const { mesh } = await repairWithAdmesh(parsed);

  onProgress('analyze-after', { triangles });
  const after = analyzeManifold(mesh, { tolerance, collectDefectEdges });

  const pass = after.openEdges === 0 && after.flippedEdges === 0 && after.triangles > 0 && Math.abs(after.signedVolume) > 0;

  onProgress('export', { triangles });
  return {
    stl: buildBinaryStl(mesh),
    report: { before, after, pass, warnings: buildWarnings(after) },
    beforeMesh: parsed,
    afterMesh: mesh,
  };
}
