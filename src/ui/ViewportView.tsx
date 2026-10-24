import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../app/store';
import { ViewportController } from '../viewport/ViewportController';
import { Icon } from './Icon';
import { cssGradient } from '../engine/colormap';
import { formatPrefixed, formatSci } from '../engine/units';
import type { SliceQuantity } from '../scene/types';

const QUANTITY_LABEL: Record<SliceQuantity, string> = {
  Emag: '|E|',
  Ex: 'Eₓ',
  Ey: 'E_y',
  Ez: 'E_z',
  Bmag: '|B|',
  phi: 'φ',
  energyE: 'u_E',
  energyB: 'u_B',
  poynting: '|S|',
};

const QUANTITY_UNIT: Record<SliceQuantity, string> = {
  Emag: 'V/m',
  Ex: 'V/m',
  Ey: 'V/m',
  Ez: 'V/m',
  Bmag: 'T',
  phi: 'V',
  energyE: 'J/m³',
  energyB: 'J/m³',
  poynting: 'W/m²',
};

export function ViewportView() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ViewportController | null>(null);
  const scene = useAppStore((s) => s.scene);
  const fullMaxwell = scene.simulation.useApproximation === false;
  const selectedId = useAppStore((s) => s.selectedId);
  const cameraRequest = useAppStore((s) => s.cameraRequest);
  const cameraMode = useAppStore((s) => s.cameraMode);
  const gizmoMode = useAppStore((s) => s.gizmoMode);
  const status = useAppStore((s) => s.status);
  const error = useAppStore((s) => s.error);
  const play = useAppStore((s) => s.playing);
  const time = useAppStore((s) => s.time);
  const particleTelemetry = useAppStore((s) => s.particleTelemetry);
  const inductionTelemetry = useAppStore((s) => s.inductionTelemetry);
  const setGizmoMode = useAppStore((s) => s.setGizmoMode);
  const requestCamera = useAppStore((s) => s.requestCamera);
  const [legend, setLegend] = useState<{ quantity: SliceQuantity; min: number; max: number } | null>(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const controller = new ViewportController(wrapRef.current, {
      onSelect: (id) => useAppStore.getState().select(id),
      onTransform: (id, position, rotation) => {
        useAppStore.getState().updateObject(id, { position, rotation }, false);
      },
      onFps: (value) => useAppStore.getState().setFps(value),
      onSliceRange: (range) => setLegend(range),
    });
    controllerRef.current = controller;
    controller.setScene(useAppStore.getState().scene);
    controller.setSelected(useAppStore.getState().selectedId);
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    controllerRef.current?.setScene(scene);
  }, [scene]);

  useEffect(() => {
    controllerRef.current?.setSelected(selectedId);
  }, [selectedId]);

  useEffect(() => {
    controllerRef.current?.setTransformMode(gizmoMode);
  }, [gizmoMode]);

  useEffect(() => {
    if (cameraRequest > 0) controllerRef.current?.requestCamera(cameraMode);
  }, [cameraRequest, cameraMode]);

  const q = legend?.quantity ?? scene.display.sliceQuantity;
  const max = legend?.max ?? 1;
  const min = legend?.min ?? 0;
  const log = scene.display.logScale;
  const hasSlice = scene.display.slices.xy || scene.display.slices.xz || scene.display.slices.yz;

  return (
    <div className="viewport" ref={wrapRef}>
      <div className="viewport-overlay">
        <div className="vp-top-left">
          <span className="vp-chip"><span className="dot" /><b>{fullMaxwell ? 'Maxwell FDTD' : scene.mode === 'fields' ? 'Fields' : 'Waves'}</b> · {fullMaxwell || scene.mode === 'waves' ? 'time-domain Maxwell' : 'static / quasistatic'}</span>
          {hasSlice && <span className="vp-chip">{QUANTITY_LABEL[q]} slice · {QUANTITY_UNIT[q]}</span>}
          {inductionTelemetry.length > 0 && (
            <span className="vp-chip">
              <span className="dot" />ε <b>{formatPrefixed(inductionTelemetry[0].emf, 'V')}</b> · Φ {formatPrefixed(inductionTelemetry[0].flux, 'Wb')}
            </span>
          )}
          {particleTelemetry.length > 0 && (
            <span className="vp-chip">v <b>{formatPrefixed(particleTelemetry[0].speed, 'm/s')}</b></span>
          )}
          {(scene.mode === 'waves' || fullMaxwell) && (
            <span className={`vp-chip ${play ? '' : 'warn'}`}><span className="dot" />{play ? 'running' : 'paused'} · {formatSci(time, 3)} s</span>
          )}
          <span className="vp-chip">{scene.objects.length} objects</span>
        </div>

        <div className="vp-top-right">
          <button className={`icon-btn ${gizmoMode === 'translate' ? 'active' : ''}`} onClick={() => setGizmoMode('translate')} title="Move (G)"><Icon name="move" size={15} /></button>
          <button className={`icon-btn ${gizmoMode === 'rotate' ? 'active' : ''}`} onClick={() => setGizmoMode('rotate')} title="Rotate (R)"><Icon name="rotate" size={15} /></button>
          <button className={`icon-btn ${gizmoMode === 'scale' ? 'active' : ''}`} onClick={() => setGizmoMode('scale')} title="Scale (S)"><Icon name="scale" size={15} /></button>
          <span style={{ width: 6 }} />
          <button className="icon-btn" onClick={() => requestCamera('iso')} title="Isometric camera (1)"><Icon name="orbit" size={15} /></button>
          <button className="icon-btn" onClick={() => requestCamera('front')} title="Front camera (2)"><Icon name="box" size={15} /></button>
          <button className="icon-btn" onClick={() => requestCamera('top')} title="Top camera (3)"><Icon name="grid" size={15} /></button>
          <button className="icon-btn" onClick={() => requestCamera('side')} title="Side camera (4)"><Icon name="axes" size={15} /></button>
        </div>

        {hasSlice && <div className="legend">
          <div className="legend-head">
            <span className="legend-title">{QUANTITY_LABEL[q]}</span>
            <span className="legend-value">{QUANTITY_UNIT[q]}</span>
          </div>
          <div className="legend-bar" style={{ background: cssGradient(scene.display.colormap, 14) }} />
          <div className="legend-scale">
            <span>{formatSci(min, 3)}</span>
            <span>{formatSci(max, 3)}</span>
          </div>
          <div className="legend-note">{log ? 'log colour scale' : 'linear colour scale'} · {scene.display.colormap}</div>
        </div>}

        <div className="vp-hint">drag orbit · scroll zoom · click select · right-drag pan</div>

        {status.phase === 'solving' && (
          <div className="vp-center-note"><span className="spinner" /> solving fields…</div>
        )}
        {status.phase === 'error' && error && <div className="vp-error">{error}</div>}
      </div>
    </div>
  );
}
