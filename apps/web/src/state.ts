import { detectKind, isOverSoftCap, type MeshKind } from './dropzone';
import { RepairFailedError, RepairTimeoutError, EngineLoadError, type Phase, type RepairResult } from './repair-client';

export type AppState =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'repairing'; phase: Phase }
  | { kind: 'done'; result: RepairResult; fileName: string }
  | { kind: 'error'; message: string };

export type Validation =
  | { kind: MeshKind }
  | { kind: MeshKind; warning: string }
  | { error: string };

// A soft cap warns; it never hard-rejects. The user knows their machine.
export function validateFile(file: File): Validation {
  const kind = detectKind(file.name);
  if (!kind) return { error: `"${file.name}" is not a mesh we can read. Drop an STL or 3MF file.` };
  if (isOverSoftCap(file.size)) {
    return { kind, warning: 'This model is large. Repair may take a while and use a lot of memory.' };
  }
  return { kind };
}

export function errorMessageFor(error: unknown): string {
  if (error instanceof EngineLoadError) {
    return 'The repair engine failed to load. Check your connection and reload the page.';
  }
  if (error instanceof RepairTimeoutError) {
    return 'The repair took too long and was stopped. This model may be too large or too complex for your browser.';
  }
  if (error instanceof RepairFailedError) return error.message;
  return 'Something went wrong. Try reloading the page.';
}

// The honest-reporting rule reaches the button, not just the headline: a mesh that
// did not pass is not a "repaired" mesh, whatever the file is called. Pure and
// exported so a test can hold it to that — main.ts cannot be unit-tested (it
// constructs a WebGLRenderer).
export function downloadLabel(ok: boolean): string {
  return ok ? 'Download repaired STL' : 'Download result';
}

export function phaseLabel(phase: Phase): string {
  const labels: Record<Phase, string> = {
    'parse': 'Reading the mesh…',
    'analyze-before': 'Finding the defects…',
    'repair': 'Repairing…',
    'analyze-after': 'Checking the result…',
    'export': 'Writing the STL…',
  };
  return labels[phase];
}
