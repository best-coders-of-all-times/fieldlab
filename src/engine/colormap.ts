export type RGB = [number, number, number];

export type ColormapName =
  | 'viridis'
  | 'inferno'
  | 'coolwarm'
  | 'electric'
  | 'magnetic'
  | 'plasma'
  | 'mono';

type Stop = [number, RGB];

const STOPS: Record<ColormapName, Stop[]> = {
  viridis: [
    [0.0, [68, 1, 84]],
    [0.1, [72, 40, 120]],
    [0.2, [62, 74, 137]],
    [0.3, [49, 104, 142]],
    [0.4, [38, 130, 142]],
    [0.5, [31, 158, 137]],
    [0.6, [53, 183, 121]],
    [0.7, [109, 205, 89]],
    [0.8, [180, 222, 44]],
    [0.9, [225, 226, 40]],
    [1.0, [253, 231, 37]],
  ],
  inferno: [
    [0.0, [0, 0, 4]],
    [0.12, [22, 11, 57]],
    [0.25, [66, 10, 104]],
    [0.38, [106, 23, 110]],
    [0.5, [147, 38, 103]],
    [0.62, [188, 55, 84]],
    [0.75, [221, 81, 58]],
    [0.87, [243, 120, 25]],
    [0.95, [249, 184, 51]],
    [1.0, [252, 255, 164]],
  ],
  coolwarm: [
    [0.0, [59, 76, 192]],
    [0.15, [98, 130, 234]],
    [0.3, [141, 176, 254]],
    [0.45, [198, 219, 239]],
    [0.5, [221, 221, 221]],
    [0.55, [245, 196, 173]],
    [0.7, [244, 154, 123]],
    [0.85, [222, 96, 77]],
    [1.0, [180, 4, 38]],
  ],
  electric: [
    [0.0, [4, 10, 30]],
    [0.2, [8, 45, 92]],
    [0.4, [0, 120, 168]],
    [0.6, [0, 200, 224]],
    [0.78, [110, 245, 255]],
    [0.9, [214, 255, 255]],
    [1.0, [255, 255, 255]],
  ],
  magnetic: [
    [0.0, [24, 4, 42]],
    [0.2, [66, 12, 92]],
    [0.4, [130, 24, 140]],
    [0.6, [210, 40, 150]],
    [0.76, [255, 92, 146]],
    [0.9, [255, 170, 132]],
    [1.0, [255, 247, 214]],
  ],
  plasma: [
    [0.0, [13, 8, 135]],
    [0.2, [75, 3, 161]],
    [0.4, [125, 3, 168]],
    [0.55, [168, 34, 150]],
    [0.7, [203, 70, 121]],
    [0.82, [229, 107, 93]],
    [0.92, [248, 148, 65]],
    [1.0, [240, 249, 33]],
  ],
  mono: [
    [0.0, [10, 12, 18]],
    [1.0, [245, 248, 255]],
  ],
};

const LUT_SIZE = 256;
const luts: Partial<Record<ColormapName, Uint8Array>> = {};
const linearLuts: Partial<Record<ColormapName, Float32Array>> = {};

export const COLORMAPS: ColormapName[] = [
  'viridis', 'inferno', 'plasma', 'coolwarm', 'electric', 'magnetic', 'mono',
];

function buildLut(name: ColormapName): Uint8Array {
  const stops = STOPS[name];
  const data = new Uint8Array(LUT_SIZE * 3);
  let s = 0;
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = i / (LUT_SIZE - 1);
    while (s < stops.length - 2 && t > stops[s + 1][0]) s++;
    const [t0, c0] = stops[s];
    const [t1, c1] = stops[s + 1];
    const u = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
    data[i * 3] = Math.round(c0[0] + (c1[0] - c0[0]) * u);
    data[i * 3 + 1] = Math.round(c0[1] + (c1[1] - c0[1]) * u);
    data[i * 3 + 2] = Math.round(c0[2] + (c1[2] - c0[2]) * u);
  }
  return data;
}

export function lut(name: ColormapName): Uint8Array {
  let data = luts[name];
  if (!data) {
    data = buildLut(name);
    luts[name] = data;
  }
  return data;
}

/** Colormap as linear-light floats, for vertex/instance colours in Three.js. */
export function lutLinear(name: ColormapName): Float32Array {
  let data = linearLuts[name];
  if (!data) {
    const srgb = lut(name);
    data = new Float32Array(srgb.length);
    for (let i = 0; i < srgb.length; i++) {
      const c = srgb[i] / 255;
      data[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    linearLuts[name] = data;
  }
  return data;
}

export function sample(name: ColormapName, t: number): RGB {
  const u = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const i = Math.round(u * (LUT_SIZE - 1)) * 3;
  const data = lut(name);
  return [data[i], data[i + 1], data[i + 2]];
}

export function rgbCss([r, g, b]: RGB, alpha = 1): string {
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

export function cssGradient(name: ColormapName, steps = 12): string {
  const parts: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    parts.push(`${rgbCss(sample(name, t))} ${(t * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}
