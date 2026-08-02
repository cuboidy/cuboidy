import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { openLibrary, place, thumbnailCoverage } from './helpers.js';

// The library as cards, each with a picture of its model.
//
// Worth E2E-ing because every failure mode here is silent. The offscreen
// renderer can produce a perfectly valid, perfectly empty PNG; the <img>
// is present and its src parses either way. So the assertions are about
// PAINT, not about markup.

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const MODELS = resolve(REPO_ROOT, 'models');

test('every model card ends up with a rendered picture', async ({ page }) => {
  await openLibrary(page, MODELS);
  const cards = page.locator('.model-card');
  const count = await cards.count();
  expect(count).toBeGreaterThan(3);

  // One renderer draws them a model at a time, yielding in between, so
  // the last card's picture lands some frames after the first.
  await expect
    .poll(async () => await page.locator('.model-card-art img').count(), {
      timeout: 20_000,
    })
    .toBe(count);
});

test('a thumbnail is the model, not an empty frame', async ({ page }) => {
  await openLibrary(page, MODELS);
  await expect
    .poll(async () => await thumbnailCoverage(page, 'knight'), {
      timeout: 20_000,
    })
    // Some of the square is painted, and the model does not fill it edge
    // to edge — a fully-covered square would mean the camera ended up
    // inside the geometry.
    .toBeGreaterThan(0.04);
  expect(await thumbnailCoverage(page, 'knight')).toBeLessThan(0.9);
});

test('two different models get two different pictures', async ({ page }) => {
  // One shared renderer draws them all in sequence; a stale framebuffer
  // or a mis-keyed cache would give every card the same image.
  await openLibrary(page, MODELS);
  await expect
    .poll(async () => await page.locator('.model-card-art img').count(), {
      timeout: 20_000,
    })
    .toBeGreaterThan(3);
  const src = async (name: string) =>
    page.evaluate((wanted) => {
      const cards = [...document.querySelectorAll('.model-card')];
      const card = cards.find(
        (c) => c.querySelector('.model-card-name')?.textContent === wanted,
      );
      return card?.querySelector('img')?.getAttribute('src') ?? null;
    }, name);
  const knight = await src('knight');
  const sword = await src('sword');
  expect(knight).not.toBeNull();
  expect(knight).not.toEqual(sword);
});

test('the card is still what places a model in the scene', async ({ page }) => {
  // The list became a grid; the two gestures it carried have to survive
  // the change.
  await openLibrary(page, MODELS);
  await page.locator('.model-card-name', { hasText: /^knight$/ }).click();
  await expect(
    page.locator('.model-card', { hasText: 'knight' }).first(),
  ).toHaveClass(/selected/);
  await place(page, 'knight');
  await expect(page.locator('.scene-tree-panel .tree-name')).toHaveText([
    'knight',
  ]);
});

test('a card offers a visible way in, not just gestures', async ({ page }) => {
  // Dragging has to be guessed at and double-clicking has to be tried.
  // The + button is the one route that shows itself.
  await openLibrary(page, MODELS);
  const cell = page.locator('.model-cell', { hasText: 'knight' }).first();
  const add = cell.getByRole('button', { name: 'Add knight to the scene' });

  await expect(add).toHaveCSS('opacity', '0');
  await cell.hover();
  await expect(add).toHaveCSS('opacity', '1');
  await add.click();
  await expect(page.locator('.scene-tree-panel .tree-name')).toHaveText([
    'knight',
  ]);
});

test('the library can be used without a pointer', async ({ page }) => {
  // Drag and double-click are both mouse gestures; without the + button
  // there is no keyboard route into the scene at all.
  await openLibrary(page, MODELS);
  const add = page
    .locator('.model-cell', { hasText: 'knight' })
    .first()
    .getByRole('button', { name: 'Add knight to the scene' });

  await add.focus();
  // Focus reveals it: hidden from sight is fine, hidden from Tab is not.
  await expect(add).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  await expect(page.locator('.scene-tree-panel .tree-name')).toHaveText([
    'knight',
  ]);
});

test('the tooltip carries facts, not instructions', async ({ page }) => {
  // How to use the app does not belong somewhere you have to hover for a
  // second to read.
  await openLibrary(page, MODELS);
  const card = page.locator('.model-card', { hasText: 'knight' }).first();
  const title = await card.getAttribute('title');
  expect(title).toContain('part');
  expect(title).not.toMatch(/drag|double-click/i);
});

test('a card says whether the model can be attached to', async ({ page }) => {
  // The one fact worth keeping on the card: a model that publishes no
  // socket cannot host anything, and that decides what you reach for.
  await openLibrary(page, MODELS);
  const knight = page.locator('.model-card', { hasText: 'knight' }).first();
  const sword = page.locator('.model-card', { hasText: 'sword' }).first();
  await expect(knight.locator('.model-card-badge')).toHaveText('2');
  await expect(sword.locator('.model-card-badge')).toHaveCount(0);
});
