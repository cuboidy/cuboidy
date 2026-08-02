import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  attachedNames,
  centrePixelIsBackground,
  instanceNames,
  instanceOrigin,
  instancePose,
  openLibrary,
  place,
  socketRow,
} from './helpers.js';

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
      page.locator('.model-card-name', { hasText: new RegExp(`^${name}$`) }),
    ).toBeVisible();
  }
  // Every shipped model lints clean, so none should be flagged here — the
  // workspace agreeing with cuboidy-lint about what is wrong with a model
  // is the point of routing through core's resolveProject.
  await expect(page.locator('.model-card-warn')).toHaveCount(0);
});

test('the scene starts empty and says how to fill it', async ({ page }) => {
  await openLibrary(page, MODELS);
  await expect(page.locator('.scene-hint')).toBeVisible();
  await expect(page.locator('.scene-tree-panel .tree-row')).toHaveCount(0);
  // No pixel assertion here: the ground grid is drawn either way, so the
  // canvas is legitimately not blank with an empty scene.
});

test('a placed model shows what it publishes, and what each resolves to', async ({
  page,
}) => {
  // knight publishes `weapon` and `crest` (SPEC §6.12) — the attachment
  // points a scene hooks onto. Both live in the Instances tree now; the
  // Published sockets panel that used to hold them was a second view of
  // the same fact.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await expect(page.locator('.scene-tree-panel .socket-name')).toHaveText([
    'weapon',
    'crest',
  ]);
  // The part:socket a published name resolves to — what you need when the
  // socket is in the wrong place and a model has to be fixed.
  await expect(
    page.locator('.scene-tree-panel .socket-target').first(),
  ).toHaveText('hand-r:grip');
});

test('double-clicking a model puts it in the scene and draws it', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await expect(instanceNames(page)).toHaveText(['knight']);
  await expect
    .poll(async () => await centrePixelIsBackground(page), { timeout: 10_000 })
    .toBe(false);
});

test('a second copy of one model gets its own id', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'knight');
  await expect(instanceNames(page)).toHaveText(['knight', 'knight-2']);
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
  await page.locator('.scene-tree-panel .tree-row[draggable] .tree-name', { hasText: /^sword$/ }).click();
  await page.locator('.field', { hasText: 'attached to' }).locator('select')
    .selectOption('knight');

  // It defaults to the host's first published socket…
  await expect(
    page.locator('.field', { hasText: /^socket/ }).locator('select'),
  ).toHaveValue('weapon');
  // …the tree nests it under the SOCKET, under its host…
  await expect(attachedNames(page)).toHaveText(['sword']);
  // …and it is no longer at the origin: it is up in the knight's hand.
  const after = await instanceOrigin(page, 'sword');
  expect(after).not.toEqual(before);
  expect(after![1]).toBeGreaterThan(10); // grip height, not the floor
});

test('dragging an instance onto a socket attaches it there', async ({ page }) => {
  // Sockets are rows, so the drop target is the socket itself rather than
  // the host — no guessing which of `weapon` and `crest` was meant.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  await page
    .locator('.scene-tree-panel .tree-row', { hasText: 'sword' })
    .dragTo(socketRow(page, 'weapon'));
  await expect(attachedNames(page)).toHaveText(['sword']);
  expect((await instanceOrigin(page, 'sword'))![1]).toBeGreaterThan(10);
});

test('dragging to the other socket moves it there', async ({ page }) => {
  // What used to need the Attachment panel's dropdown.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  const sword = page.locator('.scene-tree-panel .tree-row', { hasText: 'sword' });
  await sword.dragTo(socketRow(page, 'weapon'));
  const onWeapon = await instanceOrigin(page, 'sword');

  await page
    .locator('.scene-tree-panel .tree-row[draggable]', { hasText: 'sword' })
    .dragTo(socketRow(page, 'crest'));
  await expect(
    page.locator('.field', { hasText: /^socket/ }).locator('select'),
  ).toHaveValue('crest');
  expect(await instanceOrigin(page, 'sword')).not.toEqual(onWeapon);
});

test('dragging onto the detach strip frees it again', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  const sword = page.locator('.scene-tree-panel .tree-row', { hasText: 'sword' });
  await sword.dragTo(socketRow(page, 'weapon'));
  await expect(attachedNames(page)).toHaveCount(1);
  // The strip only exists while a drag is in flight, so the drop has to
  // happen in one gesture.
  await sword.hover();
  await page.mouse.down();
  await page.mouse.move(120, 400, { steps: 8 });
  const strip = page.locator('.scene-detach-zone');
  await expect(strip).toBeVisible();
  await strip.hover();
  await page.mouse.up();
  await expect(attachedNames(page)).toHaveCount(0);
});

test('detaching returns it to the scene root', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  await page.locator('.scene-tree-panel .tree-row[draggable] .tree-name', { hasText: /^sword$/ }).click();
  const attachTo = page.locator('.field', { hasText: 'attached to' }).locator('select');
  await attachTo.selectOption('knight');
  await expect(attachedNames(page)).toHaveCount(1);
  await attachTo.selectOption('');
  await expect(attachedNames(page)).toHaveCount(0);
  expect((await instanceOrigin(page, 'sword'))![1]).toBe(0);
});

