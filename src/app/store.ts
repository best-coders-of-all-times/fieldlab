import { create } from 'zustand';
import { fieldBus } from './fieldBus';
import type { FdtdMeta } from '../engine/fdtd/fdtd3d';
import type { Vec3 } from '../engine/math/vec3';
import type { StaticsSummary } from '../engine/staticsEngine';
import type {
  MeasurementSnapshot,
  ProbeReading,
  Scene,
  SceneObject,
  TimeSeriesPoint,
} from '../scene/types';
import { defaultScene, getPreset, PRESETS } from '../scene/presets';
import { cloneObject, makePlaneWave, uid } from '../scene/defaults';
import { isAntenna, isPlaneWave, isPointSource } from '../scene/types';

export type SolverPhase = 'idle' | 'solving' | 'ready' | 'error';

export interface SolverStatus {
  phase: SolverPhase;
  message?: string;
  solveMs?: number;
}

export interface InductionTelemetry {
  id: string;
  name: string;
  flux: number;
  emf: number;
  turns: number;
}

export interface ParticleTelemetry {
  id: string;
  name: string;
  position: Vec3;
  speed: number;
  E: number;
  B: number;
  gyroRadius: number;
  gyroPeriod: number;
}

interface AppState {
  scene: Scene;
  presetId: string | null;
  selectedId: string | null;
  playing: boolean;
  time: number;
  fps: number;
  status: SolverStatus;
  staticsSummary: StaticsSummary | null;
  fdtdMeta: FdtdMeta | null;
  measurements: MeasurementSnapshot;
  probes: ProbeReading[];
  particleTelemetry: ParticleTelemetry[];
  inductionTelemetry: InductionTelemetry[];
  chart: { series: string[]; points: TimeSeriesPoint[] };
  error: string | null;
  panels: { left: boolean; right: boolean; chart: boolean; theory: boolean };
  rightTab: 'inspector' | 'display' | 'simulation' | 'theory' | 'measure';
  leftTab: 'scenes' | 'add';
  cameraRequest: number;
  cameraMode: 'iso' | 'front' | 'top' | 'side';
  gizmoMode: 'translate' | 'rotate' | 'scale';
  stepRequest: number;
  resetRequest: number;
  past: Scene[];
  future: Scene[];
  historyAt: number;
  autosave: boolean;

  setScene: (scene: Scene, opts?: { presetId?: string | null; history?: boolean }) => void;
  loadPreset: (id: string) => void;
  resetScene: () => void;
  rewindSimulation: () => void;
  replaySimulation: () => void;
  setMode: (mode: Scene['mode']) => void;
  updateObject: (id: string, patch: Partial<SceneObject>, history?: boolean) => void;
  addObject: (obj: SceneObject) => void;
  removeObject: (id: string) => void;
  duplicateSelected: () => void;
  select: (id: string | null) => void;
  setPlaying: (playing: boolean) => void;
  setTime: (time: number) => void;
  setFps: (fps: number) => void;
  setStatus: (status: SolverStatus) => void;
  setStaticsSummary: (summary: StaticsSummary | null) => void;
  setFdtdMeta: (meta: FdtdMeta | null) => void;
  setMeasurements: (patch: Partial<MeasurementSnapshot>) => void;
  setProbes: (probes: ProbeReading[]) => void;
  setParticleTelemetry: (telemetry: ParticleTelemetry[]) => void;
  setInductionTelemetry: (telemetry: InductionTelemetry[]) => void;
  appendChart: (point: TimeSeriesPoint) => void;
  clearChart: () => void;
  setError: (error: string | null) => void;
  setDisplay: (patch: Partial<Scene['display']>) => void;
  setSimulation: (patch: Partial<Scene['simulation']>) => void;
  togglePanel: (key: keyof AppState['panels']) => void;
  setRightTab: (tab: AppState['rightTab']) => void;
  setLeftTab: (tab: AppState['leftTab']) => void;
  requestCamera: (mode: AppState['cameraMode']) => void;
  setGizmoMode: (mode: AppState['gizmoMode']) => void;
  requestStep: () => void;
  undo: () => void;
  redo: () => void;
  setAutosave: (on: boolean) => void;
}

const cloneScene = (scene: Scene): Scene => structuredClone(scene);
const initial = defaultScene();

