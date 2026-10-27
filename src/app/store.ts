import { create } from 'zustand';
import { fieldBus } from './fieldBus';
import type { FdtdMeta } from '../engine/fdtd/fdtd3d';
import type { Vec3 } from '../engine/math/vec3';
import type { StaticsSummary } from '../engine/staticsEngine';
import type {
  MeasurementSnapshot,
  PlaybackFps,
  PlaybackSettings,
  ProbeReading,
  Scene,
  SceneObject,
  TimeSeriesPoint,
} from '../scene/types';
import { defaultScene, getPreset, PRESETS } from '../scene/presets';
import { cloneObject, defaultPlayback, makePlaneWave, uid } from '../scene/defaults';
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

export type PlaybackMode = 'idle' | 'computing' | 'cached';

/** Runtime-only cached-playback state. Frame arrays live in the controller. */
export interface PlaybackRuntime {
  mode: PlaybackMode;
  requestId: number;
  frameCount: number;
  frameIndex: number;
  framesDone: number;
  totalFrames: number;
  steps: number;
  totalSteps: number;
  bytes: number;
  frameBytes: number;
  startTime: number;
  endTime: number;
  sampleTimes: number[];
  fps: PlaybackFps;
  loop: boolean;
  phase: 'warmup' | 'sampling';
  startedAt: number;
  elapsedMs: number;
  stepsPerSecond: number;
  message?: string;
}

export interface PlaybackCommand {
  serial: number;
  kind: 'precompute' | 'cancel' | 'seek' | 'exit';
  index?: number;
}

