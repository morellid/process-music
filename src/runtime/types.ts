/** A note in engine time: pulses, not seconds. The scheduler converts. */
export type NoteEvent = {
  pulse: number;
  midi: number;
  velocity: number;
  duration: number;
  layer: string;
};

export type ScheduledNote = { midi: number; velocity: number; time: number; duration: number; layer: string };

export interface Output {
  ready: Promise<unknown>;
  play(note: ScheduledNote): void;
  stopAll(): void;
}

/** Who asked for a change: kept in the decisions log (D4). */
export type Source = 'ui' | 'form' | 'conductor' | 'scenario';
