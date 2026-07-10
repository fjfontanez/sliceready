import type { MeshKind } from './dropzone';

export type Phase = 'parse' | 'analyze-before' | 'repair' | 'analyze-after' | 'export';

export const PHASES: readonly Phase[] = ['parse', 'analyze-before', 'repair', 'analyze-after', 'export'];

export interface MeshBuffers {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
}

export interface DefectEdges {
  open: Float32Array;
  flipped: Float32Array;
  truncated: boolean;
}

export interface ManifoldReport {
  openEdges: number;
  complexEdges: number;
  flippedEdges: number;
  nonManifoldEdges: number;
  weldedVertices: number;
  triangles: number;
  degenerateTriangles: number;
  signedVolume: number;
  defectEdges?: DefectEdges;
}

export interface Report {
  before: ManifoldReport;
  after: ManifoldReport;
  pass: boolean;
  warnings: string[];
}

export interface RepairResult {
  stl: Uint8Array;
  report: Report;
  beforeMesh: MeshBuffers;
  afterMesh: MeshBuffers;
}

// Typed against the real DOM Worker's exact event types. Under
// strictFunctionTypes handler parameters are checked CONTRAVARIANTLY: widening
// `ev` to `ErrorEvent | Event` makes a real Worker UNassignable, because its own
// handler only accepts `ErrorEvent`. Narrower here, not wider.
export interface WorkerLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
}

export class RepairTimeoutError extends Error {
  constructor(readonly phase: Phase) {
    super(`the "${phase}" phase stopped responding`);
    this.name = 'RepairTimeoutError';
  }
}

export class RepairFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepairFailedError';
  }
}

// A Worker `error` event is how a module/WASM load failure surfaces: the
// worker script or its .wasm asset failed to fetch or instantiate. It is a
// distinct user-facing state from "the engine ran and rejected this mesh".
export class EngineLoadError extends Error {
  constructor(message = 'the repair engine failed to load') {
    super(message);
    this.name = 'EngineLoadError';
  }
}

// base: fixed startup cost. perTriangle: marginal cost, so a legitimately slow
// large mesh is never mistaken for a dead one. Deliberately generous — this is
// a hang detector, not a performance budget. Calibrate against the real Tripo
// fixture (1,876,984 triangles) before changing any number here.
const BUDGETS: Record<Phase, { base: number; perTriangle: number }> = {
  'parse': { base: 5_000, perTriangle: 0.02 },
  'analyze-before': { base: 5_000, perTriangle: 0.05 },
  // The single opaque ADMesh WASM call. NO heartbeat is possible inside it
  // without instrumenting the C source, so this ceiling is the only guard.
  'repair': { base: 10_000, perTriangle: 0.10 },
  'analyze-after': { base: 5_000, perTriangle: 0.05 },
  'export': { base: 5_000, perTriangle: 0.02 },
};

export function phaseBudgetMs(phase: Phase, triangles: number): number {
  const { base, perTriangle } = BUDGETS[phase];
  // Ceil to whole milliseconds: setTimeout truncates fractional delays, and a
  // budget that silently loses its fraction is a budget nobody can reason about.
  return Math.ceil(base + perTriangle * Math.max(0, triangles));
}

// Used only for the `parse` deadline, before any real triangle count is known.
// Binary STL is exact. A 3MF is deflated XML; 12 bytes per triangle is a coarse
// floor drawn from the real fixture (32 MB zipped, ~1.88M triangles) and errs
// toward a larger estimate, i.e. a more generous deadline.
export function estimateTriangles(sizeBytes: number, kind: MeshKind): number {
  if (kind === 'stl') return Math.max(0, Math.floor((sizeBytes - 84) / 50));
  return Math.max(0, Math.floor(sizeBytes / 12));
}

export function repairInWorker(
  worker: WorkerLike,
  bytes: ArrayBuffer,
  kind: MeshKind,
  { onPhase }: { onPhase?: (phase: Phase) => void } = {},
): Promise<RepairResult> {
  return new Promise<RepairResult>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let triangles = estimateTriangles(bytes.byteLength, kind);

    const disarm = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      disarm();
      fn();
    };

    // A hung WASM call cannot be interrupted cooperatively. terminate() is the
    // only recovery, and it also reclaims the module instance, so a hang cannot
    // leak into the next repair.
    const fail = (error: Error): void => settle(() => { worker.terminate(); reject(error); });

    // Arms the deadline for the phase we just entered: the NEXT message must
    // arrive within this phase's budget, or the phase is considered dead.
    const arm = (phase: Phase): void => {
      disarm();
      timer = setTimeout(() => fail(new RepairTimeoutError(phase)), phaseBudgetMs(phase, triangles));
    };

    worker.onerror = () => fail(new EngineLoadError());

    worker.onmessage = ({ data }): void => {
      if (settled) return;
      const msg = data as { type: string; phase?: Phase; triangles?: number; message?: string } & Partial<RepairResult>;

      if (msg.type === 'progress' && msg.phase) {
        if (typeof msg.triangles === 'number') triangles = msg.triangles;
        onPhase?.(msg.phase);
        arm(msg.phase);
        return;
      }
      if (msg.type === 'done') {
        settle(() => resolve({
          stl: msg.stl!,
          report: msg.report!,
          beforeMesh: msg.beforeMesh!,
          afterMesh: msg.afterMesh!,
        }));
        return;
      }
      if (msg.type === 'error') {
        fail(new RepairFailedError(msg.message ?? 'the repair failed'));
      }
    };

    arm('parse');
    worker.postMessage({ type: 'repair', bytes, kind }, [bytes]);
  });
}

export function createRepairWorker(): Worker {
  return new Worker(new URL('./worker/repair.worker.ts', import.meta.url), { type: 'module' });
}
