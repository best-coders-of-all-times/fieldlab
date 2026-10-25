import React, { useMemo, useState } from 'react';
import { useAppStore } from '../app/store';
import { PRESETS } from '../scene/presets';
import { Icon } from './Icon';
import type { SceneObject } from '../scene/types';
import {
  makeAntenna,
  makeCharge,
  makeChargedSphere,
  makeCoil,
  makeConductor,
  makeDielectric,
  makeLoop,
  makeMagnet,
  makeParticle,
  makePlaneWave,
  makePointSource,
  makeProbe,
  makeWire,
  makeScene,
} from '../scene/defaults';

const KIND_ICON: Record<string, string> = {
  charge: 'charge',
  chargedSphere: 'sphere',
  conductor: 'conductor',
  dielectric: 'dielectric',
  wire: 'wire',
  loop: 'loop',
  coil: 'coil',
  magnet: 'magnet',
  particle: 'particle',
  probe: 'probe',
  planeWave: 'wave',
  pointSource: 'spark',
  antenna: 'antenna',
};

export function LeftPanel() {
  const leftTab = useAppStore((s) => s.leftTab);
  const setLeftTab = useAppStore((s) => s.setLeftTab);
  const scene = useAppStore((s) => s.scene);
  const presetId = useAppStore((s) => s.presetId);
  const selectedId = useAppStore((s) => s.selectedId);
  const loadPreset = useAppStore((s) => s.loadPreset);
  const select = useAppStore((s) => s.select);
  const addObject = useAppStore((s) => s.addObject);
  const updateObject = useAppStore((s) => s.updateObject);
  const removeObject = useAppStore((s) => s.removeObject);
  const locked = useAppStore((s) => s.playback.mode !== 'idle');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PRESETS;
    return PRESETS.filter((p) =>
      `${p.title} ${p.subtitle} ${p.description} ${p.tags.join(' ')} ${p.group}`.toLowerCase().includes(q),
    );
  }, [query]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof PRESETS>();
    for (const p of filtered) {
      const arr = map.get(p.group) ?? [];
      arr.push(p);
      map.set(p.group, arr);
    }
    return map;
  }, [filtered]);

  const add = (obj: SceneObject) => {
    const n = scene.objects.length;
    const offset = ((n % 5) - 2) * 0.07;
    obj.position = [offset, 0, 0];
    addObject(obj);
  };

  const addItems: Array<{ label: string; sub: string; icon: string; make: () => SceneObject }> = [
    { label: 'Point charge', sub: 'Coulomb source', icon: 'charge', make: () => makeCharge([0, 0, 0], 1e-9) },
    { label: 'Charged sphere', sub: 'analytic sphere', icon: 'sphere', make: () => makeChargedSphere([0, 0, 0], 10e-9, 0.15) },
    { label: 'Conductor', sub: 'PEC / electrodes', icon: 'conductor', make: () => makeConductor([0, 0, 0], 'box', [0.26, 0.26, 0.26]) },
    { label: 'Dielectric', sub: 'εᵣ, μᵣ, σ', icon: 'dielectric', make: () => makeDielectric([0, 0, 0], 'box', [0.26, 0.26, 0.26], 4) },
    { label: 'Wire', sub: 'current filament', icon: 'wire', make: () => makeWire([[-0.25, 0, 0], [0.25, 0, 0]], 2) },
    { label: 'Loop', sub: 'circular current', icon: 'loop', make: () => makeLoop([0, 0, 0], 0.18, 2) },
    { label: 'Solenoid', sub: 'N turns', icon: 'coil', make: () => makeCoil([0, 0, 0], 0.08, 0.36, 12) },
    { label: 'Magnet', sub: 'magnetisation', icon: 'magnet', make: () => makeMagnet([0, 0, 0], 0.05, 0.22) },
    { label: 'Particle', sub: 'Lorentz motion', icon: 'particle', make: () => makeParticle([0, 0, 0], 'electron', [1e6, 0, 0]) },
    { label: 'Probe', sub: 'sample E, B, φ', icon: 'probe', make: () => makeProbe([0.15, 0, 0]) },
  ];

  const waveItems: Array<{ label: string; sub: string; icon: string; make: () => SceneObject }> = [
    { label: 'Plane wave', sub: 'uniform source', icon: 'wave', make: () => makePlaneWave() },
    { label: 'Point source', sub: 'soft E source', icon: 'spark', make: () => makePointSource([0, 0, 0], 'Ez') },
    { label: 'Dipole antenna', sub: 'radiating current', icon: 'antenna', make: () => makeAntenna([0, 0, 0]) },
  ];

  return (
    <aside className="left-panel">
      <div className="panel-tabs">
        <button className={leftTab === 'scenes' ? 'active' : ''} onClick={() => setLeftTab('scenes')}>
          <Icon name="book" size={13} /> Scenes
        </button>
        <button className={leftTab === 'add' ? 'active' : ''} onClick={() => setLeftTab('add')}>
          <Icon name="add" size={13} /> Add
        </button>
      </div>
      <fieldset className="lock-fieldset left-lock" disabled={locked}>
      <div className="left-body">
        {locked && <div className="playback-banner compact"><span>Return to live to change scenes or objects.</span></div>}
        {leftTab === 'scenes' ? (
          <>
            <button className="preset-card custom-scene" onClick={() => {
              const blank = makeScene({ name: 'Custom scene', subtitle: 'Wires, sources and prescribed motion', tags: ['custom'] });
              blank.simulation.staticBoundary = 'open';
              useAppStore.getState().setScene(blank, { presetId: null });
              useAppStore.setState({ selectedId: null, playing: false, time: 0, leftTab: 'add', rightTab: 'inspector', chart: { series: [], points: [] } });
            }}>
              <div className="preset-title"><span>+ New custom scene</span></div>
              <div className="preset-sub">Build wire curves and timed motion</div>
            </button>
            <div className="search-box">
              <Icon name="search" size={14} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search scenes, topics, equations…"
                aria-label="Search scenes"
              />
            </div>
            {Array.from(groups.entries()).map(([group, presets]) => (
              <div key={group}>
                <div className="group-label">{group}</div>
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`preset-card ${presetId === preset.id ? 'active' : ''}`}
                    onClick={() => loadPreset(preset.id)}
                    title={preset.description}
                  >
                    <div className="preset-title">
                      <span>{preset.title}</span>
                      {preset.tags[0] && <span className="preset-tag">{preset.tags[0]}</span>}
                    </div>
                    <div className="preset-sub">{preset.subtitle}</div>
                  </button>
                ))}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="empty-state"><strong>No scenes</strong><p>Try another keyword.</p></div>
            )}
          </>
        ) : (
          <>
            <div className="group-label">Sources & matter</div>
            <div className="add-grid">
              {addItems.filter(item => scene.mode !== 'waves' || ['Conductor', 'Dielectric', 'Probe'].includes(item.label)).map((item) => (
                <button key={item.label} type="button" className="add-btn" onClick={() => add(item.make())}>
                  <Icon name={item.icon} size={18} />
                  <span className="add-title">{item.label}</span>
                  <span className="add-sub">{item.sub}</span>
                </button>
              ))}
            </div>
            {(scene.mode === 'waves' || scene.objects.some((o) => o.kind === 'planeWave')) && (
              <>
                <div className="group-label">Wave sources</div>
                <div className="add-grid">
                  {waveItems.map((item) => (
                    <button key={item.label} type="button" className="add-btn" onClick={() => add(item.make())}>
                      <Icon name={item.icon} size={18} />
                      <span className="add-title">{item.label}</span>
                      <span className="add-sub">{item.sub}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="add-note">
              Objects are placed at the centre. Click a selected object and drag the gizmo to position it.
              Statics scenes re-solve automatically; waves restart the FDTD lattice when matter changes.
            </div>
            <div className="group-label">Objects in scene</div>
            <div className="object-list">
              {scene.objects.map((obj) => (
                <div
                  key={obj.id}
                  className={`object-row ${selectedId === obj.id ? 'active' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => select(obj.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') select(obj.id); }}
                >
                  <span className="obj-icon"><Icon name={KIND_ICON[obj.kind] ?? 'sphere'} size={14} /></span>
                  <span className="obj-name">{obj.name}</span>
                  <span className="obj-kind">{obj.kind}</span>
                  <button
                    className="mini-btn"
                    title={obj.visible ? 'Hide' : 'Show'}
                    onClick={(e) => { e.stopPropagation(); updateObject(obj.id, { visible: !obj.visible }, false); }}
                  >
                    <Icon name={obj.visible ? 'eye' : 'eyeOff'} size={13} />
                  </button>
                  <button
                    className="mini-btn"
                    title="Delete"
                    onClick={(e) => { e.stopPropagation(); removeObject(obj.id); }}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              ))}
              {scene.objects.length === 0 && <div className="note">No objects yet.</div>}
            </div>
          </>
        )}
      </div>
      </fieldset>
    </aside>
  );
}
