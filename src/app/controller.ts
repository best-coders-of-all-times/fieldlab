import type { Scene } from '../scene/types';
import { isProbe } from '../scene/types';
import { fieldBus } from './fieldBus';
import type { LatticePayload } from './fieldBus';
import type {
  FdtdRequest,
  FdtdResponse,
  StaticsRequest,
  StaticsResponse,
} from '../workers/protocol';
import type { StaticsSummary } from '../engine/staticsEngine';
import { ParticleSystem } from '../engine/particles/system';
import type { ParticleFrame } from '../engine/particles/system';
import { InductionSystem } from '../engine/induction/system';
import type { InductionFrame } from '../engine/induction/system';
import { isParticle } from '../scene/types';
import { maxwellRunBudget } from '../engine/maxwell/runBudget';
import { useAppStore } from './store';

function physicsKey(scene: Scene): string {
  return JSON.stringify({
    mode: scene.mode,
    useApproximation: scene.simulation.useApproximation,
    maxwellConductorModel: scene.simulation.maxwellConductorModel,
    domain: scene.domain,
    objects: scene.objects
      .filter((o) => !isProbe(o) || o.motion)
      .map((o) => isParticle(o)
        // Trail length is purely visual; changing it should not restart the orbit.
        ? { kind: o.kind, id: o.id, position: o.position, velocity: o.velocity,
            charge: o.charge, mass: o.mass, visible: o.visible, motion: o.motion, dynamics: o.dynamics }
        : { ...o, visible: o.visible }),
    resolution: scene.simulation.resolution,
    staticBoundary: scene.simulation.staticBoundary,
    externalField: scene.simulation.externalField,
    externalB: scene.simulation.externalB,
    boundary: scene.simulation.boundary,
    pmlCells: scene.simulation.pmlCells,
    cfl: scene.simulation.cfl,
  });
}

function displayKey(scene: Scene): string {
  return JSON.stringify(scene.display);
}

export class SimulationController {
  private staticsWorker: Worker | null = null;
  private fdtdWorker: Worker | null = null;
  private generation = 0;
  private mode: Scene['mode'] = 'fields';
  private physics = '';
  private display = '';
  private staticsReady = false;
  private fdtdReady = false;
  private requestCounter = 0;
  private playing = false;
  private scene: Scene | null = null;
  private sliceTimer: ReturnType<typeof setTimeout> | null = null;
  private reinitTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;
  private lastChartAt = 0;
  private particles: ParticleSystem | null = null;
  private induction: InductionSystem | null = null;
  private particleRaf = 0;
  private particleLast = 0;
  private particleTelemetryAt = 0;
  private inductionTelemetryAt = 0;
  private disposed = false;
  private fieldFramePending = false;
  private fieldFrameDirty = false;
  private latestMotion: InductionFrame | null = null;
  private fieldFrameAt = 0;
  private probeRequest = 0;

  update(scene: Scene, playing: boolean): void {
    if (this.disposed) return;
    const modeChanged = scene.mode !== this.mode;
    const pKey = physicsKey(scene);
    const dKey = displayKey(scene);
    const physicsChanged = pKey !== this.physics || modeChanged;
    this.scene = scene;
    this.playing = playing;
    this.mode = scene.mode;

    if (physicsChanged) {
      if (!this.initialized || modeChanged) {
        this.physics = pKey;
        this.display = dKey;
        this.initialized = true;
        this.reinit(scene);
      } else {
        // Stop accepting old-scene results immediately; debounce construction
        // only. A continuous drag must not keep an obsolete scene running.
        if (!this.reinitTimer) {
          this.generation++;
          this.fdtdWorker?.postMessage({ type: 'pause' } as FdtdRequest);
          this.stopParticles();
          this.staticsReady = false;
          this.fdtdReady = false;
        }
        if (this.reinitTimer) clearTimeout(this.reinitTimer);
        this.reinitTimer = setTimeout(() => {
          this.reinitTimer = null;
          if (!this.scene) return;
          this.physics = physicsKey(this.scene);
          this.display = displayKey(this.scene);
          this.reinit(this.scene);
        }, 170);
      }
      return;
    }

    if (dKey !== this.display) {
      this.display = dKey;
      if (scene.mode === 'fields' && scene.simulation.useApproximation !== false) this.scheduleStaticsDisplay();
    }

    if (scene.mode === 'waves' || scene.simulation.useApproximation === false) {
      this.fdtdWorker?.postMessage({ type: 'config', generation: this.generation, scene } as FdtdRequest);
      this.fdtdWorker?.postMessage({ type: playing ? 'start' : 'pause' } as FdtdRequest);
    }

    if (scene.mode === 'fields' && this.staticsReady) {
      this.requestExternalProbes(scene);
    }
    this.syncParticleLoop();
  }

