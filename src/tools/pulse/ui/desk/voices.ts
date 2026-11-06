// Voices view: what every layer is playing, live. One lane per layer, time flowing right to left past a
// playhead, notes coloured by instrument, brightness by velocity. Notes come from Player.onNote, in audio time.
import type { InstrumentName, Routing } from '../../../../runtime/routing';
import type { ScheduledNote } from '../../../../runtime/types';

type Note = ScheduledNote & { instrument: InstrumentName };

const LANES = ['pattern', 'canon', 'doubling', 'pulse', 'breath', 'bass'] as const;
const PAST = 8; // seconds shown before now
const FUTURE = 2; // seconds of already scheduled notes shown after now
const COLOURS: Record<InstrumentName, string> = { piano: '#2f4b5c', marimba: '#b5533c', vibraphone: '#4f8a76' };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (m: number) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

export function createVoicesView(container: HTMLElement, ctx: AudioContext, routing: () => Routing) {
  const canvas = document.createElement('canvas');
  const legend = document.createElement('div');
  legend.className = 'voices-legend';
  for (const instrument of Object.keys(COLOURS) as InstrumentName[]) {
    const swatch = document.createElement('i');
    swatch.style.background = COLOURS[instrument];
    const item = document.createElement('span');
    item.append(swatch, instrument);
    legend.append(item);
  }
  container.append(legend, canvas);

  let notes: Note[] = [];
  let visible = false;
  let lastFrame = -1;

  const add = (n: ScheduledNote) => {
    notes.push({ ...n, instrument: routing()[n.layer] ?? 'piano' });
    // Prune here too: a hidden browser tab stops requestAnimationFrame, so draw() may not run for hours.
    notes = notes.filter((x) => x.time + x.duration > ctx.currentTime - PAST);
  };

  function draw() {
    if (!visible) return;
    const now = ctx.currentTime;
    if (now === lastFrame) return void requestAnimationFrame(draw); // paused: nothing moved
    lastFrame = now;
    notes = notes.filter((n) => n.time + n.duration > now - PAST);

    const dpr = devicePixelRatio || 1;
    const width = container.clientWidth, laneH = 70, labelW = 150, height = LANES.length * laneH;
    const w = Math.round(width * dpr), h = Math.round(height * dpr); // fractional DPR: compare integers
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const plotW = width - labelW;
    const x = (t: number) => labelW + ((t - (now - PAST)) / (PAST + FUTURE)) * plotW;

    LANES.forEach((lane, i) => {
      const top = i * laneH;
      const laneNotes = notes.filter((n) => n.layer === lane);
      const sounding = laneNotes.filter((n) => n.time <= now && now < n.time + n.duration);
      const lo = Math.min(...laneNotes.map((n) => n.midi), 60) - 1;
      const hi = Math.max(...laneNotes.map((n) => n.midi), 61) + 1;
      const y = (m: number) => top + 8 + (1 - (m - lo) / (hi - lo)) * (laneH - 16);

      if (i % 2) {
        g.fillStyle = 'rgba(0,0,0,0.025)';
        g.fillRect(labelW, top, plotW, laneH);
      }
      g.strokeStyle = '#d8d2c4';
      g.beginPath(); g.moveTo(0, top + laneH - 0.5); g.lineTo(width, top + laneH - 0.5); g.stroke();

      // Label: layer, instrument, what sounds right now.
      const instrument = routing()[lane] ?? 'piano';
      g.fillStyle = '#23211d';
      g.font = '600 12px ui-sans-serif, system-ui';
      g.fillText(lane, 8, top + 20);
      g.fillStyle = COLOURS[instrument];
      g.font = '12px ui-sans-serif, system-ui';
      g.fillText(instrument, 8, top + 36);
      g.fillStyle = '#8a857a';
      g.font = '11px ui-sans-serif, system-ui';
      const soundingNames = [...new Set(sounding.map((n) => noteName(n.midi)))].join(' ');
      g.fillText(soundingNames || (laneNotes.length ? '' : 'silent'), 8, top + 54, labelW - 12);

      for (const n of laneNotes) {
        const x0 = Math.max(labelW, x(n.time)), x1 = Math.min(width, x(n.time + n.duration));
        if (x1 <= labelW) continue;
        const active = n.time <= now && now < n.time + n.duration;
        g.globalAlpha = Math.min(1, 0.25 + n.velocity / 110) * (n.time > now ? 0.35 : 1);
        g.fillStyle = COLOURS[n.instrument];
        g.fillRect(x0, y(n.midi) - 2.5, Math.max(1.5, x1 - x0 - 1), active ? 6 : 5);
      }
      g.globalAlpha = 1;
    });

    // Playhead: left of it has sounded, right of it is already scheduled.
    g.strokeStyle = '#b5533c';
    g.beginPath(); g.moveTo(x(now), 0); g.lineTo(x(now), height); g.stroke();
    requestAnimationFrame(draw);
  }

  return {
    add,
    show(on: boolean) {
      const start = on && !visible; // never stack a second animation loop
      visible = on;
      container.hidden = !on;
      if (start) { lastFrame = -1; requestAnimationFrame(draw); }
    },
  };
}
