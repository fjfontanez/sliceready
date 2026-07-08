import Module from 'manifold-3d';

let wasmPromise;
async function getWasm() {
  if (!wasmPromise) {
    wasmPromise = (async () => {
      const wasm = await Module();
      wasm.setup();
      return wasm;
    })();
  }
  return wasmPromise;
}

// Tag thrown when the manifold-3d WASM engine itself fails or aborts during
// reconstruction (as opposed to a JS-level bug in this file). run.mjs uses
// this tag to print VERDICT: CRASHED instead of silently propagating a raw
// WASM abort or misreporting it as STILL BROKEN.
export class ManifoldEngineError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ManifoldEngineError';
  }
}

// Weld coincident vertices, then let manifold-3d reconstruct a guaranteed-manifold
// solid. status() reporting NoError means the engine accepted the topology; our
// independent checker (Task 2) is still the gate on the exported result.
export async function repairWithManifold(input) {
  const { Manifold, Mesh } = await getWasm();

  let mesh;
  let merged;
  let manifold;
  let out;
  let statusVal;
  try {
    mesh = new Mesh({
      numProp: 3,
      vertProperties: Float32Array.from(input.vertProperties),
      triVerts: Uint32Array.from(input.triVerts),
    });
    // merge()'s return value is captured here (not discarded) and threaded
    // back out to the caller as `merged`; run.mjs logs it alongside the
    // other engine diagnostics.
    merged = mesh.merge(); // welds coincident vertices in place (fixes unshared STL corners)
    manifold = new Manifold(mesh);
    statusVal = manifold.status();
    out = manifold.getMesh();
  } catch (err) {
    // mesh/manifold may be only partially constructed (or not constructed at
    // all) if the WASM engine aborted during Mesh construction or merge() —
    // guard both deletes rather than assuming either handle exists.
    mesh?.delete?.();
    manifold?.delete?.();
    throw new ManifoldEngineError(`manifold-3d engine failed during reconstruction: ${err.message}`, { cause: err });
  }

  // manifold.status() returns a Manifold.Error enum value (0 = NoError); this
  // spike only distinguishes NoError by name — all other codes are passed
  // through as their raw stringified value rather than mapped to a name.
  const status = typeof statusVal === 'string' ? statusVal : (statusVal?.value ?? String(statusVal));

  const result = {
    mesh: {
      vertProperties: Float32Array.from(out.vertProperties),
      triVerts: Uint32Array.from(out.triVerts),
    },
    status: status === '0' || status === 0 ? 'NoError' : String(status),
    genus: manifold.genus(),
    volume: manifold.volume(),
    merged,
  };

  manifold.delete();
  mesh.delete?.();
  return result;
}
