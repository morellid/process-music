// Plays a precomposed piece through the shared Player: each cycle emits the notes that fall in it.
// The piece is never changed while it plays; a new composition starts from the next cycle (D6: between pieces).
import type { NoteEvent } from '../../runtime/types';
import type { Composition } from './compose';

export type Piece = { pulsesPerMinute: number; cycleLength: number; composition: Composition };
export type TintiState = { cycle: number; start: number; playing?: Composition };

export const CYCLE = 4; // units per scheduling cycle: short, so a "next piece now" is heard within a second or two

export const initialState = (): TintiState => ({ cycle: 0, start: 0 });

export function step(state: TintiState, piece: Piece): { events: NoteEvent[]; state: TintiState } {
  const L = piece.cycleLength;
  const fresh = piece.composition !== state.playing;
  const start = fresh ? state.cycle * L : state.start;
  const from = state.cycle * L - start, to = from + L;
  const events = piece.composition.events.filter((e) => e.pulse >= from && e.pulse < to).map((e) => ({ ...e, pulse: e.pulse + start }));
  return { events, state: { cycle: state.cycle + 1, start, playing: piece.composition } };
}

/** Units played of the current piece once `state` has been scheduled. */
export const elapsed = (state: TintiState, piece: Piece) => state.cycle * piece.cycleLength - state.start;

/** True once the piece and a few seconds of silence after it have been scheduled. */
export const finished = (state: TintiState, piece: Piece, silenceSeconds = 5) =>
  elapsed(state, piece) >= piece.composition.length + Math.round((silenceSeconds * piece.pulsesPerMinute) / 60);
