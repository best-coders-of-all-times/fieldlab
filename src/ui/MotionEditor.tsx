import React, { useEffect, useState } from 'react';
import type { MotionKeyframe, SceneObject } from '../scene/types';
import { Button, CheckRow, Field, NumberInput, PanelSection, Select, Vec3Input } from './controls';

export function MotionEditor({ obj, patch }: { obj: SceneObject; patch: (p: Partial<SceneObject>) => void }) {
  const spec = obj.motion;
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (spec?.kind === 'keyframes') setText(spec.keyframes.map(k =>
      [k.time, ...k.position, ...k.rotation.map(a => Number((a * 180 / Math.PI).toFixed(6)))].join(', ')).join('\n'));
    setError('');
  }, [obj.id, spec]);
  const changeKind = (kind: 'none' | 'oscillate' | 'spin' | 'keyframes') => {
    if (kind === 'none') patch({ motion: undefined });
    else if (kind === 'keyframes') patch({ motion: { kind, loop: false, keyframes: [
      { time: 0, position: [0, 0, 0], rotation: [0, 0, 0] },
      { time: 2, position: [0.2, 0, 0], rotation: [0, 0, 0] },
    ] } });
    else patch({ motion: { kind, axis: [0, 0, 1], amplitude: 0.15, frequency: 0.5 } });
  };
  const apply = () => {
    try {
      const rows = text.trim().split(/\n/).filter(r => r.trim()).map(r => r.trim().split(/[\s,]+/).map(Number));
      if (rows.length < 2 || rows.length > 256) throw new Error('Enter 2–256 keyframes.');
      if (rows.some(r => r.length !== 7 || r.some(v => !Number.isFinite(v)))) throw new Error('Each row needs seven finite numbers: t, x, y, z, rx, ry, rz.');
      if (rows[0][0] !== 0 || rows.some((r, i) => i > 0 && r[0] <= rows[i - 1][0])) throw new Error('Start at t = 0 and use strictly increasing times.');
      const keyframes: MotionKeyframe[] = rows.map(r => ({ time: r[0], position: [r[1], r[2], r[3]],
        rotation: [r[4] * Math.PI / 180, r[5] * Math.PI / 180, r[6] * Math.PI / 180] }));
      patch({ motion: { kind: 'keyframes', keyframes, loop: spec?.kind === 'keyframes' && spec.loop } });
      setError('');
    } catch (e) { setError((e as Error).message); }
  };
  return <PanelSection title="Motion">
    <Field label="Trajectory">
      <Select value={spec?.kind ?? 'none'} onChange={changeKind} options={[
        { value: 'none', label: 'Stationary' }, { value: 'oscillate', label: 'Oscillate along axis' },
        { value: 'spin', label: 'Spin about world axis' }, { value: 'keyframes', label: 'Custom timed keyframes' },
      ]} />
    </Field>
    {spec && spec.kind !== 'keyframes' && <>
      <Field label="World axis"><Vec3Input value={spec.axis} step={0.1} onChange={axis => patch({ motion: { ...spec, axis } })} /></Field>
      {spec.kind === 'oscillate' && <Field label="Amplitude"><NumberInput value={spec.amplitude} min={0} unit="m" onChange={amplitude => patch({ motion: { ...spec, amplitude } })} /></Field>}
      <Field label="Frequency"><NumberInput value={spec.frequency} min={0} step={0.1} unit="Hz" onChange={frequency => patch({ motion: { ...spec, frequency } })} /></Field>
      <Field label="Phase"><NumberInput value={spec.phase ?? 0} step={0.1} unit="rad" onChange={phase => patch({ motion: { ...spec, phase } })} /></Field>
    </>}
    {spec?.kind === 'keyframes' && <>
      <Field label="Keyframes" hint="t (s), x y z offsets (m), rx ry rz offsets (degrees)">
        <textarea className="path-editor" aria-label="Motion keyframes" rows={7} value={text} onChange={e => setText(e.target.value)} spellCheck={false} />
      </Field>
      <Button onClick={apply}>Apply keyframes</Button>
      {error && <div className="note warn" role="alert">{error}</div>}
      <CheckRow label="Repeat trajectory" checked={spec.loop} onChange={loop => patch({ motion: { ...spec, loop } })} />
      <div className="note">Offsets are relative to Position and Rotation above. Values interpolate linearly; the final pose is held. Repeating jumps to the first pose, so match the endpoints for continuous motion.</div>
    </>}
    {spec && <div className="note">Press Play to animate. Fields follow the moving sources using the quasistatic model. Prescribed particle motion replaces its Lorentz trajectory.</div>}
  </PanelSection>;
}
