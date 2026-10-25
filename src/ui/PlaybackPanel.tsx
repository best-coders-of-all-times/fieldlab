import React, { useMemo } from 'react';
import { useAppStore } from '../app/store';
import { defaultPlayback } from '../scene/defaults';
import { formatSci } from '../engine/units';
import {
  planPlaybackSamples,
  type PlaybackPlan,
} from '../engine/maxwell/playbackSchedule';
import {
  PLAYBACK_CACHE_LIMIT_BYTES,
  PLAYBACK_CACHE_WARN_BYTES,
  estimateCacheBytes,
} from '../engine/maxwell/playbackPayload';
import { Button, CheckRow, Field, NumberInput, PanelSection, Segmented, Slider } from './controls';
import { Icon } from './Icon';
import { isProbe } from '../scene/types';
import type { PlaybackFps } from '../scene/types';

const FPS_OPTIONS: PlaybackFps[] = [12, 24, 30, 60];

function mib(bytes: number): string {
  return `${(bytes / 1024 ** 2).toFixed(bytes >= 10 * 1024 ** 2 ? 1 : 2)} MiB`;
}

function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 0.001) return `${(seconds * 1e6).toFixed(0)} µs`;
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)} ms`;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

function rateLabel(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '—';
  return `${rate >= 1000 ? Math.round(rate).toLocaleString('en-US') : rate.toFixed(1)} steps/s`;
}

export function PlaybackPanel() {
  const scene = useAppStore((s) => s.scene);
  const playback = useAppStore((s) => s.playback);
  const meta = useAppStore((s) => s.fdtdMeta);
  const status = useAppStore((s) => s.status);
  const measurements = useAppStore((s) => s.measurements);
  const updatePlaybackSettings = useAppStore((s) => s.updatePlaybackSettings);
  const requestPrecompute = useAppStore((s) => s.requestPrecompute);
  const cancelPlayback = useAppStore((s) => s.cancelPlayback);
  const exitPlayback = useAppStore((s) => s.exitPlayback);
  const requestPlaybackSeek = useAppStore((s) => s.requestPlaybackSeek);

  const settings = scene.simulation.playback ?? defaultPlayback();
  const locked = playback.mode !== 'idle';
  const computing = playback.mode === 'computing';
  const cached = playback.mode === 'cached';

  let plan: PlaybackPlan | null = null;
  let planError: string | null = null;
  if (meta) {
    try {
      plan = planPlaybackSamples(settings, meta.dt);
    } catch (err) {
      planError = err instanceof Error ? err.message : String(err);
    }
  }

  const probeCount = scene.objects.filter((object) => isProbe(object) && object.visible).length;
  const transformCount = scene.objects.filter((object) => object.visible).length;
  const estimatedBytes = useMemo(
    () => (meta && plan
      ? estimateCacheBytes(scene.display, meta, plan.sampleSteps.length, {
        probes: probeCount,
        transforms: transformCount,
      })
      : 0),
    [meta, plan, scene.display, probeCount, transformCount],
  );

  const measuredRate = computing
    ? playback.stepsPerSecond
    : measurements.extra?.stepsPerSecond ?? playback.stepsPerSecond;
  const estimatedSteppingSeconds = plan && measuredRate > 0
    ? plan.totalSteps / measuredRate
    : undefined;
  const overWarn = estimatedBytes > PLAYBACK_CACHE_WARN_BYTES;
  const overLimit = estimatedBytes > PLAYBACK_CACHE_LIMIT_BYTES;
  const requestedCount = Math.floor(settings.sampleCount);
  const actualCount = plan?.sampleSteps.length ?? 0;
  const clamped = plan !== null && actualCount !== requestedCount;
  const canStart = Boolean(meta && plan && !planError && !overLimit) && status.phase !== 'solving';
  const progress = playback.totalSteps > 0
    ? Math.max(0, Math.min(1, playback.steps / playback.totalSteps))
    : 0;
  const sampleTime = cached
    ? playback.sampleTimes[playback.frameIndex] ?? playback.startTime
    : playback.startTime;

  return (
    <PanelSection title="Cached playback" right={
      cached ? <span className="playback-badge">cached</span>
        : computing ? <span className="playback-badge computing">computing</span>
          : undefined
    }>
      <div className="note">
        A session-only slideshow of real full-Maxwell samples. Precompute always
        starts at t = 0, steps to the authored window, and stores reduced display
        frames. It does not interpolate physics or save the solver state.
      </div>
      <div className="note warn">
        Starting precompute replaces the current live run. Return to live restarts
        at t = 0; it does not resume the pre-cache playhead.
      </div>

      <div className="playback-range">
        <Field label="Start physical time" hint="Window start in seconds. The solver still computes from t = 0.">
          <NumberInput
            value={settings.startTime}
            min={0}
            step={meta?.dt ?? 1e-9}
            unit="s"
            disabled={locked}
            onChange={(startTime) => updatePlaybackSettings({ startTime })}
          />
        </Field>
        <Field label="End physical time" hint="Window end in seconds.">
          <NumberInput
            value={settings.endTime}
            min={settings.startTime}
            step={meta?.dt ?? 1e-9}
            unit="s"
            disabled={locked}
            onChange={(endTime) => updatePlaybackSettings({ endTime })}
          />
        </Field>
      </div>

      <Field label="Sample plan">
        <Segmented
          value={settings.sampleMode}
          options={[
            { value: 'count', label: 'Frame count' },
            { value: 'interval', label: 'Sample interval' },
          ]}
          onChange={(sampleMode) => updatePlaybackSettings({ sampleMode })}
          disabled={locked}
        />
      </Field>
      {settings.sampleMode === 'count' ? (
        <Field label="Frames" hint="2 to 1200. Coarse grids may clamp this to the number of distinct grid steps.">
          <NumberInput
            value={settings.sampleCount}
            min={2}
            max={1200}
            step={1}
            disabled={locked}
            onChange={(sampleCount) => updatePlaybackSettings({ sampleCount: Math.round(sampleCount) })}
          />
        </Field>
      ) : (
        <Field label="Sample interval" hint="Physical seconds between cached samples.">
          <NumberInput
            value={settings.sampleInterval}
            min={meta?.dt ?? 1e-12}
            step={meta?.dt ?? 1e-12}
            unit="s"
            disabled={locked}
            onChange={(sampleInterval) => updatePlaybackSettings({ sampleInterval })}
          />
        </Field>
      )}

      <Field label="Playback rate" hint="Display frames per wall second, independent of physical time.">
        <Segmented
          value={String(settings.fps)}
          options={FPS_OPTIONS.map((fps) => ({ value: String(fps), label: `${fps} fps` }))}
          onChange={(value) => updatePlaybackSettings({ fps: Number(value) as PlaybackFps })}
        />
      </Field>
      <CheckRow label="Loop cached playback" checked={settings.loop} onChange={(loop) => updatePlaybackSettings({ loop })} />

      {!meta && <div className="note">Waiting for full-Maxwell solver metadata.</div>}
      {planError && <div className="note warn" role="alert">{planError}</div>}
      {plan && <>
        <div className="stat-line"><span>Grid window</span><b>{formatSci(plan.sampleTimes[0], 4)} → {formatSci(plan.sampleTimes.at(-1) ?? plan.endStep * plan.dt, 4)} s</b></div>
        <div className="stat-line"><span>Cached frames</span><b>{actualCount}{clamped ? ` (clamped from ${requestedCount})` : ''}</b></div>
        <div className="stat-line"><span>Physical steps from t = 0</span><b>{plan.totalSteps.toLocaleString('en-US')}</b></div>
        <div className="stat-line"><span>Estimated payload</span><b className={overLimit ? 'danger-text' : overWarn ? 'warn-text' : ''}>{mib(estimatedBytes)}</b></div>
        <div className="stat-line"><span>Estimated stepping time</span><b>{estimatedSteppingSeconds === undefined ? '—' : duration(estimatedSteppingSeconds)}</b></div>
        <div className="stat-line"><span>Current rate</span><b>{rateLabel(measuredRate)}</b></div>
        {plan.warmupSteps > 0 && <div className="note">The first {plan.warmupSteps.toLocaleString('en-US')} warm-up steps are computed but not displayed. The cached chart starts at the window boundary.</div>}
        {overWarn && !overLimit && <div className="note warn">The estimated reduced-frame payload is above 192 MiB. Payload bytes exclude solver memory, rendering geometry and GPU memory. The hard limit is 256 MiB.</div>}
        {overLimit && <div className="note warn" role="alert">The estimated reduced-frame payload exceeds the 256 MiB cache limit. Reduce frames, resolution or display sampling.</div>}
      </>}

      {playback.mode === 'idle' && (
        <Button
          variant="primary"
          disabled={!canStart || Boolean(planError)}
          onClick={requestPrecompute}
          title={canStart ? 'Compute and cache the authored window' : 'Wait for the solver and a valid plan'}
        >
          <Icon name="play" size={13} /> Precompute cached window
        </Button>
      )}

      {computing && <>
        <div className="playback-progress" aria-label="Precompute progress">
          <div className="playback-progress-track"><div style={{ width: `${progress * 100}%` }} /></div>
          <div className="playback-progress-meta">
            <span>{playback.phase === 'warmup' ? 'Warming up from t = 0' : 'Sampling frames'}</span>
            <b>{Math.round(progress * 100)}%</b>
          </div>
        </div>
        <div className="stat-line"><span>Steps</span><b>{playback.steps.toLocaleString('en-US')} / {playback.totalSteps.toLocaleString('en-US')}</b></div>
        <div className="stat-line"><span>Frames</span><b>{playback.framesDone} / {playback.totalFrames}</b></div>
        <div className="stat-line"><span>Elapsed</span><b>{duration(playback.elapsedMs / 1000)}</b></div>
        <div className="stat-line"><span>Payload so far</span><b>{mib(playback.bytes)}</b></div>
        <div className="stat-line"><span>Measured rate</span><b>{rateLabel(playback.stepsPerSecond)}</b></div>
        <Button variant="danger" onClick={cancelPlayback}>
          <Icon name="close" size={13} /> Cancel precompute
        </Button>
      </>}

      {cached && <>
        <div className="playback-scrub">
          <Slider
            value={playback.frameIndex}
            min={0}
            max={Math.max(0, playback.frameCount - 1)}
            step={1}
            format={(value) => `${Math.round(value) + 1} / ${playback.frameCount}`}
            onChange={(value) => requestPlaybackSeek(Math.round(value))}
          />
        </div>
        <div className="stat-line"><span>Exact sample time</span><b>{formatSci(sampleTime, 5)} s</b></div>
        <div className="stat-line"><span>Loop</span><b>{playback.loop ? 'on' : 'off'}</b></div>
        <div className="stat-line"><span>Cached payload</span><b>{mib(playback.bytes)}</b></div>
        <div className="btn-row">
          <Button variant="soft" onClick={requestPrecompute} title="Discard this cache and recompute the authored window">
            <Icon name="reset" size={13} /> Recompute
          </Button>
          <Button onClick={exitPlayback}>
            Return to live
          </Button>
        </div>
        <div className="note">Playback frames are not physics snapshots. Objects and field settings are locked; only camera navigation and the transport remain active.</div>
      </>}
    </PanelSection>
  );
}
