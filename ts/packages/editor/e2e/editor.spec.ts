import { expect, test } from '@playwright/test';
import { MULTIFILE, loadFolder, openTab, tab } from './helpers.js';

// Editor E2E regression suite (audit D-1). Covers the workflows the
// 2026-07-10 audit flagged as untested and the A-6 text/AST races. Those
// races used to be a debounce-timing problem; text is now parsed as it is
// typed, so what these pin down is that a structural edit always works
// from the AST of the text currently on screen. the multi-file corpus model doubles as the fixture:
// a multi-file package (geometry list + external palette).

test('a multi-file model loads all parts with no errors', async ({ page }) => {
  await loadFolder(page, MULTIFILE);

  await openTab(page, 'Parts');
  // All six parts across body.json + limbs.json load through the shared
  // project layer.
  for (const part of ['body', 'head', 'arm-l', 'arm-r', 'leg-l', 'leg-r']) {
    await expect(
      page.locator('.tree-name', { hasText: new RegExp(`^${part}$`) }),
    ).toBeVisible();
  }

  // Console panel reports no project errors.
  await openTab(page, 'Console');
  await expect(page.locator('.console-entry.error')).toHaveCount(0);
});

test('A-6: structural edit right after typing keeps the typed text', async ({ page }) => {
  await loadFolder(page, MULTIFILE);
  await openTab(page, 'body.json');
  const textarea = page.locator('.source-textarea').first();
  const original = await textarea.inputValue();

  // Type a voxel change (arm-l hand row "1." → "11").
  const typed = original.replace('"1."', '"11"');
  expect(typed).not.toBe(original);
  await textarea.fill(typed);

  // Immediately rename a part (structural edit → serializes the AST). The
  // text was parsed as it was typed, so the rename works from THAT AST.
  await openTab(page, 'Parts');
  await page
    .locator('.tree-name', { hasText: /^head$/ })
    .dblclick();
  const rename = page.getByLabel('Rename head');
  await rename.fill('noggin');
  await rename.press('Enter');

  // The rename landed…
  await expect(
    page.locator('.tree-name', { hasText: /^noggin$/ }),
  ).toBeVisible();
  // …AND the just-typed voxel edit survived the re-serialize. A stale
  // pre-typing AST would have overwritten it.
  await openTab(page, 'body.json');
  await expect(textarea).toHaveValue(/"11"/);
  await expect(textarea).toHaveValue(/noggin/);
});

test('A-6: a broken source text blocks structural edits, not just aborts them', async ({
  page,
}) => {
  await loadFolder(page, MULTIFILE);
  await openTab(page, 'body.json');
  const textarea = page.locator('.source-textarea').first();
  const original = await textarea.inputValue();

  // Break the document (drop arm-l's required `size`). The text stays
  // well-formed JSON, so this exercises schema rejection rather than a
  // tokenizer failure. No fake clock: the text is parsed as it is typed,
  // so the error is known before the next interaction can start.
  const broken = original.replace(/^ +"size": \[2, 3, 1\],\r?\n/m, '');
  expect(broken).not.toBe(original);
  await textarea.fill(broken);

  // The error is reported, naming the line the broken part starts on (a
  // schema error knows only a document path, so the reader maps it back).
  const banner = page.locator('.parse-error-banner');
  await expect(banner).toBeVisible();
  const partLine = broken.slice(0, broken.indexOf('"name": "arm-l"')).split('\n')
    .length;
  await expect(banner).toHaveText(
    new RegExp(`line ${partLine - 1}: parts\\.2\\.size:`),
  );

  // A structural edit is now UNAVAILABLE rather than merely rejected: the
  // rename affordance never opens, because the gate reads the current
  // text's parse state instead of a pending timer.
  await openTab(page, 'Parts');
  await page.locator('.tree-name', { hasText: /^head$/ }).dblclick();
  await expect(page.getByLabel('Rename head')).toHaveCount(0);
  await expect(page.locator('.tree-name', { hasText: /^head$/ })).toBeVisible();

  // …and the broken text is preserved verbatim.
  await openTab(page, 'body.json');
  await expect(textarea).toHaveValue(broken);
});

