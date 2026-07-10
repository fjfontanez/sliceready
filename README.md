# mesh-repair

A browser-only mesh repair tool: drop in a broken STL or 3MF, get back a
printable STL. The mesh never leaves the browser — repair runs in a Web
Worker via an ADMesh WASM build.

## Tests

- `npm test` — engine (`node:test`) and app (Vitest) unit tests. Runs in CI.
- `npm run test:e2e -w @mesh-repair/web` — **local only.** Needs the ~32 MB
  gitignored fixture `packages/engine/test/fixtures/tripo-broken.3mf`. It fails
  loudly if the fixture is missing. Set `MESH_REPAIR_SKIP_E2E=1` to opt out on
  purpose — never let a silent skip be reported as a pass.
