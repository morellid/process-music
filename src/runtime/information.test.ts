import { describe, expect, test } from 'vitest';
import { emptyModel, listen } from './information';
import type { NoteEvent } from './types';

const L = 12;
const cycle = (n: number, notes: [number, number][], layer = 'pattern'): NoteEvent[] =>
  notes.map(([pos, midi]) => ({ pulse: n * L + pos, midi, velocity: 70, duration: 1, layer }));

function feed(cycles: NoteEvent[][]) {
  let model = emptyModel();
  return cycles.map((events) => {
    const r = listen(model, events, L);
    model = r.model;
    return r.info;
  });
}

describe('information model', () => {
  const motif: [number, number][] = [[0, 64], [3, 69], [6, 64], [9, 71]];

  test('exact repetition stops being news', () => {
    const info = feed(Array.from({ length: 20 }, (_, n) => cycle(n, motif)));
    expect(info[0]!.total).toBeGreaterThan(10);
    expect(info[19]!.total).toBeLessThan(info[0]!.total / 10);
  });

  test('a new note after repetition is news, mostly in pitch and rhythm', () => {
    const cycles = Array.from({ length: 15 }, (_, n) => cycle(n, motif));
    cycles.push(cycle(15, [...motif, [10, 74]]));
    const info = feed(cycles);
    const before = info[14]!, after = info[15]!;
    expect(after.total).toBeGreaterThan(before.total + 3);
    expect(after.aspects.rhythm).toBeGreaterThan(before.aspects.rhythm);
    expect(after.aspects.pitch).toBeGreaterThan(before.aspects.pitch);
  });

  test('changing one pitch class shows up in harmony and pitch, not rhythm', () => {
    const cycles = Array.from({ length: 15 }, (_, n) => cycle(n, motif));
    cycles.push(cycle(15, [[0, 64], [3, 69], [6, 64], [9, 70]]));
    const info = feed(cycles);
    const before = info[14]!, after = info[15]!;
    expect(after.aspects.harmony).toBeGreaterThan(before.aspects.harmony + 1);
    expect(after.aspects.pitch).toBeGreaterThan(before.aspects.pitch + 1);
    expect(after.aspects.rhythm).toBeLessThan(0.5);
  });

  test('a symbol returning after a long absence is never more surprising than a new one', () => {
    const cycles = [cycle(0, [[5, 61]]), ...Array.from({ length: 200 }, (_, n) => cycle(n + 1, motif))];
    const returning = feed([...cycles, cycle(201, [...motif, [5, 61]])]).at(-1)!;
    const fresh = feed([...cycles, cycle(201, [...motif, [5, 62]])]).at(-1)!;
    expect(returning.total).toBeLessThanOrEqual(fresh.total + 0.01);
  });

  test('the same notes on a different instrument are news in timbre only', () => {
    let model = emptyModel();
    for (let n = 0; n < 15; n++) model = listen(model, cycle(n, motif), L, [], { pattern: 'piano' }).model;
    const same = listen(model, cycle(15, motif), L, [], { pattern: 'piano' }).info;
    const recoloured = listen(model, cycle(15, motif), L, [], { pattern: 'marimba' }).info;
    expect(recoloured.aspects.timbre).toBeGreaterThan(same.aspects.timbre + 3);
    expect(recoloured.aspects.pitch).toBeCloseTo(same.aspects.pitch);
    expect(recoloured.aspects.rhythm).toBeCloseTo(same.aspects.rhythm);
  });

  test('novelty is normalised per aspect to 0..1', () => {
    const [first] = feed([cycle(0, motif)]);
    for (const v of Object.values(first!.novelty)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
