import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { instanceNames, openLibrary, place } from './helpers.js';

// Which scene you are editing, and saving it.
//
// The panel used to be a name field, an Open dropdown and a Save button.
// The name field WAS the filename, so editing it and saving wrote a
// different file and left the original untouched — which looks exactly
// like saving until you go and look in the folder.

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const MODELS = resolve(REPO_ROOT, 'models');
const LIBRARY = resolve(REPO_ROOT, 'ts/testdata/library');

const doc = (page: import('@playwright/test').Page) =>
  page.locator('.scene-doc');

test('an unsaved scene says so, and Save asks where', async ({ page }) => {
  await openLibrary(page, MODELS);
  await expect(doc(page).locator('.scene-doc-name')).toHaveText('untitled');
  // Nothing in it yet, so nothing to save.
  await expect(doc(page).locator('.scene-doc-dirty')).toHaveCount(0);

  await place(page, 'knight');
  await expect(doc(page).locator('.scene-doc-dirty')).toHaveCount(1);

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByLabel('Save scene as')).toBeVisible();
});

test('opening a scene shows its file, and it is not dirty', async ({ page }) => {
  await openLibrary(page, LIBRARY);
  await page.locator('.scene-file', { hasText: 'armed.scene.json' }).click();
  await expect(doc(page).locator('.scene-doc-name')).toHaveText(
    'armed.scene.json',
  );
  // Freshly opened is freshly saved. The comparison is against the
  // SERIALIZATION of what was parsed, so a hand-formatted file — or one
  // still carrying the old `name` — does not read as modified on sight.
  await expect(doc(page).locator('.scene-doc-dirty')).toHaveCount(0);
});

test('editing an opened scene marks it dirty', async ({ page }) => {
  await openLibrary(page, LIBRARY);
  await page.locator('.scene-file', { hasText: 'armed.scene.json' }).click();
  await place(page, 'sword');
  await expect(doc(page).locator('.scene-doc-dirty')).toHaveCount(1);
});

test('the current file is marked in the list', async ({ page }) => {
  await openLibrary(page, LIBRARY);
  const armed = page.locator('.scene-file', { hasText: 'armed.scene.json' });
  await expect(armed).not.toHaveClass(/current/);
  await armed.click();
  await expect(armed).toHaveClass(/current/);
});

test('Save writes back to the file it came from, not a new one', async ({
  page,
}) => {
  // The bug the name field caused: identity was the typed name, so the
  // scene could be saved somewhere other than where it was opened.
  await openLibrary(page, LIBRARY);
  await page.locator('.scene-file', { hasText: 'armed.scene.json' }).click();
  await place(page, 'sword');

  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const saved = await dl;
  expect(saved.suggestedFilename()).toBe('armed.scene.json');
  // No prompt: it knew where to go.
  await expect(page.getByLabel('Save scene as')).toHaveCount(0);
  await expect(doc(page).locator('.scene-doc-dirty')).toHaveCount(0);
});

test('Save as… is how a scene gets a different file', async ({ page }) => {
  await openLibrary(page, LIBRARY);
  await page.locator('.scene-file', { hasText: 'armed.scene.json' }).click();

  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save as…' }).click();
  const field = page.getByLabel('Save scene as');
  await field.fill('parade');
  await field.press('Enter');
  const saved = await dl;
  expect(saved.suggestedFilename()).toBe('parade.scene.json');
  await expect(doc(page).locator('.scene-doc-name')).toHaveText(
    'parade.scene.json',
  );
});

test('a scene can be saved into a subfolder', async ({ page }) => {
  // The library root is what model keys resolve against, not the folder
  // the scene sits in — so a gallery of models does not have to hold the
  // scene files too.
  await openLibrary(page, MODELS);
  await place(page, 'knight');

  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save as…' }).click();
  const field = page.getByLabel('Save scene as');
  await field.fill('scenes/parade');
  await field.press('Enter');
  await dl;
  // The path is what the app now considers this document to be, even
  // though a download could only put the file somewhere flat.
  await expect(doc(page).locator('.scene-doc-name')).toHaveText(
    'scenes/parade.scene.json',
  );
});

test('the written file carries no name of its own', async ({ page }) => {
  // The field that used to fork the document is gone from the format
  // with it.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save as…' }).click();
  const field = page.getByLabel('Save scene as');
  await field.fill('armed');
  await field.press('Enter');
  const saved = await dl;

  const stream = await saved.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const doc2 = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as {
    name?: string;
  };
  expect(doc2.name).toBeUndefined();
});

test('escaping Save as… leaves the document alone', async ({ page }) => {
  await openLibrary(page, LIBRARY);
  await page.locator('.scene-file', { hasText: 'armed.scene.json' }).click();
  await page.getByRole('button', { name: 'Save as…' }).click();
  const field = page.getByLabel('Save scene as');
  await field.fill('parade');
  await field.press('Escape');
  await expect(doc(page).locator('.scene-doc-name')).toHaveText(
    'armed.scene.json',
  );
  await expect(instanceNames(page)).toHaveText(['knight', 'sword']);
});
