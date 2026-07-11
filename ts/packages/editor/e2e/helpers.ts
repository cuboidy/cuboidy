import { expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../..',
);

export const ROBO_MINI = resolve(REPO_ROOT, 'models/robo-mini');

// Open the editor and load a model folder through the legacy
// <input webkitdirectory> path. Chromium normally exposes the FSA
// showDirectoryPicker (which Playwright can't drive), so the init
// script hides it to make the input-based folder button render.
export async function loadFolder(page: Page, dir: string): Promise<void> {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).showDirectoryPicker;
  });
  await page.goto('/');
  await page.setInputFiles('input[webkitdirectory]', dir);
  // A dock tab appearing means the load pipeline completed.
  await expect(tab(page, 'Parts')).toBeVisible();
}

// A dock tab's activation button (`.dock-tab-label` carries the panel
// title as its text; the sibling close button has an aria-label).
export function tab(page: Page, title: string) {
  return page
    .locator('.dock-tab-label')
    .filter({ hasText: new RegExp(`^${title.replace('.', '\\.')}$`) });
}

// Bring a dock panel's tab to the front.
export async function openTab(page: Page, title: string): Promise<void> {
  await tab(page, title).click();
}
