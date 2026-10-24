import { expect, test } from '@playwright/test';

test('explicit Maxwell test particle saves feedback, disables dormant shape and replays on the field clock', async ({ page }) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    (window as any).particleMessages = [];
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', event => {
          if (['ready', 'frame'].includes(event.data.type)) (window as any).particleMessages.push(event.data);
        });
      }
    };
  });
  await page.goto('/');
  await expect(page.locator('.status-chip.ready')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: /New custom scene/ }).click();
  await page.getByRole('button', { name: 'Particle Lorentz motion', exact: true }).click();
  await page.getByRole('button', { name: 'Solve', exact: true }).click();
  await page.getByRole('button', { name: 'Open + external E', exact: true }).click();
  await page.getByRole('group', { name: 'External E', exact: true }).getByRole('spinbutton').nth(0).fill('100');
  await page.getByRole('button', { name: '48³', exact: true }).click();
  await page.locator('.check-row').filter({ hasText: 'Use approximation' }).getByRole('switch').click();
  await page.getByRole('button', { name: '16³', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const feedback = page.getByRole('group', { name: 'Field feedback', exact: true }).getByRole('combobox');
  const profile = page.getByRole('group', { name: 'Source profile', exact: true }).getByRole('combobox');
  const width = page.getByRole('group', { name: 'Source width', exact: true }).getByRole('textbox');
  await expect(feedback).toHaveValue('source');
  await profile.selectOption('smooth');
  await width.fill('0.073'); await width.press('Enter');
  await expect(page.locator('.status-chip.ready')).toBeVisible({ timeout: 30000 });
  const generation = () => page.evaluate(() => Math.max(...(window as any).particleMessages.filter((m: any) => m.type === 'ready').map((m: any) => m.generation)));
  const sourceGeneration = await generation();
  await feedback.selectOption('testParticle');
  await expect.poll(generation).toBeGreaterThan(sourceGeneration);
  await expect(profile).toBeDisabled(); await expect(width).toBeDisabled();
  await expect(page.getByText(/Source profile and width are inactive for this test particle/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const object = JSON.parse(localStorage.getItem('fieldlab.scene.v1')!).objects[0];
    return { feedback: object.fieldFeedback, profile: object.sourceProfile, width: object.sourceWidth };
  })).toEqual({ feedback: 'testParticle', profile: 'smooth', width: 0.073 });
  await page.getByRole('button', { name: 'Single step', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).particleMessages.filter((m: any) => m.type === 'frame' && m.diagnostics).at(-1)?.steps ?? 0)).toBeGreaterThan(0);
  const final = await page.evaluate(() => (window as any).particleMessages.filter((m: any) => m.type === 'frame' && m.diagnostics).at(-1));
  expect(final.time).toBeCloseTo(final.steps * final.meta.dt, 18);
  expect(final.transforms[0].position[0]).toBeLessThan(0);
  expect(final.diagnostics.sourceParticleCount).toBe(0);
  expect(final.diagnostics.sourceParticleWork).toBe(0);
  expect(final.diagnostics.sourceParticleCouplingRelative).toBe(0);
  await page.getByRole('button', { name: 'Rewind to t = 0', exact: true }).click();
  await expect.poll(generation).toBeGreaterThan(final.generation);
  await expect(page.locator('.time-readout b')).toHaveText('0');
  await expect(feedback).toHaveValue('testParticle');
  await page.getByRole('button', { name: 'Single step', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).particleMessages.filter((m: any) => m.type === 'frame' && m.diagnostics).at(-1)?.steps ?? 0)).toBe(final.steps);
  const replay = await page.evaluate(() => (window as any).particleMessages.filter((m: any) => m.type === 'frame' && m.diagnostics).at(-1));
  expect(replay.transforms).toEqual(final.transforms);
  expect(replay.energy).toEqual(final.energy);
  await page.getByRole('button', { name: 'Solve', exact: true }).click();
  await page.locator('.check-row').filter({ hasText: 'Use approximation' }).getByRole('switch').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(feedback).toHaveCount(0);
  await expect(page.getByText(/Approximation always uses test particles/)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('.object-row').first().click();
  await expect(profile).toHaveValue('smooth'); await expect(width).toHaveValue('0.073');
  await page.getByRole('button', { name: 'Solve', exact: true }).click();
  await page.locator('.check-row').filter({ hasText: 'Use approximation' }).getByRole('switch').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(feedback).toHaveValue('testParticle');
  await expect(profile).toBeDisabled(); await expect(width).toBeDisabled();
  await feedback.selectOption('source');
  await expect(profile).toBeEnabled(); await expect(width).toBeEnabled();
  await expect(width).toHaveValue('0.073');
});