  private reinit(scene: Scene): void {
    this.generation++;
    this.fieldFramePending = false;
    this.fieldFrameDirty = false;
    this.latestMotion = null;
    this.fieldFrameAt = 0;
    this.probeRequest = 0;
    this.staticsReady = false;
    this.fdtdReady = false;
    useAppStore.getState().setStatus({ phase: 'solving' });
    useAppStore.getState().setProbes([]);
    useAppStore.getState().setTime(0);
    useAppStore.getState().clearChart();
    useAppStore.getState().setStaticsSummary(null);
    useAppStore.getState().setFdtdMeta(null);
    useAppStore.setState({ measurements: {} });

    if (scene.simulation.useApproximation !== false && scene.objects.some(o => o.visible && o.kind === 'wire' && o.electricalModel === 'currentFeed')) {
      this.stopParticles(); this.terminateStatics(); this.terminateFdtd();
      this.fail('Terminal current feeds require Maxwell mode. Disable "Use approximation", or explicitly select an impressed filament.');
      return;
    }

    if (scene.simulation.useApproximation !== false && scene.objects.some(o => o.visible && o.kind === 'dielectric' && o.materialModel === 'drude')) {
      this.stopParticles(); this.terminateStatics(); this.terminateFdtd();
      this.fail('Drude dispersion requires Maxwell mode. Disable "Use approximation", or explicitly choose a linear material.');
      return;
    }

    if (scene.simulation.useApproximation !== false && scene.objects.some(o => o.visible && (o.kind === 'wire' || o.kind === 'loop' || o.kind === 'coil') && o.electricalModel === 'conducting')) {
      this.stopParticles(); this.terminateStatics(); this.terminateFdtd();
      this.fail('Passive conducting wires require Maxwell mode. Disable “Use approximation”, or explicitly choose an impressed-current source.');
      return;
    }

    if (scene.simulation.useApproximation !== false && scene.objects.some(o => o.visible && o.dynamics?.mode === 'forceDriven')) {
      this.stopParticles(); this.terminateStatics(); this.terminateFdtd();
      this.fail('Force-driven source bodies require Maxwell mode. Disable “Use approximation”, or choose fixed/prescribed motion. Legacy test particles remain available without a body dynamics override.');
      return;
    }

    if (scene.mode === 'fields' && scene.simulation.useApproximation !== false) {
      this.terminateFdtd();
      fieldBus.emit('fdtd-clear', undefined);
      this.terminateStatics();
      fieldBus.emit('statics-clear', undefined);
      const worker = new Worker(new URL('../workers/statics.worker.ts', import.meta.url), { type: 'module' });
      this.staticsWorker = worker;
      worker.onmessage = (event: MessageEvent<StaticsResponse>) => this.onStatics(event.data);
      worker.onerror = (event) => this.fail(event.message || 'Statics worker failed');
      worker.postMessage({ type: 'init', generation: this.generation, scene } as StaticsRequest);
      this.setupParticles(scene);
      this.setupInduction(scene);
    } else {
      this.terminateStatics();
      fieldBus.emit('statics-clear', undefined);
      this.stopParticles();
      this.particles = null;
      this.induction = null;
      fieldBus.emit('particles-clear', undefined);
      fieldBus.emit('induction-clear', undefined);
      useAppStore.getState().setParticleTelemetry([]);
      useAppStore.getState().setInductionTelemetry([]);
      this.terminateFdtd();
      fieldBus.emit('fdtd-clear', undefined);
      const worker = new Worker(new URL('../workers/fdtd.worker.ts', import.meta.url), { type: 'module' });
      this.fdtdWorker = worker;
      worker.onmessage = (event: MessageEvent<FdtdResponse>) => this.onFdtd(event.data);
      worker.onerror = (event) => this.fail(event.message || 'FDTD worker failed');
      worker.postMessage({ type: 'init', generation: this.generation, scene } as FdtdRequest);
    }
  }

