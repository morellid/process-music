import { ENSEMBLE, type Routing } from '../../runtime/routing';
import type { Device } from './devices';
import type { Cell, KeySig, Step } from '../../runtime/theory';

export type Chord = { voices: Step[]; bass: Step };

/** What the composer wrote. Edits apply at the next cycle. */
export type Piece = {
  pulsesPerMinute: number; // starting tempo; the sounding tempo follows Targets.tempo gradually
  cycleLength: number;
  key: KeySig; // starting key
  chords: Chord[]; // the cycle, voicings inside the collection
  pattern: Cell[]; // letters + octaves, never chord-relative
  buildOrder: number[]; // composed order in which pattern notes appear
};

/** What the UI or the conductor steers. Reached gradually, one note per stage. */
export type Targets = {
  density: number; // 0..1 share of pattern notes built up
  pulseVoices: number; // chord tones in the steady pulse
  breath: number; // notes added at the top of each breath swell
  doubling: number; // 0..1 share of pattern notes doubled a 3rd below
  canon: { on: boolean; offset: number; interval: number }; // offset in pulses, interval in diatonic steps
  key: KeySig;
  grouping: 2 | 3 | 4 | 6; // accent regrouping of the cycle
  accentGroups?: number[]; // additive accents (e.g. 3+3+2+2+2, summing to the cycle); when set, overrides grouping
  tempo: number; // pulses per minute (3 pulses = one quarter: 360 = 120 bpm), reached gradually
  devices: Device[];
  chordDwell: number; // cycles per chord (section length)
  stageDwell: number; // bars (cycles) each stage holds before the next note changes; 1/4 and 1/2 = several stages per bar
  orchestration: Routing; // instrument per layer: part of the form (D5b), applied by the output
};

const s = (letter: number, octave: number): Step => ({ letter, octave });
const [C, D, E, F, G, A, B] = [0, 1, 2, 3, 4, 5, 6] as const;

export const defaultPiece: Piece = {
  pulsesPerMinute: 360,
  cycleLength: 12,
  key: 3, // A major / F# minor, the collection of Music for 18 Musicians
  chords: [
    { bass: s(F, 2), voices: [s(C, 4), s(E, 4), s(A, 4), s(B, 4)] },
    { bass: s(D, 2), voices: [s(D, 4), s(E, 4), s(A, 4), s(B, 4)] },
    { bass: s(E, 2), voices: [s(C, 4), s(E, 4), s(G, 4), s(B, 4)] },
    { bass: s(A, 1), voices: [s(C, 4), s(E, 4), s(A, 4), s(C, 5)] },
  ],
  pattern: [s(E, 5), s(F, 5), null, s(A, 5), null, s(F, 5), s(E, 5), null, s(C, 5), s(E, 5), null, s(D, 5)],
  buildOrder: [0, 6, 3, 9, 8, 1, 5, 11],
};

export const defaultTargets: Targets = {
  density: 0.5,
  pulseVoices: 0, // the pulsing chord is for the climax, not the start
  breath: 1,
  doubling: 0,
  canon: { on: false, offset: 3, interval: 0 },
  key: 3,
  grouping: 3,
  tempo: 360,
  devices: [],
  chordDwell: 8,
  stageDwell: 1,
  orchestration: ENSEMBLE, // the 18 Musicians line-up: pulse and bass on piano, pattern and canon on marimba, breath on vibraphone
};

/** Additive accent shapes over 12 pulses, as in Reich's regroupings beyond the regular 6x2, 4x3, 3x4, 2x6. */
export const ACCENT_SHAPES: number[][] = [[3, 3, 2, 2, 2], [2, 2, 3, 2, 3], [3, 2, 3, 2, 2], [2, 3, 2, 3, 2]];

/** Which pulses carry an accent: the start of every group (additive groups when set, else the regular grouping). */
export function accentStarts(t: Pick<Targets, 'grouping' | 'accentGroups'>, length: number): boolean[] {
  if (t.accentGroups?.length) {
    const starts = new Set<number>();
    let at = 0;
    for (const g of t.accentGroups) { starts.add(at % length); at += g; }
    return Array.from({ length }, (_, i) => starts.has(i));
  }
  return Array.from({ length }, (_, i) => i % t.grouping === 0);
}

/** Pulses per minute <-> beats per minute (a quarter = 3 pulses, a bar = 12 pulses). */
export const PULSES_PER_BEAT = 3;
export const bpm = (pulsesPerMinute: number) => pulsesPerMinute / PULSES_PER_BEAT;
