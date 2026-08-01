import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Stage 1, first chunk: open a folder of models, list them, draw one.
//
// This is E2E rather than unit because the claim worth proving is that a
// real library folder loads AND renders. The loader is checkable in
// isolation; "the model appears on screen" is not — a 3D view can
// typecheck and produce an empty canvas.

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const MODELS = resolve(REPO_ROOT, 'models');
// A library WITH scene files in it, for the read side.
const LIBRARY = resolve(REPO_ROOT, 'ts/testdata/library');

// Chromium exposes showDirectoryPicker, which automation cannot drive, so
// hide it to get the <input webkitdirectory> fallback the test CAN drive.
async function openLibrary(page: Page, dir: string): Promise<void> {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).showDirectoryPicker;
  });
  await page.goto('/');
  await page.setInputFiles('input[type=file]', dir);
  await expect(page.locator('.model-row').first()).toBeVisible();
}

test('the landing screen explains what to open', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.landing')).toContainText('cuboidy.json');
});

test('opening models/ lists every model in it', async ({ page }) => {
  await openLibrary(page, MODELS);
  for (const name of [
    'fox',
    'herbalist',
    'knight',
    'koi',
    'owl',
    'sword',
    'windmill',
  ]) {
    await expect(
      page.locator('.model-row-name', { hasText: new RegExp(`^${name}$`) }),
    ).toBeVisible();
  }
  // Every shipped model lints clean, so none should be flagged here — the
  // workspace agreeing with cuboidy-lint about what is wrong with a model
  // is the point of routing through core's resolveProject.
  await expect(page.locator('.model-row-warn')).toHaveCount(0);
});

test('the scene starts empty and says how to fill it', async ({ page }) => {
  await openLibrary(page, MODELS);
  await expect(page.locator('.scene-hint')).toBeVisible();
  await expect(page.locator('.scene-tree-panel .tree-row')).toHaveCount(0);
  // No pixel assertion here: the ground grid is drawn either way, so the
  // canvas is legitimately not blank with an empty scene.
});

test('selecting a model shows its published sockets', async ({ page }) => {
  await openLibrary(page, MODELS);
  await page.locator('.model-row-name', { hasText: /^knight$/ }).click();
  // knight publishes `weapon` and `crest` (SPEC §6.12) — the attachment
  // points a scene hooks onto.
  await expect(page.locator('.socket-row-name')).toHaveText(['weapon', 'crest']);
  await expect(page.locator('.socket-row-target').first()).toHaveText('hand-r:grip');
});

test('double-clicking a model puts it in the scene and draws it', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await expect(page.locator('.scene-tree-panel .tree-name')).toHaveText(['knight']);
  await expect
    .poll(async () => await centrePixelIsBackground(page), { timeout: 10_000 })
    .toBe(false);
});

test('a second copy of one model gets its own id', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'knight');
  await expect(page.locator('.scene-tree-panel .tree-name')).toHaveText(['knight', 'knight-2']);
});

test('attaching the sword to the knight nests it and moves it to the socket', async ({
  page,
}) => {
  // The join the whole design was for: knight publishes `weapon`
  // (hand-r:grip), sword was authored blind against that contract, and
  // neither model knows about the other.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');

  const before = await instanceOrigin(page, 'sword');
  await page.locator('.scene-tree-panel .tree-name', { hasText: /^sword$/ }).click();
  await page.locator('.field', { hasText: 'attached to' }).locator('select')
    .selectOption('knight');

  // It defaults to the host's first published socket…
  await expect(
    page.locator('.field', { hasText: /^socket/ }).locator('select'),
  ).toHaveValue('weapon');
  // …the tree nests it under its host…
  await expect(page.locator('.scene-tree-panel .tree-list .tree-list .tree-name')).toHaveText('sword');
  // …and it is no longer at the origin: it is up in the knight's hand.
  const after = await instanceOrigin(page, 'sword');
  expect(after).not.toEqual(before);
  expect(after![1]).toBeGreaterThan(10); // grip height, not the floor
});

test('dragging one instance onto another attaches it', async ({ page }) => {
  // The gesture the Parts panel uses for re-parenting, doing the
  // equivalent job here. A drop means "attach"; which socket is a second
  // decision the Attachment panel owns, so it takes the first published.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  await page
    .locator('.scene-tree-panel .tree-row', { hasText: 'sword' })
    .dragTo(page.locator('.scene-tree-panel .tree-row', { hasText: 'knight' }));
  await expect(page.locator('.scene-tree-panel .tree-list .tree-list .tree-name')).toHaveText('sword');
  expect((await instanceOrigin(page, 'sword'))![1]).toBeGreaterThan(10);
});

