// Devices compute a *target* pattern. They never change what sounds directly:
// the engine reaches the target one note per stage (D5, "Compositional devices").
import { mirror, shift, type Cell, type Step } from './theory';

export type Device =
  | { kind: 'transpose'; steps: number }
  | { kind: 'invert'; axis: Step }
  | { kind: 'retrograde' }
  | { kind: 'octave'; index: number; dir: 1 | -1 };

function apply(p: Cell[], d: Device): Cell[] {
  switch (d.kind) {
    case 'transpose': return p.map((c) => c && shift(c, d.steps));
    case 'invert': return p.map((c) => c && mirror(c, d.axis));
    case 'retrograde': return [...p].reverse();
    case 'octave': return p.map((c, i) => (c && i === d.index ? { ...c, octave: c.octave + d.dir } : c));
  }
}

export const applyDevices = (pattern: Cell[], devices: Device[]): Cell[] => devices.reduce(apply, pattern);
