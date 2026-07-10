declare module '@mesh-repair/engine' {
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
declare module '@mesh-repair/engine/wasm/admesh.wasm?url' {
  const url: string;
  export default url;
}
