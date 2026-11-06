// Pulse engine: a pure stepper, one cycle per call (D4). All change goes through
// morphStep (one note per stage) with a dwell per layer, so nothing jumps (D5).
import type { NoteEvent } from '../../runtime/types';
import { applyDevices } from './devices';
import { accentStarts, type Piece, type Targets } from './model';
import { morphStep } from './morph';
import { midi, shift, stepToward, type Cell, type KeySig, type Step } from './theory';

type Layer = 'key' | 'pulse' | 'breath' | 'pattern' | 'canon' | 'doubling' | 'accents';

export type PulseState = {
  cycle: number;
  key: KeySig;
  chordIndex: number;
  cycleInChord: number;
  chord: Cell[]; // sounding voicing, voice-led one voice per cycle
  bass: Step;
  pulseVoices: number;
  breathDepth: number;
  breathPos: number; // free-running, in pulses
  breathLen: number;
  pattern: Cell[];
  canon: Cell[];
  canonOffset: number;
  doubling: Cell[];
  accents: boolean[];
  tempo: number; // sounding pulses per minute, moving towards Targets.tempo
  lastChange: Record<Layer, number>;
  rng: number;
};

export function initialState(piece: Piece, seed: number): PulseState {
  const L = piece.cycleLength;
  const first = piece.chords[0]!;
  const never = -1e9;
  return {
    cycle: 0, key: piece.key, chordIndex: 0, cycleInChord: 0,
    chord: [...first.voices], bass: first.bass,
    pulseVoices: 0, breathDepth: 0, breathPos: 0, breathLen: 40,
    pattern: Array(L).fill(null), canon: Array(L).fill(null), canonOffset: 3, doubling: Array(L).fill(null),
    accents: Array(L).fill(false),
    tempo: piece.pulsesPerMinute,
    lastChange: { key: never, pulse: never, breath: never, pattern: never, canon: never, doubling: never, accents: never },
    rng: seed >>> 0,
  };
}

