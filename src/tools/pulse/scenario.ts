// A new scenario: pattern, build order, chord cycle, key, accents and canon, from a seed. Applied as Piece edits, so the
// engine still morphs one note at a time from the old material to the new.
import { generatePattern, orderFor } from './melody';
import type { Chord, Targets } from './model';
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
const VOICES_LOW = index({ letter: 0, octave: 4 }); // C4
const VOICES_HIGH = index({ letter: 2, octave: 5 }); // E5

export type Scenario = {
  key: KeySig;
  pattern: Cell[];
  buildOrder: number[];
  chords: Chord[];
  grouping: Targets['grouping'];
  canon: Targets['canon'];
};

export function generateScenario(seed: number, keys: [KeySig, KeySig] = [0, 5]): Scenario {
  const r = random(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const shuffle = <T,>(xs: T[]) => xs.map((x) => [r(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
  const pickOne = <T,>(xs: readonly T[]) => xs[int(0, xs.length - 1)]!;

  // Accents and the pattern's beat: the pattern is written against this grouping (beat starts carry triad notes).
  const grouping = pickOne([2, 3, 3, 4, 4, 6] as const);
  const canon = { on: false, offset: pickOne([2, 3, 4, 6]), interval: pickOne([0, 0, 2, 4, 5, -2]) };

  const key = int(keys[0], keys[1]);
  const pattern = generatePattern(key, grouping, r);
  const buildOrder = orderFor(pattern, key, grouping, r);

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

  return { key, pattern, buildOrder, chords, grouping, canon };
}