  private onStatics(msg: StaticsResponse): void {
    if (msg.generation !== this.generation) return;
    const store = useAppStore.getState();
    if (msg.type === 'ready') {
      this.staticsReady = true;
      store.setStatus({ phase: 'ready', solveMs: msg.summary.stats.solveMs });
      store.setStaticsSummary(msg.summary);
      store.setProbes(msg.probes);
      this.applyStaticsMeasurements(msg.summary);
      this.scheduleStaticsDisplay();
      if (this.scene) this.requestExternalProbes(this.scene);
    } else if (msg.type === 'frame') {
      this.fieldFramePending = false;
      store.setStaticsSummary(msg.summary);
      this.applyStaticsMeasurements(msg.summary);
      for (const slice of msg.slices) fieldBus.emit('statics-slice', slice);
      if (msg.lines) fieldBus.emit('statics-lines', msg.lines);
      if (msg.lattice) fieldBus.emit('statics-lattice', msg.lattice);
      store.setProbes(msg.probes);
      if (msg.probes.length) store.appendChart({ t: msg.time, values: Object.fromEntries(
        msg.probes.flatMap(p => [[`${p.id}:E`, p.Emag], [`${p.id}:B`, p.Bmag]]),
      ) });
      // Consume the latest pose only. Never queue every animation tick.
      if (this.fieldFrameDirty || (this.latestMotion && this.latestMotion.time > msg.time)) this.requestMotionFields();
    } else if (msg.type === 'slice') {
      fieldBus.emit('statics-slice', msg.slice);
    } else if (msg.type === 'lines') {
      fieldBus.emit('statics-lines', { field: msg.field, lines: msg.lines });
    } else if (msg.type === 'lattice') {
      fieldBus.emit('statics-lattice', {
        field: msg.field,
        positions: msg.positions,
        vectors: msg.vectors,
        magnitudes: msg.magnitudes,
      } as LatticePayload);
    } else if (msg.type === 'probe') {
      if (msg.requestId === this.probeRequest) store.setProbes(msg.probes);
    } else if (msg.type === 'error') {
      this.fail(msg.message);
    }
  }

  private applyStaticsMeasurements(summary: StaticsSummary): void {
    const store = useAppStore.getState();
    const charges = summary.conductors;
    store.setMeasurements({
      solver: summary.stats,
      capacitance: summary.differentialCapacitance,
      inductance: summary.inductance || undefined,
      electricEnergy: summary.electricEnergy,
      magneticEnergy: summary.magneticEnergy,
      extra: charges.length > 0
        ? Object.fromEntries(charges.map((c, i) => [`conductor${i + 1}Charge`, c.charge]))
        : undefined,
    });
  }

  private scheduleStaticsDisplay(): void {
    if (this.sliceTimer) clearTimeout(this.sliceTimer);
    this.sliceTimer = setTimeout(() => {
      this.sliceTimer = null;
      this.requestStaticsDisplay();
    }, 40);
  }

