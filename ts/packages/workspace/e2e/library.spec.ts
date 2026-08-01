import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Stage 1, first chunk: open a folder of models, list them, draw one.
//
// This is E2E rather than unit because the claim worth proving is that a
// real library folder loads AND renders. The loader is checkable in
// isolation; "the model appears on screen" is not — a 3D view can
// typecheck and produce an empty canvas.

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const MODELS = resolve(REPO_ROOT, 'models');

// Chromium exposes showDirectoryPicker, which automation cannot drive, so
// hide it to get the <input webkitdirectory> fallback the test CAN drive.
async function openLibrary(page: Page, dir: string): Promise<void> {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).showDirectoryPicker;
  });
  await page.goto('/');
  await page.setInputFiles('input[type=file]', dir);
  await expect(page.locator('.model-row').first()).toBeVisible();
}

test('the landing screen explains what to open', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.landing')).toContainText('cuboidy.json');
});

test('opening models/ lists every model in it', async ({ page }) => {
  await openLibrary(page, MODELS);
  for (const name of [
    'fox',
    'herbalist',
    'knight',
    'koi',
    'owl',
    'sword',
    'windmill',
  ]) {
    await expect(
      page.locator('.model-row-name', { hasText: new RegExp(`^${name}$`) }),
    ).toBeVisible();
  }
  // Every shipped model lints clean, so none should be flagged here — the
  // workspace agreeing with cuboidy-lint about what is wrong with a model
  // is the point of routing through core's resolveProject.
  await expect(page.locator('.model-row-warn')).toHaveCount(0);
});

test('the first model is selected and drawn', async ({ page }) => {
  await openLibrary(page, MODELS);
  await expect(page.locator('.model-row.selected .model-row-name')).toHaveText('fox');
  const canvas = page.locator('.viewport canvas');
  await expect(canvas).toBeVisible();
  // Not blank: sample the centre of the canvas and require it to differ
  // from the clear colour. An empty scene renders the background only.
  await expect
    .poll(async () => await centrePixelIsBackground(page), { timeout: 10_000 })
    .toBe(false);
});

test('selecting a model draws that one and shows its published sockets', async ({
  page,
}) => {
  await openLibrary(page, MODELS);
  await page.locator('.model-row-name', { hasText: /^knight$/ }).click();
  await expect(page.locator('.model-row.selected .model-row-name')).toHaveText(
    'knight',
  );
  // knight publishes `weapon` and `crest` (SPEC §6.12) — the attachment
  // points a scene will hook onto in the next chunk.
  await expect(page.locator('.socket-row-name')).toHaveText(['weapon', 'crest']);
  await expect(page.locator('.socket-row-target').first()).toHaveText('hand-r:grip');
  await expect
    .poll(async () => await centrePixelIsBackground(page), { timeout: 10_000 })
    .toBe(false);
});

test('a model that publishes nothing says so, rather than showing an empty list', async ({
  page,
}) => {
  await openLibrary(page, MODELS);
  await page.locator('.model-row-name', { hasText: /^sword$/ }).click();
  await expect(page.locator('.panel-detail')).toContainText('publishes no sockets');
});

// True when the canvas centre still holds the clear colour, i.e. nothing
// was drawn there.
async function centrePixelIsBackground(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.viewport canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return true;
    const gl =
      canvas.getContext('webgl2', { preserveDrawingBuffer: true }) ??
      canvas.getContext('webgl', { preserveDrawingBuffer: true });
    if (gl === null) return true;
    const px = new Uint8Array(4);
    gl.readPixels(
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      px,
    );
    // Clear colour is #14161a. Allow a little slack for colour management.
    return Math.abs(px[0]! - 0x14) < 6 && Math.abs(px[1]! - 0x16) < 6 &&
      Math.abs(px[2]! - 0x1a) < 6;
  });
}
