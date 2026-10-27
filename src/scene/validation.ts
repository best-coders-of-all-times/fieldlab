type RecordValue = Record<string, unknown>;
const record = (v: unknown): v is RecordValue => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown) => typeof v === 'string';
const vector = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(number);
const strings = (v: unknown) => Array.isArray(v) && v.every(text);
const oneOf = (v: unknown, values: readonly unknown[]) => values.includes(v);
const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v);
const positive = (v: unknown) => number(v) && (v as number) > 0;
const nonnegative = (v: unknown) => number(v) && (v as number) >= 0;
const between = (v: unknown, min: number, max: number) => number(v) && (v as number) >= min && (v as number) <= max;

const fields: Record<string, string[]> = {
  charge: ['charge'], chargedSphere: ['charge', 'radius', 'shell'],
  conductor: ['shape', 'size', 'potential', 'floating', 'netCharge'],
  dielectric: ['shape', 'size', 'epsilonR', 'muR', 'sigma'],
  wire: ['points', 'current', 'wireRadius', 'closed'],
  loop: ['radius', 'current', 'wireRadius', 'axis'],
  coil: ['radius', 'length', 'turns', 'current', 'wireRadius', 'axis'],
  magnet: ['radius', 'length', 'magnetization', 'axis'],
  particle: ['species', 'charge', 'mass', 'velocity', 'trailLength'], probe: ['quantity'],
  planeWave: ['direction', 'polarization', 'frequency', 'amplitude', 'waveform'],
  pointSource: ['component', 'frequency', 'amplitude', 'waveform'],
  antenna: ['length', 'frequency', 'amplitude', 'axis', 'waveform'],
};
const enums: Record<string, readonly unknown[]> = {
  shape: ['box', 'sphere', 'cylinder'], species: ['electron', 'proton', 'custom'],
  quantity: ['E', 'B', 'phi', 'energy'], polarization: ['y', 'z'],
  component: ['Ex', 'Ey', 'Ez', 'Hx', 'Hy', 'Hz'], waveform: ['cw', 'pulse'],
  sourceProfile: ['cic', 'smooth'], fieldFeedback: ['source', 'testParticle'],
  materialModel: ['linear', 'drude'], path: ['polyline', 'smooth'],
  electricalModel: ['impressed', 'conducting', 'currentFeed'],
};

function validMotion(v: unknown): boolean {
  if (!record(v)) return false;
  if (v.kind === 'keyframes') {
    return typeof v.loop === 'boolean' && Array.isArray(v.keyframes) && v.keyframes.length >= 2 &&
      v.keyframes.length <= 1024 && v.keyframes.every((k, i, all) => record(k) && nonnegative(k.time) &&
        (i === 0 ? k.time === 0 : (k.time as number) > all[i - 1].time) && vector(k.position) && vector(k.rotation));
  }
  return oneOf(v.kind, ['oscillate', 'spin']) && vector(v.axis) &&
    (v.axis as number[]).some(x => x !== 0) && number(v.amplitude) && nonnegative(v.frequency) && optional(v.phase, number);
}

function validObject(v: unknown): boolean {
  if (!record(v) || typeof v.kind !== 'string' || !Object.hasOwn(fields, v.kind)) return false;
  if (!text(v.id) || !(v.id as string).trim() || !text(v.name) || !(v.name as string).trim() ||
    !vector(v.position) || !vector(v.rotation) || typeof v.visible !== 'boolean') return false;
  for (const key of fields[v.kind]) {
    const value = v[key];
    if (Object.hasOwn(enums, key)) { if (!oneOf(value, enums[key])) return false; }
    else if (['size', 'axis', 'direction', 'velocity'].includes(key)) { if (!vector(value)) return false; }
    else if (key === 'points') {
      if (!Array.isArray(value) || value.length < 2 || value.length > 256 || !value.every(vector)) return false;
    } else if (['shell', 'floating', 'closed'].includes(key)) { if (typeof value !== 'boolean') return false; }
    else if (!number(value)) return false;
  }
  for (const [key, values] of Object.entries(enums)) if (!optional(v[key], x => oneOf(x, values))) return false;
  for (const key of ['radius', 'length', 'mass', 'wireRadius', 'sourceWidth', 'epsilonR', 'muR']) {
    if (!optional(v[key], positive)) return false;
  }
  for (const key of ['sigma', 'conductivity', 'frequency', 'trailLength']) if (!optional(v[key], nonnegative)) return false;
  if (!optional(v.color, text) || !optional(v.locked, x => typeof x === 'boolean')) return false;
  if (v.size !== undefined && (!vector(v.size) || !(v.size as number[]).every(positive))) return false;
  if (v.axis !== undefined && (!vector(v.axis) || !(v.axis as number[]).some(x => x !== 0))) return false;
  if (v.direction !== undefined && (!vector(v.direction) || !(v.direction as number[]).some(x => x !== 0))) return false;
  if (v.turns !== undefined && !between(v.turns, 1, 10000)) return false;
  if (v.trailLength !== undefined && !between(v.trailLength, 0, 10000)) return false;
  if (!optional(v.motion, validMotion)) return false;
  if (v.dynamics !== undefined) {
    const d = v.dynamics;
    if (!record(d) || !oneOf(d.mode, ['fixed', 'prescribed', 'forceDriven']) || !positive(d.mass) ||
      !vector(d.inertia) || !(d.inertia as number[]).every(positive) || !vector(d.velocity) || !vector(d.angularVelocity)) return false;
  }
  if (v.drude !== undefined && (!record(v.drude) || !nonnegative(v.drude.omegaP) || !nonnegative(v.drude.gamma))) return false;
  if (v.terminalFeed !== undefined && (!record(v.terminalFeed) || !text(v.terminalFeed.from) || !text(v.terminalFeed.to) || !nonnegative(v.terminalFeed.riseTime))) return false;
  return true;
}