  requestStaticsDisplay(): void {
    if (!this.staticsReady || !this.scene || !this.staticsWorker) return;
    if (this.latestMotion) { this.requestMotionFields(); return; }
    const scene = this.scene;
    const display = scene.display;
    const send = (msg: StaticsRequest) => this.staticsWorker?.postMessage(msg);
    const gen = this.generation;
    if (display.slices.xy) {
      send({
        type: 'slice', generation: gen, requestId: ++this.requestCounter,
        axis: 'z', position: display.slicePositions.z,
        quantity: display.sliceQuantity, resolution: display.sliceResolution,
        colormap: display.colormap, signed: ['Ex', 'Ey', 'Ez', 'phi'].includes(display.sliceQuantity),
      });
    }
    if (display.slices.xz) {
      send({
        type: 'slice', generation: gen, requestId: ++this.requestCounter,
        axis: 'y', position: display.slicePositions.y,
        quantity: display.sliceQuantity, resolution: display.sliceResolution,
        colormap: display.colormap, signed: ['Ex', 'Ey', 'Ez', 'phi'].includes(display.sliceQuantity),
      });
    }
    if (display.slices.yz) {
      send({
        type: 'slice', generation: gen, requestId: ++this.requestCounter,
        axis: 'x', position: display.slicePositions.x,
        quantity: display.sliceQuantity, resolution: display.sliceResolution,
        colormap: display.colormap, signed: ['Ex', 'Ey', 'Ez', 'phi'].includes(display.sliceQuantity),
      });
    }
    if (display.fieldLines !== 'none') {
      send({
        type: 'lines', generation: gen, requestId: ++this.requestCounter,
        field: display.fieldLines, count: display.lineCount,
      });
    }
    if (display.arrows !== 'none') {
      send({
        type: 'lattice', generation: gen, requestId: ++this.requestCounter,
        field: display.arrows, count: display.arrowDensity,
      });
    }
    if (this.scene) this.requestExternalProbes(this.scene);
  }

  private requestExternalProbes(scene: Scene): void {
    if (!this.staticsReady || !this.staticsWorker) return;
    if (this.latestMotion) { this.requestMotionFields(); return; }
    const points = scene.objects.filter(p => isProbe(p) && p.visible).map((p) => ({ id: p.id, position: p.position }));
    this.probeRequest = ++this.requestCounter;
    this.staticsWorker.postMessage({
      type: 'probe', generation: this.generation, requestId: this.probeRequest, points,
    } as StaticsRequest);
  }

  private requestMotionFields(): void {
    if (!this.staticsReady || !this.staticsWorker || !this.scene || !this.latestMotion) return;
    if (this.fieldFramePending) { this.fieldFrameDirty = true; return; }
    this.fieldFramePending = true;
    this.fieldFrameDirty = false;
    this.fieldFrameAt = performance.now();
    this.staticsWorker.postMessage({ type: 'frame', generation: this.generation,
      requestId: ++this.requestCounter, time: this.latestMotion.time,
      transforms: this.latestMotion.transforms, display: this.scene.display,
      probes: this.scene.objects.filter(isProbe),
    } as StaticsRequest);
  }

