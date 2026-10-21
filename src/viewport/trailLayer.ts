import * as THREE from 'three';
import type { ParticleFrame } from '../engine/particles/system';

interface TrailEntry {
  line: THREE.Line;
  points: THREE.Points;
  geometry: THREE.BufferGeometry;
  lineMaterial: THREE.LineBasicMaterial;
  pointMaterial: THREE.PointsMaterial;
  capacity: number;
}

const NEGATIVE = new THREE.Color(0x5cf0ff);
const POSITIVE = new THREE.Color(0xff9a5c);

let glowTexture: THREE.Texture | null = null;

function getGlowTexture(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  glowTexture = new THREE.CanvasTexture(canvas);
  return glowTexture;
}

/**
 * Fading world-line trails for test particles: a thin core line plus additive
 * glow points so the trail reads clearly at any zoom and on high-DPI screens.
 */
export class ParticleTrailLayer {
  readonly group = new THREE.Group();
  private entries = new Map<string, TrailEntry>();

  constructor() {
    this.group.renderOrder = 3;
  }

  setData(frame: ParticleFrame): void {
    const seen = new Set<string>();
    for (const p of frame.particles) {
      seen.add(p.id);
      const points = Math.floor(p.trail.length / 3);
      let entry = this.entries.get(p.id);
      if (!entry || entry.capacity < points) {
        if (entry) this.release(entry);
        entry = this.createEntry(Math.max(64, points));
        this.group.add(entry.line, entry.points);
        this.entries.set(p.id, entry);
      }
      const pos = entry.geometry.getAttribute('position') as THREE.BufferAttribute;
      const col = entry.geometry.getAttribute('color') as THREE.BufferAttribute;
      const base = p.charge < 0 ? NEGATIVE : POSITIVE;
      const positions = pos.array as Float32Array;
      const colors = col.array as Float32Array;
      const denom = Math.max(1, points - 1);
      for (let i = 0; i < points; i++) {
        const x = p.trail[i * 3];
        const y = p.trail[i * 3 + 1];
        const z = p.trail[i * 3 + 2];
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
        // Older samples fade toward the background; additive blending makes
        // the newest points glow like a comet head.
        const age = i / denom;
        const fade = 0.42 + 0.58 * age;
        colors[i * 3] = base.r * fade;
        colors[i * 3 + 1] = base.g * fade;
        colors[i * 3 + 2] = base.b * fade;
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
      entry.geometry.setDrawRange(0, points);
      entry.line.visible = points > 1;
      entry.points.visible = points > 0;
    }
    for (const [id, entry] of this.entries) {
      if (seen.has(id)) continue;
      this.release(entry);
      this.entries.delete(id);
    }
  }

  private createEntry(capacity: number): TrailEntry {
    const capped = Math.min(6000, Math.max(64, capacity));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capped * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(capped * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
    const lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      color: 0xffffff,
    });
    const pointMaterial = new THREE.PointsMaterial({
      size: 0.0095,
      map: getGlowTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      alphaTest: 0.01,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      toneMapped: false,
      color: 0xffffff,
    });
    const line = new THREE.Line(geometry, lineMaterial);
    line.frustumCulled = false;
    line.renderOrder = 3;
    const points = new THREE.Points(geometry, pointMaterial);
    points.frustumCulled = false;
    points.renderOrder = 4;
    return { line, points, geometry, lineMaterial, pointMaterial, capacity: capped };
  }

  private release(entry: TrailEntry): void {
    this.group.remove(entry.line, entry.points);
    entry.geometry.dispose();
    entry.lineMaterial.dispose();
    entry.pointMaterial.dispose();
  }

  clear(): void {
    for (const entry of this.entries.values()) this.release(entry);
    this.entries.clear();
  }

  dispose(): void {
    this.clear();
  }
}
