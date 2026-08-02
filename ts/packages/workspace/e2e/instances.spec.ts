import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  attachedNames,
  instanceNames,
  instanceOrigin,
  openLibrary,
  place,
  renderHost,
  renderMeshes,
  socketRow,
} from './helpers.js';

// The Instances panel: sockets as rows, and renaming.

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const MODELS = resolve(REPO_ROOT, 'models');

const selectRow = async (
  page: import('@playwright/test').Page,
  id: string,
): Promise<void> => {
  await row(page, id).locator('.tree-name').click();
};

const row = (page: import('@playwright/test').Page, id: string) =>
  page.locator('.scene-tree-panel .tree-row[draggable]', {
    has: page.locator('.tree-name', { hasText: new RegExp(`^${id}$`) }),
  });

test('a host shows the sockets it publishes, empty ones included', async ({
  page,
}) => {
  // What a model OFFERS (§6.12) becomes readable in the tree, not just in
  // the panel next door — and an empty socket is the row you are about to
  // drag onto.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await expect(page.locator('.scene-tree-panel .socket-name')).toHaveText([
    'weapon',
    'crest',
  ]);
});

test('a model that publishes nothing gets no socket rows', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'sword');
  await expect(page.locator('.scene-tree-panel .socket-name')).toHaveCount(0);
});

test('an attached instance keeps the same icon as a free one', async ({
  page,
}) => {
  // The icon used to change with attachment, which made it say where a row
  // SAT rather than what it WAS. Nesting under a socket says the first
  // thing already.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  const free = await row(page, 'sword').locator('.tree-icon svg').getAttribute(
    'class',
  );
  await row(page, 'sword').dragTo(socketRow(page, 'weapon'));
  await expect(attachedNames(page)).toHaveText(['sword']);
  const attached = await row(page, 'sword')
    .locator('.tree-icon svg')
    .getAttribute('class');
  expect(attached).toBe(free);
});

test('an instance can be hidden from the row, as a part can', async ({ page }) => {
  // The row's one trailing control, matching the editor's Parts tree.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  const eye = page.getByRole('button', { name: 'Hide knight' });
  await expect(eye).toHaveAttribute('aria-pressed', 'false');
  expect(await renderMeshes(page, 'knight')).toBeGreaterThan(0);

  await eye.click();
  await expect(page.getByRole('button', { name: 'Show knight' })).toBeVisible();
  // Gone from the 3D, still in the scene.
  expect(await renderMeshes(page, 'knight')).toBe(0);
  await expect(instanceNames(page)).toHaveText(['knight']);
});

test('a hidden row keeps its eye showing, so it can be found again', async ({
  page,
}) => {
  // Revealed on hover would mean hunting for the row you cannot see.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await page.getByRole('button', { name: 'Hide knight' }).click();
  await expect(page.getByRole('button', { name: 'Show knight' })).toHaveCSS(
    'opacity',
    '1',
  );
  await page.getByRole('button', { name: 'Show knight' }).click();
  expect(await renderMeshes(page, 'knight')).toBeGreaterThan(0);
});

test('hiding a host leaves what it carries on screen', async ({ page }) => {
  // Two instances, not one thing: the guest's group still hangs off the
  // host's, so the host's transform still carries it — only its own
  // meshes go.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  await row(page, 'sword').dragTo(socketRow(page, 'weapon'));
  await page.getByRole('button', { name: 'Hide knight' }).click();
  expect(await renderMeshes(page, 'knight')).toBe(0);
  expect(await renderMeshes(page, 'sword')).toBeGreaterThan(0);
  // Still hanging off the host, still up in the hand.
  expect(await renderHost(page, 'sword')).toBe('knight');
  expect((await instanceOrigin(page, 'sword'))![1]).toBeGreaterThan(10);
});

test('removing is a Properties action, not a row one', async ({ page }) => {
  // A delete revealed on hover, a pixel from a toggle, is a delete you
  // hit by accident. The editor keeps Delete part in the inspector and
  // this now matches.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await expect(
    page.getByRole('button', { name: /^Remove knight$/ }),
  ).toHaveCount(0);

  await selectRow(page, 'knight');
  await page.getByRole('button', { name: 'Remove from scene' }).click();
  await expect(instanceNames(page)).toHaveCount(0);
});

test('renaming an instance carries what is attached to it', async ({ page }) => {
  // An id is a reference: a guest names its host by one. A rename that
  // only touched the row would silently detach the sword.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  await row(page, 'sword').dragTo(socketRow(page, 'weapon'));
  const before = await instanceOrigin(page, 'sword');

  await row(page, 'knight').locator('.tree-name').dblclick();
  const field = page.getByLabel('Rename knight');
  await field.fill('hero');
  await field.press('Enter');

  await expect(instanceNames(page)).toHaveText(['hero', 'sword']);
  // Still on the socket, still in the same place.
  await expect(attachedNames(page)).toHaveText(['sword']);
  expect(await instanceOrigin(page, 'sword')).toEqual(before);
});

test('a rename to a name already taken is refused, not applied', async ({
  page,
}) => {
  // parseScene rejects duplicate ids, so accepting one would write a file
  // this app cannot read back.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  await row(page, 'sword').locator('.tree-name').dblclick();
  const field = page.getByLabel('Rename sword');
  await field.fill('knight');
  await field.press('Enter');

  // The field stays open and flags itself rather than committing.
  await expect(field).toBeVisible();
  await field.press('Escape');
  await expect(instanceNames(page)).toHaveText(['knight', 'sword']);
});

test('escape cancels a rename', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await row(page, 'knight').locator('.tree-name').dblclick();
  const field = page.getByLabel('Rename knight');
  await field.fill('hero');
  await field.press('Escape');
  await expect(instanceNames(page)).toHaveText(['knight']);
});

test('the renamed id is what gets saved', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await row(page, 'knight').locator('.tree-name').dblclick();
  const field = page.getByLabel('Rename knight');
  await field.fill('hero');
  await field.press('Enter');

  await page.locator('.dock-tab', { hasText: 'scene.json' }).click();
  const shown = await page.locator('.source-view').innerText();
  const doc = JSON.parse(shown) as { instances: { id: string; model: string }[] };
  expect(doc.instances[0]).toEqual({ id: 'hero', model: 'knight' });
});
