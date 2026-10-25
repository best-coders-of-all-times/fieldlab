import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../app/store';
import { Icon } from './Icon';

const COLORS = ['#5eead4', '#ff77d2', '#ffc266', '#6ea8ff', '#a0f06a', '#ff8b6b'];

export function ChartDrawer() {
  const chart = useAppStore((s) => s.chart);
  const scene = useAppStore((s) => s.scene);
  const togglePanel = useAppStore((s) => s.togglePanel);
  const clearChart = useAppStore((s) => s.clearChart);
  const playbackMode = useAppStore((s) => s.playback.mode);
  const time = useAppStore((s) => s.time);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const labels = chart.series.map((series) => {
    const [id, comp] = series.split(':');
    const obj = scene.objects.find((o) => o.id === id);
    return `${obj?.name ?? (id.startsWith('external') ? 'probe' : 'probe')} ${comp ?? ''}`.trim();
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const padL = 52, padR = 12, padT = 12, padB = 22;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;

      ctx.strokeStyle = '#182433';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = padT + (plotH * i) / 4;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + plotW, y);
        ctx.stroke();
      }

      if (chart.points.length < 2) {
        ctx.fillStyle = '#708198';
        ctx.font = '11px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Play a wave, particle or induction scene to record a time series.', padL + plotW / 2, padT + plotH / 2);
        return;
      }

      const t0 = chart.points[0].t;
      const t1 = chart.points[chart.points.length - 1].t;
      const dt = Math.max(t1 - t0, 1e-30);
      let min = Infinity;
      let max = -Infinity;
      for (const pt of chart.points) {
        for (const series of chart.series) {
          const v = pt.values[series];
          if (v === undefined || !Number.isFinite(v)) continue;
          min = Math.min(min, v);
          max = Math.max(max, v);
        }
      }
      if (!Number.isFinite(min) || !Number.isFinite(max)) return;
      if (max - min < 1e-30) { max = min + 1; }
      const margin = (max - min) * 0.08;
      min -= margin;
      max += margin;

      const xOf = (t: number) => padL + ((t - t0) / dt) * plotW;
      const yOf = (v: number) => padT + (1 - (v - min) / (max - min)) * plotH;

      ctx.fillStyle = '#708198';
      ctx.font = '9px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let i = 0; i <= 4; i++) {
        const v = max - ((max - min) * i) / 4;
        const y = padT + (plotH * i) / 4;
        ctx.fillText(formatAxis(v), padL - 7, y);
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      for (let i = 0; i <= 4; i++) {
        const t = t0 + (dt * i) / 4;
        const x = padL + (plotW * i) / 4;
        ctx.fillText(formatTimeAxis(t), x, h - 5);
      }

      chart.series.forEach((series, index) => {
        ctx.strokeStyle = COLORS[index % COLORS.length];
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        let started = false;
        for (const pt of chart.points) {
          const v = pt.values[series];
          if (v === undefined || !Number.isFinite(v)) continue;
          const x = xOf(pt.t);
          const y = yOf(v);
          if (!started) { ctx.moveTo(x, y); started = true; }
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });

      if (playbackMode === 'cached' && time >= t0 && time <= t1) {
        const x = xOf(time);
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 209, 102, 0.9)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + plotH);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = '#ffd166';
        ctx.font = '9px "JetBrains Mono", ui-monospace, monospace';
        ctx.textAlign = x > padL + plotW - 52 ? 'right' : 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(formatTimeAxis(time), x + (ctx.textAlign === 'right' ? -4 : 4), padT + 2);
      }
    };
    draw();
    const obs = new ResizeObserver(draw);
    obs.observe(wrap);
    return () => obs.disconnect();
  }, [chart, playbackMode, time]);

  return (
    <div className="chart-drawer">
      <div className="chart-head">
        <span className="chart-title"><Icon name="chart" size={14} /> Probe oscilloscope</span>
        <span className="chart-meta">{chart.points.length} samples</span>
        <span className="top-spacer" />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {chart.series.map((series, i) => (
            <span key={series} style={{ fontSize: 10, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: COLORS[i % COLORS.length] }} />
              {labels[i]}
            </span>
          ))}
        </div>
        <button className="icon-btn" onClick={clearChart} title="Clear samples"><Icon name="reset" size={14} /></button>
        <button className="icon-btn" onClick={() => togglePanel('chart')} title="Close"><Icon name="close" size={14} /></button>
      </div>
      <div className="chart-body" ref={wrapRef}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

function formatAxis(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e3 || a < 1e-3) return v.toExponential(1);
  return v.toPrecision(3);
}

function formatTimeAxis(t: number): string {
  if (Math.abs(t) < 1e-6) return `${(t * 1e9).toFixed(1)} ns`;
  if (Math.abs(t) < 1e-3) return `${(t * 1e6).toFixed(2)} µs`;
  return `${(t * 1e3).toFixed(2)} ms`;
}
