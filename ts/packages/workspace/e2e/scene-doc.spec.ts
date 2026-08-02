import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { instanceNames, openLibrary, place } from './helpers.js';

// Which scene you are editing, and saving it.
//
// The controls live in the header, where the editor keeps its own; the
// Scene panel is the list of scenes and nothing else. Before that they
// were one box holding a name field, an Open dropdown and Save — and the
// name field WAS the filename, so editing it and saving wrote a different
// file and left the original untouched.

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const MODELS = resolve(REPO_ROOT, 'models');
const LIBRARY = resolve(REPO_ROOT, 'ts/testdata/library');

const docName = (page: Page) => page.locator('.header-doc-name');
const dirtyDot = (page: Page) => page.locator('.header-doc-dirty');
const saveBtn = (page: Page) =>
  page.getByRole('button', { name: 'Save', exact: true });

// The discard guard is a confirm(). Playwright dismisses dialogs by
// default, which would silently turn "open it anyway" into "do nothing",
// so a test that means to go through says so.
const acceptDialogs = (page: Page): void => {
  page.on('dialog', (d) => void d.accept());
};

test('an unsaved scene says so, and Save asks where', async ({ page }) => {
  await openLibrary(page, MODELS);
  await expect(docName(page)).toHaveText('untitled');
  // Nothing in it yet, so nothing to save.
  await expect(dirtyDot(page)).toHaveCount(0);

  await place(page, 'knight');
  await expect(dirtyDot(page)).toHaveCount(1);

  await saveBtn(page).click();
  await expect(page.getByLabel('Save scene as')).toBeVisible();
});

test('opening a scene shows its file, and it is not dirty', async ({ page }) => {
  await openLibrary(page, LIBRARY);
  await page.locator('.scene-file', { hasText: 'armed.scene.json' }).click();
  await expect(docName(page)).toHaveText('armed.scene.json');
  // Freshly opened is freshly saved. The comparison is against the
  // SERIALIZATION of what was parsed, so a hand-formatted file — or one
  // still carrying the old `name` — does not read as modified on sight.
  await expect(dirtyDot(page)).toHaveCount(0);
});

test('editing an opened scene marks it dirty', async ({ page }) => {
  await openLibrary(page, LIBRARY);
  await page.locator('.scene-file', { hasText: 'armed.scene.json' }).click();
  await place(page, 'sword');
  await expect(dirtyDot(page)).toHaveCount(1);
});

test('the Scene panel is the list, and marks the open one', async ({ page }) => {
  await openLibrary(page, LIBRARY);
  const armed = page.locator('.scene-file', { hasText: 'armed.scene.json' });
  await expect(armed).not.toHaveClass(/current/);
  await armed.click();
  await expect(armed).toHaveClass(/current/);
  // Nothing else in there: what you can DO to a scene went to the header.
  await expect(page.locator('.dock-leaf', { hasText: 'Scene' }).first())
    .not.toContainText('Save');
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
  await saveBtn(page).click();
  const saved = await dl;
  expect(saved.suggestedFilename()).toBe('armed.scene.json');
  // No prompt: it knew where to go.
  await expect(page.getByLabel('Save scene as')).toHaveCount(0);
  await expect(dirtyDot(page)).toHaveCount(0);
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
  await expect(docName(page)).toHaveText('parade.scene.json');
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
  const downloaded = await dl;
  // A download cannot choose a folder, so the file lands flat…
  expect(downloaded.suggestedFilename()).toBe('parade.scene.json');
  // …but the document is the path that was asked for, and the notice says
  // where to put it. Telling the user it is now called something else
  // would be telling them the wrong place.
  await expect(docName(page)).toHaveText('scenes/parade.scene.json');
  await expect(page.locator('.notice-banner')).toContainText(
    'models/scenes/parade.scene.json',
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
  const doc = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as {
    name?: string;
  };
  expect(doc.name).toBeUndefined();
});

test('escaping Save as… leaves the document alone', async ({ page }) => {
  await openLibrary(page, LIBRARY);
  await page.locator('.scene-file', { hasText: 'armed.scene.json' }).click();
  await page.getByRole('button', { name: 'Save as…' }).click();
  const field = page.getByLabel('Save scene as');
  await field.fill('parade');
  await field.press('Escape');
  await expect(docName(page)).toHaveText('armed.scene.json');
  await expect(instanceNames(page)).toHaveText(['knight', 'sword']);
});

test('New scene empties it and forgets the file', async ({ page }) => {
  acceptDialogs(page);
  await openLibrary(page, LIBRARY);
  await page.locator('.scene-file', { hasText: 'armed.scene.json' }).click();
  await expect(instanceNames(page)).toHaveText(['knight', 'sword']);

  await page.getByRole('button', { name: 'New scene' }).click();
  await expect(instanceNames(page)).toHaveCount(0);
  await expect(docName(page)).toHaveText('untitled');
  // And nothing is marked open in the list any more.
  await expect(page.locator('.scene-file.current')).toHaveCount(0);
});

test('unsaved work is not thrown away silently', async ({ page }) => {
  // The dirty flag earns its keep here: both routes out of a scene ask
  // before discarding one.
  await openLibrary(page, LIBRARY);
  await place(page, 'knight');
  await expect(dirtyDot(page)).toHaveCount(1);

  // Dismissed — Playwright's default — so nothing should happen.
  await page.getByRole('button', { name: 'New scene' }).click();
  await expect(instanceNames(page)).toHaveText(['knight']);

  await page.locator('.scene-file', { hasText: 'armed.scene.json' }).click();
  await expect(instanceNames(page)).toHaveText(['knight']);

  // Accepted, so it goes through.
  acceptDialogs(page);
  await page.locator('.scene-file', { hasText: 'armed.scene.json' }).click();
  await expect(instanceNames(page)).toHaveText(['knight', 'sword']);
});
