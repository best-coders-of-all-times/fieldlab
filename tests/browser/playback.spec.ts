import { expect, test, type Locator, type Page } from '@playwright/test';

async function loadMaxwell(page: Page, name = /Maxwell: moving isolated capacitor/) {
  await page.goto('/');
  await expect(page.locator('.status-chip.ready')).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name }).click();
  await expect(page.locator('.status-chip.ready')).toBeVisible({ timeout: 60000 });
  const pause = page.getByRole('button', { name: 'Pause (space)', exact: true });
  if (await pause.isVisible().catch(() => false)) await pause.click();
  await page.getByRole('button', { name: 'Solve', exact: true }).click();
}

async function setText(page: Page, group: string, value: string) {
  const input = page.getByRole('group', { name: group, exact: true }).getByRole('textbox');
  await input.fill(value);
  await input.press('Enter');
}

async function setRange(locator: Locator, value: number) {
  await locator.evaluate((node, next) => {
    const input = node as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, String(next));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test('precomputes a window, locks edits, scrubs, loops and returns to live', async ({ page }) => {
  test.setTimeout(90000);
  await loadMaxwell(page);
  await setText(page, 'End physical time', '1e-9');
  await setText(page, 'Frames', '6');
  await expect(page.locator('.stat-line').filter({ hasText: 'Cached frames' })).toContainText('6');

  await page.getByRole('button', { name: 'Precompute cached window', exact: true }).click();
  const chip = page.locator('.status-chip.playback');
  await expect(chip).toContainText('cached 1/6', { timeout: 60000 });
  await expect(page.locator('.playback-badge')).toHaveText('cached');

  await expect(page.getByTitle('Move (G)')).toBeDisabled();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.add-btn').first()).toBeDisabled();
  const rows = page.locator('.object-row');
  const rowCount = await rows.count();
  await rows.first().click();
  await page.keyboard.press('Delete');
  await expect(rows).toHaveCount(rowCount);
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Field lines', exact: true }).getByRole('combobox')).toBeDisabled();
  await page.getByTitle('Front camera (2)').click();
  await page.getByRole('button', { name: 'Solve', exact: true }).click();

  await page.getByRole('button', { name: 'Play (space)', exact: true }).click();
  await expect.poll(async () => chip.innerText(), { timeout: 5000 }).toMatch(/cached (2|3|4|5|6)\/6/);
  await page.getByRole('button', { name: 'Pause (space)', exact: true }).click();

  const slider = page.locator('.playback-scrub input[type=range]');
  await setRange(slider, 3);
  await expect(chip).toContainText('cached 4/6');
  await expect(page.locator('.time-readout b')).not.toHaveText('0');

  await page.getByRole('button', { name: '12 fps', exact: true }).click();
  await setRange(slider, 5);
  await expect(chip).toContainText('cached 6/6');
  await page.getByRole('button', { name: 'Play (space)', exact: true }).click();
  await expect.poll(async () => chip.innerText(), { timeout: 5000 }).toMatch(/cached [1-5]\/6/);
  await page.getByRole('button', { name: 'Pause (space)', exact: true }).click();

  await page.locator('.right-panel').getByRole('button', { name: 'Return to live', exact: true }).click();
  await expect(page.locator('.status-chip.playback')).toHaveCount(0);
  await expect(page.locator('.status-chip.ready')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.time-readout b')).toHaveText('0');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.add-btn').first()).toBeEnabled();
  await page.screenshot({ path: 'artifacts/playback-cached.png' });
});

test('cancels a running precompute and returns to live', async ({ page }) => {
  test.setTimeout(90000);
  await loadMaxwell(page);
  await page.getByRole('button', { name: '24³', exact: true }).click();
  await expect(page.locator('.status-chip.ready')).toBeVisible({ timeout: 60000 });
  await setText(page, 'End physical time', '2e-7');
  await setText(page, 'Frames', '1200');
  await page.getByRole('button', { name: 'Precompute cached window', exact: true }).click();
  await expect(page.locator('.playback-progress')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel precompute', exact: true }).click();
  await expect(page.locator('.status-chip.playback')).toHaveCount(0);
  await expect(page.locator('.status-chip.ready')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.time-readout b')).toHaveText('0');
});

test('rejects an over-cap preflight before caching frames', async ({ page }) => {
  test.setTimeout(90000);
  await loadMaxwell(page);
  await setText(page, 'End physical time', '1e-6');
  await setText(page, 'Frames', '1200');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.locator('.check-row').filter({ hasText: 'XZ plane' }).getByRole('switch').click();
  await page.locator('.check-row').filter({ hasText: 'YZ plane' }).getByRole('switch').click();
  await page.getByRole('group', { name: 'Field lines', exact: true }).getByRole('combobox').selectOption('E');
  await setRange(page.getByRole('group', { name: 'Lines / seeds', exact: true }).getByRole('slider'), 140);
  await setRange(page.getByRole('group', { name: 'Arrow density', exact: true }).getByRole('slider'), 16);
  await page.getByRole('button', { name: 'Solve', exact: true }).click();
  await expect(page.getByRole('alert').first()).toContainText('cache limit', { timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Precompute cached window', exact: true })).toBeDisabled();
  await expect(page.locator('.status-chip.playback')).toHaveCount(0);
});

test('persists the authored window but never the cached runtime on reload', async ({ page }) => {
  test.setTimeout(90000);
  await loadMaxwell(page);
  await setText(page, 'End physical time', '2e-9');
  await setText(page, 'Frames', '8');
  const end = page.getByRole('group', { name: 'End physical time', exact: true }).getByRole('textbox');
  const authored = await end.inputValue();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem('fieldlab.scene.v1');
    return raw ? JSON.parse(raw).simulation.playback?.sampleCount : null;
  })).toBe(8);
  await page.reload();
  await expect(page.locator('.status-chip.ready')).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: 'Solve', exact: true }).click();
  await expect(page.getByRole('group', { name: 'End physical time', exact: true }).getByRole('textbox')).toHaveValue(authored);
  await expect(page.locator('.status-chip.playback')).toHaveCount(0);
  await expect(page.locator('.playback-progress')).toHaveCount(0);
});
