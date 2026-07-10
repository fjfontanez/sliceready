import { describe, it, expect } from 'vitest';
import { downloadLabel, errorMessageFor, validateFile } from '../src/state';
import { RepairTimeoutError, RepairFailedError, EngineLoadError } from '../src/repair-client';
import { SOFT_CAP_BYTES } from '../src/dropzone';

const fileOf = (name: string, size: number): File => {
  const file = new File([], name);
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

describe('validateFile', () => {
  it('accepts a supported file under the cap', () => {
    expect(validateFile(fileOf('frog.3mf', 1000))).toEqual({ kind: '3mf' });
  });

  it('rejects an unsupported extension with an actionable message', () => {
    const result = validateFile(fileOf('frog.obj', 1000));
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/STL|3MF/);
  });

  it('warns above the soft cap but still accepts the file', () => {
    const result = validateFile(fileOf('frog.stl', SOFT_CAP_BYTES + 1));
    expect(result).toMatchObject({ kind: 'stl' });
    expect(result).toHaveProperty('warning');
  });
});

describe('errorMessageFor', () => {
  it('explains a watchdog timeout without blaming the user', () => {
    const message = errorMessageFor(new RepairTimeoutError('repair'));
    expect(message).toMatch(/too long|stopped responding/i);
    expect(message).toMatch(/complex|large/i);
  });

  it('surfaces the engine message on a repair failure', () => {
    expect(errorMessageFor(new RepairFailedError('mesh too small'))).toMatch(/mesh too small/);
  });

  it('names the load failure when the engine never came up', () => {
    expect(errorMessageFor(new EngineLoadError())).toMatch(/engine failed to load/i);
  });

  it('falls back to a generic message for an unknown throw', () => {
    expect(errorMessageFor('boom')).toMatch(/something went wrong/i);
  });
});

describe('downloadLabel', () => {
  it('names the file repaired only when the repair passed', () => {
    expect(downloadLabel(true)).toBe('Download repaired STL');
  });

  it('never says "repaired" when the repair did not pass', () => {
    expect(downloadLabel(false).toLowerCase()).not.toContain('repaired');
  });
});
