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
              generation: m.generation, steps: m.steps, meta: m.meta,
              diagnostics: m.diagnostics, transforms: m.transforms, energy: m.energy, lineField: m.lines?.field,
              lineStart: m.lines?.lines?.[0]?.points?.slice(0, 3) ?? m.lines?.[0]?.points?.slice(0, 3) });
            if (frames.length > 120) frames.shift();
          }
        });
      }
    };
  });
  await page.goto('/');
  await expect(page.locator('.status-chip.ready')).toBeVisible({ timeout: 30000 });
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
  await page.getByRole('button', { name: 'Restore preset', exact: true }).click();
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
  await page.getByRole('group', { name: 'Dynamics', exact: true }).getByRole('combobox').selectOption('prescribed');
  await page.getByRole('group', { name: 'Trajectory', exact: true }).getByRole('combobox').selectOption('keyframes');
  await page.getByRole('textbox', { name: 'Motion keyframes' }).fill('0,0,0,0,0,0,0\n1,0.2,0.1,0,0,0,90');
  await page.getByRole('button', { name: 'Apply keyframes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restore preset', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Rewind to t = 0', exact: true }).click();
  await expect(page.locator('.object-row')).toHaveCount(1);
  await page.locator('.object-row').click();
  await expect(page.locator('.wire-point')).toHaveCount(3);
  await expect(page.getByRole('textbox', { name: 'Motion keyframes' })).toHaveValue(/0.2, 0.1/);
  await page.getByRole('button', { name: 'Play (space)', exact: true }).click();
  await expect.poll(async () => page.evaluate(() => (window as any).fieldlabFrames.filter((f: any) => f.type === 'frame' && f.time > 0).length)).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Pause (space)', exact: true }).click();
  await page.getByRole('button', { name: 'Rewind to t = 0', exact: true }).click();
  await expect(page.locator('.time-readout b')).toHaveText('0');
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('fieldlab.scene.v1')!).objects[0]?.motion?.kind)).toBe('keyframes');
  await page.reload();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.object-row')).toHaveCount(1);
  await page.locator('.object-row').click();
  await expect(page.getByRole('textbox', { name: 'Motion keyframes' })).toHaveValue(/0.2, 0.1/);
});

