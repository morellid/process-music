import { expect, test } from 'vitest';
import { crossfadeToBands } from './vcsl-crossfade';

const sfz = `<group>
ampeg_release=15
<region>
xfout_lovel=0
xfout_hivel=83
sample=Marimba/soft.wav
pitch_keycenter=41
lokey=41
hikey=44
offset=22
volume=34.4
<region>
xfin_lovel=0
xfin_hivel=83
xfout_lovel=84
xfout_hivel=127
sample=Marimba/med.wav
pitch_keycenter=41
lokey=41
hikey=44
<region>
xfin_lovel=84
xfin_hivel=127
sample=Marimba/loud.wav
pitch_keycenter=41
lokey=41
hikey=44`;

test('crossfaded layers become non-overlapping velocity bands covering 0-127', () => {
  const regions = crossfadeToBands(sfz, 'https://x/', 0.3).groups[0]!.regions;
  expect(regions.map((r) => r.velRange)).toEqual([[0, 41], [42, 105], [106, 127]]);
  expect(regions[0]).toMatchObject({ sample: 'Marimba/soft', keyRange: [41, 44], pitch: 41, offset: 22, volume: 34.4 });
});

test('release is ours, not the SFZ 15 s', () => {
  expect(crossfadeToBands(sfz, 'https://x/', 0.3).defaults?.ampRelease).toBe(0.3);
});