test('removing a host detaches what it carried rather than deleting it', async ({
  page,
}) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  await page.locator('.scene-tree-panel .tree-row[draggable] .tree-name', { hasText: /^sword$/ }).click();
  await page.locator('.field', { hasText: 'attached to' }).locator('select')
    .selectOption('knight');
  // Removing is a Properties action now, as Delete part is in the editor —
  // so it acts on the SELECTION and you can see what it will take.
  await page.locator('.scene-tree-panel .tree-row[draggable] .tree-name', { hasText: /^knight$/ }).click();
  await page.getByRole('button', { name: 'Remove from scene' }).click();
  // The sword survives, at the scene root.
  await expect(instanceNames(page)).toHaveText(['sword']);
});

test('a scene with nothing to attach to says so', async ({ page }) => {
  // Not with a paragraph — with the control. Nothing publishes a socket,
  // so the picker is disabled and carries the reason, the same way an
  // unavailable tool in the viewport does.
  await openLibrary(page, MODELS);
  await place(page, 'sword'); // publishes nothing
  const picker = page.locator('.field', { hasText: 'attached to' }).locator('select');
  await expect(picker).toBeDisabled();
  await expect(picker).toHaveAttribute('title', /publishes a socket/);
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
  await page.locator('.scene-tree-panel .tree-row[draggable] .tree-name', { hasText: /^sword$/ }).click();
  await page.locator('.field', { hasText: 'attached to' }).locator('select')
    .selectOption('knight');

  const still = await instanceOrigin(page, 'sword');

  // Play the knight's walk. Selecting a clip starts it.
  await page.locator('.scene-tree-panel .tree-row[draggable] .tree-name', { hasText: /^knight$/ }).click();
  await page.getByLabel('Clip').selectOption('walk');

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
  await page.getByLabel('Clip').selectOption('walk');
  await page.getByRole('button', { name: 'Pause' }).click();

  const a = await instancePose(page, 'knight');
  await page.waitForTimeout(400);
  expect(await instancePose(page, 'knight')).toEqual(a);
});

test('the seek bar scrubs a paused instance', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await page.getByLabel('Clip').selectOption('walk');
  await page.getByRole('button', { name: 'Pause' }).click();

  // BOTH ends of the comparison are seeked to. Reading the pose straight
  // after Pause would compare against wherever the clock happened to
  // reach between selecting the clip and the click landing — which on a
  // loaded machine can be the very point the seek then moves to, and the
  // test fails for a reason that has nothing to do with seeking.
  const bar = page.getByLabel('Scrub timeline');
  const box = (await bar.boundingBox())!;
  const seekTo = async (frac: number): Promise<void> => {
    await page.mouse.click(box.x + box.width * frac, box.y + box.height / 2);
  };

  await seekTo(0.2);
  const before = await instancePose(page, 'knight');
  await seekTo(0.7);
  const after = await instancePose(page, 'knight');

  // The pose changed, and STAYS changed — a paused instance holds its
  // own point rather than being carried by the shared clock.
  expect(after).not.toEqual(before);
  await page.waitForTimeout(350);
  expect(await instancePose(page, 'knight')).toEqual(after);
});

test('a model with no clips says so instead of offering an empty picker', async ({
  page,
}) => {
  // Said by the transport, which is inert and carries the reason — the
  // same convention as an unavailable tool or view.
  await openLibrary(page, MODELS);
  await place(page, 'sword'); // sword defines no animations
  const play = page.getByRole('button', { name: 'Play' });
  await expect(play).toBeDisabled();
  await expect(play).toHaveAttribute('title', /defines no animations/);
});

test('a scene saved and reopened comes back the same', async ({ page }) => {
  // The loop closes here: open a library, build an arrangement, write it
  // beside the models, read it back. The webkitdirectory path has no
  // handle, so saving downloads — which is the branch this exercises.
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  await page.locator('.scene-tree-panel .tree-row[draggable] .tree-name', { hasText: /^sword$/ }).click();
  await page.locator('.field', { hasText: 'attached to' }).locator('select')
    .selectOption('knight');

  // A scene with no file yet has nothing to write back to, so Save asks
  // where — which is Save as.
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const field = page.getByLabel('Save scene as');
  await field.fill('armed');
  await field.press('Enter');
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
  await page.locator('.scene-file', { hasText: 'armed.scene.json' }).click();
  await expect(instanceNames(page)).toHaveText(['knight', 'sword']);
  // Nested under its host, and actually placed at the socket.
  await expect(attachedNames(page)).toHaveText(['sword']);
  expect((await instanceOrigin(page, 'sword'))![1]).toBeGreaterThan(10);
});

test('the scene.json panel shows what Save would write', async ({ page }) => {
  await openLibrary(page, MODELS);
  await place(page, 'knight');
  await place(page, 'sword');
  await page.locator('.scene-tree-panel .tree-row[draggable] .tree-name', { hasText: /^sword$/ }).click();
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
  // Placing made it dirty, so the discard guard asks first — say yes,
  // because what this is about is what happens AFTER that.
  page.on('dialog', (d) => void d.accept());
  await page.locator('.scene-file', { hasText: 'broken.scene.json' }).click();
  await expect(page.locator('.notice-banner')).toContainText('duplicate id');
  // The arrangement already on screen survived.
  await expect(instanceNames(page)).toHaveText(['knight']);
});

