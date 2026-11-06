// Form director (D5b): keeps information flowing, spending a budget of bits per change.
// build -> sustain (rich, repetitive) -> release -> turn (sparse, the change) -> build ...
import { emptyModel, listen, ASPECTS, type Aspect, type Info, type Model } from '../../runtime/information';
import { INSTRUMENTS, LAYERS, SOLO_PIANO, type InstrumentName } from '../../runtime/routing';
import type { NoteEvent } from '../../runtime/types';
import type { Device } from './devices';
import { applyDevices } from './devices';
import { orderFor, repairPattern, varyPattern, violations } from './melody';
import type { PulseState } from './engine';
import { ACCENT_SHAPES, bpm, type Piece, type Targets } from './model';
import type { KeySig } from './theory';

export type Phase = 'build' | 'sustain' | 'release' | 'turn';
export type Changeable = 'harmony' | 'pitch' | 'melody' | 'rhythm' | 'register' | 'timbre' | 'tempo';
export const CHANGEABLE: Changeable[] = ['harmony', 'pitch', 'melody', 'rhythm', 'register', 'timbre', 'tempo'];
/** The listener's aspect that hears each kind of change (a melodic variation is heard as pitch news). */
const HEARD_AS: Record<Changeable, Aspect> = { harmony: 'harmony', pitch: 'pitch', melody: 'pitch', rhythm: 'rhythm', register: 'register', timbre: 'timbre', tempo: 'rhythm' };

/** Slow modulation of the form's own parameters: the macro-form breathes too. Depths are 0..1. */
export type Modulation = { periodMin: number; bits: number; pace: number; ceiling: number };

/**
 * What the composer (or the conductor's policy) leaves open to the director.
 * - keys, aspects, instruments: what a turn may change (instruments: for timbre turns).
 * - maxLevel (ceiling), valley: how rich arcs may get, how low they may fall.
 * - budgetBits: novelty per change, in bits; quietCycles: the pace, in bars (one bar = one cycle of 12 pulses):
 *   1/4, 1/2, 1, 2 or 4. Under a bar the director doesn't wait at all; the engine makes several stages per bar.
 * - reach: fifths a single harmony turn may modulate (within the bit budget).
 */
export type FormScope = {
  keys: [KeySig, KeySig];
  aspects: Changeable[];
  instruments?: InstrumentName[];
  maxLevel?: number;
  valley?: number;
  budgetBits?: number;
  quietCycles?: number;
  reach?: number;
  modulation?: Modulation;
  tempo?: number; // the composer's tempo (pulses per minute): the form may move up to TEMPO_RANGE around it, rarely
};
export const defaultScope: FormScope = { keys: [1, 5], aspects: CHANGEABLE };

type Intensity = Pick<Targets, 'pulseVoices' | 'density' | 'breath' | 'doubling'> & { canonOn: boolean };

/**
 * Intensity ladder, climbed and descended rung by rung.
 * The pulsing chord is a climax element (Davide, 2026-11-06): it enters only past the middle of the ladder,
 * so arcs start and end without it, and its full weight comes at the top.
 */
const LADDER: Partial<Intensity>[] = [
  { density: 0.25 },
  { breath: 1 },
  { density: 0.5 },
  { canonOn: true },
  { density: 0.75 },
  { breath: 2 },
  { doubling: 0.5 },
  { pulseVoices: 1 },
  { density: 1 },
  { pulseVoices: 2 },
  { doubling: 1 },
  { pulseVoices: 3 },
  { breath: 3 },
  { pulseVoices: 4 },
];
export const TOP = LADDER.length - 1;
const NOTHING: Intensity = { pulseVoices: 0, density: 0, breath: 0, doubling: 0, canonOn: false };

/** Kinds of change whose cost in bits the director learns from the listener. */
type Kind = 'rung' | Changeable;
/** First guesses, replaced by what the listener measures (harmony: per fifth). */
const INITIAL_COST: Record<Kind, number> = { rung: 15, harmony: 25, pitch: 18, melody: 10, rhythm: 8, register: 10, timbre: 10, tempo: 10 };
/** Tempo turns: at most this far from the composer's tempo, at most once every TEMPO_EVERY arcs, and only sometimes. */
const TEMPO_RANGE = 0.15, TEMPO_EVERY = 3, TEMPO_CHANCE = 0.35;

