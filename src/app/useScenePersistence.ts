import { useEffect, useRef, useState } from 'react';
import { useAppStore } from './store';
import { getPreset } from '../scene/presets';
import { ScenePersistence, SCENE_KEY, reconcileSaveState, type SaveState } from './scenePersistence';
import { downloadText } from '../scene/files';

export function useScenePersistence() {
  const scene = useAppStore(s => s.scene);
  const autosave = useAppStore(s => s.autosave);
  const presetId = useAppStore(s => s.presetId);
  const persistence = useRef<ScenePersistence | null>(null);
  const lastSaved = useRef('');
  const [state, setState] = useState<SaveState>({ kind: 'saved' });
  const signature = () => JSON.stringify({ scene: useAppStore.getState().scene, presetId: useAppStore.getState().presetId });
  const load = () => {
    const store = useAppStore.getState();
    if (store.playback.mode !== 'idle') { store.setError('Return to live before loading a saved scene.'); return; }
    const result = persistence.current!.load(store.scene);
    if (result.scene) {
      const id = result.presetId && getPreset(result.presetId) ? result.presetId : null;
      store.setScene(result.scene, { history: false, presetId: id });
    }
    lastSaved.current = signature();
    setState(result);
  };
  useEffect(() => {
    // A lazy adapter catches denied access to the localStorage property itself.
    persistence.current = new ScenePersistence({
      getItem: key => localStorage.getItem(key),
      setItem: (key, value) => localStorage.setItem(key, value),
      get length() { return localStorage.length; },
      key: index => localStorage.key(index),
      removeItem: key => localStorage.removeItem(key),
    }, globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    load();
    const onStorage = (event: StorageEvent) => {
      if (event.key === SCENE_KEY || event.key === null) {
        setState({ kind: 'conflict', message: 'Another tab changed the saved scene. Export this tab’s work or load the newer save.' });
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (!autosave) { setState({ kind: 'off' }); return; }
    setState(current => reconcileSaveState(current, signature() === lastSaved.current));
    const save = () => {
      if (!persistence.current || signature() === lastSaved.current) return;
      const store = useAppStore.getState();
      if (!store.autosave) return;
      const result = persistence.current.save(store.scene, store.presetId);
      if (result.kind === 'saved') lastSaved.current = signature();
      setState(result);
    };
    if (signature() !== lastSaved.current) setState(current =>
      ['conflict', 'corrupt', 'unavailable', 'invalid'].includes(current.kind) ? current : { kind: 'pending' });
    const timer = setTimeout(save, 700);
    const hidden = () => { if (document.visibilityState === 'hidden') save(); };
    const leaving = (event: BeforeUnloadEvent) => {
      save();
      if (signature() !== lastSaved.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('pagehide', save);
    window.addEventListener('beforeunload', leaving);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pagehide', save);
      window.removeEventListener('beforeunload', leaving);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [scene, autosave, presetId]);

  return { state, load, recover: () => {
    if (persistence.current?.recoveryRaw !== null && persistence.current?.recoveryRaw !== undefined)
      downloadText(persistence.current.recoveryRaw, 'fieldlab-recovery.txt', 'text/plain');
  }, replace: () => {
    try { persistence.current?.replaceCorruptSave(); lastSaved.current = ''; setState({ kind: 'pending' });
      const store = useAppStore.getState();
      const result = persistence.current!.save(store.scene, store.presetId);
      if (result.kind === 'saved') lastSaved.current = signature();
      setState(result);
    } catch { setState({ kind: 'unavailable', message: 'Could not preserve the damaged save. Export your current scene to keep your work.' }); }
  } };
}
