import { describe, it, expect, vi } from 'vitest';
import { detectKind, isOverSoftCap, SOFT_CAP_BYTES, mountDropzone } from '../src/dropzone';

describe('detectKind', () => {
  it('recognizes stl and 3mf regardless of case', () => {
    expect(detectKind('frog.stl')).toBe('stl');
    expect(detectKind('FROG.STL')).toBe('stl');
    expect(detectKind('cute+frog+3d+model.3mf')).toBe('3mf');
    expect(detectKind('frog.3MF')).toBe('3mf');
  });

  it('returns null for anything else', () => {
    expect(detectKind('frog.obj')).toBeNull();
    expect(detectKind('frog')).toBeNull();
    expect(detectKind('frog.stl.zip')).toBeNull();
    expect(detectKind('.stl')).toBeNull();
  });
});

describe('isOverSoftCap', () => {
  it('is exclusive at the cap', () => {
    expect(isOverSoftCap(SOFT_CAP_BYTES)).toBe(false);
    expect(isOverSoftCap(SOFT_CAP_BYTES + 1)).toBe(true);
  });
});

describe('mountDropzone', () => {
  it('hands the dropped file to the caller and cancels the browser default', () => {
    const root = document.createElement('div');
    const onFile = vi.fn();
    mountDropzone(root, onFile);

    const file = new File([new Uint8Array([1, 2, 3])], 'frog.stl');
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } });
    root.querySelector('[data-testid="dropzone"]')!.dispatchEvent(event);

    expect(onFile).toHaveBeenCalledWith(file);
    expect(event.defaultPrevented).toBe(true);
  });
});
