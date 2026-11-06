import { describe, expect, test } from 'vitest';
import { accidentals, keyName, midi, name, shift, stepToward, type Step } from './theory';
import { applyDevices } from './devices';

const s = (letter: number, octave: number): Step => ({ letter, octave });
const C4 = s(0, 4), D4 = s(1, 4), E4 = s(2, 4), F4 = s(3, 4);

describe('key collections', () => {
  test('C F E D in C major becomes C# F# E D in D major, through G major', () => {
    const pattern = [C4, F4, E4, D4];
    expect(pattern.map((p) => name(p, 0))).toEqual(['C4', 'F4', 'E4', 'D4']);
    expect(pattern.map((p) => name(p, 1))).toEqual(['C4', 'F#4', 'E4', 'D4']);
    expect(pattern.map((p) => name(p, 2))).toEqual(['C#4', 'F#4', 'E4', 'D4']);
  });

  test('neighbouring keys differ by exactly one pitch', () => {
    for (let k = -6; k < 6; k++) {
      const a = accidentals(k), b = accidentals(k + 1);
      expect(a.filter((x, i) => x !== b[i])).toHaveLength(1);
    }
  });

  test('stepToward moves one key at a time', () => {
    expect(stepToward(0, 3)).toBe(1);
    expect(stepToward(0, -2)).toBe(-1);
    expect(stepToward(2, 2)).toBe(2);
  });

  test('midi and key names', () => {
    expect(midi(s(5, 4), 0)).toBe(69); // A4
    expect(midi(s(6, 3), -1)).toBe(58); // Bb3
    expect(keyName(3)).toBe('A major');
    expect(keyName(-1)).toBe('F major');
  });
});

describe('diatonic devices', () => {
  test('shift carries across octaves', () => {
    expect(shift(s(6, 4), 1)).toEqual(s(0, 5));
    expect(shift(C4, -2)).toEqual(s(5, 3));
  });

  test('transpose, invert, retrograde keep rests in place or mirror them', () => {
    const p = [C4, null, E4];
    expect(applyDevices(p, [{ kind: 'transpose', steps: 1 }])).toEqual([D4, null, F4]);
    expect(applyDevices(p, [{ kind: 'invert', axis: D4 }])).toEqual([E4, null, C4]);
    expect(applyDevices(p, [{ kind: 'retrograde' }])).toEqual([E4, null, C4]);
    expect(applyDevices(p, [{ kind: 'octave', index: 0, dir: 1 }])).toEqual([s(0, 5), null, E4]);
  });
});
