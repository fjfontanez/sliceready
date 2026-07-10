import createAdmesh from '../wasm/admesh.mjs';
import { buildBinaryStl, parseBinaryStl } from './stl.mjs';

export class AdmeshEngineError extends Error {
  constructor(message) { super(message); this.name = 'AdmeshEngineError'; }
}

let modPromise;
function getModule() {
  // Instantiate the Emscripten module once and reuse it.
  if (!modPromise) modPromise = createAdmesh();
  return modPromise;
}

// Monotonic counter for MEMFS paths. The module instance (and its MEMFS) is
// cached and reused across calls (see getModule above); a hardcoded
// /in.stl, /out.stl pair would let concurrent repairWithAdmesh calls clobber
// each other's files. A simple counter is enough — this only needs to be
// collision-proof against ourselves, not cryptographically unique.
let callCounter = 0;

// ADMesh's stl_count_facets() enforces a hard STL_MIN_FILE_SIZE = 284 bytes
// (84-byte header + 4 triangles * 50 bytes each) and sets stl->error before
// stl_repair ever runs on anything smaller. Reject undersized/malformed
// input HERE, before it ever reaches MEMFS/ccall — this keeps doomed inputs
// out of ADMesh entirely, which also sidesteps the fp-handle leak on
// stl_open's error path (see repair_wrapper.c and the RESIDUAL note in
// Global Constraints) for this common case.
function assertRepairableStlSize(stlBytes) {
  if (stlBytes.length < 284 || (stlBytes.length - 84) % 50 !== 0) {
    throw new AdmeshEngineError('mesh too small or malformed for ADMesh (< 4 triangles / wrong size)');
  }
}

// Repairs a mesh buffer by round-tripping binary STL through ADMesh (WASM) via
// MEMFS. Input/output are the shared { vertProperties, triVerts } shape.
export async function repairWithAdmesh(input) {
  const Mod = await getModule();
  const n = callCounter++;
  const inPath = `/in-${n}.stl`;
  const outPath = `/out-${n}.stl`;
  const stlBytes = buildBinaryStl(input);
  assertRepairableStlSize(stlBytes);
  Mod.FS.writeFile(inPath, stlBytes);

  const rc = Mod.ccall('repair', 'number', ['string', 'string'], [inPath, outPath]);
  if (rc !== 0) {
    try { Mod.FS.unlink(inPath); } catch { /* ignore */ }
    try { Mod.FS.unlink(outPath); } catch { /* ignore */ }
    throw new AdmeshEngineError(`ADMesh repair failed (rc=${rc})`);
  }

  // try/finally so a thrown parseBinaryStl (e.g. truncated/malformed ADMesh
  // output) still unlinks both per-call MEMFS files, instead of leaking them
  // on the parse-error path.
  try {
    const outBytes = Mod.FS.readFile(outPath); // Uint8Array
    const mesh = parseBinaryStl(outBytes);
    return { mesh, ok: true };
  } finally {
    try { Mod.FS.unlink(inPath); } catch { /* ignore */ }
    try { Mod.FS.unlink(outPath); } catch { /* ignore */ }
  }
}
