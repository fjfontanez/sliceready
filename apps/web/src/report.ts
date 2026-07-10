import type { Report } from './repair-client';

export interface Summary {
  ok: boolean;
  headline: string;
  fixed: string[];
  remaining: string[];
  warnings: string[];
  notes: string[];
}

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

// The product rule, enforced here rather than in prose: a failed repair never
// gets to call itself "repaired". The download is still offered — the user's
// file is theirs — but the copy tells the truth about what is left.
export function summarize(report: Report): Summary {
  const { before, after, pass, warnings } = report;

  const fixed: string[] = [];
  const closedHoles = before.openEdges - after.openEdges;
  const fixedNormals = before.flippedEdges - after.flippedEdges;
  const removedDegenerates = before.degenerateTriangles - after.degenerateTriangles;
  if (closedHoles > 0) fixed.push(`Closed holes along ${plural(closedHoles, 'open edge')}.`);
  if (fixedNormals > 0) fixed.push(`Corrected ${plural(fixedNormals, 'flipped edge')}.`);
  if (removedDegenerates > 0) fixed.push(`Removed ${plural(removedDegenerates, 'degenerate triangle')}.`);

  const remaining: string[] = [];
  if (after.openEdges > 0) remaining.push(`${plural(after.openEdges, 'open edge')} could not be closed.`);
  if (after.flippedEdges > 0) remaining.push(`${plural(after.flippedEdges, 'flipped edge')} could not be corrected.`);

  // The overlay is capped (see analyzeManifold's maxDefectEdges). Saying so is
  // the same honesty rule the headline obeys: never let the UI imply it showed
  // everything when it did not.
  const notes: string[] = [];
  if (before.defectEdges?.truncated) {
    notes.push('The highlighted defects are a partial view — this mesh has more damage than the viewer draws.');
  }

  return {
    ok: pass,
    headline: pass ? 'Mesh repaired — it should slice now.' : 'Partially fixed — this mesh is still not watertight.',
    fixed,
    remaining,
    warnings,
    notes,
  };
}
