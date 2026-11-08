import { expect, test } from 'vitest';
import { compose, randomSpec } from './compose';
import { CYCLE, finished, initialState, step, type Piece } from './engine';

const piece = (seed: number): Piece => {
  const composition = compose(randomSpec(seed));
  return { pulsesPerMinute: composition.spec.unitsPerMinute, cycleLength: CYCLE, composition };
};

test('stepping through a piece emits every note once, in order, then reports it finished', () => {
  const p = piece(3);
  let state = initialState();
  const heard = [];
  while (!finished(state, p)) {
    const r = step(state, p);
    heard.push(...r.events);
    state = r.state;
  }
  expect(heard).toEqual(p.composition.events);
});

test('a new composition starts at the next cycle boundary, from its first note', () => {
  const a = piece(1), b = piece(2);
  let state = initialState();
  for (let i = 0; i < 5; i++) state = step(state, a).state;
  const r = step(state, b);
  expect(r.state.start).toBe(5 * CYCLE);
  expect(r.events[0]!.pulse).toBe(5 * CYCLE);
  expect(r.events.map((e) => e.midi)).toEqual(b.composition.events.filter((e) => e.pulse < CYCLE).map((e) => e.midi));
});
