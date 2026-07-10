import { repairMesh, configureAdmesh } from '@sliceready/engine';
import wasmUrl from '@sliceready/engine/wasm/admesh.wasm?url';
import type { MeshKind } from '../dropzone';

// Emscripten's loader resolves admesh.wasm from import.meta.url, which the
// bundler rewrites to the bundle's own URL. Hand it the real asset URL Vite
// emitted instead. Must run before the first repairMesh call.
configureAdmesh({ locateFile: (path: string) => (path.endsWith('.wasm') ? wasmUrl : path) });

self.onmessage = async (event: MessageEvent<{ bytes: ArrayBuffer; kind: MeshKind }>) => {
  const { bytes, kind } = event.data;
  try {
    const { stl, report, beforeMesh, afterMesh } = await repairMesh(new Uint8Array(bytes), kind, {
      // Always on: the overlay is the app's entire visual proof that a repair
      // happened. analyzeManifold caps the collected edge count internally, so
      // a catastrophically damaged mesh cannot blow up memory here.
      collectDefectEdges: true,
      onProgress: (phase: string, info: { triangles?: number }) => {
        self.postMessage({ type: 'progress', phase, triangles: info?.triangles });
      },
    });

    // Every buffer below is freshly allocated by the engine, so transferring
    // them is safe: nothing in this worker reads them afterwards.
    const transfer: Transferable[] = [
      stl.buffer,
      beforeMesh.vertProperties.buffer, beforeMesh.triVerts.buffer,
      afterMesh.vertProperties.buffer, afterMesh.triVerts.buffer,
    ];
    self.postMessage({ type: 'done', stl, report, beforeMesh, afterMesh }, transfer);
  } catch (error) {
    const failure = error as Error & { code?: string };
    // `code` survives here but not across postMessage's structured clone of an
    // Error, so it becomes an explicit field on the message.
    self.postMessage({ type: 'error', message: failure.message, code: failure.code });
  }
};
