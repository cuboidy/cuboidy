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
  await expect(page.locator('.model-card').first()).toBeVisible();
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

// How much of a card's thumbnail is actually painted, 0..1. A render that
// silently produced nothing comes back fully transparent, which no other
// check would catch — the <img> is present and its src is a valid data
// URL either way.
export async function thumbnailCoverage(
  page: Page,
  model: string,
): Promise<number> {
  return page.evaluate(async (wanted) => {
    const cards = [...document.querySelectorAll('.model-card')];
    const card = cards.find(
      (c) => c.querySelector('.model-card-name')?.textContent === wanted,
    );
    const img = card?.querySelector('img');
    if (!(img instanceof HTMLImageElement)) return 0;
    if (!img.complete) await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    if (ctx === null) return 0;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let lit = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 8) lit++;
    return lit / (c.width * c.height);
  }, model);
}

// Socket rows carry `.tree-name` too — they are names in a tree. Only
// instance rows are draggable, which is what tells the two apart.
export const instanceNames = (page: Page) =>
  page.locator('.scene-tree-panel .tree-row[draggable] .tree-name');

// The Instances panel nests instance > socket > instance, so an ATTACHED
// instance's row is three lists deep. Free ones are at the top level.
export const attachedNames = (page: Page) =>
  page.locator(
    '.scene-tree-panel .tree-list .tree-list .tree-list .tree-row[draggable] .tree-name',
  );

// A socket row — the thing you drop onto to attach. Matched on the NAME
// child rather than the row's text: the row also carries the part:socket
// it resolves to, so its text content is not just the socket's name.
export const socketRow = (page: Page, socket: string) =>
  page.locator('.scene-tree-panel .tree-row.socket-slot', {
    has: page.locator('.socket-name', { hasText: new RegExp(`^${socket}$`) }),
  });

// The instance whose GROUP actually contains this one, read off the
// three.js object graph. Distinct from what the scene resolved to: a flat
// graph can report the right world frame and still leave a guest behind
// while its host is dragged, because a sibling hears nothing about a
// matrix mutated in place.
export async function renderHost(
  page: Page,
  id: string,
): Promise<string | null> {
  return page.evaluate((wanted) => {
    const w = window as unknown as { __renderHost?: (id: string) => string | null };
    return w.__renderHost?.(wanted) ?? null;
  }, id);
}

// Where an instance's group actually ends up, after every ancestor
// transform. Compared against the resolved frame, this is what keeps the
// two paths honest.
export async function renderWorld(
  page: Page,
  id: string,
): Promise<[number, number, number] | null> {
  return page.evaluate((wanted) => {
    const w = window as unknown as {
      __renderWorld?: (id: string) => [number, number, number] | null;
    };
    return w.__renderWorld?.(wanted) ?? null;
  }, id);
}

export async function place(page: Page, model: string): Promise<void> {
  await page.locator('.model-card-name', { hasText: new RegExp(`^${model}$`) })
    .dblclick();
  await expect(
    page.locator('.scene-tree-panel .tree-row[draggable] .tree-name', { hasText: new RegExp(`^${model}`) }).first(),
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
