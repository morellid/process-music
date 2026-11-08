// Tintinnabuli (D6): a piece is a Spec, fixed before the first note. Nothing in it changes while it plays.
import type { InstrumentName } from '../../runtime/routing';
import type { KeySig } from '../../runtime/theory';

/** M-voice modes (Hillier): 1 up from the centre, 2 down to it from above, 3 down from it, 4 up to it from below. */
export type Mode = 1 | 2 | 3 | 4;

/** T-voice: the 1st or 2nd note of the tonic triad above or below the M note (never the unison), or alternating per note. */
export type TVoice = { side: 'superior' | 'inferior' | 'alternating'; position: 1 | 2 };

/** Phrase lengths: additive 1..n, subtractive n..1, arch 1..n..1, fixed n (n phrases of n notes). */
export type Process = { kind: 'additive' | 'subtractive' | 'arch' | 'fixed'; n: number };

export type Spec = {
  key: KeySig; // key signature, as in Pulse
  minor: boolean; // tonic is the relative minor of the key signature
  centreOctave: number; // octave of the fastest voice's centre (the tonic)
  process: Process;
  modes: Mode[]; // cycled phrase by phrase
  breath: number; // rest after each phrase, in units
  speeds: number[]; // mensuration canon: one M+T pair per speed; 1 is the fastest (one note per unit)
  t: TVoice;
  instruments: { m: InstrumentName; t: InstrumentName };
  unitsPerMinute: number; // tempo of the fastest voice
};

export const PROCESSES: Process['kind'][] = ['additive', 'subtractive', 'arch', 'fixed'];
export const MODE_CYCLES: Mode[][] = [[1], [2], [3], [4], [1, 3], [2, 4], [1, 2], [4, 3], [1, 2, 3, 4]];
/** Canon speed sets. Every speed divides the slowest, so all voices finish their last repetition together. */
export const CANONS: number[][] = [[1], [1, 2], [1, 3], [1, 4], [1, 2, 4]];
export const T_VOICES: TVoice[] = (['superior', 'inferior', 'alternating'] as const).flatMap((side) => ([1, 2] as const).map((position) => ({ side, position })));
