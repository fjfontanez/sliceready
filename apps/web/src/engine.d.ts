declare module '@sliceready/engine' {
  export interface MeshBuffers { vertProperties: Float32Array; triVerts: Uint32Array }
  export function configureAdmesh(options: { locateFile: (path: string) => string }): void;
  export function repairMesh(
    bytes: Uint8Array,
    kind: 'stl' | '3mf',
    options?: {
      collectDefectEdges?: boolean;
      onProgress?: (phase: string, info: { triangles?: number }) => void;
    },
  ): Promise<{ stl: Uint8Array; report: unknown; beforeMesh: MeshBuffers; afterMesh: MeshBuffers }>;
}
declare module '@sliceready/engine/wasm/admesh.wasm?url' {
  const url: string;
  export default url;
}

// Vite's ?raw import returns the file's bytes as a string. Declared here because
// tsc has no idea Vite does that, and index-html.test.ts reads the shipped HTML
// rather than a DOM our own code built.
declare module '*?raw' {
  const contents: string;
  export default contents;
}
