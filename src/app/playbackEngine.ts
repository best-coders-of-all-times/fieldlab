export interface PlaybackEngineCallbacks {
  emitFrame(index: number): void;
  onState(patch: { frameIndex: number; playing: boolean }): void;
  now(): number;
  requestFrame(cb: (time: number) => void): number;
  cancelFrame(id: number): void;
}

export interface PlaybackEngineOptions {
  fps: number;
  loop: boolean;
}

export interface PlaybackEngineState {
  frameIndex: number;
  playing: boolean;
}

const MAX_DELTA_MS = 250;

/**
 * Wall-clock slideshow over cached reduced frames. It never advances physics:
 * fps counts cached display frames per wall second, independent of the
 * physical interval between samples.
 */
export class PlaybackEngine {
  private frameIndex = 0;
  private playing = false;
  private accumulator = 0;
  private lastNow = 0;
  private rafId = 0;
  private fps: number;
  private loop: boolean;

  constructor(
    private readonly frameCount: number,
    private readonly callbacks: PlaybackEngineCallbacks,
    options: PlaybackEngineOptions,
  ) {
    this.fps = this.sanitizeFps(options.fps);
    this.loop = options.loop;
  }

  get state(): PlaybackEngineState {
    return { frameIndex: this.frameIndex, playing: this.playing };
  }

  get options(): PlaybackEngineOptions {
    return { fps: this.fps, loop: this.loop };
  }

  start(index: number, playing: boolean): void {
    this.frameIndex = this.clamp(index);
    this.accumulator = 0;
    this.lastNow = this.callbacks.now();
    this.emit();
    if (playing) this.setPlaying(true);
    else this.pauseClock(true);
  }

  setPlaying(playing: boolean): void {
    if (this.frameCount === 0) return;
    if (!playing) {
      if (!this.playing) return;
      this.playing = false;
      this.pauseClock(true);
      return;
    }
    if (!this.loop && this.frameIndex >= this.frameCount - 1) {
      this.frameIndex = 0;
      this.emit();
    }
    if (this.playing) return;
    this.playing = true;
    this.accumulator = 0;
    this.lastNow = this.callbacks.now();
    this.callbacks.onState({ frameIndex: this.frameIndex, playing: true });
    this.schedule();
  }

  seek(index: number): void {
    this.frameIndex = this.clamp(index);
    this.accumulator = 0;
    this.lastNow = this.callbacks.now();
    this.emit();
    if (this.playing) this.schedule();
  }

  step(delta: number): void {
    const wasPlaying = this.playing;
    this.playing = false;
    if (wasPlaying) this.pauseClock(false);
    const step = delta >= 0 ? Math.max(1, Math.floor(delta)) : Math.min(-1, Math.ceil(delta));
    this.frameIndex = this.clamp(this.frameIndex + step);
    this.accumulator = 0;
    this.emit();
  }

  setOptions(options: Partial<PlaybackEngineOptions>): void {
    if (options.fps !== undefined && Number.isFinite(options.fps)) {
      const fps = this.sanitizeFps(options.fps);
      if (fps !== this.fps) {
        this.fps = fps;
        this.accumulator = 0;
        this.lastNow = this.callbacks.now();
      }
    }
    if (options.loop !== undefined && options.loop !== this.loop) {
      this.loop = options.loop;
      if (!this.loop && this.frameIndex >= this.frameCount - 1 && this.playing) {
        this.playing = false;
        this.pauseClock(true);
      }
    }
  }

  stop(): void {
    this.playing = false;
    this.accumulator = 0;
    this.pauseClock(false);
  }

  private clamp(index: number): number {
    if (!Number.isFinite(index) || this.frameCount === 0) return 0;
    return Math.max(0, Math.min(this.frameCount - 1, Math.floor(index)));
  }

  private sanitizeFps(fps: number): number {
    return Number.isFinite(fps) && fps > 0 ? fps : 30;
  }

  private schedule(): void {
    if (!this.playing || this.rafId) return;
    this.rafId = this.callbacks.requestFrame(this.tick);
  }

  private pauseClock(emitState: boolean): void {
    if (this.rafId) {
      this.callbacks.cancelFrame(this.rafId);
      this.rafId = 0;
    }
    this.accumulator = 0;
    if (emitState) this.callbacks.onState({ frameIndex: this.frameIndex, playing: false });
  }

  private emit(): void {
    this.callbacks.emitFrame(this.frameIndex);
    this.callbacks.onState({ frameIndex: this.frameIndex, playing: this.playing });
  }

  private tick = (time: number): void => {
    this.rafId = 0;
    if (!this.playing) return;
    const now = Number.isFinite(time) ? time : this.callbacks.now();
    const delta = Math.max(0, Math.min(MAX_DELTA_MS, now - this.lastNow));
    this.lastNow = now;
    this.accumulator += delta;
    const frameMs = 1000 / this.fps;
    if (this.accumulator + 1e-9 < frameMs) {
      this.schedule();
      return;
    }
    const skipped = Math.floor(this.accumulator / frameMs);
    this.accumulator = Math.max(0, this.accumulator - skipped * frameMs);
    let next = this.frameIndex + skipped;
    if (next >= this.frameCount) {
      if (this.loop) {
        next %= this.frameCount;
      } else {
        next = this.frameCount - 1;
        this.frameIndex = next;
        this.playing = false;
        this.accumulator = 0;
        this.emit();
        this.pauseClock(true);
        return;
      }
    }
    this.frameIndex = this.clamp(next);
    this.emit();
    this.schedule();
  };
}
