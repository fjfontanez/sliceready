import { test, expect } from '@playwright/test';
// @ts-expect-error — the engine is untyped ESM; this subpath is a declared export.
import { buildBinaryStl } from '@mesh-repair/engine/stl';

// A cube missing its top face: 10 triangles, one square hole, 4 open edges.
// 584 bytes, which clears ADMesh's hard 284-byte / 4-triangle floor. Fractional
// coordinates keep ADMesh's binary-vs-ASCII autodetection from misfiring.
//
// This is what CI runs. It exercises the same worker, the same WASM module, the
// same viewer and the same download in a real browser as the 1.88M-triangle
// fixture does — the two bugs only the e2e ever caught (an unhandled rejection
// on an unreadable file, and Vite's cold-start reload) fire at 10 triangles just
// as they do at two million. Size measures performance; the browser measures the
// wiring. Only the wiring is CI's job.
const V = [
  [0.13, 0.19, 0.07], [10.37, 0.19, 0.07], [10.37, 10.23, 0.07], [0.13, 10.23, 0.07],
  [0.13, 0.19, 10.41], [10.37, 0.19, 10.41], [10.37, 10.23, 10.41], [0.13, 10.23, 10.41],
];
const F = [
  [0, 2, 1], [0, 3, 2],
  [0, 1, 5], [0, 5, 4],
  [3, 7, 6], [3, 6, 2],
  [0, 4, 7], [0, 7, 3],
  [1, 2, 6], [1, 6, 5],
];

function holedCubeStl(): Buffer {
  const vertProperties = new Float32Array(F.length * 9);
  const triVerts = new Uint32Array(F.length * 3);
  let vp = 0;
  for (let t = 0; t < F.length; t++) {
    for (let c = 0; c < 3; c++) {
      const [x, y, z] = V[F[t][c]];
      vertProperties[vp++] = x;
      vertProperties[vp++] = y;
      vertProperties[vp++] = z;
    }
    triVerts[t * 3] = t * 3;
    triVerts[t * 3 + 1] = t * 3 + 1;
    triVerts[t * 3 + 2] = t * 3 + 2;
  }
  return Buffer.from(buildBinaryStl({ vertProperties, triVerts }));
}

test('repairs a holed mesh end to end in a real browser', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto('/');

  // No temp file: Playwright hands the bytes straight to the input, exactly as a
  // drop would. Nothing is written to disk and nothing is committed to the repo.
  await page.locator('input[type=file]').setInputFiles({
    name: 'holed-cube.stl',
    mimeType: 'model/stl',
    buffer: holedCubeStl(),
  });

  await expect(page.getByTestId('status')).toContainText('Mesh repaired', { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Download repaired STL' })).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download repaired STL' }).click();
  expect((await download).suggestedFilename()).toBe('holed-cube-repaired.stl');

  // A page error the app swallowed would otherwise pass unnoticed: the wiring
  // bugs this suite exists to catch surfaced as silent state resets, not throws.
  expect(errors).toEqual([]);
});
