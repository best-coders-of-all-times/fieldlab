import React, { useMemo } from 'react';
import katex from 'katex';
import { useAppStore } from '../app/store';
import { Icon } from './Icon';
import {
  Button,
  CheckRow,
  EmptyState,
  Field,
  NumberInput,
  PanelSection,
  Segmented,
  Select,
  Slider,
  Toggle,
  Vec3Input,
} from './controls';
import type { SceneObject, SliceQuantity } from '../scene/types';
import {
  isAntenna,
  isCharge,
  isChargedSphere,
  isCoil,
  isConductor,
  isDielectric,
  isLoop,
  isMagnet,
  isParticle,
  isPlaneWave,
  isPointSource,
  isProbe,
  isWire,
} from '../scene/types';
import { formatPrefixed, formatSci } from '../engine/units';
import { M_ELECTRON, M_PROTON, E_CHARGE } from '../engine/constants';

export function RightPanel() {
  const rightTab = useAppStore((s) => s.rightTab);
  const setRightTab = useAppStore((s) => s.setRightTab);
  const tabs: Array<{ id: typeof rightTab; label: string; icon: string }> = [
    { id: 'inspector', label: 'Edit', icon: 'cursor' },
    { id: 'display', label: 'View', icon: 'eye' },
    { id: 'simulation', label: 'Solve', icon: 'settings' },
    { id: 'theory', label: 'Theory', icon: 'book' },
    { id: 'measure', label: 'Data', icon: 'chart' },
  ];
  return (
    <aside className="right-panel">
      <div className="right-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={rightTab === t.id ? 'active' : ''} onClick={() => setRightTab(t.id)}>
            <Icon name={t.icon} size={13} /> {t.label}
          </button>
        ))}
      </div>
      <div className="right-body">
        {rightTab === 'inspector' && <Inspector />}
        {rightTab === 'display' && <DisplayPanel />}
        {rightTab === 'simulation' && <SimulationPanel />}
        {rightTab === 'theory' && <TheoryPanel />}
        {rightTab === 'measure' && <MeasurePanel />}
      </div>
    </aside>
  );
}

function Inspector() {
  const scene = useAppStore((s) => s.scene);
  const selectedId = useAppStore((s) => s.selectedId);
  const updateObject = useAppStore((s) => s.updateObject);
  const removeObject = useAppStore((s) => s.removeObject);
  const duplicateSelected = useAppStore((s) => s.duplicateSelected);
  const obj = scene.objects.find((o) => o.id === selectedId);

  if (!obj) {
    return (
      <>
        <PanelSection title="Scene">
          <div className="theory-title">{scene.name}</div>
          {scene.subtitle && <div className="note">{scene.subtitle}</div>}
          <div className="stat-line"><span>Mode</span><b>{scene.mode === 'fields' ? 'Fields (statics)' : 'Waves (FDTD)'}</b></div>
          <div className="stat-line"><span>Objects</span><b>{scene.objects.length}</b></div>
          <div className="stat-line"><span>Domain</span><b>{scene.domain.size.map((v) => `${v.toFixed(2)}`).join(' × ')} m</b></div>
          <div className="note">Select an object in the viewport or object list to edit it.</div>
        </PanelSection>
        <EmptyState
          title="Nothing selected"
          body="Click a charge, conductor, wire or source in the 3D view. Drag the gizmo to move it; the solver updates automatically."
        />
      </>
    );
  }

  const patch = (p: Partial<SceneObject>, history = true) => updateObject(obj.id, p, history);
  const position = obj.position;
  const rotationDeg: [number, number, number] = [
    (obj.rotation[0] * 180) / Math.PI,
    (obj.rotation[1] * 180) / Math.PI,
    (obj.rotation[2] * 180) / Math.PI,
  ];

  return (
    <>
      <PanelSection title={obj.name} right={<span className="preset-tag">{obj.kind}</span>}>
        <Field label="Name">
          <input
            className="select"
            value={obj.name}
            onChange={(e) => patch({ name: e.target.value }, false)}
          />
        </Field>
        <CheckRow label="Visible" checked={obj.visible} onChange={(v) => patch({ visible: v }, false)} />
        <Field label="Position" hint="World coordinates, metres">
          <Vec3Input value={position} onChange={(v) => patch({ position: v }, false)} unit="m" />
        </Field>
        <Field label="Rotation" hint="Euler XYZ, degrees">
          <Vec3Input
            value={rotationDeg}
            step={5}
            unit="°"
            onChange={(v) => patch({
              rotation: [
                (v[0] * Math.PI) / 180,
                (v[1] * Math.PI) / 180,
                (v[2] * Math.PI) / 180,
              ],
            }, false)}
          />
        </Field>
        <div className="btn-row">
          <Button onClick={duplicateSelected}><Icon name="copy" size={13} /> Duplicate</Button>
          <Button variant="danger" onClick={() => removeObject(obj.id)}><Icon name="trash" size={13} /> Delete</Button>
        </div>
      </PanelSection>

      {obj.motion && (
        <PanelSection title="Scripted motion" defaultOpen={false}>
          <Field label="Kind">
            <Select
              value={obj.motion.kind}
              options={[
                { value: 'oscillate', label: 'Oscillate along axis' },
                { value: 'spin', label: 'Spin about axis' },
              ]}
              onChange={(kind) => patch({ motion: { ...obj.motion!, kind } })}
            />
          </Field>
          <Field label="Axis">
            <Vec3Input value={obj.motion.axis} step={0.5} onChange={(axis) => patch({ motion: { ...obj.motion!, axis } })} />
          </Field>
          {obj.motion.kind === 'oscillate' && (
            <Field label="Amplitude">
              <Slider
                value={obj.motion.amplitude}
                min={0.02}
                max={0.38}
                step={0.01}
                format={(v) => `${(v * 100).toFixed(0)} cm`}
                onChange={(amplitude) => patch({ motion: { ...obj.motion!, amplitude } })}
              />
            </Field>
          )}
          <Field label="Frequency">
            <Slider
              value={obj.motion.frequency}
              min={0.05}
              max={2}
              step={0.01}
              format={(v) => `${v.toFixed(2)} Hz`}
              onChange={(frequency) => patch({ motion: { ...obj.motion!, frequency } })}
            />
          </Field>
          <div className="note">Motion is prescribed for the induction demos; flux and EMF are recomputed every frame from the moved sources.</div>
        </PanelSection>
      )}

      <ObjectPhysics obj={obj} patch={patch} />

      <PanelSection title="About this object" defaultOpen={false}>
        <div className="note">{objectHelp(obj)}</div>
      </PanelSection>
    </>
  );
}

