import { afterEach, expect, it, vi } from 'vitest';
import { makeScene, makeProbe } from '../src/scene/defaults';

afterEach(() => vi.unstubAllGlobals());

it('updates paused wave probes and display without advancing time', async () => {
  const replies: any[] = [];
  const context = { postMessage: (m: unknown) => replies.push(m), onmessage: null as any };
  vi.stubGlobal('self', context);
  vi.resetModules();
  await import('../src/workers/fdtd.worker');
  const scene = makeScene({ name: 'paused waves', mode: 'waves' });
  scene.simulation.resolution = 48;
  scene.display.slices = { xy: false, xz: false, yz: false };
  scene.display.arrows = 'none';
  context.onmessage({ data: { type: 'init', generation: 1, scene } });
  const probe = makeProbe([0.1, 0.2, 0.3]);
  context.onmessage({ data: { type: 'config', generation: 1, scene: { ...scene, objects: [probe] } } });
  expect(replies.at(-1).type).toBe('frame');
  expect(replies.at(-1).time).toBe(0);
  expect(replies.at(-1).probes[0].id).toBe(probe.id);
  expect(replies.at(-1).probes[0].position).toEqual([0.1, 0.2, 0.3]);
});
