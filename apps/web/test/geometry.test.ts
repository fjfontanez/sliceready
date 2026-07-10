import { describe, it, expect } from 'vitest';
import { MESH_MATERIAL_PARAMS, toBufferGeometry, toLineGeometry } from '../src/geometry';

describe('toBufferGeometry', () => {
  it('carries every vertex and every index across', () => {
    const mesh = {
      vertProperties: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      triVerts: new Uint32Array([0, 1, 2]),
    };
    const geometry = toBufferGeometry(mesh);

    expect(geometry.getAttribute('position').count).toBe(3);
    expect(geometry.getIndex()!.count).toBe(3);
  });

  it('does not compute vertex normals — the viewer flat-shades in the fragment shader', () => {
    const mesh = {
      vertProperties: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      triVerts: new Uint32Array([0, 1, 2]),
    };
    expect(toBufferGeometry(mesh).getAttribute('normal')).toBeUndefined();
  });

  it('pins flatShading, which toBufferGeometry depends on for correct lighting', () => {
    expect(MESH_MATERIAL_PARAMS.flatShading).toBe(true);
  });
});

describe('toLineGeometry', () => {
  it('reads the flat vertex-pair layout as line endpoints', () => {
    // Two edges = 4 endpoints = 12 floats.
    const segments = new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]);
    expect(toLineGeometry(segments).getAttribute('position').count).toBe(4);
  });

  it('handles an empty defect set', () => {
    expect(toLineGeometry(new Float32Array()).getAttribute('position').count).toBe(0);
  });
});
