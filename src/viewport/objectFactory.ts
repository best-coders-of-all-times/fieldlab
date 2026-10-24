import * as THREE from 'three';
import type { SceneObject } from '../scene/types';
import { wirePath } from '../scene/wirePath';
import type { Vec3 } from '../engine/math/vec3';

export interface ObjectView {
  group: THREE.Group;
  signature: string;
  boundCurrent?: THREE.Group;
}

function labelSprite(text: string, color = '#e8f0ff', size = 0.11): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);
  ctx.font = 'bold 78px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(6,10,16,0.0)';
  ctx.fillRect(0, 0, 128, 128);
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(4,8,14,0.85)';
  ctx.strokeText(text, 64, 68);
  ctx.fillStyle = color;
  ctx.fillText(text, 64, 68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(size);
  return sprite;
}

function edgeLines(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation = 0x91a4bb, opacity = 0.45): THREE.LineSegments {
  const edges = new THREE.EdgesGeometry(geometry, 25);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  return new THREE.LineSegments(edges, material);
}

function chargeRadius(q: number): number {
  const n = Math.abs(q) / 1e-9;
  return THREE.MathUtils.clamp(0.032 + 0.012 * Math.log10(1 + n), 0.026, 0.085);
}

function shapeGeometry(kind: string, size: Vec3): THREE.BufferGeometry {
  if (kind === 'sphere') {
    const r = Math.max(size[0], 1e-4) / 2;
    return new THREE.SphereGeometry(r, 48, 28);
  }
  if (kind === 'cylinder') {
    const r = Math.max(size[0], 1e-4) / 2;
    const g = new THREE.CylinderGeometry(r, r, Math.max(size[2], 1e-4), 48, 1);
    g.rotateX(Math.PI / 2);
    return g;
  }
  return new THREE.BoxGeometry(Math.max(size[0], 1e-4), Math.max(size[1], 1e-4), Math.max(size[2], 1e-4));
}

function copperMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xd68c4c,
    metalness: 0.75,
    roughness: 0.32,
    emissive: 0x2a1204,
    emissiveIntensity: 0.6,
  });
}

function tubeFromPoints(points: THREE.Vector3[], radius: number, closed = false): THREE.BufferGeometry {
  if (points.length < 2) return new THREE.BufferGeometry();
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal', 0.2);
  return new THREE.TubeGeometry(curve, Math.max(24, points.length * 4), Math.max(radius, 0.002), 8, closed);
}

function addCurrentChevrons(group: THREE.Group, points: THREE.Vector3[], closed: boolean, current = 1): void {
  const count = Math.min(9, Math.max(2, Math.floor(points.length / 3)));
  const material = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85 });
  for (let i = 1; i <= count; i++) {
    const idx = Math.floor((i / (count + 1)) * (points.length - (closed ? 0 : 1)));
    const a = points[idx];
    const b = points[Math.min(points.length - 1, idx + 1)];
    const dir = b.clone().sub(a).multiplyScalar(Math.sign(current));
    if (dir.lengthSq() < 1e-12) continue;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.03, 10), material);
    cone.position.copy(a.clone().add(b).multiplyScalar(0.5));
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    group.add(cone);
  }
}