export type FormState = {
  model: Model;
  info?: Info;
  phase: Phase;
  level: number;
  peak: number;
  floor: number;
  sustainFor: number; // cycles of absorbed repetition before releasing
  phaseCycles: number;
  heard: number; // cycles heard so far: nothing is steered during warm-up
  absorbedFor: number; // consecutive cycles with no news above the background flow
  infoEma: number; // fast: what is happening now
  baseline: number; // slow: the music's background flow of information
  noveltyEma: Record<Aspect, number>; // recent novelty per aspect
  noveltyBase: Record<Aspect, number>; // each aspect's own long-run novelty
  cost: Record<Kind, number>; // learned bits per unit of each kind of change
  pending?: { units: Partial<Record<Kind, number>>; planned: number; bits: number }; // the last change, being measured
  lastChange?: { planned: number; measured: number };
  varied: number; // small variations done in this sustain (two per sustain: the first one varies the melody)
  lastTurn?: string;
  recentAspects: Changeable[]; // each aspect once, most recently turned first
  tempoArc: number; // arc of the last tempo change: tempo turns are rare
  arc: number;
  rng: number;
};

/**
 * News = information above the background flow. Absorbed when the fast estimate is back near the baseline.
 * The baseline follows drops quickly and rises slowly, and a single spike can't inflate it more than 2x.
 */
