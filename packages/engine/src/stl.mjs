// Binary STL export: 80-byte header, uint32 triangle count, then 50 bytes/
// triangle (12-byte computed facet normal + 3 * 12-byte vertices + 2-byte
// attribute). The spike parses 3MF for intake but exports repaired meshes as
// binary STL — STL remains the export format; 3MF export is a deferred
// build-phase item. This consumes the shared/indexed mesh buffer as-is: each
// triVerts entry indexes into vertProperties, so a shared vertex is written
// once per corner that references it (STL has no shared-vertex concept).
export function buildBinaryStl({ vertProperties, triVerts }) {
  const triCount = triVerts.length / 3;
  const out = new Uint8Array(84 + triCount * 50);
  const dv = new DataView(out.buffer);
  dv.setUint32(80, triCount, true);
  let o = 84;
  for (let t = 0; t < triCount; t++) {
    const i0 = triVerts[t * 3] * 3;
    const i1 = triVerts[t * 3 + 1] * 3;
    const i2 = triVerts[t * 3 + 2] * 3;
    const x0 = vertProperties[i0], y0 = vertProperties[i0 + 1], z0 = vertProperties[i0 + 2];
    const x1 = vertProperties[i1], y1 = vertProperties[i1 + 1], z1 = vertProperties[i1 + 2];
    const x2 = vertProperties[i2], y2 = vertProperties[i2 + 1], z2 = vertProperties[i2 + 2];

    // Real facet normal (not zero). Besides being correct STL, this matters
    // for ADMesh's ASCII/binary auto-detection, which scans 128 bytes
    // starting at file offset 84 (the first facet's normal + first vertex)
    // for any byte >127. Round-number coordinates (e.g. 0/10) combined with
    // an all-zero normal can leave every byte in that window <=127,
    // misdetecting the file as ASCII — ADMesh then parses 0 facets and can
    // hang. A real, non-degenerate normal avoids that failure mode.
    const ux = x1 - x0, uy = y1 - y0, uz = z1 - z0;
    const vx = x2 - x0, vy = y2 - y0, vz = z2 - z0;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) { nx /= len; ny /= len; nz /= len; }
    dv.setFloat32(o, nx, true);
    dv.setFloat32(o + 4, ny, true);
    dv.setFloat32(o + 8, nz, true);
    o += 12;

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

// Binary STL reader → unshared per-corner vertices (callers weld via tolerance).
// Mirrors buildBinaryStl's layout: 80-byte header, uint32 count, 50 bytes/triangle.
export function parseBinaryStl(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 84) {
    throw new Error('Corrupt/too-short binary STL (< 84 bytes)');
  }
  if (bytes.byteLength >= 5 &&
      String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]) === 'solid') {
    const dv0 = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const triCount0 = dv0.getUint32(80, true);
    if (bytes.byteLength !== 84 + triCount0 * 50) {
      throw new Error('ASCII STL not supported by this reader — provide a binary STL');
    }
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triCount = dv.getUint32(80, true);
  const expected = 84 + triCount * 50;
  if (bytes.byteLength < expected) {
    throw new Error(`Corrupt binary STL: expected >= ${expected} bytes, got ${bytes.byteLength}`);
  }
  const vertProperties = new Float32Array(triCount * 9);
  const triVerts = new Uint32Array(triCount * 3);
  let src = 84, vp = 0;
  for (let t = 0; t < triCount; t++) {
    src += 12; // skip normal
    for (let c = 0; c < 3; c++) {
      vertProperties[vp++] = dv.getFloat32(src, true);
      vertProperties[vp++] = dv.getFloat32(src + 4, true);
      vertProperties[vp++] = dv.getFloat32(src + 8, true);
      src += 12;
    }
    triVerts[t * 3] = t * 3; triVerts[t * 3 + 1] = t * 3 + 1; triVerts[t * 3 + 2] = t * 3 + 2;
    src += 2; // attribute byte count
  }
  return { vertProperties, triVerts };
}
