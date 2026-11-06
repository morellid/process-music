import type { NoteEvent, Output, ScheduledNote, Source } from './types';

export type Engine<S, P, T> = (state: S, piece: P, targets: T) => { events: NoteEvent[]; state: S };

/** A policy that hears each scheduled cycle and may steer targets or edit the piece (the form director). */
export type Director<S, P, T> = {
  hear(state: S, events: NoteEvent[], targets: T, piece: P): { steer?: Partial<T>; edit?: Partial<P> } | undefined;
};

/** Every change, from any source, timestamped: Piece + decisions + seed reproduce what was heard (D4). */
export type Decision = { cycle: number; at: string; source: Source; kind: 'edit' | 'steer'; patch: unknown; changed: string[] };

/** Which values a patch really changes, one level deep (canon.interval, not just canon). */
function changedPaths(before: object, patch: object): string[] {
  return Object.entries(patch).flatMap(([k, v]) => {
    const old = (before as Record<string, unknown>)[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && old && typeof old === 'object') {
      return Object.entries(v).filter(([sk, sv]) => JSON.stringify((old as Record<string, unknown>)[sk]) !== JSON.stringify(sv)).map(([sk]) => `${k}.${sk}`);
    }
    return JSON.stringify(old) === JSON.stringify(v) ? [] : [k];
  });
}

type Timing = { pulsesPerMinute: number; cycleLength: number };

/**
 * Runs an engine one cycle ahead of the audio clock and schedules its notes in Web Audio time.
 * UI and conductor change music only through edit() and steer(): one command path.
 */
export class Player<S extends { cycle: number }, P extends Timing, T> {
  readonly decisions: Decision[] = [];
  onCycle?: (state: S, targets: T) => void;
  /** Every note as it is scheduled, in audio time (for live views). */
  onNote?: (note: ScheduledNote) => void;
  director?: Director<S, P, T>;
  private nextCycleTime = 0;
  private clock?: Worker;
  private starting?: Promise<void>;
  /** Cycles waiting to be shown, released by audio time (frozen while paused), not by wall-clock timers. */
  private shown: { time: number; state: S; targets: T }[] = [];

  constructor(
    private ctx: AudioContext,
    private output: Output,
    private engine: Engine<S, P, T>,
    public state: S,
    public piece: P,
    public targets: T,
  ) {}

  /** Piece edits: heard from the next cycle. */
  edit(patch: Partial<P>, source: Source) {
    const changed = changedPaths(this.piece, patch);
    this.piece = { ...this.piece, ...patch };
    this.log('edit', patch, source, changed);
  }

  /** Targets: reached gradually by the engine. */
  steer(patch: Partial<T>, source: Source) {
    const changed = changedPaths(this.targets as object, patch);
    this.targets = { ...this.targets, ...patch };
    this.log('steer', patch, source, changed);
  }

  /** A second call while instruments load waits for the same start; it never starts a second clock. */
  start(): Promise<void> {
    if (this.clock) return Promise.resolve();
    this.starting ??= (async () => {
      try {
        await this.ctx.resume();
        await this.output.ready;
        this.nextCycleTime = this.ctx.currentTime + 0.1;
        this.clock = new Worker(new URL('./clock.worker.ts', import.meta.url), { type: 'module' });
        this.clock.onmessage = () => this.tick();
      } finally {
        this.starting = undefined;
      }
    })();
    return this.starting;
  }

  stop() {
    this.clock?.terminate();
    this.clock = undefined;
    this.shown = [];
    this.output.stopAll();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Pause freezes the audio clock: notes already scheduled wait, and resume exactly where they were. */
  /** Returns false when nothing is playing (a pause during start-up waits for the start first). */
  async pause(): Promise<boolean> {
    if (this.starting) await this.starting.catch(() => {});
    if (!this.clock) return false;
    if (this.ctx.state === 'running') await this.ctx.suspend();
    return true;
  }

  async resume() {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  get paused() {
    return this.playing && this.ctx.state === 'suspended';
  }

  get playing() {
    return this.clock !== undefined;
  }

  private log(kind: Decision['kind'], patch: unknown, source: Source, changed: string[]) {
    this.decisions.push({ cycle: this.state.cycle, at: new Date().toISOString(), source, kind, patch, changed });
  }

  private tick() {
    const pulseSec = 60 / this.piece.pulsesPerMinute;
    const cycleSec = pulseSec * this.piece.cycleLength;
    // If the tab was frozen and we fell behind, resume from now rather than burst-play the backlog.
    if (this.nextCycleTime < this.ctx.currentTime) this.nextCycleTime = this.ctx.currentTime + 0.05;
    while (this.shown.length && this.shown[0]!.time <= this.ctx.currentTime) {
      const { state, targets } = this.shown.shift()!;
      this.onCycle?.(state, targets);
    }

    while (this.nextCycleTime < this.ctx.currentTime + cycleSec + 0.2) {
      const startPulse = this.state.cycle * this.piece.cycleLength;
      const { events, state } = this.engine(this.state, this.piece, this.targets);
      for (const e of events) {
        const note = {
          midi: e.midi,
          velocity: e.velocity,
          time: this.nextCycleTime + (e.pulse - startPulse) * pulseSec,
          duration: e.duration * pulseSec,
          layer: e.layer,
        };
        this.output.play(note);
        this.onNote?.(note);
      }
      this.state = state;
      const heard = this.director?.hear(state, events, this.targets, this.piece);
      if (heard?.edit) this.edit(heard.edit, 'form');
      if (heard?.steer && Object.keys(heard.steer).length) this.steer(heard.steer, 'form');
      this.shown.push({ time: this.nextCycleTime, state, targets: this.targets });
      this.nextCycleTime += cycleSec;
    }
  }
}
