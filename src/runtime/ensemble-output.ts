import { Mallet, Reverb, Sampler, Scheduler, SplendidGrandPiano } from 'smplr';
import type { Output, ScheduledNote } from './types';
import { vcslPreset } from './vcsl-crossfade';
import { INSTRUMENTS, type InstrumentName, type Routing } from './routing';

export { ENSEMBLE, INSTRUMENTS, SOLO_PIANO, type InstrumentName, type Routing } from './routing';

type Smplr = Pick<ReturnType<typeof SplendidGrandPiano>, 'start' | 'stop' | 'output'>;
type Loaded = { inst: Smplr; ready: Promise<unknown> };

export const fold = (midi: number, [lo, hi]: readonly [number, number]) => {
  let m = midi;
  while (m < lo) m += 12;
  while (m > hi) m -= 12;
  return m;
};

/**
 * Routes each layer to a sampled instrument. Retriggering a key cuts the previous voice of that key on
 * the same instrument, as a real instrument re-strikes. One shared smplr scheduler with a lookahead
 * longer than the Player's horizon, so every note becomes a Web Audio voice at once and our Worker
 * clock alone decides timing.
 */
export class EnsembleOutput implements Output {
  private scheduler: ReturnType<typeof Scheduler>;
  private reverb: ReturnType<typeof Reverb>;
  private loaded = new Map<InstrumentName, Loaded>();
  private sounding = new Map<string, (time?: number) => void>();
  private request = 0;
  routing: Routing = {};
  ready: Promise<unknown>;

  constructor(private context: AudioContext, private destination: AudioNode, routing: Routing) {
    this.scheduler = Scheduler(context, { lookaheadMs: 10_000 });
    this.reverb = Reverb(context);
    this.ready = this.route(routing);
  }

  /**
   * Change routing once the instruments it needs are loaded: until then the old routing keeps playing
   * (a not-yet-loaded instrument would drop its notes). The last request wins. On failure the old
   * routing stays and the error propagates.
   */
  async route(routing: Routing): Promise<void> {
    const request = ++this.request;
    await Promise.all([...new Set(Object.values(routing))].map((name) => this.instrument(name).ready));
    if (request === this.request) this.routing = routing;
  }

  private instrument(name: InstrumentName): Loaded {
    const existing = this.loaded.get(name);
    if (existing) return existing;
    // Each instrument through its own trim, so the three libraries sit at comparable levels.
    const trim = this.context.createGain();
    trim.gain.value = 10 ** (INSTRUMENTS[name].gainDb / 20);
    trim.connect(this.destination);
    const options = { destination: trim, scheduler: this.scheduler };
    let loaded: Loaded;
    if (name === 'marimba') {
      const inst = Sampler(this.context, { ...options, buffers: {} });
      // Reload only after the initial (empty) load has finished: smplr applies loads in the order they finish,
      // so an empty load landing after the preset left the marimba loaded but silent.
      loaded = {
        inst,
        ready: Promise.all([inst.ready, vcslPreset('Idiophones/Struck Idiophones/Marimba', INSTRUMENTS.marimba.release)])
          .then(([, preset]) => inst.reload(preset)),
      };
    } else {
      const inst = name === 'piano' ? SplendidGrandPiano(this.context, options) : Mallet(this.context, { ...options, instrument: 'Vibraphone - Soft Mallets' });
      loaded = { inst, ready: inst.ready };
    }
    loaded.inst.output.addEffect('reverb', this.reverb, name === 'piano' ? 0.15 : 0.25);
    loaded.ready = loaded.ready.catch((error: unknown) => {
      this.loaded.delete(name); // allow a retry
      throw error;
    });
    this.loaded.set(name, loaded);
    return loaded;
  }

  play({ midi, velocity, time, duration, layer }: ScheduledNote) {
    const name = this.routing[layer] ?? 'piano';
    const note = fold(midi, INSTRUMENTS[name].range);
    const key = `${name}:${note}`;
    this.sounding.get(key)?.(time);
    // Humanise: identical retriggers are what sounds mechanical. +-3 keeps each layer inside its velocity band.
    const jitterVelocity = Math.round((Math.random() - 0.5) * 6);
    const jitterTime = (Math.random() - 0.5) * 0.008;
    const ampRelease = INSTRUMENTS[name].release;
    const stop = this.instrument(name).inst.start({
      note, velocity: velocity + jitterVelocity, time: time + jitterTime, duration, ...(ampRelease ? { ampRelease } : {}),
    });
    this.sounding.set(key, stop);
  }

  /** Cuts sounding voices and those already scheduled for the future. */
  stopAll() {
    this.scheduler.stop();
    for (const { inst } of this.loaded.values()) inst.stop();
    this.sounding.clear();
  }
}
