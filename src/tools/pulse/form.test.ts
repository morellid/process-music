import { expect, test } from 'vitest';
import { initialState, step, type PulseState } from './engine';
import { defaultScope, direct, effectiveScope, force, initialForm, rungReached, type FormState, type Phase } from './form';
import { defaultPiece, defaultTargets, type Targets } from './model';

// 3000 cycles = 100 minutes at the default tempo.
type Frame = { form: FormState; targets: Targets; before: Targets; state: PulseState; steered: boolean };

function simulate(cycles: number, start: Partial<Targets> = {}, scope = defaultScope) {
  let state = initialState(defaultPiece, 1);
  let form = initialForm(1);
  let targets: Targets = { ...defaultTargets, pulseVoices: 0, density: 0, breath: 0, ...start };
  const trace: Frame[] = [];
  for (let c = 0; c < cycles; c++) {
    const r = step(state, defaultPiece, targets);
    state = r.state;
    const before = targets;
    const d = direct(form, state, r.events, targets, defaultPiece, scope);
    form = d.form;
    if (d.steer) targets = { ...targets, ...d.steer };
    trace.push({ form, targets, before, state, steered: !!d.steer });
  }
  return trace;
}

const trace = simulate(3000);

test('the form keeps cycling through build, sustain, release, turn', () => {
  const phases: Phase[] = [];
  for (const { form } of trace) if (phases.at(-1) !== form.phase) phases.push(form.phase);
  const arcs = phases.join(' ').split('build sustain release turn').length - 1;
  expect(arcs).toBeGreaterThanOrEqual(8);
});

test('intensity moves one rung at a time', () => {
  for (let i = 1; i < trace.length; i++) expect(Math.abs(trace[i]!.form.level - trace[i - 1]!.form.level)).toBeLessThanOrEqual(1);
});

test('arcs reach different peaks', () => {
  expect(new Set(trace.map((t) => t.form.peak)).size).toBeGreaterThan(2);
});

test('every open aspect gets turned, and the key stays in scope', () => {
  const turned = new Set(trace.map((t) => t.form.lastTurn?.split(':')[0]).filter(Boolean));
  expect([...turned].sort()).toEqual([...defaultScope.aspects].sort());
  const [lo, hi] = defaultScope.keys;
  for (const { targets } of trace) {
    expect(targets.key).toBeGreaterThanOrEqual(lo);
    expect(targets.key).toBeLessThanOrEqual(hi);
  }
});

test('nothing is steered while the listener is still warming up', () => {
  expect(trace.slice(0, 10).some((f) => f.steered)).toBe(false);
});

test('a new rung only comes once the engine has realised the previous one', () => {
  for (let i = 1; i < trace.length; i++) {
    const f = trace[i]!, prev = trace[i - 1]!;
    if (f.form.level !== prev.form.level) expect(rungReached(f.state, f.before, defaultPiece)).toBe(true);
  }
});

test('turns change something audible at the current level', () => {
  for (let i = 1; i < trace.length; i++) {
    const f = trace[i]!;
    if (f.form.arc === trace[i - 1]!.form.arc) continue;
    const aspect = f.form.lastTurn!.split(':')[0];
    const patternSounding = f.state.pattern.some(Boolean);
    if (aspect === 'pitch' || aspect === 'register') expect(patternSounding, f.form.lastTurn).toBe(true);
  }
});

test('a key outside the scope moves one fifth towards it, and out-of-scope aspects are never touched', () => {
  const t = simulate(1500, { key: -4 }, { keys: [1, 5], aspects: ['harmony', 'pitch'] });
  const keys = t.map((f) => f.targets.key).filter((k, i, a) => k !== a[i - 1]);
  for (let i = 1; i < keys.length; i++) expect(Math.abs(keys[i]! - keys[i - 1]!)).toBe(1);
  expect(t.every((f) => f.targets.grouping === defaultTargets.grouping)).toBe(true);
  expect(t.every((f) => f.targets.canon.interval === defaultTargets.canon.interval)).toBe(true);
});

test('maxLevel caps every arc', () => {
  const t = simulate(1500, {}, { ...defaultScope, maxLevel: 6 });
  expect(Math.max(...t.map((f) => f.form.level))).toBeLessThanOrEqual(6);
  expect(new Set(t.map((f) => f.form.phase)).size).toBe(4); // still builds, sustains, releases, turns
});