const FAST = 0.5, DROP = 0.15, RISE = 0.05, MARGIN = 1.15, MIN_NEWS_BITS = 3, WARM_UP = 10;
export const DEFAULTS = { budgetBits: 32, quietCycles: 1, reach: 1, valley: 3 } as const;
/** Paces in bars: a quarter, half, one, two or four bars (Davide, 2026-11-06). */
export const PACES = [0.25, 0.5, 1, 2, 4] as const;
export const paceName = (bars: number) => (bars < 1 ? `${bars * 4}/4 bar` : `${bars} bar${bars > 1 ? 's' : ''}`);
/** Nearest pace on the power-of-two grid (1/4 bar to 32 bars). */
const snapPace = (bars: number) => 2 ** clamp(Math.round(Math.log2(Math.max(bars, 1e-3))), -2, 5);
export const MAX_BITS = 128;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function random(seed: number): [number, number] {
  const next = (seed + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** The parameters in force now: base values moved by their slow modulation (phases offset so they don't move in lockstep). */
export function effectiveScope(scope: FormScope, minutes: number) {
  const m = scope.modulation;
  const wave = (offset: number) => (m && m.periodMin > 0 ? Math.sin((2 * Math.PI * minutes) / m.periodMin + offset) : 0);
  const budget = scope.budgetBits ?? DEFAULTS.budgetBits;
  const quiet = scope.quietCycles ?? DEFAULTS.quietCycles;
  const ceiling = scope.maxLevel ?? TOP;
  return {
    budgetBits: clamp(budget * (1 + (m?.bits ?? 0) * wave(0)), 2, MAX_BITS),
    quietCycles: snapPace(quiet * (1 + (m?.pace ?? 0) * wave(2.1))),
    ceiling: Math.round(clamp(ceiling + (m?.ceiling ?? 0) * 4 * wave(4.2), 2, TOP)),
    valley: clamp(scope.valley ?? DEFAULTS.valley, 0, TOP),
    reach: clamp(scope.reach ?? DEFAULTS.reach, 1, 3),
  };
}

/** The rung closest to the current targets, so switching the director on doesn't start from silence. */
export function levelFor(targets: Targets): number {
  const distance = (level: number) => {
    const t = intensityAt(level, targets);
    return Math.abs((t.pulseVoices ?? 0) - targets.pulseVoices) + 4 * Math.abs((t.density ?? 0) - targets.density)
      + Math.abs((t.breath ?? 0) - targets.breath) + 2 * Math.abs((t.doubling ?? 0) - targets.doubling)
      + (t.canon?.on === targets.canon.on ? 0 : 1);
  };
  return LADDER.reduce((best, _, i) => (distance(i) < distance(best) ? i : best), 0);
}

const perAspect = (v: number) => Object.fromEntries(ASPECTS.map((a) => [a, v])) as Record<Aspect, number>;

export function initialForm(seed: number, level = 0): FormState {
  const f: FormState = {
    model: emptyModel(), phase: 'build', level: 0, peak: 0, floor: 0, sustainFor: 0, phaseCycles: 0, heard: 0, absorbedFor: 0,
    infoEma: 0, baseline: 0, noveltyEma: perAspect(0.5), noveltyBase: perAspect(0.5), cost: { ...INITIAL_COST },
    varied: 0, arc: 0, rng: seed >>> 0, recentAspects: [], tempoArc: 0,
  };
  const arc = newArc(f, DEFAULTS.valley);
  return { ...arc, level, peak: Math.max(arc.peak, level) };
}

/** Each arc gets its own height, depth and length, so arcs differ. */
function newArc(f: FormState, valley: number): FormState {
  let r: number, rng = f.rng;
  [r, rng] = random(rng); const peak = Math.round(TOP * (0.55 + 0.45 * r));
  [r, rng] = random(rng); const floor = Math.round(valley * r);
  [r, rng] = random(rng); const sustainFor = 8 + Math.round(16 * r);
  return { ...f, peak, floor, sustainFor, rng, arc: f.arc + 1, varied: 0 };
}

/** Guide the form by hand: build to the ceiling now, release now, or turn now. */
export function force(form: FormState, phase: 'build' | 'release' | 'turn', scope: FormScope): FormState {
  const base = { ...form, phase, phaseCycles: 0, absorbedFor: 0 } as FormState;
  if (phase === 'build') return { ...base, peak: scope.maxLevel ?? TOP };
  if (phase === 'release') return { ...base, floor: Math.min(form.floor, form.level) };
  return base;
}

function intensityAt(level: number, targets: Targets): Partial<Targets> {
  const i = LADDER.slice(0, level + 1).reduce<Intensity>((acc, rung) => ({ ...acc, ...rung }), NOTHING);
  return { pulseVoices: i.pulseVoices, density: i.density, breath: i.breath, doubling: i.doubling, canon: { ...targets.canon, on: i.canonOn } };
}

const pick = <T,>(xs: T[], r: number): T => xs[Math.floor(r * xs.length) % xs.length]!;
const notes = (cells: unknown[]) => cells.filter(Boolean).length;

/** Has the engine finished realising these intensity targets (one note per stage takes a while)? */
export function rungReached(state: PulseState, targets: Targets, piece: Piece): boolean {
  const full = notes(piece.pattern);
  const pattern = Math.round(Math.min(1, Math.max(0, targets.density)) * full);
  const canon = targets.canon.on && targets.canon.offset === state.canonOffset ? pattern : 0;
  const doubling = Math.round(Math.min(1, Math.max(0, targets.doubling)) * notes(state.pattern));
  return state.pulseVoices === Math.min(targets.pulseVoices, state.chord.length)
    && state.breathDepth === Math.min(targets.breath, state.chord.length)
    && notes(state.pattern) === pattern && notes(state.canon) === canon && notes(state.doubling) === doubling;
}

/** Lowest MIDI note each layer usually plays (bass A1, breath C#3, ...), to match instruments to registers. */
const LAYER_LOWEST: Record<string, number> = { bass: 33, breath: 49, pulse: 61, doubling: 64, pattern: 71, canon: 69 };

/** Layers sounding now: a timbre turn re-colours one of these. */
function soundingLayers(state: PulseState): string[] {
  return LAYERS.filter((l) => {
    if (l === 'bass') return true;
    if (l === 'pulse') return state.pulseVoices > 0;
    if (l === 'breath') return state.breathDepth > 0;
    if (l === 'pattern') return state.pattern.some(Boolean);
    if (l === 'canon') return state.canon.some(Boolean);
    return state.doubling.some(Boolean);
  });
}

/** A turn must change something you can hear now, when the texture is sparse. */
function audible(aspect: Changeable, state: PulseState): boolean {
  if (aspect === 'melody') return state.pattern.filter(Boolean).length >= 2;
  if (aspect === 'tempo') return true;
  return aspect === 'harmony' || aspect === 'rhythm' || aspect === 'timbre' || state.pattern.some(Boolean);
}

type Turn = { steer: Partial<Targets>; edit?: Partial<Piece>; label: string };

/** One change in one aspect, chosen inside the scope. Harmony moves `fifths` fifths (one pitch at a time in the engine). */
function turn(aspect: Changeable, targets: Targets, state: PulseState, piece: Piece, scope: FormScope, r: number, fifths = 1): Turn {
  let seed = Math.floor(r * 2 ** 32);
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  switch (aspect) {
    case 'melody': {
      // Variation of the composed pattern itself: a neighbour note, a passing note, a displaced or omitted note.
      // A Piece edit, so the grid shows it and the engine still morphs to it one note at a time.
      const v = varyPattern(piece.pattern, targets.key, rand);
      if (!v) return { steer: {}, label: 'no melodic variation possible' };
      return { steer: {}, edit: { pattern: v.pattern, buildOrder: orderFor(v.pattern, targets.key, targets.grouping, rand, piece.buildOrder) }, label: v.label };
    }
    case 'harmony': {
      // A key outside the scope walks back towards it; inside, up or down, never past the range.
      const [lo, hi] = scope.keys;
      const dir = targets.key < lo ? 1 : targets.key > hi ? -1 : targets.key <= lo ? 1 : targets.key >= hi ? -1 : r < 0.5 ? -1 : 1;
      const key = targets.key < lo || targets.key > hi ? targets.key + dir : clamp(targets.key + dir * fifths, lo, hi);
      const n = Math.abs(key - targets.key);
      // The same letters land on new degrees in the new key: repair the pattern so 4ths and leading tones still resolve.
      const pattern = repairPattern(piece.pattern, key, targets.grouping, rand);
      const edit = pattern === piece.pattern ? undefined : { pattern, buildOrder: orderFor(pattern, key, targets.grouping, rand, piece.buildOrder) };
      return { steer: { key }, edit, label: `key ${dir > 0 ? 'up' : 'down'} ${n === 1 ? 'a fifth' : `${n} fifths`}` };
    }
    case 'pitch': {
      const has = (k: Device['kind']) => targets.devices.some((d) => d.kind === k);
      const without = (k: Device['kind']) => targets.devices.filter((d) => d.kind !== k);
      const t = targets.devices.find((d) => d.kind === 'transpose');
      const shiftBy = t?.kind === 'transpose' ? t.steps : 0;
      const options: [string, Device[]][] = [
        ['inversion', has('invert') ? without('invert') : [...targets.devices, { kind: 'invert', axis: { letter: 2, octave: 5 } }]],
        ['retrograde', has('retrograde') ? without('retrograde') : [...targets.devices, { kind: 'retrograde' }]],
        ['transpose', [...without('transpose'), ...(Math.abs(shiftBy) >= 2 ? [] : [{ kind: 'transpose' as const, steps: shiftBy + (r < 0.5 ? 1 : -1) }])]],
      ];
      // Only transformations that keep the melody's grammar (a retrograde turns every 4th-to-3rd resolution around).
      const bad = (devices: Device[]) => violations(applyDevices(piece.pattern, devices), targets.key).length;
      const allowed = options.filter(([, d]) => bad(d) <= bad(targets.devices));
      if (!allowed.length) return { steer: {}, label: 'no pitch transformation keeps the melody well formed' };
      const [label, devices] = pick(allowed, r);
      return { steer: { devices }, label };
    }
    case 'rhythm': {
      // Accents regroup: regular (6x2, 4x3, 3x4, 2x6) or additive (3+3+2+2+2 ...), never the current one.
      const current = targets.accentGroups?.length ? targets.accentGroups.join('+') : String(targets.grouping);
      const options: Partial<Targets>[] = [
        ...([2, 3, 4, 6] as const).map((grouping) => ({ grouping, accentGroups: undefined })),
        ...ACCENT_SHAPES.map((accentGroups) => ({ accentGroups })),
      ].filter((o) => (o.accentGroups ? o.accentGroups.join('+') : String(o.grouping)) !== current);
      const steer = pick(options, r);
      return { steer, label: steer.accentGroups ? `accents ${steer.accentGroups.join('+')}` : `accents in ${steer.grouping}s` };
    }
    case 'tempo': {
      // Accelerando or ritardando by 5-12%, inside the range around the composer's tempo; the engine slews there.
      const centre = scope.tempo ?? piece.pulsesPerMinute; // the composer's tempo, never the drifting current one
      const lo = centre * (1 - TEMPO_RANGE), hi = centre * (1 + TEMPO_RANGE);
      const by = 0.05 + 0.07 * ((r * 13.7) % 1);
      const up = targets.tempo <= lo ? true : targets.tempo >= hi ? false : r < 0.5;
      const tempo = Math.round(clamp(targets.tempo * (up ? 1 + by : 1 - by), lo, hi));
      return { steer: { tempo }, label: `${tempo > targets.tempo ? 'accelerando' : 'ritardando'} to ${Math.round(bpm(tempo))} bpm` };
    }
    case 'register': {
      if (state.canon.some(Boolean)) {
        const interval = pick([0, 2, 4, 5, -2].filter((i) => i !== targets.canon.interval), r);
        return { steer: { canon: { ...targets.canon, interval } }, label: `canon at interval ${interval}` };
      }
      // No canon sounding: move one sounding pattern note an octave (or put it back).
      const others = targets.devices.filter((d) => d.kind !== 'octave');
      if (others.length !== targets.devices.length) return { steer: { devices: others }, label: 'octave displacement undone' };
      const sounding = state.pattern.flatMap((c, i) => (c ? [i] : []));
      const index = pick(sounding, r);
      return { steer: { devices: [...others, { kind: 'octave', index, dir: r < 0.5 ? 1 : -1 }] }, label: `note ${index + 1} up/down an octave` };
    }
    case 'timbre': {
      // Same structure, new colour: one sounding layer moves to another allowed instrument.
      const allowed = scope.instruments?.length ? scope.instruments : (Object.keys(INSTRUMENTS) as InstrumentName[]);
      const current = targets.orchestration ?? SOLO_PIANO;
      // An instrument may take a layer only if its range reaches the layer's register (folding at most an octave).
      const fits = (i: InstrumentName, layer: string) => INSTRUMENTS[i].range[0] <= (LAYER_LOWEST[layer] ?? 60) + 12;
      const options = (layer: string) => allowed.filter((i) => i !== current[layer] && fits(i, layer));
      const layers = soundingLayers(state).filter((l) => options(l).length);
      if (!layers.length) return { steer: {}, label: 'no instrument change possible' };
      const layer = pick(layers, r);
      const instrument = pick(options(layer), (r * 7.31) % 1);
      return { steer: { orchestration: { ...current, [layer]: instrument } }, label: `${layer} to ${instrument}` };
    }
  }
}

/** Called once per cycle with what was just scheduled. */
export function direct(
  form: FormState, state: PulseState, events: NoteEvent[], targets: Targets, piece: Piece, scope: FormScope = defaultScope,
): { form: FormState; steer?: Partial<Targets>; edit?: Partial<Piece> } {
  const heard = listen(form.model, events, piece.cycleLength, ['breath'], targets.orchestration);
  const info = heard.info;
  const noveltyEma = Object.fromEntries(ASPECTS.map((a) => [a, 0.9 * form.noveltyEma[a] + 0.1 * info.novelty[a]])) as Record<Aspect, number>;
  const noveltyBase = Object.fromEntries(ASPECTS.map((a) => [a, 0.995 * form.noveltyBase[a] + 0.005 * info.novelty[a]])) as Record<Aspect, number>;
  const infoEma = FAST * form.infoEma + (1 - FAST) * info.total;
  const warm = form.heard >= WARM_UP;
  const sample = Math.min(info.total, 2 * form.baseline || info.total);
  const baseline = !warm ? infoEma : form.baseline + (sample < form.baseline ? DROP : RISE) * (sample - form.baseline);
  const news = infoEma > baseline * MARGIN && infoEma - baseline > MIN_NEWS_BITS;
  const absorbedFor = news ? 0 : form.absorbedFor + 1;
  // Measure the last change: the news it produced above the background flow.
  const pending = form.pending && { ...form.pending, bits: form.pending.bits + Math.max(0, info.total - baseline) };
  let f: FormState = {
    ...form, model: heard.model, info, noveltyEma, noveltyBase, infoEma, baseline, absorbedFor, pending,
    heard: form.heard + 1, phaseCycles: form.phaseCycles + 1,
  };
  if (!warm) return { form: f };

  const minutes = (f.heard * piece.cycleLength * 60) / piece.pulsesPerMinute / 60;
  const now = effectiveScope(scope, minutes);
  const settled = absorbedFor >= Math.floor(now.quietCycles) && rungReached(state, targets, piece);
  const sustainFor = f.sustainFor * (Math.max(0.5, now.quietCycles) / DEFAULTS.quietCycles);
  const to = (phase: Phase): FormState => ({ ...f, phase, phaseCycles: 0, absorbedFor: 0 });

  /** Close the measurement of the previous change (learn its cost per unit), open a new one. */
  const changed = (s: FormState, units: Partial<Record<Kind, number>>): FormState => {
    const cost = { ...s.cost };
    let lastChange = s.lastChange;
    if (s.pending) {
      const total = Object.values(s.pending.units).reduce((a, b) => a + (b ?? 0), 0);
      for (const [kind, n] of Object.entries(s.pending.units) as [Kind, number][]) {
        const perUnit = s.pending.bits / Math.max(1, total);
        if (n) cost[kind] = clamp(0.7 * cost[kind] + 0.3 * perUnit, 1, 200);
      }
      lastChange = { planned: s.pending.planned, measured: s.pending.bits };
    }
    const planned = (Object.entries(units) as [Kind, number][]).reduce((a, [k, n]) => a + cost[k] * n, 0);
    return { ...s, cost, lastChange, pending: { units, planned, bits: 0 }, absorbedFor: 0 };
  };
  /** How many rungs the bit budget buys at once. */
  const rungs = Math.round(clamp(now.budgetBits / f.cost.rung, 1, 4));

  switch (f.phase) {
    case 'build': {
      const peak = Math.min(f.peak, now.ceiling);
      if (f.level > peak) return { form: to('release') }; // the ceiling came down: follow it
      if (!settled) return { form: f };
      if (f.level < peak) {
        const level = Math.min(peak, f.level + rungs);
        f = changed({ ...f, level }, { rung: level - f.level });
        return { form: f, steer: intensityAt(level, targets) };
      }
      return { form: to('sustain') };
    }

    case 'sustain': {
      const variations = (['melody', 'rhythm', 'timbre'] as const).filter((a) => scope.aspects.includes(a) && audible(a, state));
      if (f.varied < 2 && variations.length && f.phaseCycles >= (sustainFor * (f.varied + 1)) / 3) {
        // Variation within repetition, twice per sustain: first the melody itself (the pattern evolves over time, as
        // in Reich), then whichever of the others is more habituated: regroup the accents or re-colour one layer.
        let r: number, rng = f.rng;
        [r, rng] = random(rng);
        const ratio = (a: Changeable) => f.noveltyEma[HEARD_AS[a]] / f.noveltyBase[HEARD_AS[a]];
        const aspect = f.varied === 0 && variations.includes('melody')
          ? 'melody'
          : [...variations].filter((a) => a !== 'melody' || variations.length === 1).sort((a, b) => ratio(a) - ratio(b))[0]!;
        const { steer, edit } = turn(aspect, targets, state, piece, scope, r);
        return { form: changed({ ...f, varied: f.varied + 1, rng }, { [aspect]: 1 }), steer, edit };
      }
      if (f.phaseCycles >= sustainFor && settled) return { form: to('release') };
      return { form: f };
    }

    case 'release': {
      if (!settled) return { form: f };
      const floor = Math.min(f.floor, now.valley);
      if (f.level > floor) {
        const level = Math.max(floor, f.level - rungs);
        f = changed({ ...f, level }, { rung: f.level - level });
        return { form: f, steer: intensityAt(level, targets) };
      }
      return { form: to('turn') };
    }

    case 'turn': {
      // Spend the bit budget on the most habituated aspects: most predictable *relative to their own usual level*
      // (raw novelty is not comparable across aspects), discounted by staleness (the long timescale the ~10-cycle
      // model can't see: a key unchanged for twenty minutes is fully absorbed). Never the aspect just turned first.
      let r: number, rng = f.rng;
      [r, rng] = random(rng);
      // Tempo is rare: never ranked with the others, added on top at most once every few arcs (below).
      const hearable = scope.aspects.filter((a) => a !== 'tempo' && audible(a, state));
      const fresh = hearable.filter((a) => a !== f.recentAspects[0]);
      const candidates = fresh.length ? fresh : hearable.length ? hearable : scope.aspects;
      const arcsSince = (a: Changeable) => { const i = f.recentAspects.indexOf(a); return i === -1 ? f.arc : i; };
      const habituation = (a: Changeable) => (f.noveltyEma[HEARD_AS[a]] / Math.max(1e-6, f.noveltyBase[HEARD_AS[a]])) * 0.6 ** arcsSince(a);
      const ranked = [...candidates].sort((a, b) => habituation(a) - habituation(b) || (r < 0.5 ? -1 : 1));

      // Greedy: the first aspect always; more while the expected bits fit the budget. Harmony may modulate
      // several fifths if the budget allows (up to `reach`).
      const units: Partial<Record<Kind, number>> = {};
      let spent = 0, next = targets, nextPiece = piece, steer: Partial<Targets> = {}, edit: Partial<Piece> | undefined;
      const labels: string[] = [];
      for (const aspect of ranked) {
        const fifths = aspect === 'harmony' ? Math.round(clamp((now.budgetBits - spent) / f.cost.harmony, 1, now.reach)) : 1;
        const cost = f.cost[aspect] * fifths;
        if (labels.length && spent + cost > now.budgetBits * 1.25) continue;
        [r, rng] = random(rng);
        const t = turn(aspect, next, state, nextPiece, scope, r, fifths);
        if (!Object.keys(t.steer).length && !t.edit) continue; // nothing possible in this aspect now: spend the bits elsewhere
        next = { ...next, ...t.steer };
        steer = { ...steer, ...t.steer };
        if (t.edit) { edit = { ...edit, ...t.edit }; nextPiece = { ...nextPiece, ...t.edit }; }
        labels.push(`${aspect}: ${t.label}`);
        units[aspect] = aspect === 'harmony' ? Math.abs((next.key ?? targets.key) - targets.key) || 1 : 1;
        spent += cost;
      }
      [r, rng] = random(rng);
      const tempoNow = scope.aspects.includes('tempo') && f.arc - f.tempoArc >= TEMPO_EVERY && r < TEMPO_CHANCE;
      if (tempoNow) {
        [r, rng] = random(rng);
        const t = turn('tempo', next, state, nextPiece, scope, r);
        steer = { ...steer, ...t.steer };
        labels.push(`tempo: ${t.label}`);
        units.tempo = 1;
      }
      const chosen = Object.keys(units) as Changeable[];
      const recent = [...chosen, ...f.recentAspects.filter((a) => !chosen.includes(a))];
      f = newArc(changed({ ...to('build'), rng, lastTurn: labels.join(' + '), recentAspects: recent, tempoArc: tempoNow ? f.arc : f.tempoArc }, units), now.valley);
      return { form: f, steer, edit };
    }
  }
}