test('Maxwell point charges step on physical time and replay preserves edited source data', async ({ page }) => {
  test.setTimeout(60000);
  await page.getByRole('button', { name: 'Pause (space)', exact: true }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('.object-row').first().click();
  const charge = page.getByRole('group', { name: 'Charge', exact: true }).getByRole('textbox');
  await charge.fill('4');
  await charge.press('Enter');
  await page.getByRole('button', { name: 'Solve', exact: true }).click();
  await page.getByRole('button', { name: '48³', exact: true }).click();
  await page.locator('.check-row').filter({ hasText: 'Use approximation' }).getByRole('switch').click();
  await expect(page.locator('.status-chip').filter({ hasText: 'Maxwell FDTD' })).toBeVisible();
  await expect(page.locator('.vp-chip').filter({ hasText: 'time-domain Maxwell' })).toBeVisible();
  await expect(page.locator('.vp-chip').filter({ hasText: 'static / quasistatic' })).toHaveCount(0);
  await expect(page.locator('.vp-chip').filter({ hasText: 'paused' })).toBeVisible();
  await expect(page.locator('.status-chip.ready')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play (space)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  await expect(page.locator('.probe-readout')).toContainText('Total E and B');
  await expect(page.locator('.probe-readout .stat-line').filter({ hasText: 'Potential' })).toHaveCount(0);
  await expect(page.locator('.probe-readout .stat-line').filter({ hasText: /^Dx/ })).toContainText('C/m²');
  await expect(page.locator('.probe-readout .stat-line').filter({ hasText: /^Hy/ })).toContainText('A/m');
  await expect(page.locator('.probe-readout .stat-line').filter({ hasText: /^Jz/ })).toContainText('A/m²');
  await expect(page.locator('.probe-readout .stat-line').filter({ hasText: /^ρ/ })).toContainText('C/m³');
  await expect(page.locator('.measure-card').filter({ hasText: 'Time step' })).toBeVisible();
  await expect(page.locator('.stat-line').filter({ hasText: 'Relative Gauss residual' })).toBeVisible();
  await page.locator('.probe-readout').screenshot({ path: 'artifacts/maxwell-probe-components.png' });
  await page.getByRole('button', { name: 'Single step', exact: true }).click();
  await expect.poll(async () => page.evaluate(() => {
    const frame = (window as any).fieldlabFrames.filter((f: any) => f.diagnostics).at(-1);
    return frame?.steps ?? 0;
  })).toBeGreaterThan(0);
  const frame = await page.evaluate(() => (window as any).fieldlabFrames.filter((f: any) => f.diagnostics).at(-1));
  expect(frame.time).toBeCloseTo(frame.steps * frame.meta.dt, 18);
  expect(Number.isFinite(frame.diagnostics.gaussRelative)).toBe(true);
  expect(frame.transforms).toHaveLength(3);
  expect(frame.transforms[0].position).toEqual([-0.17, 0, 0]);
  await expect(page.locator('.time-readout b')).not.toHaveText('0');
  await page.getByRole('button', { name: 'Rewind to t = 0', exact: true }).click();
  await expect(page.locator('.time-readout b')).toHaveText('0');
  await expect.poll(async () => page.evaluate(() => {
    const latest = (window as any).fieldlabFrames.filter((f: any) => f.diagnostics).at(-1);
    return latest?.generation ?? 0;
  })).toBeGreaterThan(frame.generation);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(charge).toHaveValue('4');
  await page.getByRole('button', { name: 'Single step', exact: true }).click();
  await expect.poll(async () => page.evaluate(() => (window as any).fieldlabFrames.filter((f: any) => f.diagnostics).at(-1)?.steps ?? 0)).toBe(frame.steps);
  const replay = await page.evaluate(() => (window as any).fieldlabFrames.filter((f: any) => f.diagnostics).at(-1));
  expect(replay.probes).toEqual(frame.probes);
  await page.screenshot({ path: 'artifacts/maxwell-point-charges.png' });
});

test('capacitor requires an explicit isolated model and moving bodies share the Maxwell clock', async ({ page }) => {
  test.setTimeout(90000);
  await page.getByRole('button', { name: /Parallel-plate capacitor/ }).click();
  await expect(page.locator('.status-chip.ready')).toBeVisible();
  await page.getByRole('button', { name: 'Pause (space)', exact: true }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('.object-row').first().click();
  await page.getByRole('group', { name: 'Dynamics', exact: true }).getByRole('combobox').selectOption('prescribed');
  await page.getByRole('group', { name: 'Trajectory', exact: true }).getByRole('combobox').selectOption('keyframes');
  await page.getByRole('textbox', { name: 'Motion keyframes' }).fill('0,0,0,0,0,0,0\n1e-8,0,0.01,0,0,0,0');
  await page.getByRole('button', { name: 'Apply keyframes', exact: true }).click();
  await page.getByRole('button', { name: 'Solve', exact: true }).click();
  await page.getByRole('button', { name: '48³', exact: true }).click();
  await page.locator('.check-row').filter({ hasText: 'Use approximation' }).getByRole('switch').click();
  await expect(page.locator('.status-chip.error')).toBeVisible();
  await expect(page.getByRole('alert').first()).toContainText('Initialize plate voltages');
  await page.locator('.check-row').filter({ hasText: 'Initialize plate voltages, then isolate' }).getByRole('switch').click();
  await expect(page.locator('.status-chip.ready')).toBeVisible();
  await page.getByRole('button', { name: 'Single step', exact: true }).click();
  await expect.poll(async () => page.evaluate(() => {
    const frame = (window as any).fieldlabFrames.filter((f: any) => f.diagnostics && f.steps > 0).at(-1);
    return frame?.energy.magnetic ?? 0;
  })).toBeGreaterThan(0);
  // The center probe is 0.16 m from the moving plate; let the change propagate
  // across that gap before asking whether the probe sees a magnetic field.
  await page.getByRole('group', { name: 'Steps per frame', exact: true }).getByRole('slider').fill('12');
  for (const steps of [14, 26]) {
    await page.getByRole('button', { name: 'Single step', exact: true }).click();
    await expect.poll(async () => page.evaluate(() => (window as any).fieldlabFrames.filter((f: any) => f.diagnostics).at(-1)?.steps ?? 0), { timeout: 30000 }).toBe(steps);
  }
  const frame = await page.evaluate(() => (window as any).fieldlabFrames.filter((f: any) => f.diagnostics && f.steps > 0).at(-1));
  expect(frame.transforms[0].position[1]).toBeCloseTo(frame.time * 1e6, 12);
  expect(frame.time).toBeLessThan(1e-8);
  expect(frame.time).toBeCloseTo(frame.steps * frame.meta.dt, 18);
  expect(frame.probes[0].sample.B.some((v: number) => Math.abs(v) > 0)).toBe(true);
  const poseBefore = frame.transforms[0].position;
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  await expect(page.locator('.stat-line').filter({ hasText: 'Physical steps' })).toContainText(String(frame.steps));
  // A paused display edit emits a frame without running the approximation clock.
  await page.getByRole('button', { name: 'View', exact: true }).click();
  const fieldLines = page.getByRole('group', { name: 'Field lines', exact: true }).getByRole('combobox');
  await expect(fieldLines).toBeEnabled();
  await fieldLines.selectOption('B');
  await expect.poll(async () => page.evaluate(() => (window as any).fieldlabFrames.filter((f: any) => f.diagnostics).at(-1)?.lineField)).toBe('B');
  await page.getByRole('group', { name: 'Conductor opacity', exact: true }).getByRole('slider').fill('0.5');
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('fieldlab.scene.v1')!).display.conductorOpacity)).toBe(0.5);
  const latest = await page.evaluate(() => (window as any).fieldlabFrames.filter((f: any) => f.diagnostics).at(-1));
  expect(latest.time).toBe(frame.time);
  expect(latest.transforms[0].position).toEqual(poseBefore);
  await page.screenshot({ path: 'artifacts/maxwell-capacitor.png' });
});

