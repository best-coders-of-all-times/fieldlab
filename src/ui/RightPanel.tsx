import React, { useMemo, useState } from 'react';
import katex from 'katex';
import { useAppStore } from '../app/store';
import { Icon } from './Icon';
import { MotionEditor } from './MotionEditor';
import { ProbeReadout } from './ProbeReadout';
import { makeProbe } from '../scene/defaults';
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
import { M_ELECTRON, M_PROTON, E_CHARGE, C_LIGHT } from '../engine/constants';

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
  const measurements = useAppStore((s) => s.measurements);
  const obj = scene.objects.find((o) => o.id === selectedId);

  if (!obj) {
    return (
      <>
        <PanelSection title="Scene">
          <div className="theory-title">{scene.name}</div>
          {scene.subtitle && <div className="note">{scene.subtitle}</div>}
          <div className="stat-line"><span>Solver</span><b>{scene.simulation.useApproximation === false ? 'Maxwell FDTD' : scene.mode === 'fields' ? 'Electrostatic / quasistatic' : 'Legacy wave FDTD'}</b></div>
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

      {(scene.mode === 'fields' || scene.simulation.useApproximation === false) && obj.kind !== 'probe' && <MotionEditor obj={obj} patch={patch} />}

      <ObjectPhysics obj={obj} patch={patch} />

      {scene.simulation.useApproximation === false && measurements.extra?.[`bodyCharge:${obj.id}`] !== undefined && <PanelSection title="Body charge">
        <div className="stat-line"><span>Free charge</span><b>{formatPrefixed(measurements.extra[`bodyCharge:${obj.id}`], 'C')}</b></div>
      </PanelSection>}

      <PanelSection title="About this object" defaultOpen={false}>
        <div className="note">{objectHelp(obj, scene.simulation.useApproximation === false)}</div>
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
  const fullMaxwell = useAppStore(s => s.scene.simulation.useApproximation === false);
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
        <div className="note">{fullMaxwell ? 'A resolved finite charge distribution sources the evolved fields. Resolve the radius with multiple cells.' : 'Analytic field: linear inside a solid sphere, zero inside a shell, inverse-square outside.'}</div>
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
        {fullMaxwell && <Field label="Conductivity" hint="Finite conductivity in the Maxwell material rest frame. The explicit current update limits σ Δt / ε₀.">
          <NumberInput value={obj.conductivity ?? 0.01} min={0} step={0.001} unit="S/m" onChange={conductivity => patch({ conductivity })} />
        </Field>}
        <div className="note">{fullMaxwell ? 'Finite-conductivity body. Voltages or net charges define initialization only after the isolated model is selected in Solve. There is no implicit battery or voltage clamp.' : 'Ideal equipotential region for the electrostatic Poisson solve.'}</div>
      </PanelSection>
    );
  }
  if (isDielectric(obj)) {
    const drude = obj.materialModel === 'drude';
    const parameters = obj.drude ?? { omegaP: 1e9, gamma: 1e8 };
    return (
      <PanelSection title="Dielectric">
        {(fullMaxwell || drude) && <Field label="Material model">
          <Select value={obj.materialModel ?? 'linear'} options={[
            { value: 'linear', label: 'Linear (nondispersive)' },
            { value: 'drude', label: 'Drude (dispersive)' },
          ]} onChange={materialModel => patch({ materialModel, ...(materialModel === 'drude' ? { drude: parameters } : {}) })} />
        </Field>}
        {drude && <>
          <Field label="Plasma angular frequency"><NumberInput value={parameters.omegaP} min={0} step={1e8} unit="rad/s" onChange={omegaP => patch({ drude: { ...parameters, omegaP } })} /></Field>
          <Field label="Damping rate"><NumberInput value={parameters.gamma} min={0} step={1e7} unit="s⁻¹" onChange={gamma => patch({ drude: { ...parameters, gamma } })} /></Field>
          {!fullMaxwell && <div className="note warn" role="alert">Drude dispersion requires Maxwell mode. Disable Use approximation in Solve or choose the linear material model.</div>}
          <div className="note">Stationary Drude material adds a dispersive current to the linear background. Plasma angular frequency is in rad/s; damping is in s⁻¹. Initial example values are a demonstration, not fitted parameters for a real metal. Parameters remain saved when switching to Linear.</div>
        </>}
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
        <div className="note">{fullMaxwell ? `${drude ? 'Permittivity sets the nondispersive background of the stationary Drude response.' : 'Stationary nondispersive material.'} Moving dielectric response requires a supported constitutive model; unsupported motion is rejected.` : 'Permeability and conductivity affect wave scenes. Static B uses the vacuum Biot–Savart model; static dielectrics use permittivity.'}</div>
        <Field label="Conductivity σ">
          <NumberInput value={obj.sigma} step={0.01} unit="S/m" onChange={(v) => patch({ sigma: Math.max(0, v) })} />
        </Field>
      </PanelSection>
    );
  }
  if (isWire(obj)) {
    return (
      <PanelSection title="Current wire">
        <FilamentElectrical obj={obj} patch={patch} />
        <Field label="Wire radius">
          <NumberInput value={obj.wireRadius} step={0.002} unit="m" onChange={(v) => patch({ wireRadius: Math.max(0.001, v) })} />
        </Field>
        <CheckRow label="Closed loop" checked={obj.closed} onChange={(v) => patch({ closed: v })} />
        <Field label="Path shape">
          <Select value={obj.path ?? 'polyline'} options={[{ value: 'polyline', label: 'Straight segments' }, { value: 'smooth', label: 'Smooth curve through points' }]} onChange={path => patch({ path })} />
        </Field>
        {obj.points.map((point, i) => <div className="wire-point" key={i}>
          <Field label={`Point ${i + 1}`} hint="Local coordinates in metres">
            <Vec3Input value={point} step={0.01} onChange={value => patch({ points: obj.points.map((p, j) => i === j ? value : p) })} />
          </Field>
          <Button title={`Remove point ${i + 1}`} disabled={obj.points.length <= 2} onClick={() => patch({ points: obj.points.filter((_, j) => j !== i) })}><Icon name="trash" size={12} /></Button>
        </div>)}
        <Button disabled={obj.points.length >= 256} onClick={() => {
          const end = obj.points.at(-1) ?? [0, 0, 0];
          patch({ points: [...obj.points, [end[0] + 0.05, end[1] + 0.05, end[2]]] });
        }}>Add control point</Button>
        <div className="note">{obj.electricalModel === 'currentFeed' ? 'The visible path includes the feed and return lead. Positive current runs from the first point in the From body to the last point in the To body. Keep the full endpoint interpolation support inside each named body; unresolved contacts stop with an error.' : fullMaxwell ? obj.electricalModel === 'conducting' ? 'Current evolves in the resolved finite-conductivity wire; the stored impressed-current value is retained for switching back and is not applied.' : 'Impressed filament current in the authored direction. This source is externally driven; select passive finite conductivity for induced-current feedback.' : 'B is integrated with Biot–Savart over impressed filaments. Current direction is from the first point to the last.'}</div>
      </PanelSection>
    );
  }
  if (isLoop(obj)) {
    return (
      <PanelSection title="Current loop">
        <Field label="Radius">
          <NumberInput value={obj.radius} step={0.01} unit="m" onChange={(v) => patch({ radius: Math.max(0.01, v) })} />
        </Field>
        <FilamentElectrical obj={obj} patch={patch} />
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
        <FilamentElectrical obj={obj} patch={patch} />
        <Field label="Wire radius">
          <NumberInput value={obj.wireRadius} step={0.002} min={0.001} unit="m" onChange={wireRadius => patch({ wireRadius })} />
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
        <div className="stat-line"><span>Side surface |K_b|</span><b>{formatPrefixed(Math.abs(obj.magnetization), 'A/m')}</b></div>
        <div className="note">Gold rings and arrowheads show current direction; the mint arrow shows magnetisation. Reverse M to reverse the currents and poles. End faces carry no bound current for this uniform axial magnetisation.</div>
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
        {!fullMaxwell && <Field label="Initial velocity">
          <Vec3Input value={obj.velocity} step={1e5} unit="m/s" onChange={(v) => patch({ velocity: v })} />
        </Field>}
        <Field label="Trail points">
          <Slider value={obj.trailLength} min={100} max={3000} step={50} format={(v) => `${Math.round(v)}`} onChange={(v) => patch({ trailLength: Math.round(v) })} />
        </Field>
        <div className="note">{fullMaxwell ? 'Source particle coupled to the evolved field clock and deposited charge/current. Set initial velocity in Dynamics above; explicit Dynamics mass overrides the species mass.' : 'Test particle with Boris pusher. Fields come from the statics engine or the external E/B settings.'}</div>
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
              ...(!fullMaxwell ? [{ value: 'phi' as const, label: 'Potential φ' }] : []),
              { value: 'energy', label: 'Energy density' },
            ]}
            onChange={(quantity) => patch({ quantity })}
          />
        </Field>
        <LiveProbe id={obj.id} />
        <div className="note">Enter a world coordinate in Position above. This passive probe samples all E and B components without disturbing the field.</div>
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
        <div className="note">{fullMaxwell ? 'Physical electric current sheet normal to x, radiating in both directions. The amplitude specifies the incident E scale. Use periodic y/z walls for a 1D experiment.' : 'The source sheet launches along +x. Use periodic y/z walls for a clean 1D experiment.'}</div>
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
        <Field label={fullMaxwell ? 'Electric current amplitude' : 'Amplitude'}>
          <NumberInput value={obj.amplitude} step={0.1} unit={fullMaxwell ? 'A' : 'V/m'} onChange={(v) => patch({ amplitude: v })} />
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
        <Field label={fullMaxwell ? 'Feed current amplitude' : 'Amplitude'}>
          <NumberInput value={obj.amplitude} step={0.1} unit={fullMaxwell ? 'A' : 'V/m'} onChange={(v) => patch({ amplitude: v })} />
        </Field>
      </PanelSection>
    );
  }
  return null;
}

