import { describe, it, expect } from 'vitest';
import { summarize } from '../src/report';
import type { ManifoldReport, Report } from '../src/repair-client';

const counts = (over: Partial<ManifoldReport> = {}): ManifoldReport => ({
  openEdges: 0, complexEdges: 0, flippedEdges: 0, nonManifoldEdges: 0,
  weldedVertices: 100, triangles: 100, degenerateTriangles: 0, signedVolume: 5, ...over,
});

describe('summarize', () => {
  it('reports what was fixed on a passing repair', () => {
    const report: Report = {
      before: counts({ openEdges: 22, flippedEdges: 40, nonManifoldEdges: 67, complexEdges: 5 }),
      after: counts({ complexEdges: 2, nonManifoldEdges: 2 }),
      pass: true,
      warnings: [],
    };
    const summary = summarize(report);

    expect(summary.ok).toBe(true);
    expect(summary.headline).toMatch(/repaired/i);
    expect(summary.fixed.join(' ')).toMatch(/22/);
    expect(summary.fixed.join(' ')).toMatch(/40/);
    expect(summary.remaining).toEqual([]);
  });

  it('never claims "repaired" when the repair did not pass', () => {
    const report: Report = {
      before: counts({ openEdges: 22, nonManifoldEdges: 22 }),
      after: counts({ openEdges: 3, nonManifoldEdges: 3 }),
      pass: false,
      warnings: [],
    };
    const summary = summarize(report);

    expect(summary.ok).toBe(false);
    expect(summary.headline.toLowerCase()).not.toContain('repaired');
    expect(summary.headline).toMatch(/partial/i);
    expect(summary.remaining.join(' ')).toMatch(/3 open edges/i);
  });

  it('passes engine warnings straight through, even on a passing repair', () => {
    const report: Report = {
      before: counts(), after: counts({ complexEdges: 7 }), pass: true,
      warnings: ['7 complex edges remain, above the slicer-validated baseline of 2.'],
    };
    expect(summarize(report).warnings).toEqual(report.warnings);
  });

  it('says so when the defect overlay is truncated', () => {
    const report: Report = {
      before: { ...counts({ openEdges: 500_000 }), defectEdges: { open: new Float32Array(), flipped: new Float32Array(), truncated: true } },
      after: counts(), pass: true, warnings: [],
    };
    expect(summarize(report).notes[0]).toMatch(/partial view/i);
  });
});