function ObjectPhysics({
  obj,
  patch,
}: {
  obj: SceneObject;
  patch: (p: Partial<SceneObject>, history?: boolean) => void;
}) {
  if (isCharge(obj)) {
    return (
      <PanelSection title="Charge">
        <Field label="Charge">
          <NumberInput value={obj.charge * 1e9} step={0.1} unit="nC" onChange={(v) => patch({ charge: v * 1e-9 })} />
        </Field>
        <Slider
          value={obj.charge * 1e9} min={-10} max={10} step={0.05}
          format={(v) => `${v.toFixed(2)} nC`}
          onChange={(v) => patch({ charge: v * 1e-9 })}
        />
        <div className="note">Positive charges emit field lines; negative charges absorb them. Magnitude controls line count and glyph size.</div>
      </PanelSection>
    );
  }
  if (isChargedSphere(obj)) {
    return (
      <PanelSection title="Charged sphere">
        <Field label="Total charge">
          <NumberInput value={obj.charge * 1e9} step={0.5} unit="nC" onChange={(v) => patch({ charge: v * 1e-9 })} />
        </Field>
        <Field label="Radius">
          <NumberInput value={obj.radius} step={0.01} unit="m" onChange={(v) => patch({ radius: Math.max(0.01, v) })} />
        </Field>
        <CheckRow label="Charged shell (E=0 inside)" checked={obj.shell} onChange={(v) => patch({ shell: v })} />
        <div className="note">Analytic field: linear inside a solid sphere, zero inside a shell, inverse-square outside.</div>
      </PanelSection>
    );
  }
  if (isConductor(obj)) {
    return (
      <PanelSection title="Conductor">
        <Field label="Shape">
          <Select
            value={obj.shape}
            options={[
              { value: 'box', label: 'Box' },
              { value: 'sphere', label: 'Sphere' },
              { value: 'cylinder', label: 'Cylinder' },
            ]}
            onChange={(shape) => patch({ shape })}
          />
        </Field>
        <Field label="Size" hint="Full extents in local x, y, z; sphere uses size x as diameter">
          <Vec3Input value={obj.size} step={0.02} unit="m" onChange={(size) => patch({ size })} />
        </Field>
        <CheckRow
          label="Floating (net charge specified)"
          checked={obj.floating}
          onChange={(v) => patch({ floating: v })}
        />
        {obj.floating ? (
          <Field label="Net charge">
            <NumberInput
              value={obj.netCharge * 1e12} step={1} unit="pC"
              onChange={(v) => patch({ netCharge: v * 1e-12 })}
            />
          </Field>
        ) : (
          <Field label="Potential">
            <NumberInput value={obj.potential} step={0.5} unit="V" onChange={(v) => patch({ potential: v })} />
          </Field>
        )}
        <div className="note">PEC boundary for the Poisson / FDTD solvers. Surface charge is computed from the normal E field.</div>
      </PanelSection>
    );
  }
  if (isDielectric(obj)) {
    return (
      <PanelSection title="Dielectric">
        <Field label="Shape">
          <Select
            value={obj.shape}
            options={[
              { value: 'box', label: 'Box' },
              { value: 'sphere', label: 'Sphere' },
              { value: 'cylinder', label: 'Cylinder' },
            ]}
            onChange={(shape) => patch({ shape })}
          />
        </Field>
        <Field label="Size">
          <Vec3Input value={obj.size} step={0.02} unit="m" onChange={(size) => patch({ size })} />
        </Field>
        <Field label="Relative permittivity εᵣ">
          <Slider value={obj.epsilonR} min={1} max={20} step={0.1} format={(v) => v.toFixed(2)} onChange={(v) => patch({ epsilonR: v })} />
        </Field>
        <Field label="Relative permeability μᵣ">
          <Slider value={obj.muR} min={0.5} max={10} step={0.1} format={(v) => v.toFixed(2)} onChange={(v) => patch({ muR: v })} />
        </Field>
        <Field label="Conductivity σ">
          <NumberInput value={obj.sigma} step={0.01} unit="S/m" onChange={(v) => patch({ sigma: Math.max(0, v) })} />
        </Field>
      </PanelSection>
    );
  }
  if (isWire(obj)) {
    return (
      <PanelSection title="Current wire">
        <Field label="Current">
          <NumberInput value={obj.current} step={0.5} unit="A" onChange={(v) => patch({ current: v })} />
        </Field>
        <Field label="Wire radius">
          <NumberInput value={obj.wireRadius} step={0.002} unit="m" onChange={(v) => patch({ wireRadius: Math.max(0.001, v) })} />
        </Field>
        <CheckRow label="Closed loop" checked={obj.closed} onChange={(v) => patch({ closed: v })} />
        {obj.points.length === 2 && (
          <>
            <Field label="Local start" hint="Relative to the object's position and rotation">
              <Vec3Input value={obj.points[0]} step={0.02} unit="m" onChange={(v) => patch({ points: [v, obj.points[1]] })} />
            </Field>
            <Field label="Local end">
              <Vec3Input value={obj.points[1]} step={0.02} unit="m" onChange={(v) => patch({ points: [obj.points[0], v] })} />
            </Field>
          </>
        )}
        <div className="note">B is integrated with Biot–Savart over the filament. Current direction is from the first point to the last.</div>
      </PanelSection>
    );
  }
  if (isLoop(obj)) {
    return (
      <PanelSection title="Current loop">
        <Field label="Radius">
          <NumberInput value={obj.radius} step={0.01} unit="m" onChange={(v) => patch({ radius: Math.max(0.01, v) })} />
        </Field>
        <Field label="Current">
          <NumberInput value={obj.current} step={0.5} unit="A" onChange={(v) => patch({ current: v })} />
        </Field>
        <Field label="Wire radius">
          <NumberInput value={obj.wireRadius} step={0.002} unit="m" onChange={(v) => patch({ wireRadius: Math.max(0.001, v) })} />
        </Field>
        <div className="note">The loop lies in the local XY plane; use rotation to tilt its normal.</div>
      </PanelSection>
    );
  }
  if (isCoil(obj)) {
    return (
      <PanelSection title="Solenoid">
        <Field label="Radius">
          <NumberInput value={obj.radius} step={0.005} unit="m" onChange={(v) => patch({ radius: Math.max(0.01, v) })} />
        </Field>
        <Field label="Length">
          <NumberInput value={obj.length} step={0.02} unit="m" onChange={(v) => patch({ length: Math.max(0.02, v) })} />
        </Field>
        <Field label="Turns">
          <Slider value={obj.turns} min={1} max={40} step={1} format={(v) => `${Math.round(v)}`} onChange={(v) => patch({ turns: Math.round(v) })} />
        </Field>
        <Field label="Current">
          <NumberInput value={obj.current} step={0.5} unit="A" onChange={(v) => patch({ current: v })} />
        </Field>
      </PanelSection>
    );
  }
  if (isMagnet(obj)) {
    return (
      <PanelSection title="Permanent magnet">
        <Field label="Radius">
          <NumberInput value={obj.radius} step={0.005} unit="m" onChange={(v) => patch({ radius: Math.max(0.01, v) })} />
        </Field>
        <Field label="Length">
          <NumberInput value={obj.length} step={0.01} unit="m" onChange={(v) => patch({ length: Math.max(0.02, v) })} />
        </Field>
        <Field label="Magnetisation M">
          <NumberInput value={obj.magnetization} step={1e5} unit="A/m" onChange={(v) => patch({ magnetization: v })} />
        </Field>
        <div className="note">Modelled by equivalent surface current loops, K_b = M × n̂. Toggle the overlay in View layers.</div>
      </PanelSection>
    );
  }
  if (isParticle(obj)) {
    return (
      <PanelSection title="Charged particle">
        <Field label="Species">
          <Select
            value={obj.species}
            options={[
              { value: 'electron', label: 'Electron' },
              { value: 'proton', label: 'Proton' },
              { value: 'custom', label: 'Custom' },
            ]}
            onChange={(species) => {
              if (species === 'electron') patch({ species, charge: -E_CHARGE, mass: M_ELECTRON });
              else if (species === 'proton') patch({ species, charge: E_CHARGE, mass: M_PROTON });
              else patch({ species });
            }}
          />
        </Field>
        <Field label="Charge">
          <NumberInput value={obj.charge} step={1e-19} unit="C" onChange={(v) => patch({ charge: v, species: 'custom' })} />
        </Field>
        <Field label="Mass">
          <NumberInput value={obj.mass} step={1e-31} unit="kg" onChange={(v) => patch({ mass: Math.max(1e-31, v), species: 'custom' })} />
        </Field>
        <Field label="Initial velocity">
          <Vec3Input value={obj.velocity} step={1e5} unit="m/s" onChange={(v) => patch({ velocity: v })} />
        </Field>
        <Field label="Trail points">
          <Slider value={obj.trailLength} min={100} max={3000} step={50} format={(v) => `${Math.round(v)}`} onChange={(v) => patch({ trailLength: Math.round(v) })} />
        </Field>
        <div className="note">Boris pusher. Fields come from the statics engine or the external E/B settings.</div>
      </PanelSection>
    );
  }
  if (isProbe(obj)) {
    return (
      <PanelSection title="Field probe">
        <Field label="Primary quantity">
          <Select
            value={obj.quantity}
            options={[
              { value: 'E', label: 'Electric field E' },
              { value: 'B', label: 'Magnetic field B' },
              { value: 'phi', label: 'Potential φ' },
              { value: 'energy', label: 'Energy density' },
            ]}
            onChange={(quantity) => patch({ quantity })}
          />
        </Field>
        <div className="note">Move the probe to sample E, B and φ live. The Data tab lists all probes.</div>
      </PanelSection>
    );
  }
  if (isPlaneWave(obj)) {
    return (
      <PanelSection title="Plane-wave source">
        <Field label="Frequency">
          <NumberInput value={obj.frequency / 1e6} step={10} unit="MHz" onChange={(v) => patch({ frequency: v * 1e6 })} />
        </Field>
        <Field label="Amplitude">
          <NumberInput value={obj.amplitude} step={0.1} unit="V/m" onChange={(v) => patch({ amplitude: v })} />
        </Field>
        <Field label="Polarisation">
          <Segmented
            value={obj.polarization}
            options={[{ value: 'y', label: 'E along y' }, { value: 'z', label: 'E along z' }]}
            onChange={(polarization) => patch({ polarization })}
          />
        </Field>
        <Field label="Waveform">
          <Segmented
            value={obj.waveform}
            options={[{ value: 'cw', label: 'CW' }, { value: 'pulse', label: 'Pulse' }]}
            onChange={(waveform) => patch({ waveform })}
          />
        </Field>
        <div className="note">The source sheet launches along +x. Use periodic y/z walls for a clean 1D experiment.</div>
      </PanelSection>
    );
  }
  if (isPointSource(obj)) {
    return (
      <PanelSection title="Point source">
        <Field label="Field component">
          <Select
            value={obj.component}
            options={['Ex', 'Ey', 'Ez', 'Hx', 'Hy', 'Hz'].map((v) => ({ value: v as typeof obj.component, label: v }))}
            onChange={(component) => patch({ component })}
          />
        </Field>
        <Field label="Frequency">
          <NumberInput value={obj.frequency / 1e6} step={10} unit="MHz" onChange={(v) => patch({ frequency: v * 1e6 })} />
        </Field>
        <Field label="Amplitude">
          <NumberInput value={obj.amplitude} step={0.1} unit="V/m" onChange={(v) => patch({ amplitude: v })} />
        </Field>
        <Field label="Waveform">
          <Segmented
            value={obj.waveform}
            options={[{ value: 'cw', label: 'CW' }, { value: 'pulse', label: 'Pulse' }]}
            onChange={(waveform) => patch({ waveform })}
          />
        </Field>
      </PanelSection>
    );
  }
  if (isAntenna(obj)) {
    return (
      <PanelSection title="Dipole antenna">
        <Field label="Length">
          <NumberInput value={obj.length} step={0.02} unit="m" onChange={(v) => patch({ length: Math.max(0.02, v) })} />
        </Field>
        <Field label="Frequency">
          <NumberInput value={obj.frequency / 1e6} step={10} unit="MHz" onChange={(v) => patch({ frequency: v * 1e6 })} />
        </Field>
        <Field label="Amplitude">
          <NumberInput value={obj.amplitude} step={0.1} unit="V/m" onChange={(v) => patch({ amplitude: v })} />
        </Field>
      </PanelSection>
    );
  }
  return null;
}

