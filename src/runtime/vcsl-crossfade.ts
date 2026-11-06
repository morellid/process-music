import type { SmplrPreset } from 'smplr';

const VCSL = 'https://smpldsnds.github.io/sgossner-vcsl';

const mid = (lo?: string, hi?: string) => (lo === undefined || hi === undefined ? undefined : Math.round((Number(lo) + Number(hi)) / 2));

/**
 * Some VCSL instruments (the marimba) separate dynamic layers only with xfin/xfout crossfades, which smplr's
 * SFZ parser ignores: every layer would sound on every note. Turn each crossfade into a hard velocity band
 * split at the crossfade midpoints (soft 0-41, med 42-105, loud 106-127 for the marimba).
 */
export function crossfadeToBands(sfz: string, baseUrl: string, ampRelease: number): SmplrPreset {
  const regions = sfz.split('<region>').slice(1).map((block) => {
    const p = Object.fromEntries([...block.matchAll(/^(\w+)=(.+)$/gm)].map((m) => [m[1]!, m[2]!.trim()]));
    const low = mid(p.xfin_lovel, p.xfin_hivel) ?? 0;
    const high = (mid(p.xfout_lovel, p.xfout_hivel) ?? 128) - 1;
    return {
      sample: p.sample!.replace(/\.wav$/i, ''),
      keyRange: [Number(p.lokey), Number(p.hikey)] as [number, number],
      pitch: Number(p.pitch_keycenter),
      velRange: [low, high] as [number, number],
      ...(p.volume ? { volume: Number(p.volume) } : {}),
      // No `offset`: SFZ counts it in sample frames (a few ms here) while smplr's offset is in seconds. smplr
      // doesn't apply a preset region's offset today, but frames must never reach it as seconds.
    };
  });
  return { samples: { baseUrl, formats: ['ogg', 'm4a'] }, defaults: { ampRelease }, groups: [{ regions }] };
}

export async function vcslPreset(instrument: string, ampRelease: number): Promise<SmplrPreset> {
  const sfz = await fetch(`${VCSL}/${instrument}.sfz`).then((r) => {
    if (!r.ok) throw new Error(`VCSL ${instrument}: HTTP ${r.status}`);
    return r.text();
  });
  return crossfadeToBands(sfz, `${VCSL}/${instrument.slice(0, instrument.lastIndexOf('/') + 1)}`, ampRelease);
}