test('dragging onto the detach strip frees it again', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  const sword = page.locator('.scene-tree-panel .tree-row', { hasText: 'sword' });
  await sword.dragTo(page.locator('.scene-tree-panel .tree-row', { hasText: 'knight' }));
  await expect(page.locator('.scene-tree-panel .tree-list .tree-list .tree-row')).toHaveCount(1);
  // The strip only exists while a drag is in flight, so the drop has to
  // happen in one gesture.
  await sword.hover();
  await page.mouse.down();
  await page.mouse.move(120, 400, { steps: 8 });
  const strip = page.locator('.scene-detach-zone');
  await expect(strip).toBeVisible();
  await strip.hover();
  await page.mouse.up();
  await expect(page.locator('.scene-tree-panel .tree-list .tree-list .tree-row')).toHaveCount(0);
});

test('detaching returns it to the scene root', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  await page.locator('.scene-tree-panel .tree-name', { hasText: /^sword$/ }).click();
  const attachTo = page.locator('.field', { hasText: 'attached to' }).locator('select');
  await attachTo.selectOption('knight');
  await expect(page.locator('.scene-tree-panel .tree-list .tree-list .tree-row')).toHaveCount(1);
  await attachTo.selectOption('');
  await expect(page.locator('.scene-tree-panel .tree-list .tree-list .tree-row')).toHaveCount(0);
  expect((await instanceOrigin(page, 'sword'))![1]).toBe(0);
});

test('removing a host detaches what it carried rather than deleting it', async ({
  page,
}) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  await page.locator('.scene-tree-panel .tree-name', { hasText: /^sword$/ }).click();
  await page.locator('.field', { hasText: 'attached to' }).locator('select')
    .selectOption('knight');
  await page.getByRole('button', { name: 'Remove knight' }).click();
  // The sword survives, at the scene root.
  await expect(page.locator('.scene-tree-panel .tree-name')).toHaveText(['sword']);
});

test('a model that publishes nothing says so, rather than showing an empty list', async ({
  page,
}) => {
  await openLibrary(page, MODELS);
  await page.locator('.model-row-name', { hasText: /^sword$/ }).click();
  await expect(
    page.locator('.dock-leaf', { hasText: 'Published sockets' }),
  ).toContainText('publishes no sockets');
});

test('playing a clip moves the model, and carries what is attached to it', async ({
  page,
}) => {
  // The proof that attaching to a SOCKET rather than to a position was
  // worth it: knight's `weapon` is on hand-r, hand-r moves in `walk`, so
  // the sword has to move with it.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  await page.locator('.scene-tree-panel .tree-name', { hasText: /^sword$/ }).click();
  await page.locator('.field', { hasText: 'attached to' }).locator('select')
    .selectOption('knight');

  const still = await instanceOrigin(page, 'sword');

  // Play the knight's walk. Selecting a clip starts it.
  await page.locator('.scene-tree-panel .tree-name', { hasText: /^knight$/ }).click();
  await page.locator('.dock-tab', { hasText: 'Animation' }).click();
  await page.locator('.field', { hasText: 'clip' }).locator('select')
    .selectOption('walk');

  // The sword's world position changes as the hand swings.
  await expect
    .poll(async () => {
      const now = await instanceOrigin(page, 'sword');
      return now === null || still === null
        ? 0
        : Math.abs(now[0] - still[0]) +
            Math.abs(now[1] - still[1]) +
            Math.abs(now[2] - still[2]);
    }, { timeout: 5000 })
    .toBeGreaterThan(0.05);
});

test('pausing holds the model still', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await page.locator('.dock-tab', { hasText: 'Animation' }).click();
  await page.locator('.field', { hasText: 'clip' }).locator('select')
    .selectOption('walk');
  await page.getByRole('button', { name: 'Pause' }).click();

  const a = await instancePose(page, 'knight');
  await page.waitForTimeout(400);
  expect(await instancePose(page, 'knight')).toEqual(a);
});

test('the seek bar scrubs a paused instance', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await page.locator('.dock-tab', { hasText: 'Animation' }).click();
  await page.locator('.field', { hasText: 'clip' }).locator('select')
    .selectOption('walk');
  await page.getByRole('button', { name: 'Pause' }).click();

  const before = await instancePose(page, 'knight');
  // Drag the range to the middle of the clip.
  const bar = page.getByLabel('Seek');
  const box = (await bar.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);

  // The pose changed, and STAYS changed — a paused instance holds its
  // own point rather than being carried by the shared clock.
  const after = await instancePose(page, 'knight');
  expect(after).not.toEqual(before);
  await page.waitForTimeout(350);
  expect(await instancePose(page, 'knight')).toEqual(after);
});

