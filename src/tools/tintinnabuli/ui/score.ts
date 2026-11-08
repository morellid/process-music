// The whole piece at once: tintinnabuli form is fixed before it starts, so the page shows all of it and a
// playhead moving through. One colour per canon voice; the M voice solid, its T voice lighter.
import type { Composition } from '../compose';

const VOICE_COLOURS = ['#2f4b5c', '#b5533c', '#4f8a76'];

export function drawScore(canvas: HTMLCanvasElement, composition: Composition, position: number) {
  const dpr = devicePixelRatio || 1;
  const width = canvas.parentElement!.clientWidth, height = 340;
  const w = Math.round(width * dpr), h = Math.round(height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, width, height);

  const { events, length } = composition;
  const lo = Math.min(...events.map((e) => e.midi)) - 2, hi = Math.max(...events.map((e) => e.midi)) + 2;
  const x = (pulse: number) => (pulse / length) * width;
  const y = (midi: number) => 6 + (1 - (midi - lo) / (hi - lo)) * (height - 12);
  for (const e of events) {
    const voice = Number(e.layer.slice(1)) - 1;
    const sounded = e.pulse <= position;
    g.globalAlpha = (e.layer[0] === 'M' ? 1 : 0.45) * (sounded ? 1 : 0.4);
    g.fillStyle = VOICE_COLOURS[voice % VOICE_COLOURS.length]!;
    g.fillRect(x(e.pulse), y(e.midi) - 3, Math.max(2, x(e.duration) - 1), e.layer[0] === 'M' ? 6 : 4);
  }
  g.globalAlpha = 1;
  g.strokeStyle = '#23211d';
  g.beginPath(); g.moveTo(x(position), 0); g.lineTo(x(position), height); g.stroke();
}