export const useAppStore = create<AppState>((set, get) => {
  const pushHistory = (scene: Scene, force = false) => {
    const now = Date.now();
    if (!force && now - get().historyAt < 450) {
      set({ historyAt: now });
      return;
    }
    set((state) => ({
      past: [...state.past.slice(-39), cloneScene(scene)],
      future: [],
      historyAt: now,
    }));
  };

  const restartRuntime = (playing: boolean) => set((state) => ({
    playing,
    time: 0,
    resetRequest: state.resetRequest + 1,
    staticsSummary: null,
    fdtdMeta: null,
    measurements: {},
    probes: [],
    particleTelemetry: [],
    inductionTelemetry: [],
    chart: { series: [], points: [] },
    status: { phase: 'solving' },
    error: null,
  }));

  return {
    scene: initial,
    presetId: 'point-charges',
    selectedId: null,
    playing: true,
    time: 0,
    fps: 0,
    status: { phase: 'idle' },
    staticsSummary: null,
    fdtdMeta: null,
    measurements: {},
    probes: [],
    particleTelemetry: [],
    inductionTelemetry: [],
    chart: { series: [], points: [] },
    error: null,
    panels: { left: true, right: true, chart: false, theory: true },
    rightTab: 'inspector',
    leftTab: 'scenes',
    cameraRequest: 0,
    cameraMode: 'iso',
    gizmoMode: 'translate',
    stepRequest: 0,
    resetRequest: 0,
    past: [],
    future: [],
    historyAt: 0,
    autosave: true,

    setScene: (scene, opts) => {
      if (opts?.history !== false) pushHistory(get().scene, true);
      set((state) => ({
        scene,
        presetId: opts?.presetId === undefined ? state.presetId : opts.presetId,
        staticsSummary: null,
        fdtdMeta: null,
        measurements: {},
        probes: [],
        particleTelemetry: [],
        inductionTelemetry: [],
      }));
    },

    loadPreset: (id) => {
      const preset = getPreset(id);
      if (!preset) return;
      const scene = preset.create();
      pushHistory(get().scene, true);
      set({
        scene,
        presetId: id,
        selectedId: null,
        playing: true,
        time: 0,
        staticsSummary: null,
        fdtdMeta: null,
        measurements: {},
        probes: [],
        particleTelemetry: [],
        inductionTelemetry: [],
        chart: { series: [], points: [] },
        status: { phase: 'solving' },
        past: get().past,
        future: [],
      });
    },

    setMode: (mode) => {
      const state = get();
      if (state.scene.mode === mode) return;
      pushHistory(state.scene, true);
      const scene = cloneScene(state.scene);
      scene.mode = mode;
      if (mode === 'waves') {
        scene.simulation = {
          ...scene.simulation,
          resolution: 48,
          pmlCells: 8,
          boundary: { x: 'pml', y: 'pml', z: 'pml' },
          stepsPerFrame: 2,
        };
        scene.display = {
          ...scene.display,
          fieldLines: 'none',
          arrows: 'E',
          slices: { xy: false, xz: true, yz: false },
          sliceQuantity: 'Emag',
          colormap: 'inferno',
        };
        if (!scene.objects.some((o) => isPlaneWave(o) || isPointSource(o) || isAntenna(o))) {
          scene.objects.push(makePlaneWave());
        }
      } else {
        scene.simulation = { ...scene.simulation, resolution: 64 };
        scene.display = {
          ...scene.display,
          fieldLines: 'E',
          arrows: 'none',
          slices: { xy: true, xz: false, yz: false },
          sliceQuantity: 'phi',
          colormap: 'coolwarm',
        };
      }
      set({
        scene,
        presetId: null,
        selectedId: null,
        time: 0,
        staticsSummary: null,
        fdtdMeta: null,
        measurements: {},
        probes: [],
        particleTelemetry: [],
        inductionTelemetry: [],
        chart: { series: [], points: [] },
        status: { phase: 'solving' },
      });
    },

    rewindSimulation: () => restartRuntime(false),
    replaySimulation: () => restartRuntime(true),

    resetScene: () => {
      const { presetId, scene } = get();
      const preset = presetId ? getPreset(presetId) : undefined;
      const next = preset ? preset.create() : cloneScene(scene);
      pushHistory(scene, true);
      set({
        scene: next,
        resetRequest: get().resetRequest + 1,
        selectedId: null,
        time: 0,
        measurements: {},
        probes: [],
        particleTelemetry: [],
        inductionTelemetry: [],
        chart: { series: [], points: [] },
        status: { phase: 'solving' },
      });
    },

    updateObject: (id, patch, history = true) => {
      const prev = get().scene;
      if (history) pushHistory(prev);
      set({
        scene: {
          ...prev,
          objects: prev.objects.map((obj) =>
            obj.id === id ? ({ ...obj, ...patch } as SceneObject) : obj,
          ),
        },
      });
    },

    addObject: (obj) => {
      const prev = get().scene;
      pushHistory(prev, true);
      const magnetic = ['wire', 'loop', 'coil', 'magnet'].includes(obj.kind);
      const electric = obj.kind === 'charge' || obj.kind === 'chargedSphere';
      const firstSource = !prev.objects.some(o => o.visible &&
        ['charge', 'chargedSphere', 'wire', 'loop', 'coil', 'magnet'].includes(o.kind));
      const display = prev.mode === 'fields' && firstSource && (magnetic || electric)
        ? { ...prev.display, fieldLines: magnetic ? 'B' as const : 'E' as const,
            sliceQuantity: magnetic ? 'Bmag' as const : 'Emag' as const,
            colormap: magnetic ? 'magnetic' as const : 'electric' as const }
        : prev.display;
      set({
        scene: { ...prev, display, objects: [...prev.objects, obj] },
        selectedId: obj.id,
        rightTab: 'inspector',
      });
    },

    removeObject: (id) => {
      const prev = get().scene;
      pushHistory(prev, true);
      set({
        scene: { ...prev, objects: prev.objects.filter((o) => o.id !== id) },
        selectedId: get().selectedId === id ? null : get().selectedId,
      });
    },

    duplicateSelected: () => {
      const { selectedId, scene } = get();
      const obj = scene.objects.find((o) => o.id === selectedId);
      if (!obj) return;
      const copy = cloneObject(obj);
      copy.name = `${obj.name} copy`;
      copy.position = [obj.position[0] + 0.08, obj.position[1], obj.position[2]];
      pushHistory(scene, true);
      set({
        scene: { ...scene, objects: [...scene.objects, copy] },
        selectedId: copy.id,
      });
    },

    select: (selectedId) => set({ selectedId, rightTab: selectedId ? 'inspector' : get().rightTab }),
    setPlaying: (playing) => set({ playing }),
    setTime: (time) => set({ time }),
    setFps: (fps) => set({ fps }),
    setStatus: (status) => set({ status }),
    setStaticsSummary: (staticsSummary) => set({ staticsSummary }),
    setFdtdMeta: (fdtdMeta) => set({ fdtdMeta }),
    setMeasurements: (patch) => set((state) => ({ measurements: { ...state.measurements, ...patch } })),
    setProbes: (probes) => { set({ probes }); fieldBus.emit('probes', probes); },
    setParticleTelemetry: (particleTelemetry) => set({ particleTelemetry }),
    setInductionTelemetry: (inductionTelemetry) => set({ inductionTelemetry }),
    appendChart: (point) => set((state) => {
      const points = [...state.chart.points, point].slice(-900);
      const series = Array.from(new Set([...state.chart.series, ...Object.keys(point.values)]));
      return { chart: { series, points } };
    }),
    clearChart: () => set({ chart: { series: [], points: [] } }),
    setError: (error) => set({ error }),
    setDisplay: (patch) => set((state) => ({
      scene: { ...state.scene, display: { ...state.scene.display, ...patch } },
    })),
    setSimulation: (patch) => {
      const state = get();
      if (Object.entries(patch).every(([key, value]) => state.scene.simulation[key as keyof Scene['simulation']] === value)) return;
      pushHistory(state.scene, true);
      set({ scene: { ...state.scene, simulation: { ...state.scene.simulation, ...patch } } });
      if (Object.keys(patch).some(key => key !== 'stepsPerFrame' && key !== 'timeScale' && key !== 'targetTime')) restartRuntime(false);
    },
    togglePanel: (key) => set((state) => ({ panels: { ...state.panels, [key]: !state.panels[key] } })),
    setRightTab: (rightTab) => set({ rightTab }),
    setLeftTab: (leftTab) => set({ leftTab }),
    requestCamera: (cameraMode) => set((state) => ({
      cameraMode,
      cameraRequest: state.cameraRequest + 1,
    })),
    setGizmoMode: (gizmoMode) => set({ gizmoMode }),
    requestStep: () => set((state) => ({ stepRequest: state.stepRequest + 1 })),
    undo: () => {
      const { past, scene, future } = get();
      if (past.length === 0) return;
      const previous = past[past.length - 1];
      set({
        scene: previous,
        past: past.slice(0, -1),
        future: [cloneScene(scene), ...future].slice(0, 40),
        selectedId: null,
      });
    },
    redo: () => {
      const { future, scene, past } = get();
      if (future.length === 0) return;
      const next = future[0];
      set({
        scene: next,
        future: future.slice(1),
        past: [...past, cloneScene(scene)].slice(-40),
        selectedId: null,
      });
    },
    setAutosave: (autosave) => set({ autosave }),
  };
});

export function newObjectId(prefix = 'obj'): string {
  return uid(prefix);
}

export function presetList() {
  return PRESETS;
}