test('passive loop selection preserves authored current and requires an explicitly resolved radius', async ({ page }) => {
  test.setTimeout(60000);
  await page.getByRole('button', { name: /New custom scene/ }).click();
  await page.getByRole('button', { name: 'Loop circular current', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Current', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Solve', exact: true }).click();
  await page.getByRole('button', { name: '48³', exact: true }).click();
  await page.locator('.check-row').filter({ hasText: 'Use approximation' }).getByRole('switch').click();
  await expect(page.locator('.status-chip.ready')).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const model = page.getByRole('group', { name: 'Electrical model', exact: true }).getByRole('combobox');
  await model.selectOption('conducting');
  await expect(page.getByRole('group', { name: 'Current', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Conductivity', exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'three cells' })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('fieldlab.scene.v1')!).objects[0].wireRadius)).toBe(0.008);
  const wireRadius = page.getByRole('group', { name: 'Wire radius', exact: true }).getByRole('textbox');
  await wireRadius.fill('0.04');
  await wireRadius.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'three cells' })).toHaveCount(0);
  await expect(page.locator('.status-chip.ready')).toBeVisible();
  await model.selectOption('impressed');
  await expect(page.getByRole('group', { name: 'Current', exact: true }).getByRole('textbox')).toHaveValue('2');
  await model.selectOption('conducting');
  await page.getByRole('button', { name: 'Solve', exact: true }).click();
  await page.locator('.check-row').filter({ hasText: 'Use approximation' }).getByRole('switch').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'requires Maxwell' })).toBeVisible();
});

test('Maxwell particles expose a single initial velocity control in Dynamics', async ({ page }) => {
  await page.getByRole('button', { name: /New custom scene/ }).click();
  await page.getByRole('button', { name: 'Particle Lorentz motion', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Initial velocity', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Solve', exact: true }).click();
  await page.locator('.check-row').filter({ hasText: 'Use approximation' }).getByRole('switch').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Initial velocity', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Initial linear velocity', exact: true }).getByRole('spinbutton').first()).toHaveValue('1000000');
  await page.getByRole('group', { name: 'Dynamics', exact: true }).getByRole('combobox').selectOption('prescribed');
  await expect(page.getByText('With Stationary selected, prescribed motion holds the initial pose fixed.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Solve', exact: true }).click();
  await page.locator('.check-row').filter({ hasText: 'Use approximation' }).getByRole('switch').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Initial velocity', exact: true }).getByRole('spinbutton').first()).toHaveValue('1000000');
});
