// Melody grammar for the pattern: generate patterns that make musical sense, and vary them without breaking it.
// Rules (Davide, 2026-11-06: "1 in battere, treat the 4th degree with care, make it resolve"):
// - the downbeat always sounds, on a note of the tonic triad (1, 3 or 5);
// - tension degrees resolve by step to the next note: the 4th falls to the 3rd, the leading tone rises to the tonic,
//   and neither sits on the downbeat; the pattern loops, so the last note resolves into the first;
// - mostly stepwise; a leap of a 4th or more is followed by a step back the other way; no leap past a 5th;
// - never the same pitch three times running; everything inside the pattern register.
import { type Cell, type KeySig, type Step } from './theory';

export const PATTERN_LOW = 34; // B4 as a diatonic index (octave * 7 + letter)
export const PATTERN_HIGH = 40; // A5
const index = (s: Step) => s.octave * 7 + s.letter;
const fromIndex = (i: number): Step => ({ letter: ((i % 7) + 7) % 7, octave: Math.floor(i / 7) });

/** Scale degree 0..6 (0 = tonic) of a letter in the major key with this signature. */
export const degree = (s: Step, key: KeySig) => (s.letter - ((((4 * key) % 7) + 7) % 7) + 7) % 7;
const TRIAD = [0, 2, 4];
/** Tension degree -> the step it must move by to resolve. */
const RESOLVES: Record<number, number> = { 3: -1, 6: 1 };

const notesOf = (p: Cell[]) => p.flatMap((c, i) => (c ? [{ slot: i, step: c }] : []));

/** Does `to` follow `from` correctly (resolution, leap size); `before` is the note before `from`, for leap recovery. */
function follows(before: Step | undefined, from: Step, to: Step, key: KeySig): boolean {
  const move = index(to) - index(from);
  const resolve = RESOLVES[degree(from, key)];
  if (resolve !== undefined && move !== resolve) return false;
  if (Math.abs(move) > 4) return false;
  if (before) {
    const leap = index(from) - index(before);
    if (Math.abs(leap) >= 3 && !(Math.abs(move) === 1 && Math.sign(move) === -Math.sign(leap))) return false;
    if (move === 0 && leap === 0) return false;
  }
  return true;
}

/** Every rule broken by this pattern, empty when it is well formed (used by the generator, the variations and tests). */
export function violations(pattern: Cell[], key: KeySig): string[] {
  const out: string[] = [];
  const notes = notesOf(pattern);
  const first = pattern[0];
  if (!first) out.push('no downbeat');
  else if (!TRIAD.includes(degree(first, key))) out.push('downbeat not on the tonic triad');
  for (const n of notes) if (index(n.step) < PATTERN_LOW || index(n.step) > PATTERN_HIGH) out.push(`slot ${n.slot} out of register`);
  for (let i = 0; i < notes.length && notes.length > 1; i++) {
    const at = (k: number) => notes[(i + k + notes.length) % notes.length]!.step;
    if (!follows(notes.length > 2 ? at(-1) : undefined, at(0), at(1), key)) out.push(`slot ${notes[i]!.slot} -> next`);
  }
  return out;
}

/** Weighted shuffle: higher weight, earlier on average (Efraimidis-Spirakis). */
function weightedOrder<T>(items: [T, number][], r: () => number): T[] {
  return items.filter(([, w]) => w > 0).map(([x, w]) => [x, r() ** (1 / w)] as const).sort((a, b) => b[1] - a[1]).map(([x]) => x);
}

const MOVE_WEIGHT: Record<number, number> = { 0: 0.5, 1: 4, 2: 2, 3: 0.7, 4: 0.3 };

/** Rhythm: the downbeat, most beat starts (every `grouping` pulses), some off-beats; 6 to 9 notes in 12. */
function rhythm(grouping: number, length: number, r: () => number): number[] {
  const slots = Array.from({ length }, (_, i) => i).filter((i) => i === 0 || r() < (i % grouping === 0 ? 0.85 : 0.45));
  const offbeats = () => slots.filter((i) => i % grouping !== 0);
  while (slots.length > 9) slots.splice(slots.indexOf(offbeats()[Math.floor(r() * offbeats().length)] ?? slots.at(-1)!), 1);
  while (slots.length < 6) {
    const free = Array.from({ length }, (_, i) => i).filter((i) => !slots.includes(i));
    slots.push(free[Math.floor(r() * free.length)]!);
    slots.sort((a, b) => a - b);
  }
  return slots;
}

/** Pitches for the given slots by depth-first search over weighted candidates: always finds a pattern that obeys the rules. */
function pitches(slots: number[], key: KeySig, grouping: number, r: () => number): Step[] | undefined {
  const out: Step[] = [];
  const search = (k: number): boolean => {
    if (k === slots.length) {
      // Close the loop: the last note must lead into the first, and the first must follow the last.
      const n = out.length;
      return follows(out[n - 2], out[n - 1]!, out[0]!, key) && follows(out[n - 1], out[0]!, out[1]!, key);
    }
    const strong = slots[k]! % grouping === 0;
    const candidates: [number, number][] = [];
    for (let i = PATTERN_LOW; i <= PATTERN_HIGH; i++) {
      const step = fromIndex(i);
      const d = degree(step, key);
      if (k === 0 && !TRIAD.includes(d)) continue;
      if (k > 0 && !follows(out[k - 2], out[k - 1]!, step, key)) continue;
      const move = k === 0 ? 1 : Math.abs(i - index(out[k - 1]!));
      candidates.push([i, (MOVE_WEIGHT[move] ?? 0) * (strong && TRIAD.includes(d) ? 2.5 : 1)]);
    }
    for (const i of weightedOrder(candidates, r)) {
      out[k] = fromIndex(i);
      if (search(k + 1)) return true;
    }
    out.length = k;
    return false;
  };
  return search(0) ? out : undefined;
}