function objectHelp(obj: SceneObject): string {
  if (isConductor(obj)) return 'In statics, this object is a Dirichlet region in the Poisson solve. In waves it is a perfect electric conductor (E=0 inside).';
  if (isDielectric(obj)) return 'Rasterised into εᵣ, μᵣ and σ cell arrays. Interfaces are staircased at the grid resolution.';
  if (isWire(obj) || isLoop(obj) || isCoil(obj)) return 'Current sources generate B via Biot–Savart in statics. In waves, a conductor/dielectric version can be used as an obstacle.';
  if (isMagnet(obj)) return 'Uniform magnetisation is represented by equivalent surface currents. This is a magnetostatic model; it is not a time-dependent material in FDTD.';
  if (isParticle(obj)) return 'The particle is a test charge: it feels the field but does not source it (no PIC feedback).';
  if (isProbe(obj)) return 'A passive sampler. It does not disturb the field.';
  return 'Scene object.';
}

function DisplayPanel() {
  const scene = useAppStore((s) => s.scene);
  const setDisplay = useAppStore((s) => s.setDisplay);
  const d = scene.display;
  const waves = scene.mode === 'waves';
  const quantities: Array<{ value: SliceQuantity; label: string }> = waves
    ? [
        { value: 'Emag', label: '|E|' },
        { value: 'Ez', label: 'Ez' },
        { value: 'Ey', label: 'Ey' },
        { value: 'Bmag', label: '|B|' },
        { value: 'energyE', label: 'u_E' },
        { value: 'poynting', label: '|S|' },
      ]
    : [
        { value: 'Emag', label: '|E|' },
        { value: 'phi', label: 'φ' },
        { value: 'Bmag', label: '|B|' },
        { value: 'energyE', label: 'u_E' },
        { value: 'energyB', label: 'u_B' },
      ];
  return (
    <>
      <PanelSection title="Field layers">
        <Field label="Field lines">
          <Select
            value={d.fieldLines}
            options={[
              { value: 'none', label: 'None' },
              { value: 'E', label: 'Electric field lines' },
              { value: 'B', label: 'Magnetic field lines' },
            ]}
            onChange={(fieldLines) => setDisplay({ fieldLines })}
            disabled={waves}
          />
        </Field>
        {!waves && (
          <Field label="Lines / seeds">
            <Slider value={d.lineCount} min={8} max={140} step={4} format={(v) => `${Math.round(v)}`} onChange={(lineCount) => setDisplay({ lineCount })} />
          </Field>
        )}
        <Field label="Vector arrows">
          <Select
            value={d.arrows}
            options={[
              { value: 'none', label: 'None' },
              { value: 'E', label: 'E arrows' },
              { value: 'B', label: 'B arrows' },
              { value: 'P', label: 'Poynting arrows' },
            ]}
            onChange={(arrows) => setDisplay({ arrows })}
          />
        </Field>
        {d.arrows !== 'none' && (
          <>
            <Field label="Arrow density">
              <Slider value={d.arrowDensity} min={3} max={16} step={1} format={(v) => `${Math.round(v)}³`} onChange={(arrowDensity) => setDisplay({ arrowDensity: Math.round(arrowDensity) })} />
            </Field>
            <Field label="Arrow scale">
              <Slider value={d.vectorScale} min={0.3} max={2.5} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(vectorScale) => setDisplay({ vectorScale })} />
            </Field>
          </>
        )}
      </PanelSection>

      <PanelSection title="Slice planes">
        <CheckRow label="XY plane (constant z)" checked={d.slices.xy} onChange={(v) => setDisplay({ slices: { ...d.slices, xy: v } })} />
        <CheckRow label="XZ plane (constant y)" checked={d.slices.xz} onChange={(v) => setDisplay({ slices: { ...d.slices, xz: v } })} />
        <CheckRow label="YZ plane (constant x)" checked={d.slices.yz} onChange={(v) => setDisplay({ slices: { ...d.slices, yz: v } })} />
        {d.slices.xy && (
          <Field label="z position">
            <Slider value={d.slicePositions.z} min={-1} max={1} step={0.02} format={(v) => v.toFixed(2)} onChange={(v) => setDisplay({ slicePositions: { ...d.slicePositions, z: v } })} />
          </Field>
        )}
        {d.slices.xz && (
          <Field label="y position">
            <Slider value={d.slicePositions.y} min={-1} max={1} step={0.02} format={(v) => v.toFixed(2)} onChange={(v) => setDisplay({ slicePositions: { ...d.slicePositions, y: v } })} />
          </Field>
        )}
        {d.slices.yz && (
          <Field label="x position">
            <Slider value={d.slicePositions.x} min={-1} max={1} step={0.02} format={(v) => v.toFixed(2)} onChange={(v) => setDisplay({ slicePositions: { ...d.slicePositions, x: v } })} />
          </Field>
        )}
        <Field label="Slice quantity">
          <Select value={d.sliceQuantity} options={quantities} onChange={(sliceQuantity) => setDisplay({ sliceQuantity })} />
        </Field>
        <Field label="Slice opacity">
          <Slider value={d.sliceOpacity} min={0.1} max={1} step={0.02} format={(v) => `${Math.round(v * 100)}%`} onChange={(sliceOpacity) => setDisplay({ sliceOpacity })} />
        </Field>
        <Field label="Map">
          <Select
            value={d.colormap}
            options={['electric', 'magnetic', 'inferno', 'viridis', 'plasma', 'coolwarm', 'mono'].map((v) => ({ value: v as typeof d.colormap, label: v }))}
            onChange={(colormap) => setDisplay({ colormap })}
          />
        </Field>
        <CheckRow label="Logarithmic colour scale" checked={d.logScale} onChange={(logScale) => setDisplay({ logScale })} />
      </PanelSection>

      <PanelSection title="Scene overlays">
        <CheckRow label="Grid" checked={d.showGrid} onChange={(showGrid) => setDisplay({ showGrid })} />
        <CheckRow label="Axes" checked={d.showAxes} onChange={(showAxes) => setDisplay({ showAxes })} />
        <CheckRow label="Domain box" checked={d.showDomain} onChange={(showDomain) => setDisplay({ showDomain })} />
        <CheckRow label="Bound surface current on magnets" checked={d.showBoundCurrent} onChange={(showBoundCurrent) => setDisplay({ showBoundCurrent })} />
        <div className="note">The bound-current overlay shows the equivalent surface current K_b = M × n̂ used by the magnet model.</div>
      </PanelSection>
    </>
  );
}