function FilamentElectrical({ obj, patch }: {
  obj: Extract<SceneObject, { kind: 'wire' | 'loop' | 'coil' }>;
  patch: (p: Partial<SceneObject>) => void;
}) {
  const scene = useAppStore(s => s.scene);
  const fullMaxwell = scene.simulation.useApproximation === false;
  const passive = obj.electricalModel === 'conducting';
  const terminal = obj.kind === 'wire' && obj.electricalModel === 'currentFeed';
  const contacts = obj.kind === 'wire' ? obj.terminalFeed ?? { from: '', to: '', riseTime: 1e-9 } : null;
  const bodies = scene.objects.filter(body => body.visible && (body.kind === 'conductor' ||
    ((body.kind === 'wire' || body.kind === 'loop' || body.kind === 'coil') && body.electricalModel === 'conducting')));
  const longest = Math.max(...scene.domain.size);
  const maxSpacing = Math.max(...scene.domain.size.map(size => size / Math.max(8, Math.round(scene.simulation.resolution * size / longest))));
  const minimumRadius = 1.5 * maxSpacing;
  return <>
    {(fullMaxwell || passive || obj.kind === 'wire') && <Field label="Electrical model">
      <Select value={obj.electricalModel ?? 'impressed'} options={[
        { value: 'impressed', label: 'Impressed current (external drive)' },
        { value: 'conducting', label: 'Passive finite conductivity' },
        ...(obj.kind === 'wire' ? [{ value: 'currentFeed' as const, label: 'Terminal current feed' }] : []),
      ]} onChange={electricalModel => patch({ electricalModel })} />
    </Field>}
    {passive ? <>
      <Field label="Conductivity"><NumberInput value={obj.conductivity ?? 0.01} min={0} step={0.001} unit="S/m" onChange={conductivity => patch({ conductivity })} /></Field>
      {!fullMaxwell && <div className="note warn" role="alert">Passive finite conductivity requires Maxwell mode. Disable Use approximation in Solve or choose impressed current.</div>}
      {fullMaxwell && obj.wireRadius < minimumRadius && <div className="note warn" role="alert">Passive wire diameter must span at least three cells. This grid requires radius ≥ {formatSci(minimumRadius, 4)} m. Increase the authored radius or resolution; geometry is never automatically enlarged.</div>}
      <div className="note">The passive material responds to the evolving fields. The previous impressed-current value remains saved but is not a passive initial current or a voltage feed. General circuit and energy/momentum validation remains incomplete.</div>
    </> : <Field label="Current"><NumberInput value={obj.current} step={0.5} unit="A" onChange={current => patch({ current })} /></Field>}
    {terminal && contacts && <>
      <Field label="From body" hint="Positive current withdraws charge at the first wire point.">
        <Select value={contacts.from} options={[{ value: '', label: 'Choose a conducting body' }, ...bodies.map(body => ({ value: body.id, label: body.name }))]}
          onChange={from => patch({ terminalFeed: { ...contacts, from } })} />
      </Field>
      <Field label="To body" hint="Positive current deposits charge at the last wire point.">
        <Select value={contacts.to} options={[{ value: '', label: 'Choose a conducting body' }, ...bodies.map(body => ({ value: body.id, label: body.name }))]}
          onChange={to => patch({ terminalFeed: { ...contacts, to } })} />
      </Field>
      <Field label="Rise time" hint="Seconds from t = 0 to full current, using a cubic smooth start. Zero selects an immediate start.">
        <NumberInput value={contacts.riseTime} min={0} step={1e-10} unit="s" onChange={riseTime => patch({ terminalFeed: { ...contacts, riseTime } })} />
      </Field>
      {!fullMaxwell && <div className="note warn" role="alert">Terminal current feed requires Maxwell mode. Disable Use approximation in Solve or choose impressed current.</div>}
      <div className="note">Ideal externally powered current filament with explicit contacts to two stationary conducting bodies. Author an open stationary route including the return lead. It transfers charge without a voltage clamp or a resolved lead material response. Inactive current, conductivity and terminal settings remain saved when switching models.</div>
    </>}
  </>;
}

