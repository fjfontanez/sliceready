// Independent manifold verifier. Welds coincident vertices using a
// tolerance-sized spatial hash grid, then classifies DIRECTED edges by how
// many triangles use them and in which direction: undirected incidence 1 =
// open (hole/boundary), undirected incidence 2 with opposite directions =
// healthy manifold edge, undirected incidence 2 with the SAME direction twice
// = flipped (inverted/inconsistent winding), undirected incidence >2 = complex.
export function analyzeManifold(mesh, { tolerance = 1e-4 } = {}) {
  const { vertProperties, triVerts } = mesh;
  const vertexCount = vertProperties.length / 3;
  const canonical = new Uint32Array(vertexCount);

  // Weld by spatial hashing on a tolerance-sized grid, but — critically — also
  // check the 26 neighboring cells (not just the vertex's own cell) for an
  // existing representative within `tolerance`. Checking only the exact cell
  // misses coincident vertices that straddle a cell boundary.
  const grid = new Map(); // cellKey -> [{ id, x, y, z }]
  const cellOf = (v) => Math.floor(v / tolerance);
  const cellKey = (cx, cy, cz) => `${cx},${cy},${cz}`;
  const repPosition = []; // canonical id -> { x, y, z } of its welded representative

  let nextId = 0;
  for (let i = 0; i < vertexCount; i++) {
    const x = vertProperties[i * 3];
    const y = vertProperties[i * 3 + 1];
    const z = vertProperties[i * 3 + 2];
    const cx = cellOf(x), cy = cellOf(y), cz = cellOf(z);

    let foundId = -1;
    for (let dx = -1; dx <= 1 && foundId === -1; dx++) {
      for (let dy = -1; dy <= 1 && foundId === -1; dy++) {
        for (let dz = -1; dz <= 1 && foundId === -1; dz++) {
          const bucket = grid.get(cellKey(cx + dx, cy + dy, cz + dz));
          if (!bucket) continue;
          for (const rep of bucket) {
            if (Math.hypot(x - rep.x, y - rep.y, z - rep.z) <= tolerance) { foundId = rep.id; break; }
          }
        }
      }
    }

    if (foundId === -1) {
      foundId = nextId++;
      const key = cellKey(cx, cy, cz);
      let bucket = grid.get(key);
      if (!bucket) { bucket = []; grid.set(key, bucket); }
      bucket.push({ id: foundId, x, y, z });
      repPosition.push({ x, y, z }); // canonical id -> its first-seen (welded) position
    }
    canonical[i] = foundId;
  }

  // Classify DIRECTED edges: a properly wound 2-manifold edge is used exactly
  // once in each direction by its two adjacent triangles. `forward`/`backward`
  // track, per undirected edge, how many triangles traversed it in each
  // direction — this is what lets us detect flipped/inconsistent normals,
  // which raw undirected incidence counting cannot see. Degenerate triangles
  // are filtered out entirely before this is ever called (see the triangle
  // loop below), so `a`/`b` here are always guaranteed distinct.
  const forward = new Map();
  const backward = new Map();
  const bumpDirected = (a, b) => {
    if (a < b) forward.set(`${a}_${b}`, (forward.get(`${a}_${b}`) || 0) + 1);
    else backward.set(`${b}_${a}`, (backward.get(`${b}_${a}`) || 0) + 1);
  };

  const triangles = triVerts.length / 3;
  let degenerateTriangles = 0;
  // Independent enclosed-volume estimate via the divergence theorem: summing
  // (1/6) * dot(p0, cross(p1, p2)) over every triangle's welded corner
  // positions gives the signed volume of the mesh regardless of the engine's
  // own self-reported volume. A degenerate (collapsed-corner) triangle has
  // zero area and contributes exactly 0 to this sum (dot(v, cross(v, w)) === 0),
  // so it is safe to include here
  // even though it is excluded from directed-edge accounting below.
  let signedVolume = 0;
  for (let t = 0; t < triangles; t++) {
    const a = canonical[triVerts[t * 3]];
    const b = canonical[triVerts[t * 3 + 1]];
    const c = canonical[triVerts[t * 3 + 2]];

    const p0 = repPosition[a];
    const p1 = repPosition[b];
    const p2 = repPosition[c];
    signedVolume += (
      p0.x * (p1.y * p2.z - p1.z * p2.y)
      - p0.y * (p1.x * p2.z - p1.z * p2.x)
      + p0.z * (p1.x * p2.y - p1.y * p2.x)
    ) / 6;

    if (a === b || b === c || c === a) {
      // Zero-area (collapsed-corner) triangle: it contributes no valid face
      // incidence to any edge, so all three of its directed edges are
      // skipped entirely rather than corrupting the incidence count of a
      // real edge it happens to share a pair of ids with.
      degenerateTriangles++;
      continue;
    }
    bumpDirected(a, b); bumpDirected(b, c); bumpDirected(c, a);
  }

  let openEdges = 0;
  let complexEdges = 0;
  let flippedEdges = 0;
  const keys = new Set([...forward.keys(), ...backward.keys()]);
  for (const key of keys) {
    const f = forward.get(key) || 0;
    const b = backward.get(key) || 0;
    const total = f + b;
    if (total === 1) openEdges++;
    else if (total > 2) complexEdges++;
    else if (total === 2 && (f === 2 || b === 2)) flippedEdges++; // both uses same direction = orientation defect
  }

  return {
    openEdges,
    complexEdges,
    flippedEdges,
    nonManifoldEdges: openEdges + complexEdges + flippedEdges,
    weldedVertices: nextId,
    triangles,
    degenerateTriangles,
    signedVolume,
  };
}

// Bounding-box diagonal — used by callers to derive a scale-relative
// tolerance for analyzeManifold. Shared here so run-admesh.mjs and
// engine.mjs (and any future consumer) don't each maintain their own copy.
export function bboxDiagonal(vertProperties) {
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < vertProperties.length; i += 3) {
    const x = vertProperties[i], y = vertProperties[i + 1], z = vertProperties[i + 2];
    if (x < mnx) mnx = x; if (x > mxx) mxx = x;
    if (y < mny) mny = y; if (y > mxy) mxy = y;
    if (z < mnz) mnz = z; if (z > mxz) mxz = z;
  }
  return Math.hypot(mxx - mnx, mxy - mny, mxz - mnz);
}