function SimulationPanel() {
  const scene = useAppStore((s) => s.scene);
  const setSimulation = useAppStore((s) => s.setSimulation);
  const sim = scene.simulation;
  const waves = scene.mode === 'waves';
  const meta = useAppStore((s) => s.fdtdMeta);
  return (
    <>
      <PanelSection title="Grid & solver">
        <Field label="Resolution">
          <Segmented
            value={String(sim.resolution) as '48' | '64' | '96'}
            options={[
              { value: '48', label: '48³' },
              { value: '64', label: '64³' },
              { value: '96', label: '96³' },
            ]}
            onChange={(v) => setSimulation({ resolution: Number(v) as 48 | 64 | 96 })}
          />
        </Field>
        {waves ? (
          <>
            <Field label="Steps per frame">
              <Slider value={sim.stepsPerFrame} min={1} max={12} step={1} format={(v) => `${Math.round(v)}`} onChange={(stepsPerFrame) => setSimulation({ stepsPerFrame: Math.round(stepsPerFrame) })} />
            </Field>
            <Field label="CFL factor">
              <Slider value={sim.cfl} min={0.3} max={0.95} step={0.01} format={(v) => v.toFixed(2)} onChange={(cfl) => setSimulation({ cfl })} />
            </Field>
            <Field label="Absorbing layer">
              <Slider value={sim.pmlCells} min={0} max={16} step={1} format={(v) => `${Math.round(v)} cells`} onChange={(pmlCells) => setSimulation({ pmlCells: Math.round(pmlCells) })} />
            </Field>
            <Field label="Boundary x">
              <Select value={sim.boundary.x} options={boundaryOptions} onChange={(x) => setSimulation({ boundary: { ...sim.boundary, x } })} />
            </Field>
            <Field label="Boundary y">
              <Select value={sim.boundary.y} options={boundaryOptions} onChange={(y) => setSimulation({ boundary: { ...sim.boundary, y } })} />
            </Field>
            <Field label="Boundary z">
              <Select value={sim.boundary.z} options={boundaryOptions} onChange={(z) => setSimulation({ boundary: { ...sim.boundary, z } })} />
            </Field>
            {meta && (
              <div className="note">
                <div className="stat-line"><span>Δt</span><b>{formatSci(meta.dt, 4)} s</b></div>
                <div className="stat-line"><span>Δx</span><b>{formatSci(meta.dx, 3)} m</b></div>
                <div className="stat-line"><span>λ / Δx</span><b>{meta.wavelengthCells.toFixed(1)} cells</b></div>
                <div className="stat-line"><span>Grid</span><b>{meta.nx}×{meta.ny}×{meta.nz}</b></div>
              </div>
            )}
            {meta && meta.wavelengthCells > 0 && meta.wavelengthCells < 15 && (
              <div className="note warn">Wavelength is only {meta.wavelengthCells.toFixed(1)} cells. Increase resolution or lower frequency for a converged wave.</div>
            )}
            <div className="note">The graded absorber is impedance-matched; reflections are small but not zero. Periodic walls give an exact 1D-embedded plane wave.</div>
          </>
        ) : (
          <>
            <Field label="Boundary">
              <Segmented
                value={sim.staticBoundary}
                options={[{ value: 'grounded', label: 'Grounded box' }, { value: 'open', label: 'Open + external E' }]}
                onChange={(staticBoundary) => setSimulation({ staticBoundary })}
              />
            </Field>
            <Field label="External E" hint="Applied uniform field used with the open boundary">
              <Vec3Input value={sim.externalField} step={100} unit="V/m" onChange={(externalField) => setSimulation({ externalField })} />
            </Field>
            <Field label="External B" hint="Uniform background magnetic field">
              <Vec3Input value={sim.externalB} step={1e-4} unit="T" onChange={(externalB) => setSimulation({ externalB })} />
            </Field>
            <Field label="Particle slow-motion" hint="Wall seconds per 200 ns of simulated time at 1×">
              <Slider value={sim.timeScale} min={0.1} max={4} step={0.1} format={(v) => `${v.toFixed(1)}×`} onChange={(timeScale) => setSimulation({ timeScale })} />
            </Field>
            <div className="note">
              Electrostatics uses analytic superposition for bare charges and a 3D finite-volume multigrid Poisson solve when conductors or dielectrics are present. Cell size is {formatSci(scene.domain.size[0] / sim.resolution, 3)} m. Test particles advance with a Boris pusher in the analytic E and Biot–Savart B fields.
            </div>
          </>
        )}
      </PanelSection>

      <PanelSection title="Domain">
        <Field label="Size">
          <Vec3Input value={scene.domain.size} step={0.1} unit="m" onChange={(size) => useAppStore.getState().setScene({ ...scene, domain: { ...scene.domain, size } }, { history: false })} />
        </Field>
        <Field label="Centre">
          <Vec3Input value={scene.domain.center} step={0.05} unit="m" onChange={(center) => useAppStore.getState().setScene({ ...scene, domain: { ...scene.domain, center } }, { history: false })} />
        </Field>
      </PanelSection>
    </>
  );
}

