import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DisplaySettings } from '../scene/types';
import { lut, lutLinear } from '../engine/colormap';
import type { FieldLineData } from '../engine/staticsEngine';

export type SliceAxis = 'x' | 'y' | 'z';

function axisBasis(axis: SliceAxis): THREE.Matrix4 {
  if (axis === 'z') {
    return new THREE.Matrix4().makeBasis(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
    );
  }
  if (axis === 'y') {
    return new THREE.Matrix4().makeBasis(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, -1, 0),
    );
  }
  return new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(1, 0, 0),
  );
}

export class SliceLayer {
  readonly mesh: THREE.Mesh;
  private axis: SliceAxis;
  private resolution = 0;
  private texture: THREE.DataTexture | null = null;
  private data: Float32Array | null = null;
  private min = 0;
  private max = 1;
  private signed = false;
  private opacity = 0.85;

  constructor(axis: SliceAxis) {
    this.axis = axis;
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  setDomain(center: [number, number, number], size: [number, number, number]): void {
    const [w, h] = this.axis === 'x'
      ? [size[1], size[2]]
      : this.axis === 'y'
        ? [size[0], size[2]]
        : [size[0], size[1]];
    const geometry = new THREE.PlaneGeometry(w, h);
    this.mesh.geometry.dispose();
    this.mesh.geometry = geometry;
    this.mesh.quaternion.setFromRotationMatrix(axisBasis(this.axis));
    this.mesh.userData.center = center;
    this.mesh.userData.size = size;
  }

  setPosition(position: number, center: [number, number, number], size: [number, number, number]): void {
    const idx = this.axis === 'x' ? 0 : this.axis === 'y' ? 1 : 2;
    this.mesh.position.set(center[0], center[1], center[2]);
    this.mesh.position.setComponent(idx, center[idx] + (position * size[idx]) / 2);
  }

  setData(
    data: Float32Array,
    min: number,
    max: number,
    resolution: number,
    display: DisplaySettings,
  ): void {
    this.data = data;
    this.min = min;
    this.max = max;
    this.signed = min < 0 && max > 0;
    this.opacity = display.sliceOpacity;
    this.resolution = resolution;
    this.recolor(display);
  }

  private recolor(display: DisplaySettings): void {
    if (!this.data || this.resolution <= 0) return;
    const n = this.resolution;
    const rgba = new Uint8Array(n * n * 4);
    const colors = lut(display.colormap);
    const min = this.min;
    const max = this.max;
    const span = Math.max(max - min, 1e-30);
    const positive = !this.signed;
    const logMax = Math.log10(1 + Math.max(max, 0) / Math.max(span * 0.01, 1e-30));
    for (let i = 0; i < n * n; i++) {
      let v = this.data[i];
      if (!Number.isFinite(v)) v = 0;
      let t: number;
      if (positive && display.logScale) {
        t = Math.log10(1 + Math.max(v, 0) / Math.max(span * 0.01, 1e-30)) / Math.max(logMax, 1e-30);
      } else {
        t = (v - min) / span;
      }
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ci = Math.round(t * 255) * 3;
      rgba[i * 4] = colors[ci];
      rgba[i * 4 + 1] = colors[ci + 1];
      rgba[i * 4 + 2] = colors[ci + 2];
      rgba[i * 4 + 3] = 255;
    }
    if (!this.texture || this.texture.image.width !== n) {
      this.texture?.dispose();
      this.texture = new THREE.DataTexture(rgba, n, n, THREE.RGBAFormat);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.texture.magFilter = THREE.LinearFilter;
      this.texture.minFilter = THREE.LinearFilter;
      (this.mesh.material as THREE.MeshBasicMaterial).map = this.texture;
    } else {
      this.texture.image.data = rgba;
    }
    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = this.opacity;
    (this.mesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
    this.mesh.visible = true;
  }

  hasData(): boolean {
    return this.data !== null;
  }

  setDisplay(display: DisplaySettings): void {
    this.opacity = display.sliceOpacity;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = this.opacity;
    this.recolor(display);
  }

  clear(): void {
    this.data = null;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture?.dispose();
  }
}

export class LinesLayer {
  readonly group = new THREE.Group();
  private line: THREE.LineSegments | null = null;

  setLines(
    lines: FieldLineData[],
    field: 'E' | 'B',
    display: DisplaySettings,
  ): void {
    this.clear();
    const positions: number[] = [];
    const colors: number[] = [];
    const mags: number[] = [];
    for (const line of lines) {
      for (let i = 0; i < line.magnitudes.length; i += 2) {
        mags.push(line.magnitudes[i]);
      }
    }
    if (mags.length === 0) return;
    mags.sort((a, b) => a - b);
    const ref = mags[Math.floor(mags.length * 0.92)] || mags[mags.length - 1] || 1;
    const colorsLut = lutLinear(display.colormap);
    for (const line of lines) {
      const n = line.magnitudes.length;
      for (let i = 0; i < n - 1; i++) {
        const a = i * 3;
        const b = (i + 1) * 3;
        positions.push(line.points[a], line.points[a + 1], line.points[a + 2]);
        positions.push(line.points[b], line.points[b + 1], line.points[b + 2]);
        const t1 = Math.min(1, Math.sqrt(line.magnitudes[i] / ref));
        const t2 = Math.min(1, Math.sqrt(line.magnitudes[i + 1] / ref));
        const c1 = Math.round(t1 * 255) * 3;
        const c2 = Math.round(t2 * 255) * 3;
        colors.push(
          colorsLut[c1], colorsLut[c1 + 1], colorsLut[c1 + 2],
          colorsLut[c2], colorsLut[c2 + 1], colorsLut[c2 + 2],
        );
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: field === 'E' ? 0.9 : 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.line = new THREE.LineSegments(geometry, material);
    this.group.add(this.line);
  }

  clear(): void {
    if (!this.line) return;
    this.group.remove(this.line);
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
    this.line = null;
  }

  dispose(): void {
    this.clear();
  }
}

export class ArrowLayer {
  readonly mesh: THREE.InstancedMesh;
  private readonly geometry: THREE.BufferGeometry;
  private currentCount = 0;
  private readonly maxCount = 20 * 20 * 20;

  constructor() {
    // Unit-length arrow (y from 0 to 1). Instances scale it uniformly so the
    // shaft/head proportions stay constant at every field magnitude.
    const shaft = new THREE.CylinderGeometry(0.085, 0.085, 0.7, 6, 1, true);
    shaft.translate(0, 0.35, 0);
    const head = new THREE.ConeGeometry(0.2, 0.3, 8);
    head.translate(0, 0.85, 0);
    const merged = mergeGeometries([shaft, head]);
    this.geometry = merged ?? new THREE.ConeGeometry(0.06, 1, 8);
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, material, this.maxCount);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  setData(
    positions: Float32Array,
    vectors: Float32Array,
    magnitudes: Float32Array,
    field: 'E' | 'B' | 'P',
    display: DisplaySettings,
  ): void {
    const count = Math.min(this.maxCount, magnitudes.length);
    if (count === 0) {
      this.mesh.count = 0;
      return;
    }
    if (!this.mesh.instanceColor) {
      const colors = new Float32Array(this.maxCount * 3);
      for (let i = 0; i < this.maxCount; i++) {
        colors[i * 3] = 1; colors[i * 3 + 1] = 1; colors[i * 3 + 2] = 1;
      }
      this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    }
    const sorted = Array.from(magnitudes).sort((a, b) => a - b);
    const ref = sorted[Math.floor(sorted.length * 0.92)] || sorted[sorted.length - 1] || 1;
    const colorsLut = lutLinear(display.colormap);
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      pos.set(positions[o], positions[o + 1], positions[o + 2]);
      dir.set(vectors[o], vectors[o + 1], vectors[o + 2]);
      const mag = magnitudes[i];
      if (!Number.isFinite(mag) || mag <= 1e-30 || dir.lengthSq() < 1e-30) {
        scale.setScalar(0);
        quat.identity();
      } else {
        dir.normalize();
        quat.setFromUnitVectors(up, dir);
        const raw = Math.sqrt(mag / ref);
        const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
        const len = (0.016 + 0.058 * t) * display.vectorScale;
        scale.setScalar(len);
      }
      matrix.compose(pos, quat, scale);
      this.mesh.setMatrixAt(i, matrix);
      const t = Math.min(1, Math.sqrt(Math.max(mag, 0) / ref));
      const ci = Math.round(t * 255) * 3;
      color.setRGB(colorsLut[ci], colorsLut[ci + 1], colorsLut[ci + 2]);
      this.mesh.setColorAt(i, color);
    }
    this.currentCount = count;
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    void field;
  }

  setDisplay(display: DisplaySettings): void {
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = 0.86;
    void display;
  }

  clear(): void {
    this.mesh.count = 0;
    this.currentCount = 0;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
