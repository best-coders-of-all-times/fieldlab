import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeScene, makeMagnet, makeProbe } from '../src/scene/defaults';

afterEach(() => vi.unstubAllGlobals());

describe('Statics worker transport', () => {
  it('preserves probe IDs on coordinate updates and clears removed probes', async () => {
    const replies: any[] = [];
    const context = { postMessage: (m: unknown) => replies.push(m), onmessage: null as any };
    vi.stubGlobal('self', context);
    vi.resetModules();
    await import('../src/workers/statics.worker');
    const scene = makeScene({ name: 'probes' });
    scene.simulation.externalField = [100, 200, 300];
    context.onmessage({ data: { type: 'init', generation: 1, scene } });
    context.onmessage({ data: { type: 'probe', generation: 1, requestId: 1,
      points: [{ id: 'my-probe', position: [0.1, 0.2, 0.3] }] } });
    const reading = replies.at(-1).probes[0];
    expect(reading.id).toBe('my-probe');
    expect(reading.E).toEqual([100, 200, 300]);
    expect(reading.phi).toBeCloseTo(-140);
    context.onmessage({ data: { type: 'probe', generation: 1, requestId: 2, points: [] } });
    expect(replies.at(-1).probes).toEqual([]);
  });

  it('recomputes field overlays and probe samples at the moving source position', async () => {
    const replies: any[] = [];
    const context = { postMessage: (m: unknown) => replies.push(m), onmessage: null as any };
    vi.stubGlobal('self', context);
    vi.resetModules();
    await import('../src/workers/statics.worker');
    const magnet = makeMagnet();
    const probe = makeProbe([0.2, 0, 0]);
    const scene = makeScene({ name: 'moving', objects: [magnet, probe] });
    scene.display.slices = { xy: false, xz: false, yz: false };
    scene.display.fieldLines = 'B';
    scene.display.lineCount = 8;
    context.onmessage({ data: { type: 'init', generation: 3, scene } });
    const before = replies.at(-1).probes[0].Bmag;
    context.onmessage({ data: { type: 'frame', generation: 3, requestId: 1, time: 0.5,
      transforms: [{ id: magnet.id, position: [0.25, 0, 0], rotation: [0, 0, 0] }],
      display: scene.display, probes: [probe] } });
    const frame = replies.at(-1);
    expect(frame.type).toBe('frame');
    expect(frame.time).toBe(0.5);
    expect(frame.probes[0].Bmag).toBeGreaterThan(before * 2);
    expect(frame.lines.field).toBe('B');
    expect(frame.lines.lines.length).toBeGreaterThan(0);
  });
});
