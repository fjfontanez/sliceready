import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { repairedFileName, downloadStl } from '../src/download';

describe('repairedFileName', () => {
  it('replaces the extension and marks the file as repaired', () => {
    expect(repairedFileName('cute+frog+3d+model.3mf')).toBe('cute+frog+3d+model-repaired.stl');
    expect(repairedFileName('frog.STL')).toBe('frog-repaired.stl');
  });

  it('handles a name with dots in it', () => {
    expect(repairedFileName('v1.2.final.stl')).toBe('v1.2.final-repaired.stl');
  });
});

describe('downloadStl', () => {
  const mockUrl = 'blob:mock-object-url';
  let createObjectURLSpy: MockInstance<typeof URL.createObjectURL>;
  let revokeObjectURLSpy: MockInstance<typeof URL.revokeObjectURL>;
  let createElementSpy: MockInstance<typeof document.createElement>;
  let clickSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue(mockUrl);
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    clickSpy = vi.fn();
    // Capture the real implementation before spying, so the mock can still
    // produce a real, fully functional anchor element — only `click` is
    // replaced, so href/download assignment behaves exactly as in the browser.
    const realCreateElement = document.createElement.bind(document);
    createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tagName: string, options?: ElementCreationOptions) => {
        const element = realCreateElement(tagName, options);
        if (tagName === 'a') {
          (element as HTMLAnchorElement).click = clickSpy;
        }
        return element;
      });
  });

  afterEach(() => {
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
    createElementSpy.mockRestore();
    vi.useRealTimers();
  });

  it('builds the Blob from the given STL bytes with the correct type and length', () => {
    const stl = new Uint8Array([1, 2, 3, 4, 5]);

    downloadStl(stl, 'frog-repaired.stl');

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    const blob = createObjectURLSpy.mock.calls[0]?.[0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('model/stl');
    expect(blob.size).toBe(stl.byteLength);
  });

  it('sets the anchor filename and href, and clicks it exactly once', () => {
    const stl = new Uint8Array([9, 9, 9]);

    downloadStl(stl, 'frog-repaired.stl');

    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    // The anchor is captured via the spy's mock results, since downloadStl
    // never exposes the element it creates.
    const anchor = createElementSpy.mock.results[0]?.value as HTMLAnchorElement;
    expect(anchor.download).toBe('frog-repaired.stl');
    expect(anchor.href).toBe(mockUrl);
  });

  it('defers the object URL revoke instead of running it synchronously', () => {
    const stl = new Uint8Array([1, 2, 3]);

    downloadStl(stl, 'frog-repaired.stl');

    // Immediately after downloadStl returns, the revoke must NOT have run yet:
    // a synchronous revoke races the browser's own fetch of the blob URL and
    // can cancel a large download outright.
    expect(revokeObjectURLSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(0);

    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith(mockUrl);
  });
});
