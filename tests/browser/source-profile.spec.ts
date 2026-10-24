import { expect, test } from '@playwright/test';

for (const objectName of ['Point charge Coulomb source', 'Particle Lorentz motion']) {
  test(`${objectName} retains its finite Maxwell profile while inactive and on reload`, async ({ page }) => {
    test.setTimeout(90000);
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      (window as any).sourceGenerations = [];
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          this.addEventListener('message', event => {
            if (event.data.type === 'ready') (window as any).sourceGenerations.push(event.data.generation);
          });
        }
      };
    });
    await page.goto('/');
    await expect(page.locator('.status-chip.ready')).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: /New custom scene/ }).click();
    await page.getByRole('button', { name: objectName, exact: true }).click();
    await page.getByRole('button', { name: 'Solve', exact: true }).click();
    await page.getByRole('button', { name: '48³', exact: true }).click();
    await page.locator('.check-row').filter({ hasText: 'Use approximation' }).getByRole('switch').click();
    await page.getByRole('button', { name: '16³', exact: true }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const profile = page.getByRole('group', { name: 'Source profile', exact: true }).getByRole('combobox');
    const width = page.getByRole('group', { name: 'Source width', exact: true }).getByRole('textbox');
    await expect(page.locator('.status-chip.ready')).toBeVisible({ timeout: 30000 });
    const generation = () => page.evaluate(() => Math.max(...(window as any).sourceGenerations));
    const legacyGeneration = await generation();
    await expect(profile).toHaveValue('cic');
    await expect(width).toHaveCount(0);
    await profile.selectOption('smooth');
    await expect(width).toHaveValue('0.05');
    await expect.poll(generation).toBeGreaterThan(legacyGeneration);
    const smoothGeneration = await generation();
    await width.fill('0.073'); await width.press('Enter');
    await expect.poll(generation).toBeGreaterThan(smoothGeneration);
    await profile.selectOption('cic');
    await expect(width).toHaveCount(0);
    await profile.selectOption('smooth');
    await expect(width).toHaveValue('0.073');
    await page.getByRole('button', { name: 'Solve', exact: true }).click();
    await page.locator('.check-row').filter({ hasText: 'Use approximation' }).getByRole('switch').click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Smooth source profile is inactive in approximation mode' })).toBeVisible();
    await expect.poll(async () => page.evaluate(() => {
      const saved = localStorage.getItem('fieldlab.scene.v1');
      return saved ? JSON.parse(saved)?.objects?.[0]?.sourceWidth : undefined;
    })).toBe(0.073);
    await page.reload();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.locator('.object-row').first().click();
    await expect(profile).toHaveValue('smooth');
    await expect(width).toHaveValue('0.073');
    await expect(page.getByRole('alert').filter({ hasText: 'Smooth source profile is inactive in approximation mode' })).toBeVisible();
  });
}
