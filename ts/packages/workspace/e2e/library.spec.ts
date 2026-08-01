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

test('the scene starts empty and says how to fill it', async ({ page }) => {
  await openLibrary(page, MODELS);
  await expect(page.locator('.scene-hint')).toBeVisible();
  await expect(page.locator('.scene-row')).toHaveCount(0);
  // No pixel assertion here: the ground grid is drawn either way, so the
  // canvas is legitimately not blank with an empty scene.
});

test('selecting a model shows its published sockets', async ({ page }) => {
  await openLibrary(page, MODELS);
  await page.locator('.model-row-name', { hasText: /^knight$/ }).click();
  // knight publishes `weapon` and `crest` (SPEC §6.12) — the attachment
  // points a scene hooks onto.
  await expect(page.locator('.socket-row-name')).toHaveText(['weapon', 'crest']);
  await expect(page.locator('.socket-row-target').first()).toHaveText('hand-r:grip');
});

test('double-clicking a model puts it in the scene and draws it', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await expect(page.locator('.scene-row-id')).toHaveText(['knight']);
  await expect
    .poll(async () => await centrePixelIsBackground(page), { timeout: 10_000 })
    .toBe(false);
});

test('a second copy of one model gets its own id', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'knight');
  await expect(page.locator('.scene-row-id')).toHaveText(['knight', 'knight-2']);
});

test('attaching the sword to the knight nests it and moves it to the socket', async ({
  page,
}) => {
  // The join the whole design was for: knight publishes `weapon`
  // (hand-r:grip), sword was authored blind against that contract, and
  // neither model knows about the other.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');

  const before = await instanceOrigin(page, 'sword');
  await page.locator('.scene-row-id', { hasText: /^sword$/ }).click();
  await page.locator('.field', { hasText: 'attached to' }).locator('select')
    .selectOption('knight');

  // It defaults to the host's first published socket…
  await expect(
    page.locator('.field', { hasText: /^socket/ }).locator('select'),
  ).toHaveValue('weapon');
  // …the tree nests it under its host…
  await expect(page.locator('.scene-tree li li .scene-row-id')).toHaveText('sword');
  // …and it is no longer at the origin: it is up in the knight's hand.
  const after = await instanceOrigin(page, 'sword');
  expect(after).not.toEqual(before);
  expect(after![1]).toBeGreaterThan(10); // grip height, not the floor
});

test('detaching returns it to the scene root', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  await page.locator('.scene-row-id', { hasText: /^sword$/ }).click();
  const attachTo = page.locator('.field', { hasText: 'attached to' }).locator('select');
  await attachTo.selectOption('knight');
  await expect(page.locator('.scene-tree li li')).toHaveCount(1);
  await attachTo.selectOption('');
  await expect(page.locator('.scene-tree li li')).toHaveCount(0);
  expect((await instanceOrigin(page, 'sword'))![1]).toBe(0);
});

test('removing a host detaches what it carried rather than deleting it', async ({
  page,
}) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  await page.locator('.scene-row-id', { hasText: /^sword$/ }).click();
  await page.locator('.field', { hasText: 'attached to' }).locator('select')
    .selectOption('knight');
  await page.getByRole('button', { name: 'Remove knight' }).click();
  // The sword survives, at the scene root.
  await expect(page.locator('.scene-row-id')).toHaveText(['sword']);
});

test('a model that publishes nothing says so, rather than showing an empty list', async ({
  page,
}) => {
  await openLibrary(page, MODELS);
  await page.locator('.model-row-name', { hasText: /^sword$/ }).click();
  await expect(page.locator('.panel-detail')).toContainText('publishes no sockets');
});

async function place(page: Page, model: string): Promise<void> {
  await page.locator('.model-row-name', { hasText: new RegExp(`^${model}$`) })
    .dblclick();
  await expect(
    page.locator('.scene-row-id', { hasText: new RegExp(`^${model}`) }).first(),
  ).toBeVisible();
}

// Where an instance's model origin ended up, read off the scene the app
// resolved — the only way to tell "attached" from "drawn at the origin".
async function instanceOrigin(
  page: Page,
  id: string,
): Promise<[number, number, number] | null> {
  return page.evaluate((wanted) => {
    const w = window as unknown as {
      __scene?: { instance: { id: string }; frame: { pos: [number, number, number] } }[];
    };
    const hit = w.__scene?.find((p) => p.instance.id === wanted);
    return hit === undefined ? null : hit.frame.pos;
  }, id);
}

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
