// Instrument metadata and presets (D3b). Pure: shared by the browser output and any external controller.

/**
 * Ranges are the sampled ranges; notes outside are folded by octaves.
 * Release: the VCSL files ask for 15 s, which would turn every retrigger and note end into a 15 s fade.
 */
export const INSTRUMENTS = {
  piano: { label: 'piano', range: [21, 108], release: undefined },
  marimba: { label: 'marimba', range: [41, 97], release: 0.3 },
  vibraphone: { label: 'vibraphone', range: [53, 89], release: 0.6 },
} as const;
export type InstrumentName = keyof typeof INSTRUMENTS;
export type Routing = Record<string, InstrumentName>;

export const LAYERS = ['pulse', 'bass', 'breath', 'pattern', 'canon', 'doubling'] as const;
export const SOLO_PIANO: Routing = { pulse: 'piano', bass: 'piano', breath: 'piano', pattern: 'piano', canon: 'piano', doubling: 'piano' };
export const ENSEMBLE: Routing = { pulse: 'piano', bass: 'piano', breath: 'vibraphone', pattern: 'marimba', canon: 'marimba', doubling: 'piano' };
