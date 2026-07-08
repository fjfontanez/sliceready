// Binary STL export: 80-byte header, uint32 triangle count, then 50 bytes/
// triangle (12-byte zero normal + 3 * 12-byte vertices + 2-byte attribute).
// The spike parses 3MF for intake but exports repaired meshes as binary STL —
// STL remains the export format; 3MF export is a deferred build-phase item.
// This consumes the shared/indexed mesh buffer as-is: each triVerts entry
// indexes into vertProperties, so a shared vertex is written once per corner
// that references it (STL has no shared-vertex concept).
export function buildBinaryStl({ vertProperties, triVerts }) {
  const triCount = triVerts.length / 3;
  const out = new Uint8Array(84 + triCount * 50);
  const dv = new DataView(out.buffer);
  dv.setUint32(80, triCount, true);
  let o = 84;
  for (let t = 0; t < triCount; t++) {
    o += 12; // normal left as zero; slicers recompute
    for (let c = 0; c < 3; c++) {
      const v = triVerts[t * 3 + c] * 3;
      dv.setFloat32(o, vertProperties[v], true);
      dv.setFloat32(o + 4, vertProperties[v + 1], true);
      dv.setFloat32(o + 8, vertProperties[v + 2], true);
      o += 12;
    }
    o += 2;
  }
  return out;
}
