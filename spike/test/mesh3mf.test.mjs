import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { parse3mf } from '../src/mesh3mf.mjs';
import { buildBinaryStl } from '../src/stl.mjs';

// A closed tetrahedron authored as a SHARED, INDEXED mesh — exactly how 3MF
// stores geometry: 4 vertices, 4 triangles referencing them by index.
const TETRA_VERTICES = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1],
];
const TETRA_TRIANGLES = [
  [0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3],
];

// A second tetra's vertex/triangle set with a realistic negative
// high-precision decimal coordinate on vertex 0 — proves parseFloat-based
// extraction round-trips real-world 3MF coordinates, not just 0/1 integers.
const PRECISE_VERTICES = [
  [-26.025390, 0.000146, 17.584228], [1, 0, 0], [0, 1, 0], [0, 0, 1],
];

function verticesXml(vertices) {
  return vertices.map(([x, y, z]) => `<vertex y="${y}" x="${x}" z="${z}" />`).join('');
}

function trianglesXml(triangles) {
  return triangles.map(([v1, v2, v3]) => `<triangle v2="${v2}" v1="${v1}" v3="${v3}" />`).join('');
}

// Build a minimal-but-valid <object>/<mesh> block with attributes in mixed
// order to prove the parser extracts by attribute NAME, not position.
function objectXml(id, vertices, triangles) {
  return `<object id="${id}" type="model">
      <mesh>
        <vertices>${verticesXml(vertices)}</vertices>
        <triangles>${trianglesXml(triangles)}</triangles>
      </mesh>
    </object>`;
}

function tetraModelXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    ${objectXml(1, TETRA_VERTICES, TETRA_TRIANGLES)}
  </resources>
  <build><item objectid="1" /></build>
</model>`;
}

// Same shape as tetraModelXml but with TWO <object>/<mesh> blocks — a
// multi-object/multi-mesh 3MF, which this spike must reject rather than
// silently concatenate (concatenating would corrupt triangle indices across
// meshes since they'd share one vertProperties array without an offset).
function multiMeshModelXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    ${objectXml(1, TETRA_VERTICES, TETRA_TRIANGLES)}
    ${objectXml(2, TETRA_VERTICES, TETRA_TRIANGLES)}
  </resources>
  <build><item objectid="1" /><item objectid="2" /></build>
</model>`;
}

// Same shape as tetraModelXml but the <build><item> carries a `transform`
// attribute — this spike does not apply affine transforms to geometry, so
// parse3mf must reject it rather than silently returning the wrong absolute
// geometry.
function transformedItemModelXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    ${objectXml(1, TETRA_VERTICES, TETRA_TRIANGLES)}
  </resources>
  <build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0" /></build>
</model>`;
}

// One triangle references vertex index -1, which is out of range. parse3mf must
// throw rather than let Uint32Array.from wrap it to 4294967295 and emit NaN bytes
// downstream.
function negativeTriangleIndexModelXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    ${objectXml(1, TETRA_VERTICES, [[-1, 0, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]])}
  </resources>
  <build><item objectid="1" /></build>
</model>`;
}

function preciseVertexModelXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    ${objectXml(1, PRECISE_VERTICES, TETRA_TRIANGLES)}
  </resources>
  <build><item objectid="1" /></build>
</model>`;
}

// Assemble a real 3MF (zip) in-test with the parts the parser needs.
function makeThreeMf(modelXml) {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;
  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(modelXml),
  });
}

function makeTetra3mf() {
  return makeThreeMf(tetraModelXml());
}

test('parse3mf extracts indexed vertices and triangles from the model part', () => {
  const { vertProperties, triVerts } = parse3mf(makeTetra3mf());
  // Indexed — 4 shared vertices (12 floats), NOT expanded per-triangle (which
  // would be 36). 4 triangles → 12 indices.
  assert.equal(vertProperties.length, 12);
  assert.equal(triVerts.length, 12);
  // Triangle indices match the authored connectivity exactly.
  assert.deepEqual([...triVerts], [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);
  // Vertex 1 is (1,0,0): its x lives at index 3, extracted by name despite
  // the y="" attribute appearing before x="" in the XML.
  assert.equal(vertProperties[3], 1);
  assert.equal(vertProperties[4], 0);
  assert.equal(vertProperties[5], 0);
});

test('parse3mf throws when the model part is missing', () => {
  const noModel = zipSync({ '[Content_Types].xml': strToU8('<Types />') });
  assert.throws(() => parse3mf(noModel), /3dmodel\.model/);
});

test('parse3mf throws on a multi-object/multi-mesh 3MF (unsupported by this spike)', () => {
  const multiMesh = makeThreeMf(multiMeshModelXml());
  assert.throws(() => parse3mf(multiMesh), /multi-object|multi-mesh/);
});

test('parse3mf throws on a <build><item> carrying a transform attribute', () => {
  const transformed = makeThreeMf(transformedItemModelXml());
  assert.throws(() => parse3mf(transformed), /transform/);
});

test('parse3mf throws on a negative triangle index', () => {
  const negIdx = makeThreeMf(negativeTriangleIndexModelXml());
  assert.throws(() => parse3mf(negIdx), /negative triangle index/);
});

test('parse3mf round-trips a realistic negative high-precision decimal coordinate', () => {
  const { vertProperties } = parse3mf(makeThreeMf(preciseVertexModelXml()));
  const EPS = 1e-4; // float32 precision tolerance, well above real rounding error
  assert.ok(
    Math.abs(vertProperties[0] - -26.02539) < EPS,
    `expected x≈-26.025390, got ${vertProperties[0]}`,
  );
  assert.ok(
    Math.abs(vertProperties[1] - 0.000146) < EPS,
    `expected y≈0.000146, got ${vertProperties[1]}`,
  );
  assert.ok(
    Math.abs(vertProperties[2] - 17.584228) < EPS,
    `expected z≈17.584228, got ${vertProperties[2]}`,
  );
});

test('buildBinaryStl serializes an indexed mesh to the expected byte length', () => {
  // Author an indexed mesh directly (same shape parse3mf produces) and confirm
  // the STL export path is exactly 84 + 50 * triCount bytes.
  const mesh = {
    vertProperties: Float32Array.from(TETRA_VERTICES.flat()),
    triVerts: Uint32Array.from(TETRA_TRIANGLES.flat()),
  };
  const stl = buildBinaryStl(mesh);
  const triCount = mesh.triVerts.length / 3;
  assert.equal(stl.length, 84 + 50 * triCount);
});
