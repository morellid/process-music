// A new scenario: pattern, build order, chord cycle and key, from a seed. Applied as Piece edits, so the
// engine still morphs one note at a time from the old material to the new.
import type { Chord } from './model';
import { shift, type Cell, type KeySig, type Step } from './theory';

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const index = (s: Step) => s.octave * 7 + s.letter;
const fromIndex = (i: number): Step => ({ letter: ((i % 7) + 7) % 7, octave: Math.floor(i / 7) });
const PATTERN_LOW = index({ letter: 6, octave: 4 }); // B4
const PATTERN_HIGH = index({ letter: 5, octave: 5 }); // A5
const VOICES_LOW = index({ letter: 0, octave: 4 }); // C4
const VOICES_HIGH = index({ letter: 2, octave: 5 }); // E5

export type Scenario = { key: KeySig; pattern: Cell[]; buildOrder: number[]; chords: Chord[] };

export function generateScenario(seed: number, keys: [KeySig, KeySig] = [0, 5]): Scenario {
  const r = random(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const shuffle = <T,>(xs: T[]) => xs.map((x) => [r(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);

  // Pattern: the downbeat always sounds; a mostly stepwise walk inside the pattern register.
  const count = int(6, 9);
  const slots = [0, ...shuffle(Array.from({ length: 11 }, (_, i) => i + 1)).slice(0, count - 1)].sort((a, b) => a - b);
  let at = int(PATTERN_LOW + 1, PATTERN_HIGH - 1);
  const pattern: Cell[] = Array(12).fill(null);
  for (const slot of slots) {
    pattern[slot] = fromIndex(at);
    const move = [-2, -1, -1, 1, 1, 2, 3, -3][int(0, 7)]!;
    at = at + move < PATTERN_LOW || at + move > PATTERN_HIGH ? at - move : at + move;
  }

  // Build order: strong pulses (every 3rd) first, each group in its own order. The downbeat comes first.
  const strong = shuffle(slots.filter((i) => i % 3 === 0 && i !== 0));
  const weak = shuffle(slots.filter((i) => i % 3 !== 0));
  const buildOrder = [0, ...strong, ...weak];

  const key = int(keys[0], keys[1]);
  // Chords: four distinct basses on I, ii, IV, V or vi of the key; voices stacked in diatonic thirds above the
  // bass (3rd, 5th, 7th, 9th), the added-note sonorities of Music for 18 Musicians, folded into the pulse
  // register. iii and vii are left out: their 9th is a minor 9th over the bass (and vii has a tritone).
  const tonic = (((4 * key) % 7) + 7) % 7; // letter of the major tonic for this key signature
  const basses = shuffle([0, 1, 3, 4, 5].map((degree) => (tonic + degree) % 7)).slice(0, 4);
  const chords: Chord[] = basses.map((letter) => {
    const bass: Step = { letter, octave: letter >= 5 ? 1 : 2 };
    const voices = [2, 4, 6, 8].map((n) => {
      let i = index(shift({ letter, octave: 4 }, n));
      while (i > VOICES_HIGH) i -= 7;
      while (i < VOICES_LOW) i += 7;
      return fromIndex(i);
    }).sort((a, b) => index(a) - index(b));
    return { bass, voices };
  });

  return { key, pattern, buildOrder, chords };
}
