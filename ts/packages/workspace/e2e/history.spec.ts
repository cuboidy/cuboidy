import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  attachedNames,
  instanceNames,
  instanceOrigin,
  openLibrary,
  place,
  socketRow,
} from './helpers.js';

// Undo/redo, and the Delete key it made safe.
//
// Every mutation is recorded except playback, which lives on the scene
// object for convenience but is not part of the document — pressing play
// is not something Ctrl+Z should take back.

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const MODELS = resolve(REPO_ROOT, 'models');
const LIBRARY = resolve(REPO_ROOT, 'ts/testdata/library');

const row = (page: Page, id: string) =>
  page.locator('.scene-tree-panel .tree-row[draggable]', {
    has: page.locator('.tree-name', { hasText: new RegExp(`^${id}$`) }),
  });

const undoBtn = (page: Page) => page.getByRole('button', { name: 'Undo' });
const redoBtn = (page: Page) => page.getByRole('button', { name: 'Redo' });

test('nothing to undo on a fresh library', async ({ page }) => {
  await openLibrary(page, MODELS);
  await expect(undoBtn(page)).toBeDisabled();
  await expect(redoBtn(page)).toBeDisabled();
});

test('placing is undoable and redoable', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await expect(undoBtn(page)).toBeEnabled();

  await undoBtn(page).click();
  await expect(instanceNames(page)).toHaveCount(0);
  await expect(redoBtn(page)).toBeEnabled();

  await redoBtn(page).click();
  await expect(instanceNames(page)).toHaveText(['knight']);
});

test('Ctrl+Z and Ctrl+Shift+Z do the same', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await page.keyboard.press('Control+z');
  await expect(instanceNames(page)).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(instanceNames(page)).toHaveText(['knight']);
});

test('an attachment comes back with everything it implied', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  await row(page, 'sword').dragTo(socketRow(page, 'weapon'));
  const onSocket = await instanceOrigin(page, 'sword');

  await page.keyboard.press('Control+z');
  await expect(attachedNames(page)).toHaveCount(0);
  expect((await instanceOrigin(page, 'sword'))![1]).toBe(0);

  await page.keyboard.press('Control+Shift+z');
  await expect(attachedNames(page)).toHaveText(['sword']);
  expect(await instanceOrigin(page, 'sword')).toEqual(onSocket);
});

test('typing a position is ONE undo, not one per keystroke', async ({ page }) => {
  // The coalescing window is what stops a number field from filling the
  // stack with a step per digit.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await row(page, 'knight').locator('.tree-name').click();
  const x = page
    .locator('.prop-group', { hasText: 'position' })
    .locator('.num-field input')
    .first();
  await x.fill('123');
  expect((await instanceOrigin(page, 'knight'))![0]).toBe(123);

  // Focus has to leave the field first: inside one, Ctrl+Z is the
  // browser's own text undo and the app keeps its hands off.
  await row(page, 'knight').locator('.tree-name').click();
  await page.keyboard.press('Control+z');
  expect((await instanceOrigin(page, 'knight'))![0]).toBe(0);
});

test('playback is not an edit', async ({ page }) => {
  // `anim` rides on the scene object but is never written to the file and
  // is not part of the document; pressing play must not become an undo
  // step, nor must Ctrl+Z take the knight back out of the scene.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await page.getByLabel('Clip').selectOption('walk');
  await page.getByRole('button', { name: 'Pause' }).click();

  await page.keyboard.press('Control+z');
  // One undo, and it went past the playback straight to the placement.
  await expect(instanceNames(page)).toHaveCount(0);
});

test('opening a scene clears the stack', async ({ page }) => {
  // Undoing across a load would restore a scene into a library that may
  // not have the models for it.
  await openLibrary(page, LIBRARY);
  await place(page, 'knight');
  await expect(undoBtn(page)).toBeEnabled();
  page.on('dialog', (d) => void d.accept());
  await page.locator('.scene-file', { hasText: 'armed.scene.json' }).click();
  await expect(undoBtn(page)).toBeDisabled();
});

test('Delete removes the selected instance, and undo brings it back', async ({
  page,
}) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  await row(page, 'sword').dragTo(socketRow(page, 'weapon'));
  await row(page, 'sword').locator('.tree-name').click();

  await page.keyboard.press('Delete');
  await expect(instanceNames(page)).toHaveText(['knight']);

  // Back, still on the socket: an id is a reference and the whole
  // document snapshot came back, not just the row.
  await page.keyboard.press('Control+z');
  await expect(attachedNames(page)).toHaveText(['sword']);
  expect((await instanceOrigin(page, 'sword'))![1]).toBeGreaterThan(10);
});

test('Backspace does the same', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await row(page, 'knight').locator('.tree-name').click();
  await page.keyboard.press('Backspace');
  await expect(instanceNames(page)).toHaveCount(0);
});

test('Delete in a text field is text editing, not scene editing', async ({
  page,
}) => {
  // The guard that matters: renaming an instance and pressing Backspace
  // must not delete it.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await row(page, 'knight').locator('.tree-name').dblclick();
  const field = page.getByLabel('Rename knight');
  await field.press('Backspace');
  await field.press('Delete');
  await expect(field).toBeVisible();
  await field.press('Escape');
  await expect(instanceNames(page)).toHaveText(['knight']);
});

test('Delete with nothing selected does nothing', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  // Clicking empty space in the 3D deselects.
  const box = (await page.locator('.scene-canvas').boundingBox())!;
  await page.mouse.click(box.x + 30, box.y + box.height - 60);
  await page.keyboard.press('Delete');
  await expect(instanceNames(page)).toHaveText(['knight']);
});
