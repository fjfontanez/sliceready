import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../../../packages/engine/test/fixtures/tripo-broken.3mf', import.meta.url));

// The fixture is ~32 MB and gitignored, so this suite cannot run in CI. It must
// FAIL rather than skip when the fixture is absent: a silent skip reported as a
// green run is how a broken pipeline gets mistaken for a working one. CI opts
// out explicitly with SLICEREADY_SKIP_E2E=1.
test.beforeAll(() => {
  if (process.env.SLICEREADY_SKIP_E2E === '1') test.skip(true, 'explicitly opted out via SLICEREADY_SKIP_E2E');
  if (!existsSync(FIXTURE)) {
    throw new Error(`e2e fixture missing: ${FIXTURE}. Restore it, or set SLICEREADY_SKIP_E2E=1 to opt out on purpose.`);
  }
});

test('repairs the real broken Tripo mesh and offers the STL', async ({ page }) => {
  // Surfaced to the test runner's stdout so a run's console output and page
  // errors are visible without opening a trace viewer.
  page.on('console', (msg) => console.log(`[browser:${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (error) => console.error(`[pageerror] ${error.message}`));

  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles(FIXTURE);

  await expect(page.getByTestId('status')).toContainText('Mesh repaired', { timeout: 4 * 60 * 1000 });
  await expect(page.getByRole('button', { name: 'Download repaired STL' })).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download repaired STL' }).click();
  expect((await download).suggestedFilename()).toBe('tripo-broken-repaired.stl');
});