/** mulberry32: pure, so the state carries the seed. */
function random(seed: number): [number, number] {
  const next = (seed + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

const fullOrder = (order: number[], length: number) =>
  [...order.filter((i) => i < length), ...Array.from({ length }, (_, i) => i).filter((i) => !order.includes(i))];

/** Keep only the first `share` of the notes, counted in build order. */
function mask(cells: Cell[], order: number[], share: number): Cell[] {
  const notes = order.filter((i) => cells[i]);
  const keep = new Set(notes.slice(0, Math.round(share * notes.length)));
  return cells.map((c, i) => (keep.has(i) ? c : null));
}

/** Additions follow the composed order, removals the reverse (strip-down). */
function morphLayer(current: Cell[], goal: Cell[], order: number[]): Cell[] {
  const growing = goal.filter(Boolean).length >= current.filter(Boolean).length;
  return morphStep(current, goal, growing ? order : [...order].reverse());
}

const toward = (n: number, target: number) => n + Math.sign(target - n);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Tempo moves at most this share per cycle: accelerando and ritardando are gradual, never a jump. */
const TEMPO_STEP = 0.005;

export function step(state: PulseState, piece: Piece, targets: Targets): { events: NoteEvent[]; state: PulseState; pulsesPerMinute: number } {
  const L = piece.cycleLength;
  const order = fullOrder(piece.buildOrder, L);
  const st: PulseState = { ...state, lastChange: { ...state.lastChange } };

  // Sections: the dwell on one chord.
  if (st.cycleInChord >= targets.chordDwell) {
    st.chordIndex = (st.chordIndex + 1) % piece.chords.length;
    st.cycleInChord = 0;
    st.bass = piece.chords[st.chordIndex]!.bass;
  }
  const atBoundary = st.cycleInChord === 0;

  // Voice leading: one voice per cycle, smallest moves first.
  const goalChord = piece.chords[st.chordIndex]!.voices;
  const moveOrder = st.chord
    .map((c, i) => ({ i, d: c && goalChord[i] ? Math.abs(midi(c, st.key) - midi(goalChord[i]!, st.key)) : 99 }))
    .sort((a, b) => a.d - b.d).map((x) => x.i);
  const voiced = morphStep(st.chord, goalChord, moveOrder);
  // A chord voice move or a key step is the only change in its cycle: it already moves notes in every layer that uses them.
  let quiet = voiced !== st.chord;
  st.chord = voiced;

  // Pace under a bar (stageDwell 1/4 or 1/2): several one-note stages in the same cycle, one per fraction of the bar.
  const stages = targets.stageDwell < 1 ? Math.round(1 / targets.stageDwell) : 1;
  const change = (layer: Layer, apply: () => boolean, times = stages) => {
    if (quiet || st.cycle - st.lastChange[layer] < targets.stageDwell) return;
    for (let k = 0; k < times && apply(); k++) st.lastChange[layer] = st.cycle;
  };
  const changed = <T,>(before: T, after: T) => before !== after;

  change('key', () => changed(st.key, (st.key = stepToward(st.key, targets.key))), 1); // one fifth per bar at most
  quiet ||= st.lastChange.key === st.cycle;
  change('pulse', () => changed(st.pulseVoices, (st.pulseVoices = toward(st.pulseVoices, clamp(targets.pulseVoices, 0, st.chord.length)))));
  change('breath', () => changed(st.breathDepth, (st.breathDepth = toward(st.breathDepth, clamp(targets.breath, 0, st.chord.length)))));

  const goal = mask(applyDevices(piece.pattern, targets.devices), order, clamp(targets.density, 0, 1));
  change('pattern', () => changed(st.pattern, (st.pattern = morphLayer(st.pattern, goal, order))));

  // Canon: an offset change strips the canon, then rebuilds it at a section boundary.
  const canonEmpty = st.canon.every((c) => c === null);
  if (targets.canon.on && targets.canon.offset !== st.canonOffset && canonEmpty && atBoundary) st.canonOffset = targets.canon.offset;
  const canonGoal = targets.canon.on && targets.canon.offset === st.canonOffset
    ? goal.map((c) => c && shift(c, targets.canon.interval))
    : Array<Cell>(L).fill(null);
  change('canon', () => changed(st.canon, (st.canon = morphLayer(st.canon, canonGoal, order))));

  const doublingGoal = mask(st.pattern, order, clamp(targets.doubling, 0, 1)).map((c) => c && shift(c, -2));
  change('doubling', () => changed(st.doubling, (st.doubling = morphLayer(st.doubling, doublingGoal, order))));

  const accentGoal = accentStarts(targets, L);
  change('accents', () => changed(st.accents, (st.accents = morphStep(st.accents, accentGoal, order, (a, b) => a === b))));

  // Render the cycle. Each layer's velocities stay inside one smplr velocity band (41-67 or 68-84), jitter included.
  const events: NoteEvent[] = [];
  const voices = st.chord.filter((c): c is Step => c !== null).sort((a, b) => midi(a, st.key) - midi(b, st.key));
  const note = (pulse: number, cell: Cell, velocity: number, duration: number, layer: string) => {
    if (cell) events.push({ pulse, midi: midi(cell, st.key), velocity, duration, layer });
  };
  for (let p = 0; p < L; p++) {
    const pulse = st.cycle * L + p;
    const accent = st.accents[p] ? 1 : 0;

    for (const v of voices.slice(0, st.pulseVoices)) note(pulse, v, 54 + 6 * accent, 0.9, 'pulse');
    if (p === 0 || p === L / 2) note(pulse, st.bass, 60, L / 2, 'bass');
    note(pulse, st.pattern[p] ?? null, 72 + 8 * accent, 1.5, 'pattern');
    note(pulse, st.canon[(p - st.canonOffset + L) % L] ?? null, 72 + 6 * accent, 1.5, 'canon');
    note(pulse, st.doubling[p] ?? null, 58 + 4 * accent, 1.5, 'doubling');

    // Breath: a doubling an octave below the pulse that swells by adding notes.
    const swell = Math.max(0, Math.sin((Math.PI * st.breathPos) / st.breathLen));
    for (const v of voices.slice(0, Math.round(swell * st.breathDepth))) note(pulse, shift(v, -7), 44 + Math.round(18 * swell), 1, 'breath');
    if (++st.breathPos >= st.breathLen) {
      const [r, rng] = random(st.rng);
      st.rng = rng;
      st.breathPos = 0;
      st.breathLen = 32 + Math.floor(r * 24); // 5-9 s at 6 pulses/s, each breath its own length
    }
  }

  // Tempo: this cycle plays at the current tempo; the next one is a little closer to the target.
  const tempo = st.tempo ?? piece.pulsesPerMinute;
  const goalTempo = targets.tempo ?? piece.pulsesPerMinute;
  const nextTempo = tempo + clamp(goalTempo - tempo, -tempo * TEMPO_STEP, tempo * TEMPO_STEP);
  return { events, state: { ...st, tempo: nextTempo, cycle: st.cycle + 1, cycleInChord: st.cycleInChord + 1 }, pulsesPerMinute: tempo };
}
