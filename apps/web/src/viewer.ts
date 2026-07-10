import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MESH_MATERIAL_PARAMS, toBufferGeometry, toLineGeometry } from './geometry';
import type { DefectEdges, MeshBuffers } from './repair-client';

const OPEN_EDGE_COLOR = 0xff2d2d;
const FLIPPED_EDGE_COLOR = 0xffa500;

export interface Viewer {
  show(before: MeshBuffers, after: MeshBuffers, defects?: DefectEdges): void;
  toggle(which: 'before' | 'after'): void;
  dispose(): void;
}

export function createViewer(host: HTMLElement): Viewer {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(host.clientWidth, host.clientHeight);
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));

  const camera = new THREE.PerspectiveCamera(50, host.clientWidth / host.clientHeight, 0.1, 10_000);
  const controls = new OrbitControls(camera, renderer.domElement);

  // One scene, one camera, two meshes. Sharing the camera between before and
  // after is what makes the toggle a comparison rather than two pictures.
  const group = new THREE.Group();
  scene.add(group);

  // flatShading is load-bearing, not cosmetic: the geometry built in toBufferGeometry
  // carries no normal attribute. See MESH_MATERIAL_PARAMS in geometry.ts for the
  // invariant and the test that pins it.
  const material = new THREE.MeshStandardMaterial(MESH_MATERIAL_PARAMS);
  let beforeMesh: THREE.Mesh | undefined;
  let afterMesh: THREE.Mesh | undefined;
  let overlay: THREE.Group | undefined;

  const clear = (): void => {
    for (const object of [...group.children]) {
      group.remove(object);
      object.traverse((node) => {
        if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments) {
          node.geometry.dispose();
          // The overlay builds a fresh LineBasicMaterial per show(); disposing
          // only geometry abandons one material per defect layer per file drop.
          // The shared mesh `material` is disposed once, in dispose().
          if (node.material !== material) {
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            for (const m of materials) m.dispose();
          }
        }
      });
    }
    beforeMesh = afterMesh = overlay = undefined;
  };

  const frame = (): void => {
    controls.update();
    renderer.render(scene, camera);
  };
  renderer.setAnimationLoop(frame);

  return {
    show(before, after, defects) {
      clear();

      beforeMesh = new THREE.Mesh(toBufferGeometry(before), material);
      afterMesh = new THREE.Mesh(toBufferGeometry(after), material);
      afterMesh.visible = false;
      group.add(beforeMesh, afterMesh);

      if (defects) {
        overlay = new THREE.Group();
        overlay.add(new THREE.LineSegments(toLineGeometry(defects.open), new THREE.LineBasicMaterial({ color: OPEN_EDGE_COLOR })));
        overlay.add(new THREE.LineSegments(toLineGeometry(defects.flipped), new THREE.LineBasicMaterial({ color: FLIPPED_EDGE_COLOR })));
        group.add(overlay);
      }

      // Frame the model: 14 mm of a 200 mm frog is not a useful default view.
      const box = new THREE.Box3().setFromObject(beforeMesh);
      const size = box.getSize(new THREE.Vector3()).length();
      const center = box.getCenter(new THREE.Vector3());
      controls.target.copy(center);
      camera.position.copy(center).add(new THREE.Vector3(0, 0, size * 1.5));
      camera.near = size / 100;
      camera.far = size * 100;
      camera.updateProjectionMatrix();
    },

    toggle(which) {
      if (!beforeMesh || !afterMesh) return;
      beforeMesh.visible = which === 'before';
      afterMesh.visible = which === 'after';
      // Defects belong to the broken mesh. Showing them over the repaired one
      // would claim damage that is no longer there.
      if (overlay) overlay.visible = which === 'before';
    },

    dispose() {
      renderer.setAnimationLoop(null);
      clear();
      material.dispose();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