  private onFdtd(msg: FdtdResponse): void {
    if (msg.type === 'error') {
      if (msg.generation === this.generation) this.fail(msg.message);
      return;
    }
    if (msg.generation !== this.generation) return;
    const store = useAppStore.getState();
    if (msg.type === 'ready') {
      this.fdtdReady = true;
      store.setFdtdMeta(msg.meta);
      store.setStatus({ phase: 'ready' });
      store.setMeasurements({
        dt: msg.meta.dt,
        dx: msg.meta.dx,
        frequency: msg.meta.frequency,
        wavelength: msg.meta.frequency > 0 ? 299792458 / msg.meta.frequency : 0,
      });
      this.fdtdWorker?.postMessage({ type: this.playing ? 'start' : 'pause' } as FdtdRequest);
    } else if (msg.type === 'frame') {
      // Target edits do not rebuild physics. A queued frame may still refer to
      // the old target, so evaluate its step against the latest authored target.
      if (msg.targetReached && this.scene?.simulation.useApproximation === false) {
        let reached = false;
        try { reached = maxwellRunBudget(msg.meta.dt, msg.steps, this.scene.simulation.targetTime, 1).reached; }
        catch { /* The worker reports an invalid imported/configured target. */ }
        if (reached) { this.playing = false; store.setPlaying(false); }
      }
      store.setTime(msg.time);
      store.setFdtdMeta(msg.meta);
      store.setMeasurements({
        electricEnergy: msg.energy.electric,
        magneticEnergy: msg.energy.magnetic,
        dt: msg.meta.dt,
        dx: msg.meta.dx,
        frequency: msg.meta.frequency,
        wavelength: msg.meta.frequency > 0 ? 299792458 / msg.meta.frequency : 0,
      });
      const probes = msg.probes.map((p) => ({
        id: p.id,
        position: p.position,
        E: p.sample.E,
        B: p.sample.B,
        D: p.sample.D,
        H: p.sample.H,
        J: p.sample.J,
        rho: p.sample.rho,
        phi: 0,
        Emag: p.sample.Emag,
        Bmag: p.sample.Bmag,
      }));
      store.setProbes(probes);
      fieldBus.emit('fdtd-frame', msg);
      if (msg.transforms) fieldBus.emit('induction-frame', { time: msg.time, transforms: msg.transforms, readings: [] });
      if (msg.lines) fieldBus.emit('statics-lines', msg.lines);
      if (msg.diagnostics) store.setMeasurements({ extra: { ...msg.diagnostics, steps: msg.steps } });
      const now = performance.now();
      if (now - this.lastChartAt > 70 && probes.length > 0) {
        this.lastChartAt = now;
        for (const p of probes) {
          store.appendChart({
            t: msg.time,
            values: {
              [`${p.id}:E`]: p.Emag,
              [`${p.id}:B`]: p.Bmag,
            },
          });
        }
      }
    }
  }

  play(playing: boolean): void {
    this.playing = playing;
    if (this.mode === 'waves' || this.scene?.simulation.useApproximation === false) {
      this.fdtdWorker?.postMessage({ type: playing ? 'start' : 'pause' } as FdtdRequest);
    }
    this.syncParticleLoop();
  }

  step(): void {
    if (this.mode === 'waves' || this.scene?.simulation.useApproximation === false) {
      this.fdtdWorker?.postMessage({ type: 'pause' } as FdtdRequest);
      this.fdtdWorker?.postMessage({ type: 'singleStep' } as FdtdRequest);
    } else {
      const timeScale = this.scene?.simulation.timeScale ?? 1;
      if (this.particles) {
        const frame = this.particles.advance(1 / 60, timeScale);
        if (frame) this.publishParticleFrame(frame);
      }
      if (this.induction) {
        const frame = this.induction.advance(1 / 60, timeScale);
        if (frame) this.publishInductionFrame(frame);
      }
    }
  }

  private setupParticles(scene: Scene): void {
    this.stopParticles();
    fieldBus.emit('particles-clear', undefined);
    this.particles = scene.objects.some(isParticle) ? new ParticleSystem(scene) : null;
    if (this.particles && !this.particles.active) this.particles = null;
    useAppStore.getState().setParticleTelemetry([]);
    this.particleLast = 0;
    if (this.particles || this.induction) this.syncParticleLoop();
  }

  private setupInduction(scene: Scene): void {
    fieldBus.emit('induction-clear', undefined);
    this.induction = scene.objects.some((o) => o.visible && o.motion) ? new InductionSystem(scene) : null;
    useAppStore.getState().setInductionTelemetry([]);
    if (this.induction || this.particles) this.syncParticleLoop();
  }

  private syncParticleLoop(): void {
    const shouldRun = !this.disposed && this.mode === 'fields' && this.scene?.simulation.useApproximation !== false && this.playing && (!!this.particles || !!this.induction);
    if (!shouldRun) {
      this.stopParticles();
      return;
    }
    if (this.particleRaf) return;
    this.particleLast = performance.now();
    this.particleRaf = requestAnimationFrame(this.particleTick);
  }