test('A-6: undo right after editing a non-primary file stays consistent', async ({ page }) => {
  await loadFolder(page, MULTIFILE);
  await openTab(page, 'Files');
  await page.locator('.file-tree').getByText('limbs.json').click();
  await openTab(page, 'limbs.json');
  const textarea = page.locator('.source-textarea').first();
  const original = await textarea.inputValue();

  // Edit a NON-primary file, then undo. Text and derived state move
  // together in one history entry, so the restore cannot leave an AST
  // from the edited text sitting on the restored text. (Blur first: the
  // app-level Ctrl+Z intentionally defers to the browser's native undo
  // while a text field has focus.)
  await textarea.fill(original.replace('leg-l', 'leg-x'));
  await textarea.blur();
  await page.keyboard.press('Control+z');

  await expect(textarea).toHaveValue(original);
  await openTab(page, 'Parts');
  await expect(
    page.locator('.tree-name', { hasText: /^leg-l$/ }),
  ).toBeVisible();
});

// The regression this suite was extended for: an edit path that is NOT
// gated by a disabled control. PartTree's drag-reparent is enabled
// whenever a manifest exists, so it is the one way to reach a manifest
// write with a broken manifest on screen. It used to clobber the typed
// text, because the guard asked whether a debounce timer was pending
// rather than whether the text parsed.
test('A-6: a drag-reparent cannot clobber broken manifest text', async ({
  page,
}) => {
  const row = (name: string) =>
    page.locator('.tree-row').filter({
      has: page.locator('.tree-name', { hasText: new RegExp(`^${name}$`) }),
    });

  await loadFolder(page, MULTIFILE);
  await openTab(page, 'cuboidy.json');
  const textarea = page.locator('.source-textarea').first();
  const original = await textarea.inputValue();

  // Break the manifest: schema-invalid but well-formed JSON.
  const broken = original.replace('"name": "multifile"', '"name": 42');
  expect(broken).not.toBe(original);
  await textarea.fill(broken);
  await expect(page.locator('.parse-error-banner')).toBeVisible();

  // Reparent by drag. PartTree's dndEnabled only checks that a manifest
  // exists, so nothing stops the gesture — the handler has to refuse.
  await openTab(page, 'Parts');
  await row('leg-l').dragTo(row('head'));

  // The reparent did NOT happen: head gains no children.
  await expect(row('head').locator('.tree-caret-btn')).toHaveCount(0);

  // …and the typed text survives verbatim.
  await openTab(page, 'cuboidy.json');
  await expect(textarea).toHaveValue(broken);
});

test('lint findings appear in the Console and follow the edit', async ({ page }) => {
  // Core's lint runs in the CLI; until now the editor never called it, so
  // the one place a model is authored was the one place that could not say
  // the model was wrong. The finding must also track the CURRENT text, not
  // a snapshot from load time.
  await loadFolder(page, MULTIFILE);
  await openTab(page, 'Console');
  // `.panel-empty` is shared by every panel's empty state, so scope to the
  // Console's own.
  await expect(page.locator('.console-empty')).toBeVisible();

  // Push `body`'s pivot far outside its 4x4x2 grid — W01.
  await openTab(page, 'body.json');
  const textarea = page.locator('.source-textarea').first();
  const original = await textarea.inputValue();
  const broken = original.replace(
    '"name": "body",',
    '"name": "body",\n      "pivot": { "pos": [99, 0, 0] },',
  );
  expect(broken).not.toBe(original);
  await textarea.fill(broken);

  await openTab(page, 'Console');
  const entry = page.locator('.console-entry');
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText('outside grid bounds');
  await expect(entry.locator('.console-rule')).toHaveText('[W01]');
  await expect(entry.locator('.console-source')).toHaveText('body.json');
  // A warning, not an error: the model still loads.
  await expect(entry).toHaveClass(/warning/);

  // Undo the edit and the finding goes away.
  await openTab(page, 'body.json');
  await textarea.fill(original);
  await openTab(page, 'Console');
  // `.panel-empty` is shared by every panel's empty state, so scope to the
  // Console's own.
  await expect(page.locator('.console-empty')).toBeVisible();
});

