import * as THREE from 'three';
import type { MeshBuffers } from './repair-client';

// The mesh material lives here, next to the geometry it must match. toBufferGeometry
// emits no `normal` attribute, so flatShading is a correctness requirement, not a
// style choice: MeshStandardMaterial without normals AND without flat shading renders
// unlit. Pinned by a test, because viewer.ts needs a WebGL context and cannot be one.
export const MESH_MATERIAL_PARAMS: THREE.MeshStandardMaterialParameters = {
  color: 0x9bb7d4,
  flatShading: true,
};

export function toBufferGeometry(mesh: MeshBuffers): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.vertProperties, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.triVerts, 1));
  // No vertex-normal pass here: the viewer's material sets flatShading, and under
  // FLAT_SHADED three.js ignores the normal attribute entirely, recomputing the
  // normal from screen-space derivatives in the fragment shader. Computing it here
  // would walk ~5.6M vertices per mesh on the real fixture and discard the result.
  // This is only safe while the material keeps flatShading: true — without both,
  // MeshStandardMaterial renders unlit.
  return geometry;
}

// `segments` is the flat [x,y,z, x,y,z, ...] vertex-pair layout produced by
// analyzeManifold's collectDefectEdges option — exactly what LineSegments reads.
export function toLineGeometry(segments: Float32Array): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(segments, 3));
  return geometry;
}
