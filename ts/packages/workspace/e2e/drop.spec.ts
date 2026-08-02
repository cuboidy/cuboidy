import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { instanceOrigin, openLibrary, place } from './helpers.js';

// Dragging a model out of the library and onto the scene.
//
// The gesture used to be a lie: it said "put it here" and put everything
// at the origin, which made it strictly worse than the double-click it
// duplicated. These are about the position actually meaning something.

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const MODELS = resolve(REPO_ROOT, 'models');

// Playwright's dragTo dispatches real HTML5 drag events, but it only
// stops at the target's centre. The landing point is the whole subject
// here, so the steps are driven by hand.
async function dragCardTo(
  page: Page,
  model: string,
  to: { x: number; y: number },
): Promise<void> {
  const card = page.locator('.model-card', { hasText: model }).first();
  await card.hover();
  await page.mouse.down();
  // Two moves: the first starts the drag, the second is the one whose
  // coordinates the drop reads.
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.move(to.x, to.y);
  await page.mouse.up();
}

async function canvasBox(page: Page) {
  const box = await page.locator('.scene-canvas').boundingBox();
  if (box === null) throw new Error('no canvas');
  return box;
}

test('a model dropped on the ground lands where it was dropped', async ({
  page,
}) => {
  await openLibrary(page, MODELS);
  const box = await canvasBox(page);
  // Well below centre, so the ray meets the floor in front of the camera
  // rather than off toward the horizon.
  await dragCardTo(page, 'sword', {
    x: box.x + box.width * 0.62,
    y: box.y + box.height * 0.72,
  });

  await expect(page.locator('.scene-tree-panel .tree-name')).toHaveText([
    'sword',
  ]);
  const at = await instanceOrigin(page, 'sword');
  expect(at).not.toBeNull();
  // On the floor, and NOT at the origin — the old behaviour put every
  // drop at [0,0,0] regardless of where the pointer was.
  expect(at![1]).toBe(0);
  expect(Math.abs(at![0]) + Math.abs(at![2])).toBeGreaterThan(0);
  // Whole units: a scene is measured at voxel scale.
  for (const v of at!) expect(v).toBe(Math.round(v));
});

test('dropping onto a published socket attaches in one motion', async ({
  page,
}) => {
  // The action this app exists for, previously four steps: drag, find it
  // in the tree, drag onto the host, choose the socket.
  await openLibrary(page, MODELS);
  await place(page, 'knight');

  // knight's `weapon` socket is on hand-r. Find where it actually is on
  // screen rather than guessing at it.
  const at = await socketPixel(page, 'knight', 'weapon');
  expect(at).not.toBeNull();
  await dragCardTo(page, 'sword', { x: at![0], y: at![1] });

  await expect(
    page.locator('.scene-tree-panel .tree-list .tree-list .tree-name'),
  ).toHaveText('sword');
  // And it is up in the hand, not on the floor.
  expect((await instanceOrigin(page, 'sword'))![1]).toBeGreaterThan(10);
});

test('the drag layer names the target while over the view', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  const at = await socketPixel(page, 'knight', 'weapon');

  const card = page.locator('.model-card', { hasText: 'sword' }).first();
  await card.hover();
  await page.mouse.down();
  await page.mouse.move(at![0], at![1], { steps: 10 });
  await page.mouse.move(at![0], at![1]);

  // Over a socket it says which one; the 3D outline cannot name itself.
  await expect(page.locator('.drag-caption')).toContainText('weapon');
  await page.mouse.up();
});

test('the drag layer carries the model, centred on the cursor', async ({
  page,
}) => {
  await openLibrary(page, MODELS);
  const card = page.locator('.model-card', { hasText: 'knight' }).first();
  await card.hover();
  await page.mouse.down();
  // Over the Instances panel, which is not a scene drop target.
  const tree = await page.locator('.dock-leaf', { hasText: 'Instances' })
    .first().boundingBox();
  const x = tree!.x + 60;
  const y = tree!.y + 80;
  await page.mouse.move(x, y, { steps: 10 });
  await page.mouse.move(x, y);

  // The picture follows the cursor here, rather than a caption.
  const img = page.locator('.drag-layer img');
  await expect(img).toBeVisible();

  // Held, not towed by a corner. Asserted as geometry rather than as a
  // CSS declaration: a transform is only a claim about where something
  // will be, and this is the where.
  const box = (await img.boundingBox())!;
  expect(box.x + box.width / 2).toBeCloseTo(x, 0);
  expect(box.y + box.height / 2).toBeCloseTo(y, 0);
  await page.mouse.up();
});

test('the caption stays off the point it is naming', async ({ page }) => {
  // The opposite rule from the image: this one describes what is under
  // the pointer, so centring it would hide that.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  const at = await socketPixel(page, 'knight', 'weapon');

  const card = page.locator('.model-card', { hasText: 'sword' }).first();
  await card.hover();
  await page.mouse.down();
  await page.mouse.move(at![0], at![1], { steps: 10 });
  await page.mouse.move(at![0], at![1]);

  const box = (await page.locator('.drag-caption').boundingBox())!;
  expect(box.x).toBeGreaterThan(at![0]);
  expect(box.y).toBeGreaterThan(at![1]);
  await page.mouse.up();
});

test('the layer goes away when the drag does', async ({ page }) => {
  await openLibrary(page, MODELS);
  const box = await canvasBox(page);
  await dragCardTo(page, 'knight', {
    x: box.x + box.width * 0.5,
    y: box.y + box.height * 0.7,
  });
  await expect(page.locator('.drag-layer')).toHaveCount(0);
});

test('double-clicking still places at the origin', async ({ page }) => {
  // The gesture that expresses no position must not acquire one.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  expect(await instanceOrigin(page, 'knight')).toEqual([0, 0, 0]);
});

// Where a host's published socket is on screen, in page pixels. A drop
// onto a socket is AIMED, so a test proving the aim works has to know
// where to aim — and a canvas cannot be asked. The app exposes the same
// projection the drag itself uses.
async function socketPixel(
  page: Page,
  host: string,
  socket: string,
): Promise<[number, number] | null> {
  const local = await page.evaluate(
    ({ h, s }) => {
      const w = window as unknown as {
        __socketPixel?: (host: string, socket: string) => [number, number] | null;
      };
      return w.__socketPixel?.(h, s) ?? null;
    },
    { h: host, s: socket },
  );
  if (local === null) return null;
  const box = await page.locator('.scene-canvas').boundingBox();
  if (box === null) return null;
  return [box.x + local[0], box.y + local[1]];
}
