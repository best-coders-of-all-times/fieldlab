import React, { useEffect, useRef } from 'react';
import { useAppStore } from './store';
import { SimulationController } from './controller';
import { TopBar } from '../ui/TopBar';
import { LeftPanel } from '../ui/LeftPanel';
import { RightPanel } from '../ui/RightPanel';
import { ViewportView } from '../ui/ViewportView';
import { ChartDrawer } from '../ui/Chart';
import { Icon } from '../ui/Icon';
import { useScenePersistence } from './useScenePersistence';

export default function App() {
  const scene = useAppStore((s) => s.scene);
  const playing = useAppStore((s) => s.playing);
  const panels = useAppStore((s) => s.panels);
  const selectedId = useAppStore((s) => s.selectedId);
  const error = useAppStore((s) => s.error);
  const stepRequest = useAppStore((s) => s.stepRequest);
  const resetRequest = useAppStore((s) => s.resetRequest);
  const playbackCommand = useAppStore((s) => s.playbackCommand);
  const controllerRef = useRef<SimulationController | null>(null);
  const persistence = useScenePersistence();

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
    const media = window.matchMedia('(max-width: 1050px)');
    const resize = () => {
      if (media.matches) useAppStore.setState(s => ({ panels: { ...s.panels, left: false, right: false } }));
    };
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.repeat || document.querySelector('[role=dialog]') || target?.closest('input,textarea,select,[contenteditable=true]')) {
        return;
      }
      if (event.code === 'Space' && target?.closest('button,a,[role=button],[role=switch]')) return;
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
      <div className={`save-status ${persistence.state.kind}`} role="status" aria-live="polite">
        <span>{persistence.state.message ?? ({ saved: 'Saved on this device', pending: 'Saving?', off: 'Autosave off ? export to keep your work' } as Record<string, string>)[persistence.state.kind]}</span>
        {persistence.state.kind === 'conflict' && <button onClick={() => {
          if (window.confirm('Load the newer saved scene? Export this tab?s work first if you want to keep it.')) persistence.load();
        }}>Load newer save</button>}
        {persistence.state.kind === 'corrupt' && <>
          <button onClick={persistence.recover}>Download damaged save</button>
          <button onClick={() => { if (window.confirm('Preserve a backup and replace the damaged save with this scene?')) persistence.replace(); }}>Use this scene</button>
        </>}
      </div>
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
          <span><b>Attention.</b> {error}</span>
          <button onClick={() => useAppStore.getState().setError(null)} aria-label="Dismiss"><Icon name="close" size={14} /></button>
        </div>
      )}
      {selectedId === undefined && null}
    </div>
  );
}
