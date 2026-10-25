import React, { useEffect, useRef } from 'react';
import { useAppStore } from './store';
import { SimulationController } from './controller';
import { TopBar } from '../ui/TopBar';
import { LeftPanel } from '../ui/LeftPanel';
import { RightPanel } from '../ui/RightPanel';
import { ViewportView } from '../ui/ViewportView';
import { ChartDrawer } from '../ui/Chart';
import { Icon } from '../ui/Icon';
import { restoreScene } from './restoreScene';

function saveCurrentScene() {
  const state = useAppStore.getState();
  if (!state.autosave) return;
  try { localStorage.setItem('fieldlab.scene.v1', JSON.stringify(state.scene)); }
  catch { /* Storage can be unavailable in private contexts. */ }
}

export default function App() {
  const scene = useAppStore((s) => s.scene);
  const playing = useAppStore((s) => s.playing);
  const autosave = useAppStore((s) => s.autosave);
  const panels = useAppStore((s) => s.panels);
  const selectedId = useAppStore((s) => s.selectedId);
  const error = useAppStore((s) => s.error);
  const stepRequest = useAppStore((s) => s.stepRequest);
  const resetRequest = useAppStore((s) => s.resetRequest);
  const playbackCommand = useAppStore((s) => s.playbackCommand);
  const controllerRef = useRef<SimulationController | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('fieldlab.scene.v1');
      if (!raw) return;
      const restored = restoreScene(JSON.parse(raw), useAppStore.getState().scene);
      if (restored) useAppStore.getState().setScene(restored, { history: false, presetId: null });
    } catch {
      // A corrupt autosave should never block startup.
    }
  }, []);

  useEffect(() => {
    const controller = new SimulationController();
    controllerRef.current = controller;
    controller.update(useAppStore.getState().scene, useAppStore.getState().playing);
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    controllerRef.current?.update(scene, playing);
  }, [scene, playing]);

  useEffect(() => {
    if (stepRequest > 0) controllerRef.current?.step();
  }, [stepRequest]);

  useEffect(() => {
    if (resetRequest > 0) controllerRef.current?.reset();
  }, [resetRequest]);

  useEffect(() => {
    if (playbackCommand) controllerRef.current?.handlePlaybackCommand(playbackCommand);
  }, [playbackCommand]);

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(saveCurrentScene, 700);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [scene, autosave]);

  useEffect(() => {
    // A reload can happen before the debounce expires. Read the store at the
    // event rather than capturing an earlier render's scene.
    const onHidden = () => { if (document.visibilityState === 'hidden') saveCurrentScene(); };
    window.addEventListener('pagehide', saveCurrentScene);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', saveCurrentScene);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, []);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => useAppStore.getState().setError(null), 9000);
    return () => clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return;
      }
      const store = useAppStore.getState();
      const locked = store.playback.mode !== 'idle';
      if (event.code === 'Space') {
        event.preventDefault();
        if (store.playback.mode !== 'computing') store.setPlaying(!store.playing);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!locked && store.selectedId) {
          event.preventDefault();
          store.removeObject(store.selectedId);
        }
      } else if (!locked && event.key.toLowerCase() === 'g') store.setGizmoMode('translate');
      else if (!locked && event.key.toLowerCase() === 'r') store.setGizmoMode('rotate');
      else if (!locked && event.key.toLowerCase() === 's') store.setGizmoMode('scale');
      else if (event.key === '1') store.requestCamera('iso');
      else if (event.key === '2') store.requestCamera('front');
      else if (event.key === '3') store.requestCamera('top');
      else if (event.key === '4') store.requestCamera('side');
      else if (event.key.toLowerCase() === 'f') store.requestCamera('iso');
      else if (!locked && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const workspaceClass = [
    'workspace',
    panels.left ? '' : 'left-closed',
    panels.right ? '' : 'right-closed',
  ].filter(Boolean).join(' ');

  return (
    <div className="app">
      <TopBar />
      <div className={workspaceClass}>
        {panels.left && <LeftPanel />}
        <main className="viewport-wrap">
          <ViewportView />
          {!panels.left && (
            <button
              className="icon-btn"
              style={{ position: 'absolute', left: 12, top: 12, zIndex: 5, background: 'rgba(8,12,18,0.8)', borderColor: 'var(--border)' }}
              onClick={() => useAppStore.getState().togglePanel('left')}
              title="Open library"
            >
              <Icon name="layers" size={16} />
            </button>
          )}
          {!panels.right && (
            <button
              className="icon-btn"
              style={{ position: 'absolute', right: 12, top: 12, zIndex: 5, background: 'rgba(8,12,18,0.8)', borderColor: 'var(--border)' }}
              onClick={() => useAppStore.getState().togglePanel('right')}
              title="Open inspector"
            >
              <Icon name="sliders" size={16} />
            </button>
          )}
        </main>
        {panels.right && <RightPanel />}
      </div>
      {panels.chart && <ChartDrawer />}
      {error && (
        <div className="toast" role="alert">
          <span><b>Solver error.</b> {error}</span>
          <button onClick={() => useAppStore.getState().setError(null)} aria-label="Dismiss"><Icon name="close" size={14} /></button>
        </div>
      )}
      {selectedId === undefined && null}
    </div>
  );
}