export function createObjectView(obj: SceneObject): ObjectView {
  const group = new THREE.Group();
  group.userData.id = obj.id;
  group.name = obj.name;
  const signature = objectSignature(obj);
  let boundCurrent: THREE.Group | undefined;

  switch (obj.kind) {
    case 'charge': {
      const r = chargeRadius(obj.charge);
      const color = obj.charge >= 0 ? 0xff5a72 : 0x5f8bff;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(r, 32, 20),
        new THREE.MeshStandardMaterial({
          color, emissive: color, emissiveIntensity: 0.55, metalness: 0.1, roughness: 0.35,
        }),
      );
      group.add(mesh);
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(r * 1.8, 24, 14),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, depthWrite: false }),
      );
      group.add(halo);
      const glyph = labelSprite(obj.charge >= 0 ? '+' : '−', color === 0xff5a72 ? '#ffd5dc' : '#d5e2ff', r * 4.2);
      glyph.position.y = r + 0.055;
      group.add(glyph);
      break;
    }
    case 'chargedSphere': {
      const geometry = new THREE.SphereGeometry(obj.radius, 48, 28);
      const color = obj.charge >= 0 ? 0xff7a8c : 0x7a9cff;
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color, emissive: color, emissiveIntensity: 0.18, transparent: true, opacity: 0.18,
          roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide,
        }),
      );
      group.add(mesh);
      group.add(edgeLines(geometry, color, 0.45));
      const glyph = labelSprite(obj.charge >= 0 ? '+' : '−', '#ffe4e8', Math.max(0.11, obj.radius * 0.6));
      glyph.position.y = obj.radius + 0.08;
      group.add(glyph);
      break;
    }
    case 'conductor': {
      const geometry = shapeGeometry(obj.shape, obj.size);
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: 0xbfccdc, metalness: 0.9, roughness: 0.26, emissive: 0x101923, emissiveIntensity: 0.35,
        }),
      );
      mesh.userData.id = obj.id;
      group.add(mesh);
      group.add(edgeLines(geometry, 0xd9e7f8, 0.3));
      break;
    }
    case 'dielectric': {
      const geometry = shapeGeometry(obj.shape, obj.size);
      const hue = THREE.MathUtils.clamp(0.52 + Math.log2(Math.max(1, obj.epsilonR)) * 0.055, 0.5, 0.78);
      const color = new THREE.Color().setHSL(hue, 0.7, 0.56);
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshPhysicalMaterial({
          color, transparent: true, opacity: 0.22, roughness: 0.18, metalness: 0.05,
          transmission: 0.0, thickness: 0.3, side: THREE.DoubleSide, depthWrite: false,
        }),
      );
      mesh.userData.id = obj.id;
      group.add(mesh);
      group.add(edgeLines(geometry, color, 0.5));
      const glyph = labelSprite(`εᵣ ${trim(obj.epsilonR)}`, '#bfe8ff', 0.13);
      glyph.position.y = obj.size[1] * 0.5 + 0.08;
      group.add(glyph);
      break;
    }
    case 'wire': {
      const pts = wirePath(obj).map((p) => new THREE.Vector3(p[0], p[1], p[2]));
      const curve = new THREE.CurvePath<THREE.Vector3>();
      for (let i = 1; i < pts.length; i++) curve.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
      if (obj.closed && pts.length > 1) curve.add(new THREE.LineCurve3(pts[pts.length - 1], pts[0]));
      const geometry = pts.length > 1 ? new THREE.TubeGeometry(curve, Math.max(64, pts.length * 4), Math.max(obj.wireRadius, 0.001), 8, obj.closed) : new THREE.BufferGeometry();
      const mesh = new THREE.Mesh(geometry, copperMaterial());
      mesh.userData.id = obj.id;
      group.add(mesh);
      if (obj.current !== 0) addCurrentChevrons(group, pts, obj.closed, obj.current);
      break;
    }
    case 'loop': {
      const geometry = new THREE.TorusGeometry(obj.radius, Math.max(obj.wireRadius, 0.003), 12, 80);
      const mesh = new THREE.Mesh(geometry, copperMaterial());
      mesh.userData.id = obj.id;
      group.add(mesh);
      if (obj.current !== 0) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 32; i++) {
          const a = (i / 32) * Math.PI * 2;
          pts.push(new THREE.Vector3(obj.radius * Math.cos(a), obj.radius * Math.sin(a), 0));
        }
        addCurrentChevrons(group, pts, true, obj.current);
      }
      break;
    }
    case 'coil': {
      const pts: THREE.Vector3[] = [];
      const turns = Math.max(1, Math.round(obj.turns));
      const n = turns * 48;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2 * turns;
        const z = -obj.length / 2 + (i / n) * obj.length;
        pts.push(new THREE.Vector3(obj.radius * Math.cos(a), obj.radius * Math.sin(a), z));
      }
      const geometry = tubeFromPoints(pts, obj.wireRadius, false);
      const mesh = new THREE.Mesh(geometry, copperMaterial());
      mesh.userData.id = obj.id;
      group.add(mesh);
      break;
    }
    case 'magnet': {
      const half = obj.length / 2;
      const north = new THREE.Mesh(
        new THREE.CylinderGeometry(obj.radius, obj.radius, half, 40, 1),
        new THREE.MeshStandardMaterial({ color: obj.magnetization >= 0 ? 0xe0485c : 0x3d6dff, metalness: 0.55, roughness: 0.35, emissive: 0x3a0910, emissiveIntensity: 0.6 }),
      );
      north.rotation.x = Math.PI / 2;
      north.position.z = half / 2;
      const south = new THREE.Mesh(
        new THREE.CylinderGeometry(obj.radius, obj.radius, half, 40, 1),
        new THREE.MeshStandardMaterial({ color: obj.magnetization >= 0 ? 0x3d6dff : 0xe0485c, metalness: 0.55, roughness: 0.35, emissive: 0x081538, emissiveIntensity: 0.6 }),
      );
      south.rotation.x = Math.PI / 2;
      south.position.z = -half / 2;
      north.userData.id = obj.id;
      south.userData.id = obj.id;
      group.add(north, south);
      const nLabel = labelSprite(obj.magnetization >= 0 ? 'N' : 'S', '#ffd7dc', 0.1);
      nLabel.position.set(0, 0, half + 0.07);
      const sLabel = labelSprite(obj.magnetization >= 0 ? 'S' : 'N', '#d2e0ff', 0.1);
      sLabel.position.set(0, 0, -half - 0.07);
      group.add(nLabel, sLabel);
      boundCurrent = new THREE.Group();
      const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffd26f, toneMapped: false, depthWrite: false });
      const radius = obj.radius + Math.max(0.004, obj.radius * 0.08);
      if (obj.magnetization !== 0) for (let layer = 0; layer < 6; layer++) {
        const z = -half + (layer + 0.5) * obj.length / 6;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, Math.min(0.002, obj.radius * 0.035), 5, 48), arrowMat);
        ring.position.z = z;
        boundCurrent.add(ring);
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2 + (layer % 2) * Math.PI / 4;
          const direction = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0).multiplyScalar(Math.sign(obj.magnetization));
          const cone = new THREE.Mesh(new THREE.ConeGeometry(Math.min(0.006, obj.radius * 0.12), Math.min(0.022, obj.radius * 0.4), 10), arrowMat);
          cone.position.set(radius * Math.cos(a), radius * Math.sin(a), z);
          cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
          boundCurrent.add(cone);
        }
      }
      const mArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, Math.sign(obj.magnetization) || 1),
        new THREE.Vector3(radius * 1.6, 0, -half * Math.sign(obj.magnetization)), obj.length, 0x7fffd4, 0.025, 0.014);
      if (obj.magnetization !== 0) boundCurrent.add(mArrow);
      boundCurrent.position.z = 0;
      boundCurrent.visible = false;
      group.add(boundCurrent);
      break;
    }
    case 'particle': {
      const color = obj.charge >= 0 ? 0xff9a5c : 0x5cf0ff;
      // Unlit core keeps the cyan/orange identity instead of ACES washing it
      // out to white; the additive halo gives it a glow.
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.011, 20, 14),
        new THREE.MeshBasicMaterial({ color, toneMapped: false }),
      );
      group.add(mesh);
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.026, 16, 12),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      group.add(halo);
      break;
    }
    case 'probe': {
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.026, 0),
        new THREE.MeshStandardMaterial({ color: 0xffc66d, emissive: 0xffa729, emissiveIntensity: 0.8, roughness: 0.3 }),
      );
      mesh.userData.id = obj.id;
      group.add(mesh);
      const glyph = labelSprite('P', '#ffe9bd', 0.1);
      glyph.position.y = 0.07;
      group.add(glyph);
      break;
    }
    case 'planeWave': {
      const arrow = new THREE.ArrowHelper(
        new THREE.Vector3(1, 0, 0), new THREE.Vector3(-0.44, 0, 0), 0.16, 0xffb15c, 0.05, 0.03,
      );
      group.add(arrow);
      const glyph = labelSprite('wave', '#ffd9a8', 0.13);
      glyph.position.set(-0.42, 0.1, 0);
      group.add(glyph);
      break;
    }
    case 'pointSource': {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.024, 20, 14),
        new THREE.MeshStandardMaterial({ color: 0xffb15c, emissive: 0xff8e1f, emissiveIntensity: 1.2 }),
      );
      group.add(mesh);
      break;
    }
    case 'antenna': {
      const geometry = new THREE.CylinderGeometry(0.008, 0.008, obj.length, 12, 1);
      geometry.rotateZ(0);
      const mesh = new THREE.Mesh(geometry, copperMaterial());
      mesh.userData.id = obj.id;
      group.add(mesh);
      const glyph = labelSprite('tx', '#ffd9a8', 0.11);
      glyph.position.y = obj.length * 0.55;
      group.add(glyph);
      break;
    }
    default:
      break;
  }

  group.position.set(obj.position[0], obj.position[1], obj.position[2]);
  group.rotation.set(obj.rotation[0], obj.rotation[1], obj.rotation[2]);
  return { group, signature, boundCurrent };
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function objectSignature(obj: SceneObject): string {
  switch (obj.kind) {
    case 'charge': return `charge:${obj.charge.toPrecision(6)}`;
    case 'chargedSphere': return `sphere:${obj.charge.toPrecision(5)}:${obj.radius}:${obj.shell}`;
    case 'conductor': return `cond:${obj.shape}:${obj.size.join(',')}`;
    case 'dielectric': return `diel:${obj.shape}:${obj.size.join(',')}:${obj.epsilonR}`;
    case 'wire': return `wire:${JSON.stringify(obj.points)}:${obj.current}:${obj.wireRadius}:${obj.closed}:${obj.path ?? 'polyline'}`;
    case 'loop': return `loop:${obj.radius}:${obj.current}:${obj.wireRadius}`;
    case 'coil': return `coil:${obj.radius}:${obj.length}:${obj.turns}:${obj.wireRadius}:${obj.current}`;
    case 'magnet': return `magnet:${obj.radius}:${obj.length}:${obj.magnetization}`;
    case 'particle': return `particle:${obj.species}:${obj.charge}`;
    case 'probe': return `probe:${obj.quantity}`;
    case 'planeWave': return `wave:${obj.frequency}:${obj.polarization}`;
    case 'pointSource': return `source:${obj.component}:${obj.frequency}`;
    case 'antenna': return `antenna:${obj.length}:${obj.frequency}`;
    default: return '';
  }
}

export function disposeObjectView(view: ObjectView): void {
  view.group.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Sprite) {
      const anyChild = child as THREE.Mesh;
      anyChild.geometry?.dispose?.();
      const material = anyChild.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else (material as THREE.Material | undefined)?.dispose?.();
      if (child instanceof THREE.Sprite) {
        const map = (child.material as THREE.SpriteMaterial).map;
        map?.dispose();
      }
    }
  });
}
