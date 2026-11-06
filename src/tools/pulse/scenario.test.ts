import { expect, test } from 'vitest';
import { degree, violations } from './melody';
import { generateScenario } from './scenario';

const index = (s: { letter: number; octave: number }) => s.octave * 7 + s.letter;
const scenarios = Array.from({ length: 50 }, (_, seed) => generateScenario(seed));

test('deterministic for a seed, different across seeds', () => {
  expect(generateScenario(7)).toEqual(generateScenario(7));
  expect(new Set(scenarios.map((s) => JSON.stringify(s.pattern))).size).toBeGreaterThan(40);
});

test('pattern: 12 pulses, 6-9 notes in the pattern register, mostly stepwise, starting on the downbeat', () => {
  for (const { pattern } of scenarios) {
    expect(pattern).toHaveLength(12);
    expect(pattern[0]).not.toBeNull();
    const notes = pattern.filter((c) => c !== null);
    expect(notes.length).toBeGreaterThanOrEqual(6);
    expect(notes.length).toBeLessThanOrEqual(9);
    for (const n of notes) expect(index(n)).toBeGreaterThanOrEqual(index({ letter: 6, octave: 4 })); // B4
    for (const n of notes) expect(index(n)).toBeLessThanOrEqual(index({ letter: 5, octave: 5 })); // A5
    for (let i = 1; i < notes.length; i++) expect(Math.abs(index(notes[i]!) - index(notes[i - 1]!))).toBeLessThanOrEqual(4); // a 5th at most
  }
});

test('build order covers exactly the notes, strong pulses first', () => {
  for (const { pattern, buildOrder } of scenarios) {
    const notes = pattern.flatMap((c, i) => (c ? [i] : []));
    expect([...buildOrder].sort((a, b) => a - b)).toEqual(notes);
    expect(buildOrder[0]).toBe(0);
  }
});

test('a cycle of 4 different chords, 4 voices each inside the pulse register, over distinct basses', () => {
  for (const { chords } of scenarios) {
    expect(chords).toHaveLength(4);
    expect(new Set(chords.map((c) => c.bass.letter)).size).toBe(4);
    for (const c of chords) {
      expect(c.voices).toHaveLength(4);
      for (const v of c.voices) expect(index(v)).toBeGreaterThanOrEqual(index({ letter: 0, octave: 4 }));
      for (const v of c.voices) expect(index(v)).toBeLessThanOrEqual(index({ letter: 2, octave: 5 }));
    }
  }
});

test('no chord has a minor 9th or a tritone over its bass', async () => {
  const { midi } = await import('./theory');
  for (const { chords, key } of scenarios) {
    for (const c of chords) {
      const bass = midi(c.bass, key) % 12;
      for (const v of c.voices) expect([1, 6]).not.toContain((midi(v, key) - bass + 120) % 12);
    }
  }
});

test('patterns make musical sense: tonic triad on the downbeat, 4th and leading tone resolve by step', () => {
  for (const { pattern, key } of scenarios) {
    expect(violations(pattern, key)).toEqual([]);
    expect([0, 2, 4]).toContain(degree(pattern[0]!, key));
    const notes = pattern.filter((c) => c !== null);
    notes.forEach((n, i) => {
      const next = notes[(i + 1) % notes.length]!;
      if (degree(n, key) === 3) expect(index(next) - index(n)).toBe(-1); // 4th falls to the 3rd
      if (degree(n, key) === 6) expect(index(next) - index(n)).toBe(1); // leading tone rises to the tonic
    });
  }
});

test('a half-built pattern never leaves a tension note without its resolution', () => {
  for (const { pattern, key, buildOrder } of scenarios) {
    const slots = pattern.flatMap((c, i) => (c ? [i] : []));
    slots.forEach((slot, k) => {
      if (![3, 6].includes(degree(pattern[slot]!, key))) return;
      const resolution = slots[(k + 1) % slots.length]!;
      expect(buildOrder.indexOf(resolution)).toBeLessThan(buildOrder.indexOf(slot));
    });
  }
});

test('accents and canon vary across scenarios', () => {
  expect(new Set(scenarios.map((s) => s.grouping)).size).toBeGreaterThan(2);
  expect(new Set(scenarios.map((s) => JSON.stringify(s.canon))).size).toBeGreaterThan(5);
});
