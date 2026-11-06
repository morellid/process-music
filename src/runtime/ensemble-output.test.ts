import { expect, test, vi } from 'vitest';

// A fake smplr Sampler with the real one's behaviour that matters here: it starts loading its initial (empty)
// buffers at construction, and whichever load finishes last decides what the instrument plays.
const samplers: { preset: unknown }[] = [];
vi.mock('smplr', () => {
  const later = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const inst = () => ({ start: () => () => {}, stop: () => {}, output: { addEffect: () => {} } });
  return {
    Scheduler: () => ({ stop: () => {} }),
    Reverb: () => ({}),
    SplendidGrandPiano: () => ({ ...inst(), ready: Promise.resolve() }),
    Mallet: () => ({ ...inst(), ready: Promise.resolve() }),
    Sampler: () => {
      const s = { ...inst(), preset: undefined as unknown, ready: Promise.resolve(), reload: async (p: unknown) => { await later(1); s.preset = p; } };
      // The initial empty load is slow (finishes after the preset has been fetched and reloaded) and overwrites it.
      s.ready = later(20).then(() => { s.preset = 'empty'; });
      samplers.push(s);
      return s;
    },
  };
});
vi.mock('./vcsl-crossfade', () => ({ vcslPreset: async () => 'marimba preset' }));

test('the marimba keeps its preset even when the initial empty load finishes last', async () => {
  const { EnsembleOutput } = await import('./ensemble-output');
  const fakeNode = { connect: () => {}, gain: { value: 1 } };
  const context = { createGain: () => ({ ...fakeNode }) } as unknown as AudioContext;
  const output = new EnsembleOutput(context, fakeNode as unknown as AudioNode, { pattern: 'marimba' });
  await output.ready;
  await new Promise((r) => setTimeout(r, 40)); // let any late load land
  expect(samplers[0]!.preset).toBe('marimba preset');
});
