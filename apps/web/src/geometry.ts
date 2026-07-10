import * as THREE from 'three';
import type { MeshBuffers } from './repair-client';

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
