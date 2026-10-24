export type YeePrecision = 'float32' | 'float64';
export type YeeArray<P extends YeePrecision = 'float64'> = P extends 'float32' ? Float32Array : Float64Array;

/** Convolutional stretched-coordinate PML. Each curl derivative owns its history.
 * Profiles and coefficient evaluation remain Float64 in the CPU storage modes.
 */
export class Cpml<P extends YeePrecision = 'float64'> {
  readonly memories: YeeArray<P>[];
  readonly reference: YeeArray<P>[];
  private readonly coefficients: { a: Float64Array; b: Float64Array; k: Float64Array }[][];

  constructor(private readonly shape: number[], spacing: number[], boundaries: string[], cells: number, dt: number, speed: number, precision: P = 'float64' as P) {
    if (precision !== 'float32' && precision !== 'float64') throw new Error('Invalid Yee precision');
    const size = shape[0] * shape[1] * shape[2];
    const allocate = () => (precision === 'float32' ? new Float32Array(size) : new Float64Array(size)) as YeeArray<P>;
    this.memories = Array.from({ length: 12 }, allocate);
    this.reference = Array.from({ length: 12 }, allocate);
    this.coefficients = shape.map((n, axis) => [0, 0.5].map(offset => {
      const a = new Float64Array(n), b = new Float64Array(n), k = new Float64Array(n).fill(1);
      if (boundaries[axis] !== 'pml') return { a, b, k };
      for (let j = 0; j < n; j++) {
        const u = Math.max(0, (cells - (j + offset)) / cells, (j + offset - (n - cells)) / cells);
        if (u <= 0) continue;
        // sigma/epsilon has units 1/s. Matched electric/magnetic stretching.
        const rate = -4 * speed * Math.log(1e-8) / (2 * cells * spacing[axis]) * u ** 3;
        const alpha = 0.05 * speed / spacing[axis] * (1 - Math.min(1, u));
        k[j] = 1 + 4 * u ** 3;
        b[j] = Math.exp(-(rate / k[j] + alpha) * dt);
        a[j] = rate * (b[j] - 1) / (k[j] * (rate + k[j] * alpha));
      }
      return { a, b, k };
    }));
  }

  derivative(slot: number, axis: number, coordinate: number, index: number, forward: boolean, derivative: number): number {
    const c = this.coefficients[axis][forward ? 1 : 0];
    const memory = this.memories[slot];
    const background = this.reference[slot][index], perturbation = derivative - background;
    memory[index] = c.b[coordinate] * memory[index] + c.a[coordinate] * perturbation;
    return background + perturbation / c.k[coordinate] + memory[index];
  }

  previewDerivative(slot: number, axis: number, coordinate: number, index: number, forward: boolean, derivative: number): number {
    const c = this.coefficients[axis][forward ? 1 : 0];
    const background = this.reference[slot][index], perturbation = derivative - background;
    return background + perturbation / c.k[coordinate] + c.b[coordinate] * this.memories[slot][index] + c.a[coordinate] * perturbation;
  }

  reset() { for (const memory of [...this.memories, ...this.reference]) memory.fill(0); }
}
