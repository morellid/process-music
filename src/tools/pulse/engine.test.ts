import { describe, expect, test } from 'vitest';
import { morphStep } from './morph';
import { initialState, step, type PulseState } from './engine';
import { defaultPiece, defaultTargets, type Targets } from './model';
import { sameStep, type Cell } from './theory';

const s = (letter: number, octave: number) => ({ letter, octave });

describe('morphStep', () => {
  test('changes exactly one cell, following the order', () => {
    const current: Cell[] = [null, null, null];
    const goal: Cell[] = [s(0, 4), s(1, 4), s(2, 4)];
    const next = morphStep(current, goal, [2, 0, 1]);
    expect(next).toEqual([null, null, s(2, 4)]);
  });

  test('reaches the goal in as many steps as there are differences', () => {
    let current: Cell[] = [s(0, 4), null, s(2, 4)];
    const goal: Cell[] = [null, s(1, 4), s(2, 4)];
    current = morphStep(current, goal, [0, 1, 2]);
    current = morphStep(current, goal, [0, 1, 2]);
    expect(current).toEqual(goal);
    expect(morphStep(current, goal, [0, 1, 2])).toBe(current);
  });
});

function run(targets: Targets, cycles: number, from?: PulseState) {
  let state = from ?? initialState(defaultPiece, 1);
  const states = [state];
  for (let i = 0; i < cycles; i++) {
    state = step(state, defaultPiece, targets).state;
    states.push(state);
  }
  return states;
}

const diff = (a: Cell[], b: Cell[]) => a.filter((c, i) => !sameStep(c, b[i] ?? null)).length;

describe('pulse engine', () => {
  const busy: Targets = { ...defaultTargets, density: 1, doubling: 1, canon: { on: true, offset: 3, interval: 0 }, key: 5, stageDwell: 1 };

  test('no layer changes by more than one note per cycle, key by more than one pitch', () => {
    const states = run(busy, 80);
    for (let i = 1; i < states.length; i++) {
      const a = states[i - 1]!, b = states[i]!;
      expect(diff(a.pattern, b.pattern)).toBeLessThanOrEqual(1);
      expect(diff(a.canon, b.canon)).toBeLessThanOrEqual(1);
      expect(diff(a.doubling, b.doubling)).toBeLessThanOrEqual(1);
      expect(diff(a.chord, b.chord)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.key - b.key)).toBeLessThanOrEqual(1);
    }
  });

  test('stage dwell holds each stage for the given number of cycles', () => {
    const states = run({ ...busy, stageDwell: 4 }, 40);
    const changes = states.slice(1).map((st, i) => diff(states[i]!.pattern, st.pattern)).filter(Boolean);
    expect(changes.length).toBeLessThanOrEqual(10);
  });

  test('converges to the full pattern and the target key', () => {
    const last = run(busy, 80).at(-1)!;
    expect(last.pattern.filter(Boolean).length).toBe(defaultPiece.pattern.filter(Boolean).length);
    expect(last.key).toBe(5);
    expect(last.canonOffset).toBe(3);
  });

  test('density 0 strips the pattern back to silence', () => {
    const full = run(busy, 80).at(-1)!;
    const empty = run({ ...busy, density: 0 }, 40, full).at(-1)!;
    expect(empty.pattern.every((c) => c === null)).toBe(true);
  });

  test('a chord voice move or a key step is the only change in its cycle', () => {
    const states = run({ ...busy, pulseVoices: 1, breath: 3, chordDwell: 2 }, 80);
    for (let i = 1; i < states.length; i++) {
      const a = states[i - 1]!, b = states[i]!;
      const chordMoved = diff(a.chord, b.chord) > 0;
      const keyMoved = a.key !== b.key;
      const others = diff(a.pattern, b.pattern) + diff(a.canon, b.canon) + diff(a.doubling, b.doubling)
        + Math.abs(a.pulseVoices - b.pulseVoices) + Math.abs(a.breathDepth - b.breathDepth) + (keyMoved ? 1 : 0);
      if (chordMoved) expect(others).toBe(0);
      if (keyMoved) expect(others - 1 + (chordMoved ? 1 : 0)).toBe(0);
    }
  });

  test('each layer stays inside one smplr velocity band, even with +-3 humanising', () => {
    const bands = [[41, 67], [68, 84]] as const; // SplendidGrandPiano velocity layers used here
    const byLayer = new Map<string, number[]>();
    for (const st of run(busy, 60)) {
      for (const e of step(st, defaultPiece, busy).events) byLayer.set(e.layer, [...(byLayer.get(e.layer) ?? []), e.velocity]);
    }
    for (const [layer, vs] of byLayer) {
      const lo = Math.min(...vs) - 3, hi = Math.max(...vs) + 3;
      expect(bands.some(([a, b]) => lo >= a && hi <= b), `${layer}: ${lo}-${hi}`).toBe(true);
    }
  });

  test('is deterministic for a given seed', () => {
    const a = step(initialState(defaultPiece, 7), defaultPiece, busy);
    const b = step(initialState(defaultPiece, 7), defaultPiece, busy);
    expect(a).toEqual(b);
  });

  test('events of one cycle stay inside the cycle', () => {
    const st = run(busy, 30).at(-1)!;
    const { events } = step(st, defaultPiece, busy);
    const start = st.cycle * defaultPiece.cycleLength;
    for (const e of events) {
      expect(e.pulse).toBeGreaterThanOrEqual(start);
      expect(e.pulse).toBeLessThan(start + defaultPiece.cycleLength);
      expect(e.velocity).toBeGreaterThan(0);
      expect(e.velocity).toBeLessThanOrEqual(127);
    }
  });
});

test('a pace under a bar makes several one-note stages per cycle', () => {
  const build = (stageDwell: number) => {
    let state = initialState(defaultPiece, 1);
    const targets = { ...defaultTargets, density: 1, breath: 0, stageDwell };
    const counts: number[] = [];
    for (let c = 0; c < 3; c++) {
      state = step(state, defaultPiece, targets).state;
      counts.push(state.pattern.filter(Boolean).length);
    }
    return counts;
  };
  expect(build(1)).toEqual([1, 2, 3]); // one note per bar
  expect(build(0.25)).toEqual([4, 8, 8]); // four per bar (the pattern has 8 notes)
  expect(build(0.5)).toEqual([2, 4, 6]);
});

test('tempo follows its target gradually, at most 0.5% per cycle, and each cycle reports its tempo', () => {
  let state = initialState(defaultPiece, 1);
  const targets = { ...defaultTargets, tempo: 400 };
  const tempos: number[] = [];
  for (let c = 0; c < 40; c++) {
    const r = step(state, defaultPiece, targets);
    tempos.push(r.pulsesPerMinute);
    state = r.state;
  }
  expect(tempos[0]).toBe(360);
  for (let i = 1; i < tempos.length; i++) expect(tempos[i]! - tempos[i - 1]!).toBeLessThanOrEqual(tempos[i - 1]! * 0.005 + 1e-9);
  expect(tempos.at(-1)).toBeCloseTo(400, 0);
});

test('additive accents mark the start of every group', async () => {
  const { accentStarts } = await import('./model');
  expect(accentStarts({ grouping: 3, accentGroups: [3, 3, 2, 2, 2] }, 12).flatMap((a, i) => (a ? [i] : []))).toEqual([0, 3, 6, 8, 10]);
  expect(accentStarts({ grouping: 4 }, 12).flatMap((a, i) => (a ? [i] : []))).toEqual([0, 4, 8]);
});
