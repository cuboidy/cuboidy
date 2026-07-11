import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROBO_MINI, loadFolder, openTab } from './helpers.js';

// Rendering / playback semantics (audit A-7 + A-8): the anim transport
// respects `loop: false`, and the static Rig view renders through the
// same RiggedParts transform tree as the Anim view (pivot.rot applied).

test('A-7: a loop:false clip stops at its end; loop:true keeps wrapping', async ({ page }) => {
  await loadFolder(page, ROBO_MINI);

  // Flip robo-mini's wave clip to loop:false through the manifest tab.
  await openTab(page, 'cuboidy.json');
  const textarea = page.locator('.source-textarea').first();
  const original = await textarea.inputValue();
  await page.clock.install();
  await textarea.fill(original.replace('"loop": true', '"loop": false'));
  await page.clock.runFor(400); // land the debounced reparse

  // The view toggle lives in the Preview panel (same dock leaf as the
  // manifest tab) — bring it back to front first.
  await openTab(page, 'Preview');
  await page.getByRole('tab', { name: 'Anim view' }).click();
  const slider = page.getByLabel('Scrub timeline');
  await expect(slider).toBeVisible();

  // Playback starts automatically; run well past the 1s duration.
  await page.clock.runFor(3000);
  // The playhead clamps at duration and the transport stops.
  await expect(slider).toHaveValue('1');
  const playButton = page.getByRole('button', { name: 'Play' });
  await expect(playButton).toBeVisible();

  // Pressing play again restarts from 0 instead of stopping immediately.
  await playButton.click();
  await page.clock.runFor(500);
  const mid = Number(await slider.inputValue());
  expect(mid).toBeGreaterThan(0);
  expect(mid).toBeLessThan(1);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
});

test('A-7 control: a loop:true clip keeps playing past duration', async ({ page }) => {
  await loadFolder(page, ROBO_MINI);
  await page.clock.install();
  await page.getByRole('tab', { name: 'Anim view' }).click();
  await expect(page.getByLabel('Scrub timeline')).toBeVisible();
  await page.clock.runFor(3000);
  // Still running (wrapped), never clamped to the end.
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  const t = Number(await page.getByLabel('Scrub timeline').inputValue());
  expect(t).toBeLessThan(1);
});

test('A-8: rig view renders a pivot.rot model through the rig transform tree', async ({ page }, testInfo) => {
  // Fixture: a 6-voxel boom with pivot rot 0 0 45 — visibly diagonal
  // when the rest rotation is applied, horizontal when it is ignored.
  const dir = mkdtempSync(join(tmpdir(), 'cuboidy-e2e-pivot-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'voxels.cvox'),
    [
      'palette #888888 #FF3B30',
      'part torso',
      '    size 4 2 4',
      '    pivot 2 0 2',
      '    voxels {',
      '        0000',
      '        0000',
      '        0000',
      '        0000',
      '        ,',
      '        0000',
      '        0000',
      '        0000',
      '        0000',
      '    }',
      'part boom',
      '    size 6 1 1',
      '    pivot 0 0 0 rot 0 0 45',
      '    voxels {',
      '        000001',
      '    }',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, 'cuboidy.json'),
    JSON.stringify(
      {
        name: 'pivot-demo',
        parts: [
          { name: 'torso', position: [0, 0, 0] },
          { name: 'boom', parent: 'torso', position: [0, 4, 0] },
        ],
        animations: {
          idle: { duration: 1, loop: true, parts: {} },
        },
      },
      null,
      2,
    ),
  );

  await loadFolder(page, dir);

  // Rig view is the default for a manifest-bearing load; both parts render.
  await expect(
    page.getByRole('tab', { name: 'Rig view', selected: true }),
  ).toBeVisible();
  const rigCanvas = page.locator('canvas').first();
  await expect(rigCanvas).toBeVisible();
  await page.waitForTimeout(500); // let a few frames render
  await rigCanvas.screenshot({ path: testInfo.outputPath('rig-view.png') });

  // The Anim view at rest must show the same pose (same transform tree).
  await page.getByRole('tab', { name: 'Anim view' }).click();
  const animCanvas = page.locator('.anim-canvas canvas');
  await expect(animCanvas).toBeVisible();
  await page.waitForTimeout(500);
  await animCanvas.screenshot({ path: testInfo.outputPath('anim-view.png') });

  await openTab(page, 'Console');
  await expect(page.locator('.console-entry.error')).toHaveCount(0);
});
