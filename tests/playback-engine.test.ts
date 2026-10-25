import { describe, expect, it } from 'vitest';
import { PlaybackEngine } from '../src/app/playbackEngine';

function harness(frameCount = 5, fps = 10, loop = true) {
  let now = 0, nextId = 1;
  const callbacks = new Map<number, (time: number) => void>();
  const emitted: number[] = [];
  const states: Array<{ frameIndex: number; playing: boolean }> = [];
  const engine = new PlaybackEngine(frameCount, {
    emitFrame: (index) => emitted.push(index),
    onState: (state) => states.push(state),
    now: () => now,
    requestFrame: (cb) => {
      const id = nextId++;
      callbacks.set(id, cb);
      return id;
    },
    cancelFrame: (id) => { callbacks.delete(id); },
  }, { fps, loop });
  const advance = (ms: number) => {
    now += ms;
    const pending = [...callbacks.entries()];
    callbacks.clear();
    for (const [, cb] of pending) cb(now);
  };
  return { engine, emitted, states, advance, pending: () => callbacks.size };
}

describe('PlaybackEngine', () => {
  it('emits the selected frame and stays paused until asked to play', () => {
    const h = harness();
    h.engine.start(2, false);
    expect(h.emitted).toEqual([2]);
    expect(h.engine.state).toEqual({ frameIndex: 2, playing: false });
    expect(h.pending()).toBe(0);
  });

  it('advances at wall-clock fps and emits only the latest skipped frame', () => {
    const h = harness(5, 10, false);
    h.engine.start(0, true);
    h.advance(16);
    expect(h.emitted).toEqual([0]);
    h.advance(100);
    expect(h.emitted.at(-1)).toBe(1);
    h.advance(250);
    const count = h.emitted.length;
    expect(h.emitted.at(-1)).toBeGreaterThanOrEqual(3);
    expect(h.emitted).toHaveLength(count);
  });

  it('clamps a large tab-resume delta to 250 ms', () => {
    const h = harness(10, 10, false);
    h.engine.start(0, true);
    h.advance(5000);
    expect(h.emitted.at(-1)).toBe(2);
  });

  it('loops to the first frame', () => {
    const h = harness(5, 10, true);
    h.engine.start(3, true);
    h.advance(100);
    expect(h.emitted.at(-1)).toBe(4);
    h.advance(100);
    expect(h.emitted.at(-1)).toBe(0);
  });

  it('pauses at the last frame when looping is off', () => {
    const h = harness(5, 10, false);
    h.engine.start(3, true);
    h.advance(1000);
    expect(h.emitted.at(-1)).toBe(4);
    expect(h.engine.state).toEqual({ frameIndex: 4, playing: false });
    expect(h.states.at(-1)).toEqual({ frameIndex: 4, playing: false });
  });

  it('restarts from zero when play is requested at the end without loop', () => {
    const h = harness(5, 10, false);
    h.engine.start(4, false);
    h.engine.setPlaying(true);
    expect(h.emitted.at(-1)).toBe(0);
    expect(h.engine.state.playing).toBe(true);
  });

  it('pauses and moves exactly one frame when stepped', () => {
    const h = harness(5, 10, true);
    h.engine.start(2, true);
    h.engine.step(1);
    expect(h.engine.state).toEqual({ frameIndex: 3, playing: false });
    expect(h.emitted.at(-1)).toBe(3);
    h.engine.step(-1);
    expect(h.engine.state.frameIndex).toBe(2);
    expect(h.emitted.at(-1)).toBe(2);
    expect(h.pending()).toBe(0);
  });

  it('seeks within bounds, emits immediately and keeps playing state', () => {
    const h = harness(5, 10, true);
    h.engine.start(0, false);
    h.engine.seek(99);
    expect(h.engine.state.frameIndex).toBe(4);
    expect(h.emitted.at(-1)).toBe(4);
    expect(h.engine.state.playing).toBe(false);
  });

  it('updates fps and loop options without losing the frame', () => {
    const h = harness(5, 10, true);
    h.engine.start(1, false);
    h.engine.setOptions({ fps: 60, loop: false });
    expect(h.engine.options).toEqual({ fps: 60, loop: false });
    expect(h.engine.state.frameIndex).toBe(1);
  });

  it('stops the animation clock', () => {
    const h = harness();
    h.engine.start(0, true);
    h.engine.stop();
    expect(h.pending()).toBe(0);
    expect(h.engine.state.playing).toBe(false);
  });
});