test('a cross-file lint finding is attributed to the project', async ({ page }) => {
  await loadFolder(page, MULTIFILE);
  // Name a part in the manifest that no geometry file defines.
  await openTab(page, 'cuboidy.json');
  const textarea = page.locator('.source-textarea').first();
  const original = await textarea.inputValue();
  const withGhost = original.replace(
    '"parts": [',
    '"parts": [ { "name": "ghost" },',
  );
  expect(withGhost).not.toBe(original);
  await textarea.fill(withGhost);

  await openTab(page, 'Console');
  const entry = page.locator('.console-entry');
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText('ghost');
  await expect(entry.locator('.console-source')).toHaveText('<cross-file>');
  await expect(entry).toHaveClass(/error/);
});

// SPEC §6.12 — a socket's name lives in the geometry file and its
// publication in the manifest, so every socket edit has to move both or
// leave the package with a cross-file error (§11.6). This drives the whole
// life cycle through the UI, checking cuboidy.json after each step.
test('publishing a socket keeps the manifest in step with the geometry', async ({
  page,
}) => {
  await loadFolder(page, MULTIFILE);
  await openTab(page, 'Parts');
  await page.locator('.tree-name', { hasText: /^head$/ }).click();
  await openTab(page, 'Properties');

  // Declare a socket. Geometry only so far — nothing published.
  await page.locator('.socket-add').click();
  await expect(page.getByLabel('Socket name')).toHaveValue('socket1');
  await openTab(page, 'cuboidy.json');
  const manifestText = page.locator('.source-textarea').first();
  await expect(manifestText).not.toHaveValue(/"sockets"/);

  // Publish it under a name that is NOT the socket's own — publication is
  // an alias, so the two must be tracked separately.
  await openTab(page, 'Properties');
  const published = page.getByLabel('Published name for socket socket1');
  await expect(published).toHaveValue('');
  await published.fill('headwear');
  await published.press('Enter');
  await openTab(page, 'cuboidy.json');
  await expect(manifestText).toHaveValue(/"headwear"/);
  await expect(manifestText).toHaveValue(/"part": "head"/);
  await expect(manifestText).toHaveValue(/"socket": "socket1"/);
  // Written where §6.1 puts it, not appended after the animations block.
  await expect(manifestText).toHaveValue(/"sockets"[\s\S]*"animations"/);

  // Renaming the socket retargets the publication; the published name is
  // what consumers hold, so it must NOT change.
  await openTab(page, 'Properties');
  const socketName = page.getByLabel('Socket name');
  await socketName.fill('crest');
  await socketName.press('Enter');
  await openTab(page, 'cuboidy.json');
  await expect(manifestText).toHaveValue(/"socket": "crest"/);
  await expect(manifestText).toHaveValue(/"headwear"/);

  // Renaming the PART retargets it too.
  await openTab(page, 'Parts');
  await page.locator('.tree-name', { hasText: /^head$/ }).dblclick();
  const rename = page.getByLabel('Rename head');
  await rename.fill('noggin');
  await rename.press('Enter');
  await openTab(page, 'cuboidy.json');
  await expect(manifestText).toHaveValue(/"part": "noggin"/);

  // No cross-file error at any point — the two files never disagreed.
  await openTab(page, 'Console');
  await expect(page.locator('.console-entry.error')).toHaveCount(0);

  // Removing the socket removes its publication, and the now-empty map is
  // dropped rather than written as `"sockets": {}`.
  await openTab(page, 'Properties');
  await page.getByRole('button', { name: 'Remove socket' }).click();
  await openTab(page, 'cuboidy.json');
  await expect(manifestText).not.toHaveValue(/"sockets"/);
  await openTab(page, 'Console');
  await expect(page.locator('.console-entry.error')).toHaveCount(0);
});
