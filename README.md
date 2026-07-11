# SliceReady

A browser-only mesh repair tool: drop in a broken STL or 3MF, get back a
printable STL. The mesh never leaves the browser — repair runs in a Web
Worker via an ADMesh WASM build.

## Tests

Before opening a pull request, run every gate at once:

```bash
.claude/skills/pre-pr-checks/assets/pre-pr.sh
```

It prints a table and exits non-zero if any gate fails. CI runs the same script.
Read the exit code, never the summary line — Vitest prints `41 passed` and exits
`1` when a promise rejected inside a fake timer with no handler attached.

Individually:

- `npm test` — engine (`node:test`) and app (Vitest) unit tests. Runs in CI.
- `npm run build -w @sliceready/web` — `tsc --noEmit && vite build`. The only
  type check there is: Vitest transpiles with esbuild and never checks types, so
  a green test run says nothing about whether the app compiles.
- `npm run test:e2e -w @sliceready/web` — Playwright, against the **production
  build**, never the dev server. Two specs:
  - `smoke.e2e.ts` builds a 10-triangle holed cube in memory and always runs.
    This is what CI runs. A real Chromium drives the real Worker and the real
    WASM module; the browser is what catches wiring bugs, and the triangle count
    only measures speed.
  - `repair.e2e.ts` needs the ~30 MB gitignored fixture
    `packages/engine/test/fixtures/tripo-broken.3mf` and **fails loudly** when it
    is absent. `SLICEREADY_SKIP_E2E=1` opts out of this spec alone — use it to
    state a limit honestly, never to reach green.

`main.ts` and `viewer.ts` have no unit tests: both construct a `WebGLRenderer`,
which happy-dom cannot provide. The e2e is their only exercise, and it covers the
happy path only.

## License

SliceReady is licensed under **GPL-2.0-or-later** — see [`LICENSE`](LICENSE).

The repair engine compiles [ADMesh](https://github.com/admesh/admesh)
(GPL-2.0-or-later) to WebAssembly; its license and a corresponding-source offer
live in [`packages/engine/wasm/`](packages/engine/wasm/). Because the shipped
WASM is a derivative of ADMesh, the project as a whole is distributed under the GPL.