  private stopParticles(): void {
    if (this.particleRaf) cancelAnimationFrame(this.particleRaf);
    this.particleRaf = 0;
    this.particleLast = 0;
  }

  private particleTick = (): void => {
    this.particleRaf = 0;
    if (this.disposed || (!this.particles && !this.induction) || !this.playing || this.mode !== 'fields') return;
    this.particleRaf = requestAnimationFrame(this.particleTick);
    const now = performance.now();
    const dt = this.particleLast > 0 ? (now - this.particleLast) / 1000 : 1 / 60;
    this.particleLast = now;
    const timeScale = this.scene?.simulation.timeScale ?? 1;
    if (this.particles) {
      const frame = this.particles.advance(dt, timeScale);
      if (frame) this.publishParticleFrame(frame);
    }
    if (this.induction) {
      const frame = this.induction.advance(dt, timeScale);
      if (frame) this.publishInductionFrame(frame);
    }
  };

  private publishParticleFrame(frame: ParticleFrame): void {
    fieldBus.emit('particles-frame', frame);
    const now = performance.now();
    if (now - this.particleTelemetryAt < 120) return;
    this.particleTelemetryAt = now;
    const scene = this.scene;
    if (!scene) return;
    const store = useAppStore.getState();
    if (!this.induction) store.setTime(frame.time);
    store.setParticleTelemetry(frame.particles.map((p) => {
      const obj = scene.objects.find((o) => o.id === p.id);
      return {
        id: p.id,
        name: obj?.name ?? 'Particle',
        position: [p.position[0], p.position[1], p.position[2]],
        speed: p.speed,
        E: Math.hypot(p.E[0], p.E[1], p.E[2]),
        B: Math.hypot(p.B[0], p.B[1], p.B[2]),
        gyroRadius: p.gyroRadius,
        gyroPeriod: p.gyroPeriod,
      };
    }));
    for (const p of frame.particles) {
      store.appendChart({ t: frame.time, values: { [`${p.id}:v`]: p.speed } });
    }
  }

  private publishInductionFrame(frame: InductionFrame): void {
    fieldBus.emit('induction-frame', frame);
    this.latestMotion = frame;
    if (performance.now() - this.fieldFrameAt >= 100 || !this.playing) this.requestMotionFields();
    const now = performance.now();
    if (now - this.inductionTelemetryAt < 120) return;
    this.inductionTelemetryAt = now;
    const store = useAppStore.getState();
    store.setTime(frame.time);
    store.setInductionTelemetry(frame.readings.map((r) => ({
      id: r.id,
      name: r.name,
      flux: r.flux,
      emf: r.emf,
      turns: r.turns,
    })));
    if (frame.readings.length > 0) {
      const first = frame.readings[0];
      const withFlux = frame.readings.find((r) => Number.isFinite(r.flux));
      store.setMeasurements({ emf: first.emf, flux: withFlux?.flux });
    }
    for (const r of frame.readings) {
      store.appendChart({ t: frame.time, values: { [`${r.id}:emf`]: r.emf } });
    }
  }

  reset(): void {
    if (this.reinitTimer) { clearTimeout(this.reinitTimer); this.reinitTimer = null; }
    if (this.scene) this.physics = physicsKey(this.scene);
    if (this.scene) this.reinit(this.scene);
  }

  private fail(message: string): void {
    useAppStore.getState().setStatus({ phase: 'error', message });
    useAppStore.getState().setError(message);
  }

  private terminateStatics(): void {
    this.staticsWorker?.terminate();
    this.staticsWorker = null;
  }

  private terminateFdtd(): void {
    this.fdtdWorker?.terminate();
    this.fdtdWorker = null;
  }

  dispose(): void {
    this.disposed = true;
    this.stopParticles();
    this.terminateStatics();
    this.terminateFdtd();
    if (this.sliceTimer) clearTimeout(this.sliceTimer);
    if (this.reinitTimer) clearTimeout(this.reinitTimer);
  }
}
