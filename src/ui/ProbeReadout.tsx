import React from 'react';
import { useAppStore } from '../app/store';
import { formatPrefixed, formatSci } from '../engine/units';
import type { ProbeReading } from '../scene/types';

export function ProbeReadout({ reading }: { reading?: ProbeReading }) {
  const scene = useAppStore(s => s.scene);
  if (!reading) return <div className="note">Sampling at this coordinate…</div>;
  const outside = reading.position.some((v, a) => Math.abs(v - scene.domain.center[a]) > scene.domain.size[a] / 2);
  if (outside) return <div className="note warn">Outside the simulation domain. Move the probe inside to sample the solved field.</div>;
  return <div className="probe-readout">
    <div className="probe-vals"><span>|E| <b>{formatPrefixed(reading.Emag, 'V/m')}</b></span><span>|B| <b>{formatPrefixed(reading.Bmag, 'T')}</b></span></div>
    {(['E', 'B'] as const).map(field => <div key={field} className="probe-components">
      {reading[field].map((value, i) => <div className="stat-line" key={i}><span>{field}{'xyz'[i]}</span><b>{formatSci(value, 5)} {field === 'E' ? 'V/m' : 'T'}</b></div>)}
    </div>)}
    {scene.mode === 'fields' && <div className="stat-line"><span>Potential φ</span><b>{formatPrefixed(reading.phi, 'V')}</b></div>}
  </div>;
}
