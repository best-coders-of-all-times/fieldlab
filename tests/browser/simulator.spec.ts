import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const frames: any[] = [];
    (window as any).fieldlabFrames = frames;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', event => {
          const m = event.data;
          if (m.type === 'probe' || m.type === 'frame' || m.type === 'lines') {
            frames.push({ type: m.type, time: m.time, probes: m.probes, field: m.field,
              lineStart: m.lines?.lines?.[0]?.points?.slice(0, 3) ?? m.lines?.[0]?.points?.slice(0, 3) });
            if (frames.length > 120) frames.shift();
          }
        });
      }
    };
  });
  await page.goto('/');
  await expect(page.locator('.status-chip.ready')).toBeVisible();
});

test('applied fields change samples and incoming field lines; probes expose vectors', async ({ page }) => {
  await expect(page.getByRole('tablist', { name: 'Simulation mode' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Solve', exact: true }).click();
  await page.getByRole('button', { name: 'Open + external E', exact: true }).click();
  const external = page.getByRole('group', { name: 'External E', exact: true }).getByRole('spinbutton');
  await external.nth(1).fill('1000');
  await expect(page.locator('.status-chip.ready')).toBeVisible();
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  await page.getByRole('button', { name: 'Add probe here', exact: true }).click();
  const position = page.getByRole('group', { name: 'Position', exact: true }).getByRole('spinbutton');
  await position.nth(0).fill('0.3');
  await position.nth(1).fill('0.2');
  await expect(page.locator('.probe-readout')).toContainText('Ey');
  await expect(page.locator('.probe-readout')).toContainText('Bz');
  await expect(page.locator('.probe-label').last()).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const p = (window as any).fieldlabFrames.filter((f: any) => f.probes?.length).at(-1)?.probes.at(-1);
    return p?.E[1];
  })).toBeGreaterThan(500);
  const positive = await page.evaluate(() => (window as any).fieldlabFrames.filter((f: any) => f.probes?.length).at(-1).probes.at(-1).E[1]);
  await page.getByRole('button', { name: 'Solve', exact: true }).click();
  await external.nth(1).fill('-1000');
  await expect.poll(async () => page.evaluate(() => {
    const p = (window as any).fieldlabFrames.filter((f: any) => f.probes?.length).at(-1)?.probes.at(-1);
    return p?.E[1];
  })).toBeCloseTo(positive - 2000, 5);
});

test('moving magnet fields update while it animates', async ({ page }) => {
  await page.getByRole('button', { name: /Magnet through a loop/ }).click();
  await expect.poll(async () => page.evaluate(() => (window as any).fieldlabFrames.filter((f: any) => f.type === 'frame' && f.lineStart).length)).toBeGreaterThan(2);
  const starts = await page.evaluate(() => (window as any).fieldlabFrames.filter((f: any) => f.type === 'frame' && f.lineStart).map((f: any) => f.lineStart[0]));
  expect(Math.max(...starts) - Math.min(...starts)).toBeGreaterThan(0.005);
  await page.getByRole('button', { name: 'Pause (space)', exact: true }).click();
  await page.screenshot({ path: 'artifacts/moving-magnet.png' });
});

test('wave reset restores preset physics and probes update while paused', async ({ page }) => {
  await page.getByRole('button', { name: /Plane electromagnetic wave/ }).click();
  await expect(page.locator('.status-chip.ready')).toBeVisible();
  await page.getByRole('button', { name: 'Pause (space)', exact: true }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('.object-row').first().click();
  const frequency = page.getByRole('group', { name: 'Frequency', exact: true }).getByRole('textbox');
  await frequency.fill('150');
  await frequency.press('Enter');
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  await expect(page.locator('.stat-line').filter({ hasText: 'Frequency' })).toContainText('150');
  await page.getByRole('button', { name: 'Reset scene', exact: true }).click();
  await expect(page.locator('.stat-line').filter({ hasText: 'Frequency' })).toContainText('300');
  await page.getByRole('button', { name: 'Add probe here', exact: true }).click();
  await expect(page.locator('.probe-readout')).toContainText('Ex');
  await expect(page.locator('.time-readout b')).toHaveText('0');
});

test('cavity opens transparent and custom wires and motion survive reset', async ({ page }) => {
  await page.getByRole('button', { name: /Conductor with a cavity/ }).click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  const opacity = page.getByRole('group', { name: 'Conductor opacity', exact: true });
  await expect(opacity.getByRole('slider')).toHaveValue('0.15');
  await expect(page.locator('.status-chip.ready')).toBeVisible();
  await page.screenshot({ path: 'artifacts/cavity.png' });
  await page.getByRole('button', { name: /New custom scene/ }).click();
  await page.getByRole('button', { name: 'Wire current filament', exact: true }).click();
  await page.getByRole('button', { name: 'Add control point', exact: true }).click();
  await expect(page.locator('.wire-point')).toHaveCount(3);
  await page.getByRole('group', { name: 'Path shape', exact: true }).getByRole('combobox').selectOption('smooth');
  await page.getByRole('group', { name: 'Trajectory', exact: true }).getByRole('combobox').selectOption('keyframes');
  await page.getByRole('textbox', { name: 'Motion keyframes' }).fill('0,0,0,0,0,0,0\n1,0.2,0.1,0,0,0,90');
  await page.getByRole('button', { name: 'Apply keyframes', exact: true }).click();
  await page.getByRole('button', { name: 'Reset scene', exact: true }).click();
  await expect(page.locator('.object-row')).toHaveCount(1);
  await page.locator('.object-row').click();
  await expect(page.locator('.wire-point')).toHaveCount(3);
  await expect(page.getByRole('textbox', { name: 'Motion keyframes' })).toHaveValue(/0.2, 0.1/);
  await page.getByRole('button', { name: 'Play (space)', exact: true }).click();
  await expect.poll(async () => page.evaluate(() => (window as any).fieldlabFrames.filter((f: any) => f.type === 'frame' && f.time > 0).length)).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Pause (space)', exact: true }).click();
  await page.getByRole('button', { name: 'Reset scene', exact: true }).click();
  await expect(page.locator('.time-readout b')).toHaveText('0');
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('fieldlab.scene.v1')!).objects[0]?.motion?.kind)).toBe('keyframes');
  await page.reload();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.object-row')).toHaveCount(1);
  await page.locator('.object-row').click();
  await expect(page.getByRole('textbox', { name: 'Motion keyframes' })).toHaveValue(/0.2, 0.1/);
});