function objectHelp(obj: SceneObject, fullMaxwell: boolean): string {
  if (fullMaxwell) {
    if (isWire(obj) && obj.electricalModel === 'currentFeed') return 'Externally powered terminal current filament. Positive current transfers charge from the first endpoint body to the last along the visible feed and return route. Stationary resolved contacts are required; voltage clamping and lead material response are not included.';
    if (isConductor(obj)) return 'Finite conductivity with transported free charge and a local rest-frame material response. Choose the explicit isolated initial-charge model in Solve.';
    if (isParticle(obj)) return 'A source particle deposits charge and current into evolved Maxwell fields. A finite numerical charge shape is not a continuum point-particle self-force model.';
    if (isMagnet(obj)) return 'Impressed magnetization source. Moving or force-driven magnet models require explicit solver support.';
    if (isWire(obj) || isLoop(obj) || isCoil(obj)) return obj.electricalModel === 'conducting' ? 'Resolved finite-conductivity passive material with evolving charge/current. Its wire diameter must span at least three cells; this is an experimental material model, not a general validated circuit solver.' : 'Externally imposed current. Choose passive finite conductivity for material-current feedback. Unsupported motion or force coupling is reported by the solver.';
    if (isProbe(obj)) return 'Passive E/B sampler. A unique electrostatic scalar potential is not available for the full time-dependent electric field.';
  }
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
  const fullMaxwell = scene.simulation.useApproximation === false;
  const waves = scene.mode === 'waves' || fullMaxwell;
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
            disabled={waves && !fullMaxwell}
          />
        </Field>
        {(!waves || fullMaxwell) && (
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
        <Field label="Conductor opacity" hint="Visual only: transparency leaves the conductor in the physics solve">
          <Slider value={d.conductorOpacity} min={0.05} max={1} step={0.05} format={v => `${Math.round(v * 100)}%`} onChange={conductorOpacity => setDisplay({ conductorOpacity })} />
        </Field>
        <CheckRow label="Probe labels" checked={d.showProbeLabels} onChange={showProbeLabels => setDisplay({ showProbeLabels })} />
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
  const fullMaxwell = sim.useApproximation === false;
  const waves = scene.mode === 'waves' || fullMaxwell;
  const meta = useAppStore((s) => s.fdtdMeta);
  const measurements = useAppStore(s => s.measurements);
  const status = useAppStore(s => s.status);
  const dx = Math.max(...scene.domain.size) / sim.resolution;
  const estimatedDt = sim.cfl * dx / (C_LIGHT * Math.sqrt(3));
  const dt = meta?.dt ?? estimatedDt;
  const hasConductors = scene.objects.some(isConductor);
  return (
    <>
      <PanelSection title="Physical model">
        <CheckRow label="Use approximation" checked={!fullMaxwell} onChange={useApproximation => setSimulation({ useApproximation })} />
        {!fullMaxwell && scene.mode === 'fields' && <div className="note">
          Electrostatic E plus magnetostatic / quasistatic B saves computation. It does not evolve spatial induced E, radiation, or passive circuit feedback. Slow variation L/(cT) ≪ 1 and v/c ≪ 1 are useful conditions, but do not by themselves make omitted inductive effects negligible.
        </div>}
        {!fullMaxwell && scene.mode === 'waves' && <div className="note">The existing wave FDTD model remains selected. Full Maxwell scene coupling and its capability checks require switching approximation off.</div>}
        {fullMaxwell && <>
          <div className="note">Experimental: evolves Maxwell E and B for supported source and material models. Selecting the full equations does not implement every moving-material or circuit model. Unsupported configurations stop with an explicit error.</div>
          <div className="note">The finite grid uses staircased geometry and explicit constitutive and source models. Permanent magnets use impressed magnetization in the authored laboratory shape, including motion; hysteresis and rest-shape Lorentz contraction are not modeled. Electrodes have finite conductivity and isolated initial charge; voltage feeds are not implemented. Check spatial and time convergence for each configuration.</div>
          <div className="note">Resolve charge width and source bandwidth, including the startup ramp. Abrupt source or velocity starts can cause persistent grid ringing. Check spatial and time refinement; frequencies and velocities are never silently rescaled.</div>
          <div className="note">Physical time is not animation wall time. Estimated Δt: {formatSci(dt, 4)} s; one physical second requires about {formatSci(1 / dt, 3)} field steps. A slow mechanical cycle can be extremely expensive. Steps per frame changes pacing, never c or the authored motion frequency.</div>
          {hasConductors && <>
            <CheckRow label="Initialize plate voltages, then isolate" checked={sim.maxwellConductorModel === 'isolated'} onChange={isolated => setSimulation({ maxwellConductorModel: isolated ? 'isolated' : undefined })} />
            <div className={`note ${sim.maxwellConductorModel ? '' : 'warn'}`}>Authored potentials initialize conductor charge once. The bodies then evolve with finite conductivity and no voltage clamp. Select this model explicitly to run conductors. An explicit terminal current feed can transfer charge between stationary bodies along its visible feed and return route.</div>
          </>}
          {measurements.extra && <>
            <div className="stat-line"><span>Physical steps</span><b>{measurements.extra.steps?.toLocaleString() ?? '—'}</b></div>
            <div className="stat-line"><span>Measured steps / second</span><b>{measurements.extra.stepsPerSecond?.toFixed(1) ?? '—'}</b></div>
            <div className="stat-line"><span>Conservative memory budget</span><b>{measurements.extra.estimatedBytes !== undefined ? `${(measurements.extra.estimatedBytes / 1048576).toFixed(1)} MiB` : '—'}</b></div>
          </>}
        </>}
        {status.phase === 'error' && status.message && <div className="note warn" role="alert">{status.message}</div>}
      </PanelSection>
      <PanelSection title="Grid & solver">
        <Field label="Resolution">
          <Segmented
            value={String(sim.resolution)}
            options={(fullMaxwell ? [16, 24, 32, 48, 64] : [48, 64, 96]).map(resolution => ({ value: String(resolution), label: `${resolution}³` }))}
            onChange={(v) => setSimulation({ resolution: Number(v) as typeof sim.resolution })}
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
            <div className="note">Absorbing boundary accuracy depends on layer thickness, resolution, source band and incidence angle. Check convergence before interpreting weak reflected or radiated fields.</div>
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
            <Field label="Animation speed" hint="Induction: simulated seconds per wall second. Particles: 200 ns per wall second at 1×.">
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
  const fullMaxwell = scene.simulation.useApproximation === false;
  const waves = scene.mode === 'waves' || fullMaxwell;

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

      {fullMaxwell && <PanelSection title="Maxwell diagnostics">
        {[
          ['steps', 'Physical steps'], ['stepsPerSecond', 'Measured steps / second'],
          ['gaussRelative', 'Relative Gauss residual'], ['divergenceE', 'Absolute electric Gauss residual'],
          ['divergenceB', 'Magnetic divergence residual'], ['charge', 'Total charge (C)'],
          ['totalEnergy', 'Field and carrier energy estimate (J)'], ['ohmicLoss', 'Stationary material loss (J)'],
          ['sourceWork', 'Applied-current work (J)'], ['conductorLoss', 'Body heat estimate (J)'],
          ['mechanicalWork', 'Rigid linear work, partial (J)'],
          ...(scene.objects.some(o => o.visible && o.kind === 'wire' && o.electricalModel === 'currentFeed') ? [
            ['feedSourceWork', 'External terminal-source work (J)'], ['feedTransferredCharge', 'Terminal transferred charge (C)'],
            ...scene.objects.filter(o => o.visible && (o.kind === 'conductor' || ((o.kind === 'wire' || o.kind === 'loop' || o.kind === 'coil') && o.electricalModel === 'conducting')))
              .map(o => [`bodyCharge:${o.id}`, `${o.name} charge (C)`]),
          ] : []),
          ...(scene.objects.some(o => o.visible && o.kind === 'dielectric' && o.materialModel === 'drude') ? [['drudeKineticEnergy', 'Carrier kinetic estimate (J)'], ['drudeLoss', 'Drude damping estimate (J)']] : []),
        ].map(([key, label]) => <div className="stat-line" key={key}><span>{label}</span><b>{measurements.extra?.[key] !== undefined ? formatSci(measurements.extra[key], 4) : '—'}</b></div>)}
        <div className="note">Relative Gauss residual uses the current charge and D/Δx scales. Applied-current work includes deposited conduction and bound currents as well as impressed sources. Stationary material loss, body heat and partial rigid linear work are separate diagnostics; they are not a closed energy/momentum ledger. Check resolution, domain, boundaries and initialization.</div>
      </PanelSection>}

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
          <div className="note">E readouts show the electrostatic contribution. This quasistatic model reports EMF but does not solve the spatial induced E or the induced circuit current.</div>
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
        <CoordinateProbe />
        {probes.map(p => <div className="probe-row" key={p.id}>
          <div className="probe-row-head"><button className="mini-btn" onClick={() => useAppStore.getState().select(p.id)}>{scene.objects.find(o => o.id === p.id)?.name ?? 'Probe'}</button></div>
          <div className="note">({p.position.map(v => formatSci(v, 5)).join(', ')}) m</div>
          <ProbeReadout reading={p} />
        </div>)}
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
          <div className="note">Choose a wave scene from the library to see FDTD diagnostics.</div>
        )}
      </PanelSection>
    </>
  );
}

function LiveProbe({ id }: { id: string }) {
  const reading = useAppStore(s => s.probes.find(p => p.id === id));
  return <ProbeReadout reading={reading} />;
}

function CoordinateProbe() {
  const [position, setPosition] = useState<[number, number, number]>([0, 0, 0]);
  return <>
    <Field label="Sample at coordinate" hint="World x, y, z in metres"><Vec3Input value={position} onChange={setPosition} unit="m" /></Field>
    <Button onClick={() => useAppStore.getState().addObject(makeProbe(position))}>Add probe here</Button>
  </>;
}
