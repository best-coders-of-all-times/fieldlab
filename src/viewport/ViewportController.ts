import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { Scene, SceneObject, SliceQuantity, ProbeReading } from '../scene/types';
import { formatPrefixed } from '../engine/units';
import { isParticle } from '../scene/types';
import { fieldBus } from '../app/fieldBus';
import type { FdtdFrame } from '../workers/protocol';
import type { ParticleFrame } from '../engine/particles/system';
import type { InductionFrame } from '../engine/induction/system';
import { ParticleTrailLayer } from './trailLayer';
import type { SliceData } from '../engine/staticsEngine';
import { createObjectView, disposeObjectView, objectSignature, type ObjectView } from './objectFactory';
import { ArrowLayer, LinesLayer, SliceLayer, type SliceAxis } from './fieldLayers';
import type { FieldLineData } from '../engine/staticsEngine';

export interface ViewportCallbacks {
  onSelect: (id: string | null) => void;
  onTransform: (id: string, position: [number, number, number], rotation: [number, number, number]) => void;
  onFps: (fps: number) => void;
  onSliceRange?: (range: { quantity: SliceQuantity; min: number; max: number } | null) => void;
}

export class ViewportController {
  private container: HTMLElement;
  private callbacks: ViewportCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private transform: TransformControls;
  private transformHelper: THREE.Object3D;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerDown = new THREE.Vector2();
  private objectGroup = new THREE.Group();
  private fieldGroup = new THREE.Group();
  private helperGroup = new THREE.Group();
  private selectionBox: THREE.BoxHelper;
  private views = new Map<string, ObjectView>();
  private slices: Record<SliceAxis, SliceLayer>;
  private linesLayer = new LinesLayer();
  private arrows = new ArrowLayer();
  private particleTrails = new ParticleTrailLayer();
  private lastParticlePositions = new Map<string, [number, number, number]>();
  private lastMotion = new Map<string, { position: [number, number, number]; rotation: [number, number, number] }>();
  private domainBox: THREE.Box3Helper | null = null;
  private grid: THREE.GridHelper | null = null;
  private axes: THREE.AxesHelper | null = null;
  private sceneData: Scene | null = null;
  private selectedId: string | null = null;
  private animation = 0;
  private disposed = false;
  private frameCount = 0;
  private fpsAt = performance.now();
  private lastLegend: { quantity: SliceQuantity; min: number; max: number } | null = null;
  private unsubscribers: Array<() => void> = [];
  private resizeObserver: ResizeObserver;
  private domainKey = '';
  private probeLabels = new Map<string, { element: HTMLButtonElement; reading: ProbeReading }>();

  constructor(container: HTMLElement, callbacks: ViewportCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.setClearColor(0x05070b, 1);
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x05070b);
    this.scene.add(this.objectGroup, this.fieldGroup, this.helperGroup);

