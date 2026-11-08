// Pitches are stored as letter + octave, never as absolute pitches: the key signature
// decides the accidentals at render time. So a key change moves every note on the
// altered letter by a semitone and leaves the rest alone (D5, collection change).

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F
const MAJOR_TONICS = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];

/** letter: 0..6 = C..B. */
export type Step = { letter: number; octave: number };
/** A pattern slot: a note or a rest. */
export type Cell = Step | null;
/** Key signature: number of sharps (positive) or flats (negative), -7..7. */
export type KeySig = number;

export function accidentals(key: KeySig): number[] {
  const acc = [0, 0, 0, 0, 0, 0, 0];
  const order = key >= 0 ? SHARP_ORDER : FLAT_ORDER;
  for (let i = 0; i < Math.abs(key); i++) acc[order[i]!] = Math.sign(key);
  return acc;
}

export function midi(step: Step, key: KeySig): number {
  return (step.octave + 1) * 12 + NATURAL_PC[step.letter]! + accidentals(key)[step.letter]!;
}

export function name(step: Step, key: KeySig): string {
  const acc = accidentals(key)[step.letter]!;
  return LETTERS[step.letter]! + (acc > 0 ? '#' : acc < 0 ? 'b' : '') + step.octave;
}

export const keyName = (key: KeySig): string => `${MAJOR_TONICS[key + 7]} major`;

/** One key closer to the target on the circle of fifths: changes exactly one pitch. */
export const stepToward = (key: KeySig, target: KeySig): KeySig => key + Math.sign(target - key);

/** Diatonic index: letter steps counted from C-1. */
export const index = (s: Step) => s.octave * 7 + s.letter;
export const fromIndex = (i: number): Step => ({ letter: ((i % 7) + 7) % 7, octave: Math.floor(i / 7) });

/** Diatonic transposition by n letter steps. */
export const shift = (s: Step, n: number): Step => fromIndex(index(s) + n);

/** Diatonic mirror of s around axis. */
export const mirror = (s: Step, axis: Step): Step => fromIndex(2 * index(axis) - index(s));

export const sameStep = (a: Cell, b: Cell): boolean =>
  a === b || (a !== null && b !== null && a.letter === b.letter && a.octave === b.octave);
