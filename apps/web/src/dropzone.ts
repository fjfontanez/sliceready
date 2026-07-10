export type MeshKind = 'stl' | '3mf';

// The product spec sets a soft cap: warn, never hard-reject. 150 MB comfortably
// clears the real 94 MB Tripo STL fixture.
export const SOFT_CAP_BYTES = 150 * 1024 * 1024;

export function isOverSoftCap(sizeBytes: number): boolean {
  return sizeBytes > SOFT_CAP_BYTES;
}

export function detectKind(fileName: string): MeshKind | null {
  const dot = fileName.lastIndexOf('.');
  // dot <= 0 rejects both "frog" (no extension) and ".stl" (all extension).
  if (dot <= 0) return null;
  const ext = fileName.slice(dot + 1).toLowerCase();
  if (ext === 'stl') return 'stl';
  if (ext === '3mf') return '3mf';
  return null;
}

export function mountDropzone(root: HTMLElement, onFile: (file: File) => void): void {
  const zone = document.createElement('div');
  zone.dataset.testid = 'dropzone';
  zone.className = 'dropzone';
  zone.innerHTML = '<p>Drop an STL or 3MF file here</p>';

  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.stl,.3mf';
  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    if (file) onFile(file);
    // Reset so re-selecting the same file fires 'change' again.
    picker.value = '';
  });

  // Without preventDefault on dragover the browser navigates away to the file.
  zone.addEventListener('dragover', (event) => event.preventDefault());
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = (event as DragEvent).dataTransfer?.files?.[0];
    if (file) onFile(file);
  });

  zone.append(picker);
  root.append(zone);
}
