import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Field, Select, NumberInput, Slider, Toggle, CheckRow, PanelSection } from '../src/ui/controls';
import { sceneFilename } from '../src/scene/files';

describe('accessible reusable controls', () => {
  it.each([
    ['Map', <Select value="a" options={[{ value: 'a', label: 'A' }]} onChange={() => {}} />],
    ['Count', <NumberInput value={1} onChange={() => {}} />],
    ['Opacity', <Slider value={1} min={0} max={1} step={0.1} onChange={() => {}} />],
    ['Show grid', <Toggle checked onChange={() => {}} />],
  ])('labels the actual control for %s', (name, control) => {
    const html = renderToStaticMarkup(<Field label={name}>{control}</Field>);
    expect(html).toMatch(new RegExp(`<(input|select|button)[^>]*aria-label="${name}"`));
  });
  it('labels a check-row switch', () => {
    expect(renderToStaticMarkup(<CheckRow label="Show axes" checked onChange={() => {}} />)).toContain('aria-label="Show axes"');
  });
  it('keeps section actions outside its disclosure button', () => {
    const html = renderToStaticMarkup(<PanelSection title="Probes" right={<button>Chart</button>}>Values</PanelSection>);
    expect(html).toMatch(/<\/button><span class="section-right"><button>Chart/);
  });
});
describe('scene export filenames', () => {
  it.each(['电磁场', '⚡ field', 'Solenoid'])('preserves readable Unicode: %s', name => {
    expect(sceneFilename(name)).toBe(`${name.replace(/\s+/g, '-')}.fieldlab.json`);
  });
  it('uses a dated fallback for empty and unsafe-only names', () => {
    expect(sceneFilename('  ', new Date('2026-10-27T00:00:00Z'))).toBe('fieldlab-2026-10-27T00-00-00-000Z.fieldlab.json');
    expect(sceneFilename('../bad/name')).not.toContain('/');
  });
});
