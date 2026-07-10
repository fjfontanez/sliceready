export function repairedFileName(originalName: string): string {
  const dot = originalName.lastIndexOf('.');
  const stem = dot > 0 ? originalName.slice(0, dot) : originalName;
  return `${stem}-repaired.stl`;
}

export function downloadStl(stl: Uint8Array, fileName: string): void {
  // TypeScript 5.9 narrowed BlobPart to ArrayBufferView<ArrayBuffer>, and a bare
  // Uint8Array infers as Uint8Array<ArrayBufferLike> — which admits
  // SharedArrayBuffer and so no longer satisfies it. We never create one (no
  // threads, no SharedArrayBuffer, no COOP/COEP), so the cast is sound. Casting
  // beats `stl.slice()`, which would copy a buffer that can be ~94 MB.
  const url = URL.createObjectURL(new Blob([stl as BlobPart], { type: 'model/stl' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // The blob can be tens of megabytes, so it must be released — but NOT in this
  // same task. Revoking synchronously after click() races the browser's own
  // fetch of the blob URL and can cancel the download outright. One tick later
  // the download has started and the URL is safe to drop.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
