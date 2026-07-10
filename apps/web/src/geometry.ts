import * as THREE from 'three';
import type { MeshBuffers } from './repair-client';

export function toBufferGeometry(mesh: MeshBuffers): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.vertProperties, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.triVerts, 1));
  // Without normals the standard material renders unlit.
  geometry.computeVertexNormals();
  return geometry;
}

// `segments` is the flat [x,y,z, x,y,z, ...] vertex-pair layout produced by
// analyzeManifold's collectDefectEdges option — exactly what LineSegments reads.
export function toLineGeometry(segments: Float32Array): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(segments, 3));
  return geometry;
}