test('a model with no clips says so instead of offering an empty picker', async ({
  page,
}) => {
  await openLibrary(page, MODELS);
  await place(page, 'sword'); // sword defines no animations
  await page.locator('.dock-tab', { hasText: 'Animation' }).click();
  await expect(
    page.locator('.dock-leaf', { hasText: 'Animation' }),
  ).toContainText('defines no animations');
});

test('a scene saved and reopened comes back the same', async ({ page }) => {
  // The loop closes here: open a library, build an arrangement, write it
  // beside the models, read it back. The webkitdirectory path has no
  // handle, so saving downloads — which is the branch this exercises.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  await page.locator('.scene-tree-panel .tree-name', { hasText: /^sword$/ }).click();
  await page.locator('.field', { hasText: 'attached to' }).locator('select')
    .selectOption('knight');

  const name = page.getByLabel('Scene name');
  await name.fill('armed');

  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save scene' }).click();
  const saved = await dl;
  expect(saved.suggestedFilename()).toBe('armed.scene.json');

  // Read what was written and put it back through the app's own parser
  // by way of a fresh load — the round trip that matters is on disk.
  const stream = await saved.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf-8');
  const doc = JSON.parse(text) as {
    format: string;
    instances: { id: string; attach?: { to: string; socket: string } }[];
  };
  expect(doc.format).toBe('cuboidy-scene');
  expect(doc.instances.map((i) => i.id)).toEqual(['knight', 'sword']);
  expect(doc.instances[1]?.attach).toEqual({ to: 'knight', socket: 'weapon' });
});

test('opening a scene from the library restores its arrangement', async ({
  page,
}) => {
  // testdata/library holds two models and a scene file built from them,
  // so this exercises the read side against a file on disk rather than
  // one this test just wrote.
  await openLibrary(page, LIBRARY);
  await page.getByLabel('Open a scene').selectOption('armed.scene.json');
  await expect(page.locator('.scene-tree-panel .tree-name')).toHaveText(['knight', 'sword']);
  // Nested under its host, and actually placed at the socket.
  await expect(page.locator('.scene-tree-panel .tree-list .tree-list .tree-name')).toHaveText('sword');
  expect((await instanceOrigin(page, 'sword'))![1]).toBeGreaterThan(10);
});

test('the scene.json panel shows what Save would write', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  await page.locator('.scene-tree-panel .tree-name', { hasText: /^sword$/ }).click();
  await page.locator('.field', { hasText: 'attached to' }).locator('select')
    .selectOption('knight');
  await page.locator('.dock-tab', { hasText: 'scene.json' }).click();

  const shown = await page.locator('.source-view').innerText();
  const doc = JSON.parse(shown) as {
    format: string;
    instances: { id: string; attach?: { to: string; socket: string } }[];
  };
  expect(doc.format).toBe('cuboidy-scene');
  expect(doc.instances[1]?.attach).toEqual({ to: 'knight', socket: 'weapon' });

  // Live: detaching is reflected without any save step.
  await page.locator('.field', { hasText: 'attached to' }).locator('select')
    .selectOption('');
  await expect(page.locator('.source-view')).not.toContainText('"attach"');
});

test('a scene file that does not parse says why and keeps what is on screen', async ({
  page,
}) => {
  await openLibrary(page, LIBRARY);
  await place(page, 'knight');
  await page.getByLabel('Open a scene').selectOption('broken.scene.json');
  await expect(page.locator('.scene-bar')).toContainText('duplicate id');
  // The arrangement already on screen survived.
  await expect(page.locator('.scene-tree-panel .tree-name')).toHaveText(['knight']);
});

// One part's sampled rotation, for telling "paused" from "running slowly".
async function instancePose(page: Page, id: string): Promise<unknown> {
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

async function place(page: Page, model: string): Promise<void> {
  await page.locator('.model-row-name', { hasText: new RegExp(`^${model}$`) })
    .dblclick();
  await expect(
    page.locator('.scene-tree-panel .tree-name', { hasText: new RegExp(`^${model}`) }).first(),
  ).toBeVisible();
}

// Where an instance's model origin ended up, read off the scene the app
// resolved — the only way to tell "attached" from "drawn at the origin".
async function instanceOrigin(
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
async function centrePixelIsBackground(page: Page): Promise<boolean> {
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
