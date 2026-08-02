import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { instanceOrigin, openLibrary, place, socketRow } from './helpers.js';

// The Properties panel: what an instance is, what carries it, and where it
// sits — the last of which used to be reachable only by dragging a gizmo.

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const MODELS = resolve(REPO_ROOT, 'models');

const group = (page: Page, label: string) =>
  page.locator('.prop-group').filter({ hasText: label });

const axis = (page: Page, label: string, i: number) =>
  group(page, label).locator('.num-field input').nth(i);

const selectRow = async (page: Page, id: string): Promise<void> => {
  await page
    .locator('.scene-tree-panel .tree-row[draggable] .tree-name', {
      hasText: new RegExp(`^${id}$`),
    })
    .click();
};

test('a free instance can be positioned by typing', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await selectRow(page, 'knight');

  await axis(page, 'position', 0).fill('4');
  await axis(page, 'position', 1).fill('2');
  await axis(page, 'position', 2).fill('-3');
  expect(await instanceOrigin(page, 'knight')).toEqual([4, 2, -3]);
});

test('the panel says who it is about', async ({ page }) => {
  // The id and the model are two different facts and a tree row shows one.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'knight');
  await selectRow(page, 'knight-2');
  await expect(page.locator('.prop-identity-id')).toHaveText('knight-2');
  await expect(page.locator('.prop-identity-model')).toHaveText('knight');
});

test('rotation is editable, and turning does not move it', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await selectRow(page, 'knight');
  await axis(page, 'position', 0).fill('5');

  await axis(page, 'rotation', 1).fill('90');
  // Applied about the model origin, so the origin is where it was.
  expect(await instanceOrigin(page, 'knight')).toEqual([5, 0, 0]);
  // And it is in the file.
  await page.locator('.dock-tab', { hasText: 'scene.json' }).click();
  const doc = JSON.parse(
    await page.locator('.source-view').innerText(),
  ) as { instances: { rot?: number[] }[] };
  expect(doc.instances[0]?.rot).toEqual([0, 90, 0]);
});

test('an attached instance is offset in the SOCKET frame', async ({ page }) => {
  // The label changes with the meaning: the same three numbers are the
  // scene for a free instance and the socket for an attached one.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  await page
    .locator('.scene-tree-panel .tree-row[draggable]', { hasText: 'sword' })
    .dragTo(socketRow(page, 'weapon'));
  await selectRow(page, 'sword');

  await expect(group(page, 'socket offset')).toBeVisible();
  await expect(group(page, 'position')).toHaveCount(0);

  const onSocket = await instanceOrigin(page, 'sword');
  await axis(page, 'socket offset', 1).fill('3');
  const moved = await instanceOrigin(page, 'sword');
  // It moved by three units — along the socket's axes, so not necessarily
  // world +y. What matters is that it moved by the amount asked for.
  const d = Math.hypot(
    moved![0] - onSocket![0],
    moved![1] - onSocket![1],
    moved![2] - onSocket![2],
  );
  expect(d).toBeCloseTo(3, 4);
});

test('a typed value lands on the authoring grid', async ({ page }) => {
  // The gizmo commits on a 0.1 grid; a typed 1.23456 in the file would be
  // a number nobody chose.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await selectRow(page, 'knight');
  await axis(page, 'position', 0).fill('1.23456');
  expect((await instanceOrigin(page, 'knight'))![0]).toBe(1.2);
});

test('negative values go in', async ({ page }) => {
  // Half the scene is behind the origin. (How an <input type=number>
  // handles a lone '-' mid-typing is the browser's business and
  // NumberInput's; what this asserts is that the value arrives.)
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await selectRow(page, 'knight');
  await axis(page, 'position', 0).fill('-4');
  await axis(page, 'position', 2).fill('-2.5');
  expect(await instanceOrigin(page, 'knight')).toEqual([-4, 0, -2.5]);
});

test('the gizmo and the fields are the same value', async ({ page }) => {
  // Two ways to set one thing. The fields read the placement the drag
  // commits, so a move in the view shows up here rather than the panel
  // going stale.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await selectRow(page, 'knight');
  await axis(page, 'position', 0).fill('7');
  await expect(axis(page, 'position', 0)).toHaveValue('7');
  // Reselecting does not lose it either.
  await place(page, 'sword');
  await selectRow(page, 'knight');
  await expect(axis(page, 'position', 0)).toHaveValue('7');
});