test('the pulsing chord is a climax element: absent at the start and in the lower half of every arc', () => {
  expect(trace.slice(0, 30).every((f) => f.targets.pulseVoices === 0)).toBe(true);
  for (const f of trace) if (f.targets.pulseVoices > 0) expect(f.form.level).toBeGreaterThanOrEqual(7);
  expect(trace.some((f) => f.targets.pulseVoices > 0)).toBe(true); // but it does come
});

test('novelty budget in bits: a bigger budget buys more rungs per step and more aspects per turn', () => {
  const jumps = (budgetBits: number) => {
    const t = simulate(2000, {}, { ...defaultScope, budgetBits });
    return {
      maxJump: Math.max(...t.slice(1).map((f, i) => Math.abs(f.form.level - t[i]!.form.level))),
      multiTurns: t.filter((f) => (f.form.lastTurn ?? '').includes(' + ')).length,
    };
  };
  const small = jumps(4), big = jumps(80);
  expect(small.maxJump).toBe(1);
  expect(small.multiTurns).toBe(0);
  expect(big.maxJump).toBeGreaterThan(1);
  expect(big.maxJump).toBeLessThanOrEqual(4);
  expect(big.multiTurns).toBeGreaterThan(0);
});

test('the cost of each kind of change is learned from what the listener measured', () => {
  const last = trace.at(-1)!.form;
  expect(last.lastChange).toBeDefined();
  expect(last.cost.rung).not.toBe(15);
});

test('timbre turns re-colour one sounding layer with an allowed instrument', () => {
  const t = simulate(2500, {}, { ...defaultScope, aspects: ['timbre'], instruments: ['piano', 'marimba'] });
  let changes = 0;
  for (let i = 1; i < t.length; i++) {
    const a = t[i - 1]!.targets.orchestration, b = t[i]!.targets.orchestration;
    const moved = Object.keys(b).filter((l) => a[l] !== b[l]);
    expect(moved.length).toBeLessThanOrEqual(1);
    for (const l of moved) expect(['piano', 'marimba']).toContain(b[l]);
    changes += moved.length;
  }
  expect(changes).toBeGreaterThan(3);
});

test('force: build to the ceiling, release, or turn on demand', () => {
  const f = trace[200]!.form;
  expect(force(f, 'build', { ...defaultScope, maxLevel: 9 })).toMatchObject({ phase: 'build', peak: 9 });
  expect(force(f, 'release', defaultScope).phase).toBe('release');
  expect(force(f, 'turn', defaultScope).phase).toBe('turn');
});

test('form parameters breathe with their modulation, and stay put without it', () => {
  const still = effectiveScope({ ...defaultScope, budgetBits: 16 }, 7);
  expect(still.budgetBits).toBe(16);
  const mod = { ...defaultScope, budgetBits: 16, maxLevel: 10, modulation: { periodMin: 20, bits: 0.5, pace: 0.5, ceiling: 1 } };
  const values = Array.from({ length: 20 }, (_, m) => effectiveScope(mod, m));
  expect(Math.max(...values.map((v) => v.budgetBits))).toBeGreaterThan(22);
  expect(Math.min(...values.map((v) => v.budgetBits))).toBeLessThan(10);
  expect(new Set(values.map((v) => v.ceiling)).size).toBeGreaterThan(3);
});

test('modulation reach: a rich budget lets a harmony turn move more than one fifth, still within the key range', () => {
  const t = simulate(3000, { key: 3 }, { keys: [0, 6], aspects: ['harmony', 'rhythm'], reach: 3, budgetBits: 120 });
  const keys = t.map((f) => f.targets.key).filter((k, i, a) => k !== a[i - 1]);
  expect(keys.some((k, i) => i > 0 && Math.abs(k - keys[i - 1]!) > 1)).toBe(true);
  for (const k of keys) { expect(k).toBeGreaterThanOrEqual(0); expect(k).toBeLessThanOrEqual(6); }
});

test('novelty pace: waiting longer for quiet means fewer changes', () => {
  const steers = (quietCycles: number) => simulate(1500, {}, { ...defaultScope, quietCycles }).filter((f) => f.steered).length;
  expect(steers(12)).toBeLessThan(steers(1) * 0.7);
});

test('timbre turns only use instruments that reach the layer: no bass on the vibraphone', () => {
  const t = simulate(4000, {}, { ...defaultScope, aspects: ['timbre'], instruments: ['vibraphone', 'piano'] });
  for (const f of t) expect(f.targets.orchestration.bass).not.toBe('vibraphone');
});
