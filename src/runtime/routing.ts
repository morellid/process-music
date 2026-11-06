// Instrument metadata and presets (D3b). Pure: shared by the browser output and any external controller.

/**
 * Ranges are the sampled ranges; notes outside are folded by octaves.
 * Release: the VCSL files ask for 15 s, which would turn every retrigger and note end into a 15 s fade.
 */
export const INSTRUMENTS = {
  // gainDb balances the libraries: at the same note and velocity the VCSL marimba and vibraphone measured
  // 5-7 dB below the piano (2026-11-06), so a marimba pattern over piano layers was masked.
  piano: { label: 'piano', range: [21, 108], release: undefined, gainDb: 0 },
  marimba: { label: 'marimba', range: [41, 97], release: 0.3, gainDb: 6 },
  vibraphone: { label: 'vibraphone', range: [53, 89], release: 0.6, gainDb: 4 },
} as const;
export type InstrumentName = keyof typeof INSTRUMENTS;
export type Routing = Record<string, InstrumentName>;

export const LAYERS = ['pulse', 'bass', 'breath', 'pattern', 'canon', 'doubling'] as const;
export const SOLO_PIANO: Routing = { pulse: 'piano', bass: 'piano', breath: 'piano', pattern: 'piano', canon: 'piano', doubling: 'piano' };
export const ENSEMBLE: Routing = { pulse: 'piano', bass: 'piano', breath: 'vibraphone', pattern: 'marimba', canon: 'marimba', doubling: 'piano' };