/**
 * Make a pattern fit a (new) key: after a modulation the same letters can land on new degrees (in C the 4th, F,
 * falls to E; in G it is F#, the leading tone, and must rise). First the smallest change: one note a step up or
 * down at a time, while that reduces the violations. If rules are still broken, keep the rhythm and write new
 * pitches for it. Returns the pattern unchanged when it already obeys the rules.
 */
export function repairPattern(pattern: Cell[], key: KeySig, grouping: number, r: () => number): Cell[] {
  let best = pattern, bad = violations(pattern, key).length;
  for (let round = 0; round < 12 && bad > 0; round++) {
    const options = notesOf(best).flatMap((n) => [-1, 1].map((d) => {
      const p = [...best];
      p[n.slot] = fromIndex(index(n.step) + d);
      return p;
    }));
    const scored = options.map((p) => ({ p, bad: violations(p, key).length }));
    const min = Math.min(...scored.map((s) => s.bad));
    if (min >= bad) break;
    const top = scored.filter((s) => s.bad === min);
    best = top[Math.floor(r() * top.length)]!.p;
    bad = min;
  }
  if (bad === 0) return best;
  const slots = notesOf(pattern).map((n) => n.slot);
  if (slots[0] !== 0 || slots.length < 3) return best;
  const steps = pitches(slots, key, grouping, r);
  if (!steps) return best;
  const out: Cell[] = Array(pattern.length).fill(null);
  slots.forEach((s, k) => (out[s] = steps[k]!));
  return out;
}

/**
 * Build order: the downbeat, then the other beat starts, then off-beats; a tension note never before the note it
 * resolves to, so a half-built pattern never leaves a 4th hanging.
 */
export function orderFor(pattern: Cell[], key: KeySig, grouping: number, r: () => number, start: number[] = []): number[] {
  const notes = notesOf(pattern).map((n) => n.slot);
  const shuffle = (xs: number[]) => xs.map((x) => [r(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
  const kept = start.filter((s) => notes.includes(s));
  const added = notes.filter((s) => !kept.includes(s));
  const order = kept.length
    ? [...kept, ...shuffle(added)]
    : [0, ...shuffle(notes.filter((s) => s !== 0 && s % grouping === 0)), ...shuffle(notes.filter((s) => s % grouping !== 0))];
  // Move each tension note right after its resolution when it would come first.
  for (let k = 0; k < notes.length; k++) {
    const slot = notes[k]!;
    if (RESOLVES[degree(pattern[slot]!, key)] === undefined) continue;
    const target = notes[(k + 1) % notes.length]!;
    const at = order.indexOf(slot), res = order.indexOf(target);
    if (at < res) { order.splice(at, 1); order.splice(order.indexOf(target) + 1, 0, slot); }
  }
  return order;
}

export function generatePattern(key: KeySig, grouping: number, r: () => number, length = 12): Cell[] {
  for (;;) {
    const slots = rhythm(grouping, length, r);
    const steps = pitches(slots, key, grouping, r);
    if (!steps) continue; // this rhythm can't carry a well-formed loop: draw another
    const pattern: Cell[] = Array(length).fill(null);
    slots.forEach((s, k) => (pattern[s] = steps[k]!));
    return pattern;
  }
}

/** One small change to a pattern, as a composer would vary it, keeping it well formed. */
export function varyPattern(pattern: Cell[], key: KeySig, r: () => number): { pattern: Cell[]; label: string } | undefined {
  const notes = notesOf(pattern);
  const free = pattern.flatMap((c, i) => (c ? [] : [i]));
  const candidates: { pattern: Cell[]; label: string }[] = [];
  const set = (changes: [number, Cell][]) => { const p = [...pattern]; for (const [i, c] of changes) p[i] = c; return p; };
  for (const n of notes) {
    // Neighbour: one note a step up or down.
    for (const d of [-1, 1]) candidates.push({ pattern: set([[n.slot, fromIndex(index(n.step) + d)]]), label: `neighbour note on pulse ${n.slot + 1}` });
    if (n.slot === 0) continue;
    // Displacement: an off-beat note moves to the free pulse before or after it (anticipation, delay).
    for (const d of [-1, 1]) {
      const to = n.slot + d;
      if (free.includes(to) && to > 0) candidates.push({ pattern: set([[n.slot, null], [to, n.step]]), label: `note moved to pulse ${to + 1}` });
    }
    // Thinning: a note drops out (never below five).
    if (notes.length > 5) candidates.push({ pattern: set([[n.slot, null]]), label: `note on pulse ${n.slot + 1} left out` });
  }
  // Passing note: fill a rest between two notes a third apart.
  for (let k = 0; k < notes.length; k++) {
    const a = notes[k]!, b = notes[(k + 1) % notes.length]!;
    const gap = free.filter((s) => (b.slot > a.slot ? s > a.slot && s < b.slot : s > a.slot));
    if (gap.length && notes.length < 10 && Math.abs(index(b.step) - index(a.step)) === 2) {
      candidates.push({ pattern: set([[gap[0]!, fromIndex((index(a.step) + index(b.step)) / 2)]]), label: `passing note on pulse ${gap[0]! + 1}` });
    }
  }
  // Never worse than before (a pattern drawn by hand may break a rule on purpose); the fewest violations win.
  const scored = candidates.map((c) => ({ ...c, bad: violations(c.pattern, key).length }));
  const best = Math.min(violations(pattern, key).length, ...scored.map((c) => c.bad));
  const good = scored.filter((c) => c.bad === best).map(({ pattern: p, label }) => ({ pattern: p, label }));
  return good.length ? good[Math.floor(r() * good.length)] : undefined;
}
