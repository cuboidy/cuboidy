import { expect, test } from '@playwright/test';
import { ROBO_MINI, loadFolder, openTab, tab } from './helpers.js';

// Editor E2E regression suite (audit D-1). Covers the workflows the
// 2026-07-10 audit flagged as untested and the A-6 debounce/structure
// races fixed on this branch. models/robo-mini doubles as the fixture:
// a multi-file package (geometry list + external palette).

test('robo-mini loads all parts with no errors', async ({ page }) => {
  await loadFolder(page, ROBO_MINI);

  await openTab(page, 'Parts');
  // All six parts across body.cvox + limbs.cvox load through the shared
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
  await openTab(page, 'body.cvox');
  const textarea = page.locator('.source-textarea').first();
  const original = await textarea.inputValue();

  // Freeze timers so the 300ms debounced reparse CANNOT fire — the
  // structural edit below must flush it synchronously itself.
  await page.clock.install();

  // Type a voxel change (arm-l hand row '1.' → '11').
  await textarea.fill(original.replace('1.', '11'));

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
  await openTab(page, 'body.cvox');
  await expect(textarea).toHaveValue(/11/);
  await expect(textarea).toHaveValue(/noggin/);
});

test('A-6: structural edit aborts while the source text is broken', async ({ page }) => {
  await loadFolder(page, ROBO_MINI);
  await openTab(page, 'body.cvox');
  const textarea = page.locator('.source-textarea').first();
  const original = await textarea.inputValue();

  await page.clock.install();

  // Break the text (drop arm-l's size line) and immediately try a
  // structural edit before the debounce can even report the error.
  const broken = original.replace(/^\s*size 2 3 1\s*$/m, '');
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
  await openTab(page, 'body.cvox');
  await expect(textarea).toHaveValue(broken);
  // …and the parse error is reported instead of silently cleared.
  await expect(page.locator('.parse-error-banner')).toBeVisible();
});

test('A-6: undo right after editing a non-primary file stays consistent', async ({ page }) => {
  await loadFolder(page, ROBO_MINI);
  await openTab(page, 'Files');
  await page.locator('.file-tree').getByText('limbs.cvox').click();
  await openTab(page, 'limbs.cvox');
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
