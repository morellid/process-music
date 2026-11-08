// The whole piece is composed before it plays (D6): compose() turns a Spec into every note, in units.
// Pitches are diatonic indices (letter steps from C-1); the key signature decides accidentals at render time.
import { fromIndex, LETTERS, midi, type KeySig } from '../../runtime/theory';
import type { NoteEvent } from '../../runtime/types';
import { CANONS, MODE_CYCLES, PROCESSES, T_VOICES, type Mode, type Process, type Spec, type TVoice } from './model';

export function phraseLengths({ kind, n }: Process): number[] {
  const up = Array.from({ length: n }, (_, i) => i + 1);
  if (kind === 'subtractive') return up.reverse();
  if (kind === 'arch') return [...up, ...up.slice(0, -1).reverse()];
  if (kind === 'fixed') return Array(n).fill(n);
  return up;
}

/** One M-voice phrase of `length` notes around `centre`, stepwise. Modes 1 and 3 leave the centre, 2 and 4 arrive at it. */
export function mPhrase(centre: number, mode: Mode, length: number): number[] {
  return Array.from({ length }, (_, i) => {
    if (mode === 1) return centre + i;
    if (mode === 2) return centre + length - 1 - i;
    if (mode === 3) return centre - i;
    return centre - (length - 1) + i;
  });
}

/** Letter (0..6) of the tonic: the major key signature's tonic moves by a fifth (4 letters) per sharp; minor is 5 letters up (C -> A). */
export const tonicLetter = (key: KeySig, minor: boolean) => (((4 * key + (minor ? 5 : 0)) % 7) + 7) % 7;

export const inTriad = (i: number, tonic: number) => [0, 2, 4].includes((((i - tonic) % 7) + 7) % 7);

/** The T note for M note `m`: the `position`-th triad note above or below, never the unison. `j` is the note's place in its phrase (for alternating). */
export function tNote(m: number, tonic: number, t: TVoice, j: number): number {
  const dir = t.side === 'superior' || (t.side === 'alternating' && j % 2 === 0) ? 1 : -1;
  let i = m;
  for (let found = 0; found < t.position; ) if (inTriad((i += dir), tonic)) found++;
  return i;
}

export type Composition = { spec: Spec; events: NoteEvent[]; length: number };

const FINAL_HOLD = 8; // units the closing chord rings

/**
 * One line (phrases of equal notes, the phrase-final note doubled, a breath after each phrase) is played by
 * every canon voice at its own speed: speed s makes every value s times longer, and faster voices repeat the
 * line so that all voices finish their last repetition together. A tutti tonic chord closes the piece.
 */
export function compose(spec: Spec): Composition {
  const line: { at: number; dur: number; m: number; j: number }[] = [];
  let unit = 0;
  phraseLengths(spec.process).forEach((len, k) => {
    mPhrase(0, spec.modes[k % spec.modes.length]!, len).forEach((m, j) => {
      const dur = j === len - 1 ? 2 : 1;
      line.push({ at: unit, dur, m, j });
      unit += dur;
    });
    unit += spec.breath;
  });

  const tonic = tonicLetter(spec.key, spec.minor);
  const slowest = Math.max(...spec.speeds);
  const close = unit * slowest - spec.breath; // as the fastest voice's last note ends (the line's trailing breath is dropped)
  const pitch = (i: number) => midi(fromIndex(i), spec.key);
  const events: NoteEvent[] = [];
  // Fastest voice highest, each slower voice an octave lower (as in Cantus).
  [...spec.speeds].sort((a, b) => a - b).forEach((s, v) => {
    const centre = (spec.centreOctave - v) * 7 + tonic;
    const voice = (layer: string, velocity: number, pulse: number, duration: number, i: number) =>
      events.push({ pulse, midi: pitch(i), velocity, duration, layer: `${layer}${v + 1}` });
    for (let r = 0; r < slowest / s; r++) {
      for (const n of line) {
        const pulse = (r * unit + n.at) * s;
        voice('M', 62, pulse, n.dur * s, centre + n.m);
        voice('T', 54, pulse, n.dur * s, tNote(centre + n.m, tonic, spec.t, n.j));
      }
    }
    voice('M', 66, close, FINAL_HOLD, centre);
    voice('T', 58, close, FINAL_HOLD, tNote(centre, tonic, { side: spec.t.side === 'inferior' ? 'inferior' : 'superior', position: spec.t.position }, 0));
  });
  events.sort((a, b) => a.pulse - b.pulse);
  return { spec, events, length: close + FINAL_HOLD };
}

// ---- Random pieces --------------------------------------------------------

/** mulberry32. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLOURS: Spec['instruments'][] = [
  { m: 'piano', t: 'piano' }, { m: 'piano', t: 'piano' },
  { m: 'piano', t: 'vibraphone' }, { m: 'piano', t: 'vibraphone' },
  { m: 'vibraphone', t: 'piano' }, { m: 'marimba', t: 'vibraphone' },
];

/** A random piece; its phrase count is chosen so that it lasts close to a random target of 75-210 seconds. */
export function randomSpec(seed: number): Spec {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const speeds = pick(CANONS);
  const base: Spec = {
    key: Math.floor(r() * 9) - 4,
    minor: r() < 0.7, // Part's tintinnabuli pieces are mostly minor
    centreOctave: speeds.length > 2 ? 5 : pick([4, 5]),
    process: { kind: pick(PROCESSES), n: 3 },
    modes: pick(MODE_CYCLES),
    breath: pick([1, 1, 2]),
    speeds,
    t: pick(T_VOICES),
    instruments: pick(COLOURS),
    unitsPerMinute: 60 + Math.floor(r() * 9) * 5,
  };
  const target = 75 + r() * 135;
  const seconds = (n: number) => (compose({ ...base, process: { ...base.process, n } }).length * 60) / base.unitsPerMinute;
  const n = Array.from({ length: 8 }, (_, i) => i + 3).reduce((best, n) => (Math.abs(seconds(n) - target) < Math.abs(seconds(best) - target) ? n : best));
  return { ...base, process: { ...base.process, n } };
}

// ---- Description ----------------------------------------------------------

export function tonicName(spec: Spec): string {
  const step = { letter: tonicLetter(spec.key, spec.minor), octave: 4 };
  const accidental = midi(step, spec.key) - midi(step, 0);
  return `${LETTERS[step.letter]}${accidental > 0 ? '#' : accidental < 0 ? 'b' : ''} ${spec.minor ? 'minor' : 'major'}`;
}

const ORDINAL = { 1: '1st', 2: '2nd' } as const;

export function describe(spec: Spec, length: number): string {
  const seconds = Math.round((length * 60) / spec.unitsPerMinute);
  const { kind, n } = spec.process;
  const process = kind === 'fixed' ? `${n} phrases of ${n}` : `${kind} ${kind === 'subtractive' ? `${n}..1` : kind === 'arch' ? `1..${n}..1` : `1..${n}`}`;
  return [
    tonicName(spec),
    process,
    `mode ${spec.modes.join(', ')}`,
    `T ${spec.t.side} ${ORDINAL[spec.t.position]}`,
    spec.speeds.length > 1 ? `canon ${spec.speeds.join(':')}` : 'one voice',
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
  ].join(' / ');
}
