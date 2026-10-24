import React from 'react';
import { useAppStore } from '../app/store';
import { formatPrefixed, formatSci } from '../engine/units';
import type { ProbeReading } from '../scene/types';

export function ProbeReadout({ reading }: { reading?: ProbeReading }) {
  const scene = useAppStore(s => s.scene);
  const fullMaxwell = scene.simulation.useApproximation === false;
  if (!reading) return <div className="note">Sampling at this coordinate…</div>;
  const outside = reading.position.some((v, a) => Math.abs(v - scene.domain.center[a]) > scene.domain.size[a] / 2);
  if (outside) return <div className="note warn">Outside the simulation domain. Move the probe inside to sample the solved field.</div>;
  return <div className="probe-readout">
    <div className="probe-vals"><span>|E| <b>{formatPrefixed(reading.Emag, 'V/m')}</b></span><span>|B| <b>{formatPrefixed(reading.Bmag, 'T')}</b></span></div>
    {(['E', 'B', ...(fullMaxwell ? ['D', 'H', 'J'] as const : [])] as const).map(field => reading[field] && <div key={field} className="probe-components" role="group" aria-label={`${field} components`}>
      {reading[field]!.map((value, i) => <div className="stat-line" key={i}><span>{field}{'xyz'[i]}</span><b>{formatSci(value, 5)} {{ E: 'V/m', B: 'T', D: 'C/m²', H: 'A/m', J: 'A/m²' }[field]}</b></div>)}
    </div>)}
    {fullMaxwell && reading.rho !== undefined && <div className="stat-line"><span>ρ</span><b>{formatSci(reading.rho, 5)} C/m³</b></div>}
    {scene.mode === 'fields' && scene.simulation.useApproximation !== false && <div className="stat-line"><span>Potential φ</span><b>{formatPrefixed(reading.phi, 'V')}</b></div>}
    {fullMaxwell && <div className="note">Total E and B from Maxwell evolution. D, H, J and deposited charge density ρ are shown when sampled; ρ includes bound polarization charge where present. A unique electrostatic potential does not describe the induced electric field.</div>}
  </div>;
}
