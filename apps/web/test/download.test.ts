import { describe, it, expect } from 'vitest';
import { repairedFileName } from '../src/download';

describe('repairedFileName', () => {
  it('replaces the extension and marks the file as repaired', () => {
    expect(repairedFileName('cute+frog+3d+model.3mf')).toBe('cute+frog+3d+model-repaired.stl');
    expect(repairedFileName('frog.STL')).toBe('frog-repaired.stl');
  });

  it('handles a name with dots in it', () => {
    expect(repairedFileName('v1.2.final.stl')).toBe('v1.2.final-repaired.stl');
  });
});
