import { describe, expect, it } from 'vitest';
import { ScenePersistence, SCENE_KEY, reconcileSaveState } from '../src/app/scenePersistence';
import { PRESETS } from '../src/scene/presets';

const base = PRESETS[0].create();
function storage() {
  const data = new Map<string, string>();
  return { data, get length() { return data.size; }, key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => { data.delete(k); },
    getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
}
describe('safe autosave', () => {
  it.each(['off', 'pending', 'invalid'] as const)('clears stale %s status when edits return to the saved scene', kind => {
    expect(reconcileSaveState({ kind }, true)).toEqual({ kind: 'saved' });
  });
  it.each(['conflict', 'corrupt', 'unavailable'] as const)('preserves genuine %s status even when edits are clean', kind => {
    expect(reconcileSaveState({ kind }, true)).toEqual({ kind });
  });
  it('bounds recovery drafts across reloads and separate sessions', () => {
    const s = storage();
    for (let i = 0; i < 30; i++) {
      const p = new ScenePersistence(s, `session-${i}`);
      p.load(base); p.save(base, 'point-charges');
    }
    expect([...s.data.keys()].filter(k => k.includes('.draft.')).length).toBeLessThanOrEqual(10);
  });
  it('never reports an unloadable authored scene as saved', () => {
    const s = storage(), p = new ScenePersistence(s, 'a');
    p.load(base); p.save(base, 'point-charges');
    const original = s.getItem(SCENE_KEY);
    expect(p.save({ ...base, domain: { ...base.domain, size: [0, 1, 1] } }, null).kind).toBe('invalid');
    expect(s.getItem(SCENE_KEY)).toBe(original);
  });
  it('stops stale tab flushes and retains its own recovery draft', () => {
    const s = storage();
    const a = new ScenePersistence(s, 'a'), b = new ScenePersistence(s, 'b');
    a.load(base); b.load(base);
    expect(a.save({ ...base, name: 'Solenoid' }, 'solenoid').kind).toBe('saved');
    b.load(base);
    expect(b.save({ ...base, name: 'Bar magnet' }, 'bar-magnet').kind).toBe('saved');
    expect(a.save({ ...base, name: 'Stale edits' }, null).kind).toBe('conflict');
    expect(JSON.parse(s.getItem(SCENE_KEY)!).name).toBe('Bar magnet');
    expect([...s.data.values()].some(v => v.includes('Stale edits'))).toBe(true);
  });
  it('retains preset identity in the same atomic storage record', () => {
    const s = storage(), p = new ScenePersistence(s, 'a');
    p.load(base); p.save(base, 'point-charges');
    expect(new ScenePersistence(s, 'b').load(base).presetId).toBe('point-charges');
  });
  it('preserves corrupt raw data and blocks autosave until recovery is explicit', () => {
    const s = storage(); s.setItem(SCENE_KEY, '{broken');
    const p = new ScenePersistence(s, 'a');
    expect(p.load(base).kind).toBe('corrupt');
    expect(p.save(base, null).kind).toBe('corrupt');
    expect(s.getItem(SCENE_KEY)).toBe('{broken');
  });
  it('reports denied reads and failed writes', () => {
    const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
    const p = new ScenePersistence(denied, 'a');
    expect(p.load(base).kind).toBe('unavailable');
    expect(p.save(base, null).kind).toBe('unavailable');
  });
});
