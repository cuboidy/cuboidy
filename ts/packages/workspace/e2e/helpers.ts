/* Shared by the specs in this folder.
 *
 * The window.__scene readers are the important ones: a 3D view can
 * typecheck and render nothing, and where an instance ENDED UP is the
 * only way to tell an attachment that took effect from one that merely
 * says it did. A canvas cannot be asked. */

import { expect, type Page } from '@playwright/test';

// Chromium exposes showDirectoryPicker, which automation cannot drive,
// so hide it to get the <input webkitdirectory> fallback the test CAN
// drive.
export async function openLibrary(page: Page, dir: string): Promise<void> {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).showDirectoryPicker;
  });
  await page.goto('/');
  await page.setInputFiles('input[type=file]', dir);
  await expect(page.locator('.model-row').first()).toBeVisible();
}

// One part's sampled rotation, for telling "paused" from "running slowly".
export async function instancePose(page: Page, id: string): Promise<unknown> {
  return page.evaluate((wanted) => {
    const w = window as unknown as {
      __scene?: { instance: { id: string }; poses: Map<string, unknown> | null }[];
    };
    const hit = w.__scene?.find((p) => p.instance.id === wanted);
    return hit?.poses === null || hit?.poses === undefined
      ? null
      : JSON.stringify([...hit.poses]);
  }, id);
}

export async function place(page: Page, model: string): Promise<void> {
  await page.locator('.model-row-name', { hasText: new RegExp(`^${model}$`) })
    .dblclick();
  await expect(
    page.locator('.scene-tree-panel .tree-name', { hasText: new RegExp(`^${model}`) }).first(),
  ).toBeVisible();
}

// Where an instance's model origin ended up, read off the scene the app
// resolved — the only way to tell "attached" from "drawn at the origin".
export async function instanceOrigin(
  page: Page,
  id: string,
): Promise<[number, number, number] | null> {
  return page.evaluate((wanted) => {
    const w = window as unknown as {
      __scene?: { instance: { id: string }; frame: { pos: [number, number, number] } }[];
    };
    const hit = w.__scene?.find((p) => p.instance.id === wanted);
    return hit === undefined ? null : hit.frame.pos;
  }, id);
}

// True when the canvas centre still holds the clear colour, i.e. nothing
// was drawn there.
export async function centrePixelIsBackground(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.scene-canvas canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return true;
    const gl =
      canvas.getContext('webgl2', { preserveDrawingBuffer: true }) ??
      canvas.getContext('webgl', { preserveDrawingBuffer: true });
    if (gl === null) return true;
    const px = new Uint8Array(4);
    gl.readPixels(
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      px,
    );
    // Clear colour is #14161a. Allow a little slack for colour management.
    return Math.abs(px[0]! - 0x14) < 6 && Math.abs(px[1]! - 0x16) < 6 &&
      Math.abs(px[2]! - 0x1a) < 6;
  });
}
