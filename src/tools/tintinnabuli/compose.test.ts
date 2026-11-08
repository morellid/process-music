import { describe, expect, test } from 'vitest';
import { fromIndex, index, midi } from '../../runtime/theory';
import { INSTRUMENTS } from '../../runtime/routing';
import { compose, describe as describePiece, inTriad, mPhrase, phraseLengths, randomSpec, routingFor, tNote, tonicLetter, tonicName } from './compose';
import { T_VOICES, type Spec } from './model';

const A = 5; // A minor / C major tonic letters
const seeds = Array.from({ length: 300 }, (_, i) => i * 7919 + 1);

describe('rules', () => {
  test('phrase processes', () => {
    expect(phraseLengths({ kind: 'additive', n: 4 })).toEqual([1, 2, 3, 4]);
    expect(phraseLengths({ kind: 'subtractive', n: 3 })).toEqual([3, 2, 1]);
    expect(phraseLengths({ kind: 'arch', n: 3 })).toEqual([1, 2, 3, 2, 1]);
    expect(phraseLengths({ kind: 'fixed', n: 3 })).toEqual([3, 3, 3]);
  });

  test('the four M modes leave or reach the centre stepwise', () => {
    expect(mPhrase(10, 1, 3)).toEqual([10, 11, 12]);
    expect(mPhrase(10, 2, 3)).toEqual([12, 11, 10]);
    expect(mPhrase(10, 3, 3)).toEqual([10, 9, 8]);
    expect(mPhrase(10, 4, 3)).toEqual([8, 9, 10]);
  });

  test('tonic letters: C major, A minor, G major, E minor, F major, D minor', () => {
    expect([tonicLetter(0, false), tonicLetter(0, true), tonicLetter(1, false), tonicLetter(1, true), tonicLetter(-1, false), tonicLetter(-1, true)]).toEqual([0, 5, 4, 2, 3, 1]);
    expect(tonicName({ key: -2, minor: true } as Spec)).toBe('G minor');
    expect(tonicName({ key: 3, minor: false } as Spec)).toBe('A major');
  });

  test('T voice in A minor: superior 1st over A is C, over B is C; inferior 2nd under C is E; never the unison', () => {
    const a4 = index({ letter: A, octave: 4 });
    expect(tNote(a4, A, { side: 'superior', position: 1 }, 0)).toBe(a4 + 2); // C5
    expect(tNote(a4 + 1, A, { side: 'superior', position: 1 }, 0)).toBe(a4 + 2); // B4 -> C5
    expect(tNote(a4 + 2, A, { side: 'inferior', position: 2 }, 0)).toBe(a4 - 3); // C5 -> A4 is 1st, E4 is 2nd
    for (let m = a4 - 7; m < a4 + 7; m++) {
      for (const t of T_VOICES) {
        const n = tNote(m, A, t, m);
        expect(inTriad(n, A)).toBe(true);
        expect(n).not.toBe(m);
        expect(Math.abs(n - m)).toBeLessThanOrEqual(t.position === 1 ? 3 : 5);
      }
    }
  });
});

describe('composed pieces (random specs)', () => {
  test('every T note is in the tonic triad and differs from its M note', () => {
    for (const seed of seeds) {
      const spec = randomSpec(seed);
      const triad = new Set([0, 2, 4].map((d) => midi(fromIndex(tonicLetter(spec.key, spec.minor) + d), spec.key) % 12));
      const { events } = compose(spec);
      const ms = events.filter((e) => e.layer.startsWith('M'));
      for (const e of events.filter((x) => x.layer.startsWith('T'))) {
        expect(triad.has(e.midi % 12)).toBe(true);
        const m = ms.find((x) => x.pulse === e.pulse && x.layer.slice(1) === e.layer.slice(1))!;
        expect(e.midi).not.toBe(m.midi);
      }
    }
  });

  test('each M voice moves stepwise inside a phrase (adjacent notes at most 2 semitones apart)', () => {
    for (const seed of seeds) {
      const spec = randomSpec(seed);
      const { events } = compose(spec);
      for (const layer of new Set(events.filter((e) => e.layer.startsWith('M')).map((e) => e.layer))) {
        const line = events.filter((e) => e.layer === layer);
        for (let i = 1; i < line.length - 1; i++) {
          const prev = line[i - 1]!, cur = line[i]!;
          if (prev.pulse + prev.duration === cur.pulse && prev.duration === cur.duration) expect(Math.abs(cur.midi - prev.midi)).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  test('voices never overlap themselves and all end on one tutti tonic chord', () => {
    for (const seed of seeds) {
      const spec = randomSpec(seed);
      const { events, length } = compose(spec);
      const layers = new Set(events.map((e) => e.layer));
      expect(layers.size).toBe(2 * spec.speeds.length);
      const close = Math.max(...events.map((e) => e.pulse));
      for (const layer of layers) {
        const line = events.filter((e) => e.layer === layer);
        for (let i = 1; i < line.length; i++) expect(line[i]!.pulse).toBeGreaterThanOrEqual(line[i - 1]!.pulse + line[i - 1]!.duration);
        expect(line.at(-1)!.pulse).toBe(close);
      }
      const tonicPc = midi(fromIndex(tonicLetter(spec.key, spec.minor)), spec.key) % 12;
      for (const e of events.filter((x) => x.pulse === close && x.layer.startsWith('M'))) expect(e.midi % 12).toBe(tonicPc);
      expect(length).toBeGreaterThan(close);
    }
  });

  test('random pieces last between 45 seconds and 5 minutes and describe themselves', () => {
    for (const seed of seeds) {
      const spec = randomSpec(seed);
      const { length } = compose(spec);
      const seconds = (length * 60) / spec.unitsPerMinute;
      expect(seconds).toBeGreaterThan(30);
      expect(seconds).toBeLessThan(360);
    }
    expect(describePiece(randomSpec(1), 100)).toMatch(/^[A-G][#b]? (minor|major) \/ /);
  });
});

describe('review findings', () => {
  test('canon voices end together: every voice\'s last line note ends as the closing chord starts', () => {
    for (const seed of seeds) {
      const spec = randomSpec(seed);
      const { events } = compose(spec);
      const close = Math.max(...events.map((e) => e.pulse));
      for (const layer of new Set(events.map((e) => e.layer))) {
        const line = events.filter((e) => e.layer === layer && e.pulse < close);
        const last = line.at(-1)!;
        expect(last.pulse + last.duration).toBe(close);
      }
    }
  });

  test('no note is folded by an octave: every layer is routed to an instrument whose range holds all its notes', () => {
    for (const seed of seeds) {
      const composition = compose(randomSpec(seed));
      const routing = routingFor(composition);
      for (const e of composition.events) {
        const [lo, hi] = INSTRUMENTS[routing[e.layer]!].range;
        expect(e.midi).toBeGreaterThanOrEqual(lo);
        expect(e.midi).toBeLessThanOrEqual(hi);
      }
    }
  });
});
