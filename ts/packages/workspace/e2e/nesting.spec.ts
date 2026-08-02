import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  instanceOrigin,
  openLibrary,
  place,
  renderHost,
  renderWorld,
} from './helpers.js';

// A guest is a real child of its host in the scene graph.
//
// It used not to be: every instance was a sibling at the canvas root,
// drawn at the world frame placeScene worked out. That resolves
// correctly and reads correctly in every static assertion — and still
// leaves the guest standing still while its host is dragged, because a
// transform gizmo mutates one group's matrix in place and a sibling hears
// nothing until the drag commits and the whole scene re-resolves.
//
// So these assert the GRAPH, not the arithmetic. window.__scene would
// have passed the whole time.

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const MODELS = resolve(REPO_ROOT, 'models');

async function armedKnight(page: import('@playwright/test').Page): Promise<void> {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  await page.locator('.scene-tree-panel .tree-row[draggable] .tree-name', { hasText: /^sword$/ }).click();
  await page.locator('.field', { hasText: 'attached to' }).locator('select')
    .selectOption('knight');
}

test('an attached guest is a child of its host, not a sibling', async ({
  page,
}) => {
  await armedKnight(page);
  expect(await renderHost(page, 'sword')).toBe('knight');
  expect(await renderHost(page, 'knight')).toBeNull();
});

test('a free instance is nobody’s child', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  expect(await renderHost(page, 'sword')).toBeNull();
});

test('detaching removes the parenting, not just the offset', async ({ page }) => {
  await armedKnight(page);
  expect(await renderHost(page, 'sword')).toBe('knight');
  await page.locator('.field', { hasText: 'attached to' }).locator('select')
    .selectOption('');
  expect(await renderHost(page, 'sword')).toBeNull();
});

test('switching socket keeps the parenting and moves the guest', async ({
  page,
}) => {
  await armedKnight(page);
  const onWeapon = await renderWorld(page, 'sword');
  await page.locator('.field', { hasText: /^socket/ }).locator('select')
    .selectOption('crest');
  const onCrest = await renderWorld(page, 'sword');
  expect(await renderHost(page, 'sword')).toBe('knight');
  expect(onCrest).not.toEqual(onWeapon);
});

// The unresolved case — a socket the host has stopped publishing — is
// covered in placement.test.ts, where drawTree can be handed one
// directly. Reaching it through the UI is not possible by design: the
// Attachment panel only offers sockets that exist.

test('the rendered position agrees with the resolved one', async ({ page }) => {
  // Two paths now compute where a guest goes: placeScene composes the
  // world frame for hit-testing and reporting, and the scene graph
  // composes it again out of nested transforms. They start from the same
  // socket and the same placement, and this is what says so.
  await armedKnight(page);
  const resolved = await instanceOrigin(page, 'sword');
  const rendered = await renderWorld(page, 'sword');
  expect(resolved).not.toBeNull();
  expect(rendered).not.toBeNull();
  for (let i = 0; i < 3; i++) {
    expect(rendered![i]).toBeCloseTo(resolved![i]!, 4);
  }
});

test('the guest tracks the host through an animation, in the graph', async ({
  page,
}) => {
  // The socket moves as the arm swings; the guest's own transform never
  // changes, so if it follows, it is the parenting that moved it.
  await armedKnight(page);
  await page.locator('.scene-tree-panel .tree-row[draggable] .tree-name', { hasText: /^knight$/ }).click();
  await page.locator('.dock-tab', { hasText: 'Animation' }).click();
  await page.locator('.field', { hasText: 'clip' }).locator('select')
    .selectOption('walk');

  const first = await renderWorld(page, 'sword');
  await expect
    .poll(
      async () => {
        const now = await renderWorld(page, 'sword');
        return now === null || first === null
          ? 0
          : Math.abs(now[0] - first[0]) +
              Math.abs(now[1] - first[1]) +
              Math.abs(now[2] - first[2]);
      },
      { timeout: 5000 },
    )
    .toBeGreaterThan(0.05);
  expect(await renderHost(page, 'sword')).toBe('knight');
});
