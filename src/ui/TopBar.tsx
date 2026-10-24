import React, { useRef, useState } from 'react';
import { useAppStore } from '../app/store';
import { Icon } from './Icon';
import { formatSci } from '../engine/units';
import { HelpModal } from './HelpModal';
import { restoreScene } from '../app/restoreScene';

export function TopBar() {
  const scene = useAppStore((s) => s.scene);
  const playing = useAppStore((s) => s.playing);
  const time = useAppStore((s) => s.time);
  const fps = useAppStore((s) => s.fps);
  const status = useAppStore((s) => s.status);
  const panels = useAppStore((s) => s.panels);
  const setPlaying = useAppStore((s) => s.setPlaying);
  const resetScene = useAppStore((s) => s.resetScene);
  const rewindSimulation = useAppStore((s) => s.rewindSimulation);
  const replaySimulation = useAppStore((s) => s.replaySimulation);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const togglePanel = useAppStore((s) => s.togglePanel);
  const past = useAppStore((s) => s.past.length);
  const future = useAppStore((s) => s.future.length);
  const presetId = useAppStore((s) => s.presetId);
  const [help, setHelp] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const requestStep = useAppStore((s) => s.requestStep);
  const step = () => {
    setPlaying(false);
    requestStep();
  };

  const exportScene = () => {
    const data = JSON.stringify(useAppStore.getState().scene, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${useAppStore.getState().scene.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.fieldlab.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importScene = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.objects)) {
        throw new Error('Not a FieldLab scene file.');
      }
      const restored = restoreScene(parsed, useAppStore.getState().scene);
      if (!restored) throw new Error('Invalid scene settings.');
      useAppStore.getState().setScene(restored, { presetId: null, history: true });
    } catch (err) {
      useAppStore.getState().setError(err instanceof Error ? err.message : String(err));
    }
  };

  const statusLabel = status.phase === 'solving'
    ? 'solving'
    : status.phase === 'ready'
      ? status.solveMs
        ? `ready · ${Math.round(status.solveMs)} ms`
        : 'ready'
      : status.phase === 'error'
        ? 'error'
        : 'idle';

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" />
          <div className="brand-text">
            <span className="brand-name">FieldLab</span>
            <span className="brand-sub">Electromagnetism sandbox</span>
          </div>
        </div>

        <div className="transport">
          <button
            className={`icon-btn primary ${playing ? 'active' : ''}`}
            onClick={() => setPlaying(!playing)}
            title={playing ? 'Pause (space)' : 'Play (space)'}
          >
            <Icon name={playing ? 'pause' : 'play'} size={17} />
          </button>
          <button className="icon-btn" onClick={step} title="Single step">
            <Icon name="step" size={16} />
          </button>
          <button className="icon-btn" onClick={rewindSimulation} title="Rewind to t = 0">
            <Icon name="reset" size={16} />
          </button>
          <button className="icon-btn" onClick={replaySimulation} title="Replay">
            <Icon name="play" size={16} />
          </button>
        </div>

        <div className="time-readout" title="Simulated time">
          <b>{formatSci(time, 4)}</b> s
        </div>

        <span className={`status-chip ${status.phase}`}>
          <span className="status-dot" />
          {statusLabel}
        </span>
        <span className="status-chip" title={scene.simulation.useApproximation === false
          ? 'Evolved Maxwell fields for supported scene models. See Solve for setup and physical time cost.'
          : 'Electrostatic/quasistatic fields, or the legacy wave solver. See Solve for validity limits.'}>
          {scene.simulation.useApproximation === false ? 'Maxwell FDTD · experimental' : 'Approximation'}
        </span>

        <span className="top-spacer" />

        <div className="top-actions">
          <button className="icon-btn" onClick={resetScene} disabled={presetId === null} title="Restore preset (discard scene edits)" aria-label="Restore preset">
            <Icon name="reset" size={16} />
          </button>
          <button className="icon-btn" onClick={undo} disabled={past === 0} title="Undo (Ctrl+Z)">
            <Icon name="undo" size={16} />
          </button>
          <button className="icon-btn" onClick={redo} disabled={future === 0} title="Redo (Ctrl+Shift+Z)">
            <Icon name="redo" size={16} />
          </button>
          <button
            className={`icon-btn ${panels.left ? 'active' : ''}`}
            onClick={() => togglePanel('left')}
            title="Toggle library"
          >
            <Icon name="layers" size={16} />
          </button>
          <button
            className={`icon-btn ${panels.chart ? 'active' : ''}`}
            onClick={() => togglePanel('chart')}
            title="Toggle probe chart"
          >
            <Icon name="chart" size={16} />
          </button>
          <button
            className={`icon-btn ${panels.right ? 'active' : ''}`}
            onClick={() => togglePanel('right')}
            title="Toggle inspector"
          >
            <Icon name="sliders" size={16} />
          </button>
          <button className="icon-btn" onClick={exportScene} title="Export scene JSON">
            <Icon name="download" size={16} />
          </button>
          <button className="icon-btn" onClick={() => fileRef.current?.click()} title="Import scene JSON">
            <Icon name="upload" size={16} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importScene(file);
              e.currentTarget.value = '';
            }}
          />
          <button className="icon-btn" onClick={() => setHelp(true)} title="Help & shortcuts">
            <Icon name="help" size={16} />
          </button>
          <span className="fps">{fps} fps</span>
        </div>
      </header>
      {help && <HelpModal onClose={() => setHelp(false)} />}
      {presetId === null && scene.mode === 'waves' && (
        <span hidden aria-hidden />
      )}
    </>
  );
}