export function idlePlaybackRuntime(settings: PlaybackSettings): PlaybackRuntime {
  return {
    mode: 'idle',
    requestId: 0,
    frameCount: 0,
    frameIndex: 0,
    framesDone: 0,
    totalFrames: 0,
    steps: 0,
    totalSteps: 0,
    bytes: 0,
    frameBytes: 0,
    startTime: settings.startTime,
    endTime: settings.endTime,
    sampleTimes: [],
    fps: settings.fps,
    loop: settings.loop,
    phase: 'warmup',
    startedAt: 0,
    elapsedMs: 0,
    stepsPerSecond: 0,
  };
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
  graphicsError: string | null;
  panels: { left: boolean; right: boolean; chart: boolean; theory: boolean };
  rightTab: 'inspector' | 'display' | 'simulation' | 'theory' | 'measure';
  leftTab: 'scenes' | 'add';
  cameraRequest: number;
  cameraMode: 'iso' | 'front' | 'top' | 'side';
  gizmoMode: 'translate' | 'rotate' | 'scale';
  stepRequest: number;
  resetRequest: number;
  playback: PlaybackRuntime;
  playbackCommand: PlaybackCommand | null;
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
  setPlayback: (patch: Partial<PlaybackRuntime>) => void;
  updatePlaybackSettings: (patch: Partial<PlaybackSettings>) => void;
  requestPrecompute: () => void;
  cancelPlayback: () => void;
  requestPlaybackSeek: (index: number) => void;
  exitPlayback: () => void;
  replaceChart: (points: TimeSeriesPoint[]) => void;
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
const initialPlayback = initial.simulation.playback ?? defaultPlayback();

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

  const playbackLocked = () => get().playback.mode !== 'idle';
  const issuePlaybackCommand = (kind: PlaybackCommand['kind'], index?: number) => {
    set((state) => ({
      playbackCommand: {
        serial: (state.playbackCommand?.serial ?? 0) + 1,
        kind,
        index,
      },
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
    graphicsError: null,
    panels: { left: typeof window === 'undefined' || window.innerWidth > 1050, right: typeof window === 'undefined' || window.innerWidth > 1050, chart: false, theory: true },
    rightTab: 'inspector',
    leftTab: 'scenes',
    cameraRequest: 0,
    cameraMode: 'iso',
    gizmoMode: 'translate',
    stepRequest: 0,
    resetRequest: 0,
    playback: idlePlaybackRuntime(initialPlayback),
    playbackCommand: null,
    past: [],
    future: [],
    historyAt: 0,
    autosave: true,

    setScene: (scene, opts) => {
      if (playbackLocked()) return;
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
      if (playbackLocked()) return;
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
      if (playbackLocked()) return;
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

    rewindSimulation: () => {
      const state = get();
      if (state.playback.mode === 'cached') {
        set({ playing: false });
        issuePlaybackCommand('seek', 0);
        return;
      }
      if (state.playback.mode === 'computing') return;
      restartRuntime(false);
    },
    replaySimulation: () => {
      const state = get();
      if (state.playback.mode === 'cached') {
        set({ playing: true });
        issuePlaybackCommand('seek', 0);
        return;
      }
      if (state.playback.mode === 'computing') return;
      restartRuntime(true);
    },

    resetScene: () => {
      if (playbackLocked()) return;
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
      if (playbackLocked()) return;
      const prev = get().scene;
      if (history) pushHistory(prev);
      set({
        scene: {
          ...prev,
          objects: prev.objects.map((obj) =>
            obj.id === id ? normalizeObjectPatch(obj, patch) : obj,
          ),
        },
      });
    },

    addObject: (obj) => {
      if (playbackLocked()) return;
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
      if (playbackLocked()) return;
      const prev = get().scene;
      pushHistory(prev, true);
      set({
        scene: { ...prev, objects: prev.objects.filter((o) => o.id !== id) },
        selectedId: get().selectedId === id ? null : get().selectedId,
      });
    },

    duplicateSelected: () => {
      if (playbackLocked()) return;
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
    setDisplay: (patch) => {
      if (playbackLocked()) return;
      set((state) => ({
        scene: { ...state.scene, display: { ...state.scene.display, ...patch } },
      }));
    },
    setSimulation: (patch) => {
      const state = get();
      const keys = Object.keys(patch) as Array<keyof Scene['simulation']>;
      let playbackPatch: Partial<PlaybackSettings> | undefined;
      if (playbackLocked()) {
        if (!(keys.length === 1 && keys[0] === 'playback') || !patch.playback) return;
        const current = state.scene.simulation.playback ?? defaultPlayback();
        const entries = Object.entries(patch.playback) as Array<[keyof PlaybackSettings, PlaybackSettings[keyof PlaybackSettings]]>;
        if (entries.some(([key, value]) => key !== 'fps' && key !== 'loop' && current[key] !== value)) return;
        playbackPatch = patch.playback;
      }
      if (Object.entries(patch).every(([key, value]) => state.scene.simulation[key as keyof Scene['simulation']] === value)) return;
      pushHistory(state.scene, true);
      set({ scene: { ...state.scene, simulation: { ...state.scene.simulation, ...patch } } });
      if (playbackPatch) {
        set((next) => ({
          playback: {
            ...next.playback,
            ...(playbackPatch!.fps !== undefined ? { fps: playbackPatch!.fps } : {}),
            ...(playbackPatch!.loop !== undefined ? { loop: playbackPatch!.loop } : {}),
          },
        }));
      }
      if (keys.some(key => key !== 'stepsPerFrame' && key !== 'timeScale' && key !== 'targetTime' && key !== 'playback')) restartRuntime(false);
    },
    setPlayback: (patch) => set((state) => ({ playback: { ...state.playback, ...patch } })),
    updatePlaybackSettings: (patch) => {
      const state = get();
      const current = state.scene.simulation.playback ?? defaultPlayback();
      if (state.playback.mode !== 'idle') {
        const keys = Object.keys(patch) as Array<keyof PlaybackSettings>;
        if (keys.some(key => key !== 'fps' && key !== 'loop')) return;
      }
      const next = { ...current, ...patch };
      if (Object.entries(patch).every(([key, value]) => current[key as keyof PlaybackSettings] === value)) return;
      pushHistory(state.scene, true);
      set({
        scene: {
          ...state.scene,
          simulation: { ...state.scene.simulation, playback: next },
        },
        playback: {
          ...state.playback,
          ...(patch.fps !== undefined ? { fps: next.fps } : {}),
          ...(patch.loop !== undefined ? { loop: next.loop } : {}),
        },
      });
    },
    requestPrecompute: () => {
      if (get().playback.mode === 'computing') return;
      issuePlaybackCommand('precompute');
    },
    cancelPlayback: () => {
      if (get().playback.mode === 'idle') return;
      issuePlaybackCommand('cancel');
    },
    requestPlaybackSeek: (index) => {
      if (get().playback.mode !== 'cached') return;
      issuePlaybackCommand('seek', index);
    },
    exitPlayback: () => {
      if (playbackLocked()) issuePlaybackCommand('exit');
    },
    replaceChart: (points) => set(() => ({
      chart: {
        series: Array.from(new Set(points.flatMap((point) => Object.keys(point.values)))),
        points: points.slice(-900),
      },
    })),
    togglePanel: (key) => set((state) => ({ panels: {
      ...state.panels,
      ...(typeof window !== 'undefined' && window.innerWidth <= 1050 && !state.panels[key]
        ? key === 'left' ? { right: false } : key === 'right' ? { left: false } : {} : {}),
      [key]: !state.panels[key],
    } })),
    setRightTab: (rightTab) => set({ rightTab }),
    setLeftTab: (leftTab) => set({ leftTab }),
    requestCamera: (cameraMode) => set((state) => ({
      cameraMode,
      cameraRequest: state.cameraRequest + 1,
    })),
    setGizmoMode: (gizmoMode) => {
      if (playbackLocked()) return;
      set({ gizmoMode });
    },
    requestStep: () => set((state) => ({ stepRequest: state.stepRequest + 1 })),
    undo: () => {
      if (playbackLocked()) return;
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
      if (playbackLocked()) return;
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

function normalizeObjectPatch(obj: SceneObject, patch: Partial<SceneObject>): SceneObject {
  const next = { ...obj, ...patch } as SceneObject;
  next.name = next.name.trim() || obj.name.trim() || obj.kind;
  if (next.kind === 'particle' && next.dynamics) {
    const p = patch as Partial<typeof next>;
    // Top-level particle fields are canonical; body edits update both representations.
    if (p.dynamics && p.mass === undefined) next.mass = p.dynamics.mass;
    if (p.dynamics && p.velocity === undefined) next.velocity = [...p.dynamics.velocity];
    next.dynamics = { ...next.dynamics, mass: next.mass, velocity: [...next.velocity] };
  }
  return next;
}

export function presetList() {
  return PRESETS;
}
