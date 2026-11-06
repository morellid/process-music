// The one primitive through which everything changes (D5): one position per stage.
import { sameStep } from './theory';

type Eq<T> = (a: T, b: T) => boolean;

/**
 * Which position changes next, when `current` must become `goal`.
 * `order` is the composed build order (Piece.buildOrder). Returns undefined when done.
 *
 * This choice shapes what every intermediate stage sounds like.
 */
export function nextChange<T>(current: T[], goal: T[], order: number[], eq: Eq<T>): number | undefined {
  const differs = (i: number) => !eq(current[i]!, goal[i]!);
  // Default: the first differing position in composed order, then any position left out of the order.
  const i = order.find(differs) ?? current.findIndex((_, j) => differs(j));
  return i === -1 ? undefined : i;
}

export function morphStep<T>(current: T[], goal: T[], order: number[], eq: Eq<T> = sameStep as Eq<T>): T[] {
  const i = nextChange(current, goal, order, eq);
  if (i === undefined) return current;
  const next = [...current];
  next[i] = goal[i]!;
  return next;
}