    this.camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.005, 100);
    this.camera.position.set(1.55, 1.15, 1.55);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.minDistance = 0.15;
    this.controls.maxDistance = 12;
    this.controls.target.set(0, 0, 0);

    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setSize(0.8);
    this.transformHelper = (this.transform as unknown as { getHelper?: () => THREE.Object3D }).getHelper
      ? (this.transform as unknown as { getHelper: () => THREE.Object3D }).getHelper()
      : (this.transform as unknown as THREE.Object3D);
    this.scene.add(this.transformHelper);
    this.transform.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !(event as unknown as { value: boolean }).value;
    });
    this.transform.addEventListener('objectChange', () => {
      const obj = this.sceneData?.objects.find((o) => o.id === this.selectedId);
      if (!obj) return;
      const group = this.views.get(obj.id)?.group;
      if (!group) return;
      this.callbacks.onTransform(
        obj.id,
        [group.position.x, group.position.y, group.position.z],
        [group.rotation.x, group.rotation.y, group.rotation.z],
      );
      if (this.selectionBox.visible) this.selectionBox.setFromObject(group);
    });

    this.selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0xffd166);
    this.selectionBox.visible = false;
    this.scene.add(this.selectionBox);

    this.slices = {
      x: new SliceLayer('x'),
      y: new SliceLayer('y'),
      z: new SliceLayer('z'),
    };
    for (const layer of Object.values(this.slices)) this.fieldGroup.add(layer.mesh);
    this.fieldGroup.add(this.linesLayer.group);
    this.fieldGroup.add(this.arrows.mesh);
    this.fieldGroup.add(this.particleTrails.group);

    this.setupLights();

    this.unsubscribers.push(
      fieldBus.on('probes', (readings) => this.setProbeLabels(readings)),
      fieldBus.on('statics-slice', (slice) => this.applySlice(slice)),
      fieldBus.on('statics-lines', (payload) => this.applyLines(payload.lines, payload.field)),
      fieldBus.on('statics-lattice', (payload) => {
        this.arrows.setData(payload.positions, payload.vectors, payload.magnitudes, payload.field, this.sceneData!.display);
      }),
      fieldBus.on('fdtd-frame', (frame) => this.applyFdtd(frame)),
      fieldBus.on('particles-frame', (frame) => this.applyParticles(frame)),
      fieldBus.on('induction-frame', (frame) => this.applyInduction(frame)),
      fieldBus.on('statics-clear', () => this.clearFields()),
      fieldBus.on('fdtd-clear', () => this.clearFields()),
      fieldBus.on('particles-clear', () => this.clearParticles()),
      fieldBus.on('induction-clear', () => this.clearInduction()),
    );

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.animate();
  }

  private setupLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xb8d4ff, 0x080a10, 1.05));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2.4, 3.2, 2.6);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x7fb2ff, 0.7);
    fill.position.set(-2.4, 1.2, -1.8);
    this.scene.add(fill);
    const rim = new THREE.PointLight(0xff5bc8, 0.65, 6);
    rim.position.set(1.6, -1.4, 1.8);
    this.scene.add(rim);
  }

  setScene(scene: Scene): void {
    const previous = this.sceneData;
    this.sceneData = scene;
    const key = `${scene.domain.center.join(',')}:${scene.domain.size.join(',')}`;
    if (key !== this.domainKey) {
      this.domainKey = key;
      this.rebuildEnvironment(scene);
    }
    if (!previous || previous.id !== scene.id) this.applyCamera(scene);
    this.syncObjects(scene);
    this.updateDisplay(scene);
    this.updateSelection();
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
    this.updateSelection();
  }

  setTransformMode(mode: 'translate' | 'rotate' | 'scale'): void {
    this.transform.setMode(mode);
  }

  requestCamera(mode: 'iso' | 'front' | 'top' | 'side'): void {
    if (!this.sceneData) return;
    const c = this.sceneData.domain.center;
    const s = this.sceneData.domain.size;
    const radius = Math.hypot(s[0], s[1], s[2]) * 0.5;
    const distance = radius / Math.sin((this.camera.fov * Math.PI) / 360) * 0.95;
    const target = new THREE.Vector3(c[0], c[1], c[2]);
    let pos: THREE.Vector3;
    if (mode === 'front') pos = target.clone().add(new THREE.Vector3(0, 0, distance));
    else if (mode === 'top') pos = target.clone().add(new THREE.Vector3(0, distance, 0.0001));
    else if (mode === 'side') pos = target.clone().add(new THREE.Vector3(distance, 0, 0));
    else pos = target.clone().add(new THREE.Vector3(distance * 0.62, distance * 0.48, distance * 0.62));
    this.camera.position.copy(pos);
    this.controls.target.copy(target);
    this.controls.update();
  }

  private applyCamera(scene: Scene): void {
    if (!scene.camera) { this.requestCamera('iso'); return; }
    this.camera.position.set(...scene.camera.position);
    this.controls.target.set(...scene.camera.target);
    this.controls.update();
  }

  private rebuildEnvironment(scene: Scene): void {
    if (this.domainBox) { this.helperGroup.remove(this.domainBox); this.domainBox.geometry.dispose(); }
    if (this.grid) {
      this.helperGroup.remove(this.grid);
      this.grid.geometry.dispose();
      (this.grid.material as THREE.Material).dispose();
    }
    if (this.axes) {
      this.helperGroup.remove(this.axes);
      this.axes.geometry.dispose();
      (this.axes.material as THREE.Material).dispose();
    }
    const [cx, cy, cz] = scene.domain.center;
    const [sx, sy, sz] = scene.domain.size;
    const min = new THREE.Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2);
    const max = new THREE.Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2);
    this.domainBox = new THREE.Box3Helper(new THREE.Box3(min, max), 0x233044);
    (this.domainBox.material as THREE.Material).transparent = true;
    (this.domainBox.material as THREE.Material).opacity = 0.55;
    this.helperGroup.add(this.domainBox);

    const gridSize = Math.max(sx, sz) * 1.55;
    this.grid = new THREE.GridHelper(gridSize, 20, 0x1d2a3d, 0x111923);
    this.grid.position.set(cx, min.y, cz);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.65;
    this.helperGroup.add(this.grid);

    this.axes = new THREE.AxesHelper(Math.max(sx, sy, sz) * 0.55);
    this.axes.position.set(min.x, min.y, min.z);
    this.helperGroup.add(this.axes);

    for (const layer of Object.values(this.slices)) layer.setDomain(scene.domain.center, scene.domain.size);
    this.requestCamera('iso');
  }

  private syncObjects(scene: Scene): void {
    const seen = new Set<string>();
    for (const obj of scene.objects) {
      seen.add(obj.id);
      let view = this.views.get(obj.id);
      const expected = objectSignature(obj);
      if (view && view.signature !== expected) {
        this.objectGroup.remove(view.group);
        disposeObjectView(view);
        view = undefined;
      }
      if (!view) {
        view = createObjectView(obj);
        view.group.position.set(...obj.position);
        view.group.rotation.set(...obj.rotation);
        this.objectGroup.add(view.group);
        this.views.set(obj.id, view);
      }
      view.group.position.set(...obj.position);
      view.group.rotation.set(...obj.rotation);
      if (isParticle(obj)) {
        const live = this.lastParticlePositions.get(obj.id);
        if (live) view.group.position.set(...live);
      }
      const motion = this.lastMotion.get(obj.id);
      if (motion) {
        view.group.position.set(...motion.position);
        view.group.rotation.set(...motion.rotation);
      }
      view.group.visible = obj.visible;
      view.group.name = obj.name;
      if (view.boundCurrent) view.boundCurrent.visible = !!scene.display.showBoundCurrent;
      if (obj.kind === 'conductor') view.group.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        const mat = child.material as THREE.MeshStandardMaterial;
        const opacity = scene.display.conductorOpacity ?? 1;
        mat.transparent = opacity < 1;
        mat.opacity = opacity;
        mat.depthWrite = opacity >= 1;
        mat.needsUpdate = true;
      });
    }
    for (const [id, view] of this.views) {
      if (!seen.has(id)) {
        this.objectGroup.remove(view.group);
        disposeObjectView(view);
        this.views.delete(id);
      }
    }
  }

  private updateDisplay(scene: Scene): void {
    const d = scene.display;
    this.helperGroup.visible = d.showGrid || d.showAxes || d.showDomain;
    if (this.grid) this.grid.visible = d.showGrid;
    if (this.axes) this.axes.visible = d.showAxes;
    if (this.domainBox) this.domainBox.visible = d.showDomain;

    const positions = d.slicePositions;
    for (const axis of ['x', 'y', 'z'] as SliceAxis[]) {
      const layer = this.slices[axis];
      const enabled = axis === 'x' ? d.slices.yz : axis === 'y' ? d.slices.xz : d.slices.xy;
      if (!enabled) {
        layer.mesh.visible = false;
        continue;
      }
      layer.setPosition(
        axis === 'x' ? positions.x : axis === 'y' ? positions.y : positions.z,
        scene.domain.center,
        scene.domain.size,
      );
      if (!layer.hasData()) layer.mesh.visible = false;
      layer.setDisplay(d);
    }
    this.linesLayer.group.visible = d.fieldLines !== 'none';
    this.arrows.mesh.visible = d.arrows !== 'none';
    for (const view of this.views.values()) {
      if (view.boundCurrent) view.boundCurrent.visible = d.showBoundCurrent;
    }
  }

  private updateSelection(): void {
    if (!this.selectedId) {
      this.selectionBox.visible = false;
      this.transform.detach();
      return;
    }
    const view = this.views.get(this.selectedId);
    if (!view) {
      this.selectionBox.visible = false;
      this.transform.detach();
      return;
    }
    if (this.transform.object !== view.group) this.transform.attach(view.group);
    this.selectionBox.setFromObject(view.group);
    this.selectionBox.visible = true;
  }

  private applySlice(slice: SliceData): void {
    const layer = this.slices[slice.axis];
    layer.setData(slice.data, slice.min, slice.max, slice.resolution, this.sceneData!.display);
    if (this.sceneData) {
      const p = slice.axis === 'x'
        ? this.sceneData.display.slicePositions.x
        : slice.axis === 'y'
          ? this.sceneData.display.slicePositions.y
          : this.sceneData.display.slicePositions.z;
      layer.setPosition(p, this.sceneData.domain.center, this.sceneData.domain.size);
    }
    if (this.sceneData) this.updateDisplay(this.sceneData);
    this.emitLegend(slice.quantity, slice.min, slice.max);
  }

  private applyLines(lines: FieldLineData[], field: 'E' | 'B'): void {
    this.linesLayer.setLines(lines, field, this.sceneData!.display);
  }

  private applyFdtd(frame: FdtdFrame): void {
    for (const slice of frame.slices) {
      const layer = this.slices[slice.axis];
      layer.setData(slice.data, slice.min, slice.max, slice.resolution, this.sceneData!.display);
      const p = slice.axis === 'x'
        ? this.sceneData!.display.slicePositions.x
        : slice.axis === 'y'
          ? this.sceneData!.display.slicePositions.y
          : this.sceneData!.display.slicePositions.z;
      layer.setPosition(p, this.sceneData!.domain.center, this.sceneData!.domain.size);
      if (this.sceneData) this.updateDisplay(this.sceneData);
    this.emitLegend(slice.quantity, slice.min, slice.max);
    }
    if (this.sceneData) this.updateDisplay(this.sceneData);
    if (frame.lattice) {
      this.arrows.setData(
        frame.lattice.positions,
        frame.lattice.vectors,
        frame.lattice.magnitudes,
        frame.lattice.field,
        this.sceneData!.display,
      );
    }
  }

  private applyParticles(frame: ParticleFrame): void {
    this.particleTrails.setData(frame);
    for (const p of frame.particles) {
      this.lastParticlePositions.set(p.id, p.position);
      const view = this.views.get(p.id);
      if (view) view.group.position.set(...p.position);
    }
    if (this.selectedId) {
      const view = this.views.get(this.selectedId);
      if (view && this.selectionBox.visible) this.selectionBox.setFromObject(view.group);
    }
  }

  private applyInduction(frame: InductionFrame): void {
    for (const transform of frame.transforms) {
      this.lastMotion.set(transform.id, { position: transform.position, rotation: transform.rotation });
      const view = this.views.get(transform.id);
      if (!view) continue;
      view.group.position.set(...transform.position);
      view.group.rotation.set(...transform.rotation);
    }
    if (this.selectedId) {
      const view = this.views.get(this.selectedId);
      if (view && this.selectionBox.visible) this.selectionBox.setFromObject(view.group);
    }
  }

  private clearInduction(): void {
    this.lastMotion.clear();
    for (const obj of this.sceneData?.objects ?? []) {
      if (!obj.motion) continue;
      const view = this.views.get(obj.id);
      if (!view) continue;
      view.group.position.set(...obj.position);
      view.group.rotation.set(...obj.rotation);
    }
  }

  private clearParticles(): void {
    this.particleTrails.clear();
    this.lastParticlePositions.clear();
    for (const obj of this.sceneData?.objects ?? []) {
      if (!isParticle(obj)) continue;
      const view = this.views.get(obj.id);
      if (view) view.group.position.set(...obj.position);
    }
  }

  private emitLegend(quantity: SliceQuantity, min: number, max: number): void {
    this.lastLegend = { quantity, min, max };
    this.callbacks.onSliceRange?.(this.lastLegend);
  }

  private clearFields(): void {
    for (const layer of Object.values(this.slices)) layer.clear();
    this.linesLayer.clear();
    this.arrows.clear();
    this.callbacks.onSliceRange?.(null);
  }

  private isPickable(object: THREE.Object3D): boolean {
    let node: THREE.Object3D | null = object;
    while (node) { if (!node.visible) return false; node = node.parent; }
    return true;
  }

  private setProbeLabels(readings: ProbeReading[]): void {
    const seen = new Set(readings.map(p => p.id));
    for (const [id, label] of this.probeLabels) {
      if (!seen.has(id)) { label.element.remove(); this.probeLabels.delete(id); }
    }
    for (const reading of readings) {
      let label = this.probeLabels.get(reading.id);
      if (!label) {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = 'probe-label';
        element.addEventListener('click', () => this.callbacks.onSelect(reading.id));
        this.container.appendChild(element);
        label = { element, reading };
        this.probeLabels.set(reading.id, label);
      }
      label.reading = reading;
      const name = this.sceneData?.objects.find(o => o.id === reading.id)?.name ?? 'Probe';
      label.element.textContent = `${name}\n|E| ${formatPrefixed(reading.Emag, 'V/m')} · |B| ${formatPrefixed(reading.Bmag, 'T')}`;
      label.element.title = 'Click to edit this coordinate and see vector components';
    }
  }

  private positionProbeLabels(): void {
    const d = this.sceneData;
    if (!d) return;
    const position = new THREE.Vector3();
    for (const { element, reading } of this.probeLabels.values()) {
      const object = d.objects.find(o => o.id === reading.id);
      position.set(...reading.position).project(this.camera);
      const outside = reading.position.some((v, i) => Math.abs(v - d.domain.center[i]) > d.domain.size[i] / 2);
      const visible = d.display.showProbeLabels && object?.visible && !outside && Math.abs(position.z) < 1 && Math.abs(position.x) < 1 && Math.abs(position.y) < 1;
      element.style.display = visible ? '' : 'none';
      element.style.left = `${(position.x + 1) * this.container.clientWidth / 2}px`;
      element.style.top = `${(1 - position.y) * this.container.clientHeight / 2}px`;
    }
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.pointerDown.set(event.clientX, event.clientY);
  };

  private onPointerUp = (event: PointerEvent): void => {
    const moved = Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y);
    if (moved > 5) return;
    if (!this.sceneData) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.objectGroup.children, true);
    for (const hit of hits) {
      if (!this.isPickable(hit.object)) continue;
      let node: THREE.Object3D | null = hit.object;
      while (node && !node.userData.id) node = node.parent;
      if (node?.userData.id) {
        this.callbacks.onSelect(node.userData.id as string);
        return;
      }
    }
    this.callbacks.onSelect(null);
  };

  private onPointerMove = (event: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.objectGroup.children, true);
    let cursor = 'default';
    for (const hit of hits) {
      if (!this.isPickable(hit.object)) continue;
      let node: THREE.Object3D | null = hit.object;
      while (node && !node.userData.id) node = node.parent;
      if (node?.userData.id) { cursor = 'pointer'; break; }
    }
    this.renderer.domElement.style.cursor = cursor;
  };

  private resize(): void {
    if (this.disposed) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.animation = requestAnimationFrame(this.animate);
    const now = performance.now();
    this.frameCount++;
    if (now - this.fpsAt > 600) {
      this.callbacks.onFps(Math.round((this.frameCount * 1000) / (now - this.fpsAt)));
      this.frameCount = 0;
      this.fpsAt = now;
    }
    this.controls.update();
    this.positionProbeLabels();
    if (this.selectedId) {
      const view = this.views.get(this.selectedId);
      if (view) this.selectionBox.setFromObject(view.group);
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animation);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    for (const unsub of this.unsubscribers) unsub();
    for (const label of this.probeLabels.values()) label.element.remove();
    this.probeLabels.clear();
    this.controls.dispose();
    this.transform.dispose();
    for (const view of this.views.values()) disposeObjectView(view);
    this.views.clear();
    for (const layer of Object.values(this.slices)) layer.dispose();
    this.linesLayer.dispose();
    this.arrows.dispose();
    this.particleTrails.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
