import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
});

test('panel closure expands the canvas', async ({ page }) => {
  await page.getByTitle('Toggle library', { exact: true }).click();
  await page.getByTitle('Toggle inspector', { exact: true }).click();
  await expect.poll(async () => (await page.locator('.viewport canvas').boundingBox())?.width ?? 0).toBeGreaterThan(1400);
});
test('mobile resize closes overlapping drawers and keeps toolbar within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.left-panel')).toHaveCount(0);
  await expect(page.locator('.right-panel')).toHaveCount(0);
  await expect.poll(async () => (await page.locator('.viewport canvas').boundingBox())?.width ?? 0).toBeGreaterThan(300);
  expect(await page.locator('.topbar').evaluate(el => el.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByTitle('Toggle library', { exact: true }).click();
  await page.getByTitle('Toggle inspector', { exact: true }).click();
  await expect(page.locator('.left-panel')).toHaveCount(0);
  await expect(page.locator('.right-panel')).toBeVisible();
});
test('Space activates a focused tab without pausing playback', async ({ page }) => {
  const playing = await page.getByTitle('Pause (space)', { exact: true }).count();
  await page.getByRole('button', { name: 'View', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.right-tabs .active')).toHaveText('View');
  expect(await page.getByTitle('Pause (space)', { exact: true }).count()).toBe(playing);
});
test('object names allow spaces while typing and reject blank commits', async ({ page }) => {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('.object-select').first().click();
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  await name.fill('');
  await name.pressSequentially('My test charge');
  await name.press('Tab');
  await expect(name).toHaveValue('My test charge');
  await name.fill('   ');
  await name.press('Tab');
  await expect(name).toHaveValue('My test charge');
});
test('Help traps focus, Escape dismisses and restores trigger focus', async ({ page }) => {
  const trigger = page.getByTitle('Help & shortcuts');
  await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab');
    expect(await page.getByRole('dialog').evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
test('invalid imports retain the scene and show persistent file errors', async ({ page }) => {
  await page.locator('input[type=file]').setInputFiles('tests/fixtures/qa-import/empty-object.fieldlab.json');
  await expect(page.getByRole('alert')).toContainText('Import failed (empty-object.fieldlab.json): objects[0]');
  await expect(page.locator('.workspace')).toBeVisible();
  await page.waitForTimeout(10000);
  await expect(page.getByRole('alert')).toBeVisible();
});
test('corrupt saves are preserved until explicit recovery', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('fieldlab.scene.v1', '{broken'));
  await page.reload();
  await expect(page.locator('.save-status.corrupt')).toContainText('preserved');
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => localStorage.getItem('fieldlab.scene.v1'))).toBe('{broken');
});
test('storage read failure is visible', async ({ context, page }) => {
  await context.addInitScript(() => { Storage.prototype.getItem = () => { throw new Error('blocked'); }; });
  await page.reload();
  await expect(page.locator('.save-status.unavailable')).toContainText('Export');
});
test('denied WebGL keeps the editor and scene export available', async ({ context, page }) => {
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (/^webgl/.test(type)) return null;
      return original.call(this, type as '2d', ...args as []) as any;
    } as typeof original;
  });
  await page.reload();
  await expect(page.locator('.graphics-fallback')).toContainText('WebGL');
  await expect(page.getByTitle('Export scene JSON')).toBeEnabled();
});
test('valid preset import remains supported', async ({ page }) => {
  await page.locator('input[type=file]').setInputFiles('tests/fixtures/qa-import/valid-solenoid.fieldlab.json');
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('fieldlab.scene.v1') ?? '{}').name)).toBe('Solenoid');
});