const boundaryOptions = [
  { value: 'pml' as const, label: 'Absorbing layer' },
  { value: 'pec' as const, label: 'PEC wall' },
  { value: 'periodic' as const, label: 'Periodic' },
];

function TheoryPanel() {
  const scene = useAppStore((s) => s.scene);
  const theory = scene.theory;
  const equations = useMemo(() => (theory?.equations ?? []).map((eq) => {
    try {
      return katex.renderToString(eq, { throwOnError: false, displayMode: true });
    } catch {
      return eq;
    }
  }), [theory]);
  if (!theory) {
    return <div className="note">This scene has no theory card. Pick a curated scene from the library, or build your own.</div>;
  }
  return (
    <>
      <div className="theory-eyebrow">Theory card</div>
      <div className="theory-title">{theory.title}</div>
      <div className="theory-body">
        <p>{theory.body}</p>
        {equations.map((html, i) => (
          <div key={i} className="equation" dangerouslySetInnerHTML={{ __html: html }} />
        ))}
        {theory.prompts && theory.prompts.length > 0 && (
          <>
            <div className="theory-eyebrow" style={{ marginTop: 14 }}>Try this</div>
            <ul className="prompt-list">
              {theory.prompts.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          </>
        )}
      </div>
    </>
  );
}

function MeasurePanel() {
  const scene = useAppStore((s) => s.scene);
  const measurements = useAppStore((s) => s.measurements);
  const summary = useAppStore((s) => s.staticsSummary);
  const probes = useAppStore((s) => s.probes);
  const particleTelemetry = useAppStore((s) => s.particleTelemetry);
  const inductionTelemetry = useAppStore((s) => s.inductionTelemetry);
  const togglePanel = useAppStore((s) => s.togglePanel);
  const panels = useAppStore((s) => s.panels);
  const meta = useAppStore((s) => s.fdtdMeta);
  const waves = scene.mode === 'waves';

  const cards: Array<{ label: string; value: string }> = [];
  if (summary?.hasGrid) {
    if (summary.differentialCapacitance !== undefined) cards.push({ label: 'Capacitance', value: formatPrefixed(summary.differentialCapacitance, 'F') });
  }
  if (summary && summary.inductance > 0) cards.push({ label: 'Inductance', value: formatPrefixed(summary.inductance, 'H') });
  if (measurements.electricEnergy !== undefined) cards.push({ label: 'Electric energy', value: formatPrefixed(measurements.electricEnergy, 'J') });
  if (measurements.magneticEnergy !== undefined) cards.push({ label: 'Magnetic energy', value: formatPrefixed(measurements.magneticEnergy, 'J') });
  if (measurements.emf !== undefined) cards.push({ label: 'Induced EMF', value: formatPrefixed(measurements.emf, 'V') });
  if (measurements.flux !== undefined) cards.push({ label: 'Flux linkage', value: formatPrefixed(measurements.flux, 'Wb') });
  if (waves && measurements.dt) {
    cards.push({ label: 'Time step', value: formatSci(measurements.dt, 3) + ' s' });
    if (measurements.dx !== undefined) cards.push({ label: 'Cell size', value: formatSci(measurements.dx, 3) + ' m' });
  }

  return (
    <>
      <PanelSection title="Live measurements" right={
        <button className="mini-btn" onClick={() => togglePanel('chart')} title="Toggle chart">
          <Icon name="chart" size={13} />
        </button>
      }>
        {cards.length > 0 ? (
          <div className="measure-grid">
            {cards.map((c) => (
              <div className="measure-card" key={c.label}>
                <div className="measure-label">{c.label}</div>
                <div className="measure-value">{c.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="note">No scalar measurements yet. Add conductors for capacitance, coils for inductance, or run a wave scene.</div>
        )}
        {summary?.stats && (
          <div style={{ marginTop: 8 }}>
            <div className="stat-line"><span>Solver</span><b>{summary.stats.algorithm}</b></div>
            <div className="stat-line"><span>Solve time</span><b>{Math.round(summary.stats.solveMs)} ms</b></div>
            <div className="stat-line"><span>V-cycles / residual</span><b>{summary.stats.cycles} / {summary.stats.residual.toExponential(1)}</b></div>
            <div className="stat-line"><span>Cells</span><b>{summary.stats.cells.toLocaleString()}</b></div>
          </div>
        )}
        {meta && (
          <div style={{ marginTop: 8 }}>
            <div className="stat-line"><span>Grid</span><b>{meta.nx}×{meta.ny}×{meta.nz}</b></div>
            <div className="stat-line"><span>CFL</span><b>{meta.cfl.toFixed(2)}</b></div>
            <div className="stat-line"><span>λ / Δx</span><b>{meta.wavelengthCells.toFixed(1)}</b></div>
          </div>
        )}
      </PanelSection>

      {inductionTelemetry.length > 0 && (
        <PanelSection title="Induction">
          {inductionTelemetry.map((r) => (
            <div className="probe-row" key={r.id}>
              <div className="probe-row-head">
                <span>{r.name}</span>
                <span style={{ color: 'var(--muted)' }}>{r.turns > 1 ? `${r.turns} turns` : '1 turn'}</span>
              </div>
              <div className="probe-vals">
                <span>Φ <b>{Number.isFinite(r.flux) ? formatPrefixed(r.flux, 'Wb') : '—'}</b></span>
                <span>ε <b>{formatPrefixed(r.emf, 'V')}</b></span>
              </div>
            </div>
          ))}
          <div className="note">ε = −dΦ/dt from the numerical flux derivative. In the moving-rod scene it is computed from ∫(v×B)·dl instead.</div>
        </PanelSection>
      )}

      {particleTelemetry.length > 0 && (
        <PanelSection title="Charged particles">
          {particleTelemetry.map((p) => (
            <div className="probe-row" key={p.id}>
              <div className="probe-row-head">
                <span>{p.name}</span>
                <span style={{ color: 'var(--muted)' }}>
                  {p.position.map((v) => (v * 100).toFixed(1)).join(', ')} cm
                </span>
              </div>
              <div className="probe-vals">
                <span>v <b>{formatPrefixed(p.speed, 'm/s')}</b></span>
                <span>E <b>{formatPrefixed(p.E, 'V/m')}</b></span>
                <span>B <b>{formatPrefixed(p.B, 'T')}</b></span>
              </div>
              <div className="probe-vals">
                <span>r<sub>c</sub> <b>{Number.isFinite(p.gyroRadius) ? formatPrefixed(p.gyroRadius, 'm') : '—'}</b></span>
                <span>T<sub>c</sub> <b>{Number.isFinite(p.gyroPeriod) ? formatSci(p.gyroPeriod, 3) + ' s' : '—'}</b></span>
              </div>
            </div>
          ))}
        </PanelSection>
      )}

      <PanelSection title={`Probes (${probes.length})`}>
        {probes.length === 0 && <div className="note">Add a probe object to sample E, B and φ.</div>}
        <div className="probe-table">
          {probes.map((p) => (
            <div className="probe-row" key={p.id}>
              <div className="probe-row-head">
                <span>{scene.objects.find((o) => o.id === p.id)?.name ?? 'Probe'}</span>
                <span style={{ color: 'var(--muted)' }}>{p.position.map((v) => v.toFixed(2)).join(', ')}</span>
              </div>
              <div className="probe-vals">
                <span>E <b>{formatPrefixed(p.Emag, 'V/m')}</b></span>
                <span>B <b>{formatPrefixed(p.Bmag, 'T')}</b></span>
                <span>φ <b>{formatPrefixed(p.phi, 'V')}</b></span>
              </div>
            </div>
          ))}
        </div>
      </PanelSection>

      {summary && summary.conductors.length > 0 && (
        <PanelSection title="Conductors">
          {summary.conductors.map((c) => (
            <div className="probe-row" key={c.id}>
              <div className="probe-row-head"><span>{c.name}</span><span>Q</span></div>
              <div className="probe-vals">
                <span>V <b>{formatPrefixed(c.potential, 'V')}</b></span>
                <span>Q <b>{formatPrefixed(c.charge, 'C')}</b></span>
                <span>{c.floating ? 'floating' : 'held'}</span>
              </div>
            </div>
          ))}
        </PanelSection>
      )}

      <PanelSection title="Wave diagnostics" defaultOpen={waves}>
        {waves ? (
          <>
            <div className="stat-line"><span>Frequency</span><b>{measurements.frequency ? formatPrefixed(measurements.frequency, 'Hz') : '—'}</b></div>
            <div className="stat-line"><span>Free-space λ</span><b>{measurements.wavelength ? formatPrefixed(measurements.wavelength, 'm') : '—'}</b></div>
            <div className="stat-line"><span>Electric energy</span><b>{measurements.electricEnergy !== undefined ? formatPrefixed(measurements.electricEnergy, 'J') : '—'}</b></div>
            <div className="stat-line"><span>Magnetic energy</span><b>{measurements.magneticEnergy !== undefined ? formatPrefixed(measurements.magneticEnergy, 'J') : '—'}</b></div>
            <Button variant="soft" onClick={() => { if (!panels.chart) togglePanel('chart'); }}>
              <Icon name="chart" size={13} /> Open probe oscilloscope
            </Button>
          </>
        ) : (
          <div className="note">Switch to Waves to see FDTD diagnostics.</div>
        )}
      </PanelSection>
    </>
  );
}
