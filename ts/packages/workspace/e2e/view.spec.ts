import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { instancePose, openLibrary, place } from './helpers.js';

// The viewport's own controls: the tool switch, the gizmo toggles and the
// rig/anim switch, all shared with the editor's preview.
//
// What is E2E here is the BEHAVIOUR behind each control — that rig view
// really stops sampling, that a running clock really blocks a drag. The
// placement math the move and rotate tools commit is unit-tested in
// placement.test.ts instead: driving a three.js transform gizmo through a
// synthetic mouse is a test of the gizmo, not of this app.

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const MODELS = resolve(REPO_ROOT, 'models');

// Scoped, because accessible-name matching is by substring and the tree
// rows carry a "Remove <id>" button on every instance — which matches
// "Move".
const tools = (page: Page) => page.getByRole('toolbar', { name: 'Scene tools' });
const gizmos = (page: Page) =>
  page.getByRole('group', { name: 'Selected-instance gizmos' });

async function playWalk(page: Page): Promise<void> {
  await page.locator('.dock-tab', { hasText: 'Animation' }).click();
  await page.locator('.field', { hasText: 'clip' }).locator('select')
    .selectOption('walk');
}

test('the viewport carries a tool switch and a view switch', async ({ page }) => {
  await openLibrary(page, MODELS);
  await expect(tools(page)).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Rig view' })).toBeVisible();
  // Select is the default: nothing in this app should start out able to
  // move something by accident.
  await expect(
    tools(page).getByRole('button', { name: 'Select' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('rig view stops sampling, and anim view resumes it', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await playWalk(page);
  await expect.poll(() => instancePose(page, 'knight')).not.toBeNull();

  await page.getByRole('tab', { name: 'Rig view' }).click();
  // Rest, not paused: no sampled pose at all.
  await expect.poll(() => instancePose(page, 'knight')).toBeNull();

  await page.getByRole('tab', { name: 'Anim view' }).click();
  await expect.poll(() => instancePose(page, 'knight')).not.toBeNull();
});

test('the animation panel says why nothing is moving in rig view', async ({
  page,
}) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await playWalk(page);
  await page.getByRole('tab', { name: 'Rig view' }).click();
  await expect(page.locator('.notice')).toContainText(
    'Rig view is showing the scene at rest',
  );
});

test('anim view is offered only when something in the scene can animate', async ({
  page,
}) => {
  await openLibrary(page, MODELS);
  const anim = page.getByRole('tab', { name: 'Anim view' });
  await expect(anim).toBeDisabled();
  await expect(anim).toHaveAttribute('title', /Nothing in the scene yet/);

  await place(page, 'sword'); // sword defines no animations
  await expect(anim).toBeDisabled();
  await expect(anim).toHaveAttribute('title', /No model in the scene/);

  await place(page, 'knight');
  await expect(anim).toBeEnabled();
});

test('the transform tools ask you to pause rather than fighting the clock', async ({
  page,
}) => {
  // A drag mutates the group's matrix imperatively; a running clock
  // rewrites every instance's frame 60 times a second and would undo it
  // mid-drag. Saying so beats a gizmo that silently does not work.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  const move = tools(page).getByRole('button', { name: 'Move' });
  await expect(move).toBeEnabled();

  await playWalk(page);
  await expect(move).toBeDisabled();
  await expect(move).toHaveAttribute('title', /Pause playback/);

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(move).toBeEnabled();
});

test('a tool disabled by playback is not forgotten when playback stops', async ({
  page,
}) => {
  // The toolbar shows the EFFECTIVE tool, as the editor's does — an
  // active-looking Move that cannot move would be the worse lie. The
  // choice survives underneath, so pausing brings it straight back
  // without a second click.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  const move = tools(page).getByRole('button', { name: 'Move' });
  await move.click();
  await expect(move).toHaveAttribute('aria-pressed', 'true');

  await playWalk(page);
  await expect(
    tools(page).getByRole('button', { name: 'Select' }),
  ).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(move).toHaveAttribute('aria-pressed', 'true');
});

test('the gizmo toggles remember what is shown', async ({ page }) => {
  await openLibrary(page, MODELS);
  const outline = gizmos(page).getByRole('button', {
    name: 'Show the selection outline',
  });
  const origin = gizmos(page).getByRole('button', {
    name: "Show the selected model's origin",
  });
  // Sockets and the outline are on by default; this app is about hooking
  // models together and both are how you see that happen.
  await expect(outline).toHaveAttribute('aria-pressed', 'true');
  await expect(origin).toHaveAttribute('aria-pressed', 'false');

  await outline.click();
  await expect(outline).toHaveAttribute('aria-pressed', 'false');
  // The flags outlive a selection change.
  await place(page, 'knight');
  await expect(outline).toHaveAttribute('aria-pressed', 'false');
});
