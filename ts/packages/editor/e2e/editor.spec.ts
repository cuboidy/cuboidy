import { expect, test } from '@playwright/test';
import { ROBO_MINI, loadFolder, openTab, tab } from './helpers.js';

// Editor E2E regression suite (audit D-1). Covers the workflows the
// 2026-07-10 audit flagged as untested and the A-6 text/AST races. Those
// races used to be a debounce-timing problem; text is now parsed as it is
// typed, so what these pin down is that a structural edit always works
// from the AST of the text currently on screen. models/robo-mini doubles as the fixture:
// a multi-file package (geometry list + external palette).

test('robo-mini loads all parts with no errors', async ({ page }) => {
  await loadFolder(page, ROBO_MINI);

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
  await loadFolder(page, ROBO_MINI);
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
  await loadFolder(page, ROBO_MINI);
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
  await loadFolder(page, ROBO_MINI);
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

  await loadFolder(page, ROBO_MINI);
  await openTab(page, 'cuboidy.json');
  const textarea = page.locator('.source-textarea').first();
  const original = await textarea.inputValue();

  // Break the manifest: schema-invalid but well-formed JSON.
  const broken = original.replace('"name": "robo-mini"', '"name": 42');
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
