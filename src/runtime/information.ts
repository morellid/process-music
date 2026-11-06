// An adaptive listener (D5b): how much of each cycle could it have predicted from what it heard?
// Predictions are conditioned on the rhythmic slot (layer x position), so exact repetition
// becomes predictable and carries almost no information; counts decay, so the model habituates.
import type { NoteEvent } from './types';

export const ASPECTS = ['rhythm', 'pitch', 'register', 'loudness', 'harmony', 'texture', 'timbre'] as const;
export type Aspect = (typeof ASPECTS)[number];

/** Nominal alphabet sizes, used for unseen symbols and to normalise novelty. */
const ALPHABET: Record<Aspect, number> = { rhythm: 2, pitch: 12, register: 9, loudness: 16, harmony: 4096, texture: 128, timbre: 8 };
const DECAY = 0.9; // per cycle: memory of ~10 cycles
const ESCAPE = 0.1; // pseudo-count reserved for "something new" in each context

type Counts = Record<string, Record<string, number>>; // context -> symbol -> decayed count
export type Model = { counts: Record<Aspect, Counts>; layers: string[]; lastHarmony: string; lastTexture: string };

export type Info = {
  total: number; // bits this cycle
  aspects: Record<Aspect, number>; // bits per aspect
  novelty: Record<Aspect, number>; // mean surprise per prediction, normalised 0..1
  events: number;
};

export const emptyModel = (): Model => ({
  counts: { rhythm: {}, pitch: {}, register: {}, loudness: {}, harmony: {}, texture: {}, timbre: {} },
  layers: [],
  lastHarmony: '',
  lastTexture: '',
});

/**
 * Escape-method estimate, blended: every symbol gets its share of the escape mass, so a symbol whose
 * count has decayed towards zero is never more surprising than one never heard.
 */
function surprisal(table: Record<string, number> | undefined, symbol: string, alphabet: number): number {
  const total = Object.values(table ?? {}).reduce((a, b) => a + b, 0);
  const seen = table?.[symbol] ?? 0;
  return -Math.log2((seen + ESCAPE / alphabet) / (total + ESCAPE));
}

const setOf = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b).join(',');

/**
 * Hear one cycle: returns its information (before learning it) and the updated model.
 * `swells`: layers heard as a swell (how many notes this cycle), not note by note, e.g. a free-running breath.
 * `instruments`: which instrument plays each layer (orchestration is part of the form, D5b).
 */
export function listen(
  model: Model, events: NoteEvent[], cycleLength: number, swells: string[] = [], instruments: Record<string, string> = {},
): { info: Info; model: Model } {
  const counts = structuredClone(model.counts);
  // Decay, and forget what has faded (keeps tables, and the clone above, small over hours).
  for (const aspect of ASPECTS) {
    for (const [context, table] of Object.entries(counts[aspect])) {
      for (const k in table) if ((table[k]! *= DECAY) < 1e-3) delete table[k];
      if (Object.keys(table).length === 0) delete counts[aspect][context];
    }
  }

  const zero = () => Object.fromEntries(ASPECTS.map((a) => [a, 0])) as Record<Aspect, number>;
  const bits = zero();
  const predictions = zero();
  const observe = (aspect: Aspect, context: string, symbol: string) => {
    bits[aspect] += surprisal(counts[aspect][context], symbol, ALPHABET[aspect]);
    predictions[aspect]++;
    const table = (counts[aspect][context] ??= {});
    table[symbol] = (table[symbol] ?? 0) + 1;
  };

  for (const layer of swells) {
    const n = events.filter((e) => e.layer === layer).length;
    observe('loudness', `${layer}:swell`, String(Math.round(Math.log2(1 + n))));
  }
  const detailed = events.filter((e) => !swells.includes(e.layer));

  const slots = new Map<string, NoteEvent[]>();
  for (const e of detailed) {
    const key = `${e.layer}@${((e.pulse % cycleLength) + cycleLength) % cycleLength}`;
    slots.set(key, [...(slots.get(key) ?? []), e]);
  }
  const layers = [...new Set([...model.layers, ...detailed.map((e) => e.layer)])].sort();

  for (const layer of layers) {
    for (let pos = 0; pos < cycleLength; pos++) {
      const slot = `${layer}@${pos}`;
      const here = slots.get(slot);
      observe('rhythm', slot, here ? '1' : '0');
      if (!here) continue;
      observe('pitch', slot, setOf(here.map((e) => e.midi % 12)));
      observe('register', slot, setOf(here.map((e) => Math.floor(e.midi / 12))));
      observe('loudness', slot, setOf(here.map((e) => Math.floor(e.velocity / 8))));
    }
  }
  const harmony = setOf(events.map((e) => e.midi % 12));
  const texture = [...new Set(events.map((e) => e.layer))].sort().join(',');
  for (const layer of new Set(events.map((e) => e.layer))) observe('timbre', layer, instruments[layer] ?? 'piano');
  observe('harmony', model.lastHarmony, harmony);
  observe('texture', model.lastTexture, texture);

  const novelty = Object.fromEntries(ASPECTS.map((a) => {
    const perPrediction = predictions[a] ? bits[a] / predictions[a] : 0;
    return [a, Math.min(1, perPrediction / (Math.log2(ALPHABET[a]) + 4))];
  })) as Record<Aspect, number>;

  return {
    info: { total: ASPECTS.reduce((t, a) => t + bits[a], 0), aspects: bits, novelty, events: events.length },
    model: { counts, layers, lastHarmony: harmony, lastTexture: texture },
  };
}
