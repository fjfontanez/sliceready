import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  repairInWorker,
  phaseBudgetMs,
  estimateTriangles,
  RepairTimeoutError,
  RepairFailedError,
  EngineLoadError,
  PHASES,
  type WorkerLike,
} from '../src/repair-client';

class FakeWorker implements WorkerLike {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  posted: unknown[] = [];
  terminated = 0;
  postMessage(msg: unknown): void { this.posted.push(msg); }
  terminate(): void { this.terminated++; }
  emit(data: unknown): void { this.onmessage?.({ data } as MessageEvent); }
  crash(): void { this.onerror?.(new ErrorEvent('error')); }
}

const DONE = {
  type: 'done',
  stl: new Uint8Array([1, 2, 3]),
  report: { before: {}, after: {}, pass: true, warnings: [] },
  beforeMesh: { vertProperties: new Float32Array(), triVerts: new Uint32Array() },
  afterMesh: { vertProperties: new Float32Array(), triVerts: new Uint32Array() },
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// `arm()`'s setTimeout rejects this promise while fake timers advance, one
// microtask before `expect(...).rejects` can attach its handler. Node's
// unhandled-rejection tracker fires in that window and vitest exits 1 even
// though every assertion passes. An inert handler attached at creation closes
// the window without changing what the promise settles to.
const started = <T>(promise: Promise<T>): Promise<T> => {
  promise.catch(() => {});
  return promise;
};

// Stated limitation: the timeout tests below compute their expected deadline by
// calling phaseBudgetMs() themselves — a self-referential oracle. If the budget
// formula were gutted to a constant, those tests would still pass; only the two
// tests in THIS block would catch it. Keep them.
describe('phaseBudgetMs', () => {
  it('grows with triangle count so a big mesh is not mistaken for a dead one', () => {
    expect(phaseBudgetMs('repair', 2_000_000)).toBeGreaterThan(phaseBudgetMs('repair', 10));
  });

  it('gives every phase a positive budget at zero triangles', () => {
    for (const phase of PHASES) expect(phaseBudgetMs(phase, 0)).toBeGreaterThan(0);
  });
});

describe('estimateTriangles', () => {
  it('derives the exact triangle count from a binary STL size', () => {
    expect(estimateTriangles(84 + 50 * 12, 'stl')).toBe(12);
  });

  it('never returns a negative estimate for a truncated file', () => {
    expect(estimateTriangles(10, 'stl')).toBe(0);
  });
});

describe('repairInWorker', () => {
  it('resolves when every phase reports in and the worker is done', async () => {
    const worker = new FakeWorker();
    const seen: string[] = [];
    const promise = repairInWorker(worker, new ArrayBuffer(884), 'stl', {
      onPhase: (p) => seen.push(p),
    });

    for (const phase of PHASES) worker.emit({ type: 'progress', phase, triangles: 16 });
    worker.emit(DONE);

    await expect(promise).resolves.toMatchObject({ report: { pass: true } });
    expect(seen).toEqual([...PHASES]);
    expect(worker.terminated).toBe(0);
  });

  it('terminates the worker and reports the hung phase when a deadline expires', async () => {
    const worker = new FakeWorker();
    const promise = started(repairInWorker(worker, new ArrayBuffer(884), 'stl'));

    worker.emit({ type: 'progress', phase: 'parse', triangles: undefined });
    worker.emit({ type: 'progress', phase: 'analyze-before', triangles: 16 });
    worker.emit({ type: 'progress', phase: 'repair', triangles: 16 });
    // ADMesh hangs: no further heartbeat ever arrives.
    await vi.advanceTimersByTimeAsync(phaseBudgetMs('repair', 16) + 1);

    await expect(promise).rejects.toBeInstanceOf(RepairTimeoutError);
    await expect(promise).rejects.toMatchObject({ phase: 'repair' });
    expect(worker.terminated).toBe(1);
  });

  it('does not fire a stale deadline after the previous phase reported in', async () => {
    const worker = new FakeWorker();
    const promise = repairInWorker(worker, new ArrayBuffer(884), 'stl');

    worker.emit({ type: 'progress', phase: 'parse', triangles: undefined });
    await vi.advanceTimersByTimeAsync(phaseBudgetMs('parse', 16) - 1);
    worker.emit({ type: 'progress', phase: 'analyze-before', triangles: 16 });
    await vi.advanceTimersByTimeAsync(2);

    expect(worker.terminated).toBe(0);
    worker.emit(DONE);
    await expect(promise).resolves.toBeDefined();
  });

  it('rejects and terminates when the worker reports an engine error', async () => {
    const worker = new FakeWorker();
    const promise = started(repairInWorker(worker, new ArrayBuffer(884), 'stl'));
    worker.emit({ type: 'error', message: 'mesh too small or malformed for ADMesh' });

    await expect(promise).rejects.toBeInstanceOf(RepairFailedError);
    await expect(promise).rejects.toThrow(/too small/);
    expect(worker.terminated).toBe(1);
  });

  it('reports an engine load failure when the worker fires an error event', async () => {
    const worker = new FakeWorker();
    const promise = started(repairInWorker(worker, new ArrayBuffer(884), 'stl'));
    worker.crash();

    await expect(promise).rejects.toBeInstanceOf(EngineLoadError);
    expect(worker.terminated).toBe(1);
  });

  it('ignores messages that arrive after it has settled', async () => {
    const worker = new FakeWorker();
    const promise = started(repairInWorker(worker, new ArrayBuffer(884), 'stl'));
    worker.emit({ type: 'error', message: 'boom' });
    await expect(promise).rejects.toBeInstanceOf(RepairFailedError);

    worker.emit(DONE);
    expect(worker.terminated).toBe(1);
  });

  it('arms no timer once settled', async () => {
    const worker = new FakeWorker();
    const promise = repairInWorker(worker, new ArrayBuffer(884), 'stl');
    for (const phase of PHASES) worker.emit({ type: 'progress', phase, triangles: 16 });
    worker.emit(DONE);
    await promise;

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(worker.terminated).toBe(0);
  });
});
