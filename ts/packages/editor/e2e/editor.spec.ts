import { expect, test } from '@playwright/test';
import { ROBO_MINI, loadFolder, openTab, tab } from './helpers.js';

// Editor E2E regression suite (audit D-1). Covers the workflows the
// 2026-07-10 audit flagged as untested and the A-6 debounce/structure
// races fixed on this branch. models/robo-mini doubles as the fixture:
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

  // Freeze timers so the 300ms debounced reparse CANNOT fire — the
  // structural edit below must flush it synchronously itself.
  await page.clock.install();

  // Type a voxel change (arm-l hand row "1." → "11").
  const typed = original.replace('"1."', '"11"');
  expect(typed).not.toBe(original);
  await textarea.fill(typed);

  // Immediately rename a part (structural edit → serializes the AST).
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
  // …AND the just-typed voxel edit survived the re-serialize. Before
  // the fix the stale pre-typing AST overwrote it.
  await openTab(page, 'body.json');
  await expect(textarea).toHaveValue(/"11"/);
  await expect(textarea).toHaveValue(/noggin/);
});

test('A-6: structural edit aborts while the source text is broken', async ({ page }) => {
  await loadFolder(page, ROBO_MINI);
  await openTab(page, 'body.json');
  const textarea = page.locator('.source-textarea').first();
  const original = await textarea.inputValue();

  await page.clock.install();

  // Break the document (drop arm-l's required `size`) and immediately
  // try a structural edit before the debounce can even report it. The
  // text stays well-formed JSON, so this exercises schema rejection
  // rather than a tokenizer failure.
  const broken = original.replace(/^ +"size": \[2, 3, 1\],\r?\n/m, '');
  expect(broken).not.toBe(original);
  await textarea.fill(broken);

  await openTab(page, 'Parts');
  await page.locator('.tree-name', { hasText: /^head$/ }).dblclick();
  const rename = page.getByLabel('Rename head');
  await rename.fill('noggin');
  await rename.press('Enter');

  // The rename must NOT have gone through (a stale-AST serialize would
  // have resurrected arm-l's size line and clobbered the typed text)…
  await expect(
    page.locator('.tree-name', { hasText: /^head$/ }),
  ).toBeVisible();
  // …the broken text is preserved verbatim…
  await openTab(page, 'body.json');
  await expect(textarea).toHaveValue(broken);
  // …and the parse error is reported instead of silently cleared, naming
  // the line the broken part starts on (a schema error knows only a
  // document path, so the reader maps it back to a position).
  const banner = page.locator('.parse-error-banner');
  await expect(banner).toBeVisible();
  const partLine = broken.slice(0, broken.indexOf('"name": "arm-l"')).split('\n')
    .length;
  await expect(banner).toHaveText(
    new RegExp(`line ${partLine - 1}: parts\\.2\\.size:`),
  );
});

test('A-6: undo right after editing a non-primary file stays consistent', async ({ page }) => {
  await loadFolder(page, ROBO_MINI);
  await openTab(page, 'Files');
  await page.locator('.file-tree').getByText('limbs.json').click();
  await openTab(page, 'limbs.json');
  const textarea = page.locator('.source-textarea').first();
  const original = await textarea.inputValue();

  await page.clock.install();

  // Edit the file, then undo BEFORE the 300ms reparse fires. The stale
  // timer must not fire afterwards and graft the post-edit AST onto the
  // restored text. (Blur first: the app-level Ctrl+Z intentionally
  // defers to the browser's native undo while a text field has focus.)
  await textarea.fill(original.replace('leg-l', 'leg-x'));
  await textarea.blur();
  await page.keyboard.press('Control+z');

  await expect(textarea).toHaveValue(original);
  // Let any (wrongly) surviving timer fire — nothing should change.
  await page.clock.runFor(1000);
  await expect(textarea).toHaveValue(original);
  await openTab(page, 'Parts');
  await expect(
    page.locator('.tree-name', { hasText: /^leg-l$/ }),
  ).toBeVisible();
});

// The A-6 tests above both freeze the clock, so they only ever exercise
// the debounce-still-PENDING path — the one the flush guard handles.
// This covers the gap: once the debounce has fired and REPORTED an
// error, the timer ref is null, so `flushPendingManifestReparse` returns
// true with nothing to flush and the guard lets a structural edit
// through against the last-good AST.
test('A-6 gap: a structural edit after the debounce reported an error', async ({
  page,
}) => {
  // KNOWN BUG — expected to fail until the edit guard stops keying off
  // the debounce timer. Playwright reports "expected to fail but passed"
  // once it is fixed, which is the signal to drop this line.
  test.fail();

  const row = (name: string) =>
    page.locator('.tree-row').filter({
      has: page.locator('.tree-name', { hasText: new RegExp(`^${name}$`) }),
    });

  await loadFolder(page, ROBO_MINI);
  await openTab(page, 'cuboidy.json');
  const textarea = page.locator('.source-textarea').first();
  const original = await textarea.inputValue();

  // Break the manifest (schema-invalid but well-formed JSON) and let the
  // real 300ms debounce fire, so the error is CONFIRMED, not pending.
  const broken = original.replace('"name": "robo-mini"', '"name": 42');
  expect(broken).not.toBe(original);
  await textarea.fill(broken);
  await expect(page.locator('.parse-error-banner')).toBeVisible();

  // Reparent by drag — the one manifest-writing entry point not gated on
  // manifestParseError (PartTree's dndEnabled only checks a manifest exists).
  await openTab(page, 'Parts');
  await row('leg-l').dragTo(row('head'));

  // The drag must actually have landed, or the assertion below proves nothing.
  await expect(row('head').locator('.tree-caret-btn')).toBeVisible();

  // The typed text must survive: serializing the last-good AST over it
  // silently discards what the user wrote.
  await openTab(page, 'cuboidy.json');
  await expect(textarea).toHaveValue(broken);
});