/** Returns the first invalid field, without mutating or coercing authored data. */
export function sceneValidationError(v: unknown): string | null {
  if (!record(v)) return 'scene must be an object';
  if (!optional(v.version, x => x === 1)) return 'version must be 1';
  if (!oneOf(v.mode, ['fields', 'waves'])) return 'mode must be fields or waves';
  if (!Array.isArray(v.objects) || v.objects.length > 1000) return 'objects must be an array of at most 1000 objects';
  const ids = new Set<unknown>();
  for (let i = 0; i < v.objects.length; i++) {
    const o = v.objects[i];
    if (!validObject(o)) return `objects[${i}] has an invalid kind, name, vector or parameter`;
    if (ids.has(o.id)) return `objects[${i}].id is duplicated`;
    ids.add(o.id);
  }
  for (const key of ['id', 'name', 'subtitle', 'description']) if (!optional(v[key], text)) return `${key} must be text`;
  if (!optional(v.tags, strings)) return 'tags must be text values';
  if (v.domain !== undefined && (!record(v.domain) || !optional(v.domain.center, vector) ||
    !optional(v.domain.size, x => vector(x) && (x as number[]).every(positive)))) return 'domain requires finite coordinates and positive sizes';
  if (v.camera != null && (!record(v.camera) || !optional(v.camera.position, vector) || !optional(v.camera.target, vector) ||
    !optional(v.camera.orthographic, x => typeof x === 'boolean'))) return 'camera is invalid';
  if (v.theory !== undefined && (!record(v.theory) || !text(v.theory.title) || !text(v.theory.body) ||
    !optional(v.theory.equations, strings) || !optional(v.theory.prompts, strings))) return 'theory is invalid';
  if (v.simulation !== undefined) {
    const s = v.simulation;
    if (!record(s)) return 'simulation must be an object';
    const checks: Record<string, (x: unknown) => boolean> = {
      resolution: x => oneOf(x, [16, 24, 32, 48, 64, 96]), useApproximation: x => typeof x === 'boolean',
      externalField: vector, externalB: vector, staticBoundary: x => oneOf(x, ['open', 'grounded']),
      boundary: x => record(x) && ['x', 'y', 'z'].every(k => optional(x[k], y => oneOf(y, ['pml', 'pec', 'periodic']))),
      pmlCells: x => between(x, 0, 32) && Number.isInteger(x), cfl: x => positive(x) && (x as number) <= 1,
      stepsPerFrame: x => between(x, 1, 100) && Number.isInteger(x), timeScale: positive,
      targetTime: nonnegative, maxwellConductorModel: x => x === 'isolated',
      playback: record,
    };
    for (const [k, check] of Object.entries(checks)) if (!optional(s[k], check)) return `simulation.${k} is invalid`;
  }
  if (v.display !== undefined) {
    const d = v.display;
    if (!record(d)) return 'display must be an object';
    const checks: Record<string, (x: unknown) => boolean> = {
      fieldLines: x => oneOf(x, ['none', 'E', 'B']), arrows: x => oneOf(x, ['none', 'E', 'B', 'P']),
      sliceQuantity: x => oneOf(x, ['Emag', 'Ex', 'Ey', 'Ez', 'Bmag', 'phi', 'energyE', 'energyB', 'poynting']),
      colormap: x => oneOf(x, ['coolwarm', 'electric', 'magnetic', 'inferno', 'viridis', 'plasma', 'mono']),
      lineCount: x => between(x, 0, 512), arrowDensity: x => between(x, 1, 32),
      sliceResolution: x => between(x, 8, 512), vectorScale: nonnegative,
      sliceOpacity: x => between(x, 0, 1), conductorOpacity: x => between(x, 0, 1),
      slices: x => record(x) && ['xy', 'xz', 'yz'].every(k => optional(x[k], y => typeof y === 'boolean')),
      slicePositions: x => record(x) && ['x', 'y', 'z'].every(k => optional(x[k], y => between(y, -1, 1))),
      range: x => x === null || (Array.isArray(x) && x.length === 2 && x.every(number) && x[0] < x[1]),
    };
    for (const k of ['showGrid', 'showAxes', 'showDomain', 'showBoundCurrent', 'showProbeLabels', 'logScale', 'autoRange']) checks[k] = x => typeof x === 'boolean';
    for (const [k, check] of Object.entries(checks)) if (!optional(d[k], check)) return `display.${k} is invalid`;
  }
  return null;
}
