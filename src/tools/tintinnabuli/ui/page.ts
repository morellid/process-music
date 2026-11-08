// Tintinnabuli page: the piece playing now (fixed, shown whole) and the next piece, which the controls edit.
// Nothing changes a piece while it plays (D6); the next one starts after a short silence, or at once on request.
import './style.css';
import { EnsembleOutput, INSTRUMENTS, type InstrumentName, type Routing } from '../../../runtime/ensemble-output';
import { Player, type Director } from '../../../runtime/player';
import { compose, describe, randomSpec, routingFor, tonicName } from '../compose';
import { CYCLE, elapsed, finished, initialState, step, type Piece, type TintiState } from '../engine';
import { CANONS, MODE_CYCLES, PROCESSES, T_VOICES, type Spec } from '../model';
import { drawScore } from './score';

import.meta.hot?.on('vite:beforeUpdate', () => location.reload());

const seed = () => Math.floor(Math.random() * 1e9);
const pieceOf = (spec: Spec): Piece => ({ pulsesPerMinute: spec.unitsPerMinute, cycleLength: CYCLE, composition: compose(spec) });
const pianoOnly = (routing: Routing): Routing => Object.fromEntries(Object.keys(routing).map((layer) => [layer, 'piano']));

let next = randomSpec(seed());
let keep = false; // keep the next-piece settings for every following piece, instead of a fresh random one
let upcoming: Piece | undefined; // the following piece, composed and routed once the current one has ended

const ctx = new AudioContext();
const master = ctx.createGain();
master.connect(ctx.destination);
const first = pieceOf(randomSpec(seed()));
const output = new EnsembleOutput(ctx, master, routingFor(first.composition));
const player = new Player<TintiState, Piece, Record<string, never>>(ctx, output, step, initialState(), first, {});
(window as unknown as { player: typeof player }).player = player;

/** Compose the next spec; a fresh random next is drawn unless the settings are kept. */
function takeNext(): Piece {
  const piece = pieceOf(next);
  if (!keep) next = randomSpec(seed());
  queueMicrotask(renderNext);
  return piece;
}

// Between pieces is the only moment anything changes (D6). When the silence after a piece begins, the following
// piece is composed and routed (its samples were preloaded while the controls showed it); when the silence ends, it starts.
// Notes already scheduled keep the instrument they were scheduled on, so routing early never recolours the old piece.
const between: Director<TintiState, Piece, Record<string, never>> = {
  hear(state, _events, _targets, piece) {
    if (elapsed(state, piece) < piece.composition.length) return undefined;
    if (!upcoming) {
      upcoming = takeNext();
      output.route(routingFor(upcoming.composition)).catch(() => {}); // on failure the old routing (or piano) plays
    }
    if (!finished(state, piece)) return undefined;
    const edit = upcoming;
    upcoming = undefined;
    return { edit };
  },
};
player.director = between;

// ---- Page ------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e: HTMLElement = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e as HTMLElementTagNameMap[K];
}

const playButton = el('button', { textContent: 'Start' });
const pauseButton = el('button', { textContent: 'Pause', disabled: true });
const volumeInput = el('input', { type: 'range', min: '0', max: '1', step: '0.01' });
const nextButton = el('button', { textContent: 'Next piece now', title: 'start the next piece at once' });
const status = el('span', { id: 'status', textContent: 'stopped' });
const nowText = el('p', { className: 'now' });
const canvas = el('canvas');
const controls = el('div', { id: 'controls' });
const nextText = el('p', { className: 'muted' });

document.body.append(
  el('header', {}, el('h1', { textContent: 'Tintinnabuli' }), playButton, pauseButton, el('label', { className: 'volume' }, 'volume ', volumeInput), nextButton, status),
  el('main', {},
    el('section', {}, el('h2', { textContent: 'Now playing' }), nowText, el('div', { className: 'score' }, canvas),
      el('p', { className: 'muted', textContent: 'Each colour is one voice of the canon: the melodic M voice solid, its T voice (notes of the tonic triad) lighter. The form is fixed before the first note.' })),
    el('section', {}, el('h2', { textContent: 'Next piece' }), controls, nextText),
  ),
);

// ---- Next-piece controls: they edit `next`, never the piece that is playing ----

const label = (text: string, input: HTMLElement) => el('label', {}, text, input);
function select<V>(text: string, options: [V, string][], get: () => V, set: (v: V) => void) {
  const s = el('select');
  options.forEach(([, name]) => s.append(el('option', { textContent: name })));
  s.onchange = () => { set(options[s.selectedIndex]![0]); renderNext(); };
  return { node: label(text, s), sync: () => { s.selectedIndex = options.findIndex(([v]) => JSON.stringify(v) === JSON.stringify(get())); } };
}
function range(text: string, min: number, max: number, get: () => number, set: (v: number) => void, show = (v: number) => String(v)) {
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: '1' });
  const out = el('output');
  input.oninput = () => { set(Number(input.value)); renderNext(); };
  return { node: el('label', {}, text, input, out), sync: () => { input.value = String(get()); out.textContent = show(get()); } };
}

const keys: [{ key: number; minor: boolean }, string][] = Array.from({ length: 9 }, (_, i) => i - 4).flatMap((key) =>
  [true, false].map((minor): [{ key: number; minor: boolean }, string] => [{ key, minor }, tonicName({ ...next, key, minor })]));
const instruments = Object.keys(INSTRUMENTS).map((name): [InstrumentName, string] => [name as InstrumentName, name]);
const ordinal = (p: number) => (p === 1 ? '1st' : '2nd');

const fields = [
  select('key', keys, () => ({ key: next.key, minor: next.minor }), (v) => { next = { ...next, ...v }; }),
  select('process', PROCESSES.map((k) => [k, k]), () => next.process.kind, (kind) => { next = { ...next, process: { ...next.process, kind } }; }),
  range('phrases up to', 2, 10, () => next.process.n, (n) => { next = { ...next, process: { ...next.process, n } }; }),
  select('M modes', MODE_CYCLES.map((m) => [m, m.join(', ')]), () => next.modes, (modes) => { next = { ...next, modes }; }),
  select('T voice', T_VOICES.map((t) => [t, `${t.side} ${ordinal(t.position)}`]), () => next.t, (t) => { next = { ...next, t }; }),
  select('canon', CANONS.map((c) => [c, c.length > 1 ? c.join(':') : 'one voice']), () => next.speeds, (speeds) => { next = { ...next, speeds }; }),
  range('breath', 1, 3, () => next.breath, (breath) => { next = { ...next, breath }; }, (v) => `${v} unit${v > 1 ? 's' : ''}`),
  range('tempo', 40, 120, () => next.unitsPerMinute, (unitsPerMinute) => { next = { ...next, unitsPerMinute }; }, (v) => `${v}/min`),
  select('M on', instruments, () => next.instruments.m, (m) => { next = { ...next, instruments: { ...next.instruments, m } }; }),
  select('T on', instruments, () => next.instruments.t, (t) => { next = { ...next, instruments: { ...next.instruments, t } }; }),
];
const keepBox = el('input', { type: 'checkbox' });
keepBox.onchange = () => { keep = keepBox.checked; };
const shuffle = el('button', { textContent: 'Shuffle', title: 'a new random next piece' });
shuffle.onclick = () => { next = randomSpec(seed()); renderNext(); };
controls.append(...fields.map((f) => f.node), el('label', { className: 'keep' }, keepBox, 'keep these settings for every piece'), el('div', { className: 'buttons' }, shuffle));

function renderNext() {
  for (const f of fields) f.sync();
  const composition = compose(next);
  nextText.textContent = `next: ${describe(next, composition.length)}`;
  output.preload(routingFor(composition)).catch(() => {}); // in time for the switch; a failure falls back to piano then
}

// ---- Now playing: description and the whole score with a moving playhead ----

/** Where the playhead was at a known audio time; onCycle fires when a cycle starts sounding. */
let mark = { position: 0, time: 0 };
let shown = player.piece.composition;

player.onCycle = (state) => {
  shown = state.playing ?? shown;
  mark = { position: elapsed(state, player.piece) - CYCLE, time: ctx.currentTime };
  renderStatus();
};

function position() {
  if (!player.playing) return 0;
  return Math.min(shown.length, mark.position + ((ctx.currentTime - mark.time) * shown.spec.unitsPerMinute) / 60);
}

let drawn = { composition: undefined as unknown, position: -1, width: 0 };
function frame() {
  const p = position(), width = canvas.parentElement!.clientWidth;
  if (drawn.composition !== shown || Math.abs(drawn.position - p) > 0.05 || drawn.width !== width) {
    drawScore(canvas, shown, p);
    nowText.textContent = describe(shown.spec, shown.length);
    drawn = { composition: shown, position: p, width };
  }
  requestAnimationFrame(frame);
}

function renderStatus() {
  pauseButton.textContent = player.paused ? 'Resume' : 'Pause';
  pauseButton.disabled = !player.playing;
  playButton.textContent = player.playing ? 'Stop' : 'Start';
  if (!player.playing) return void (status.textContent = 'stopped');
  const s = (u: number) => Math.round((u * 60) / shown.spec.unitsPerMinute);
  const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  status.textContent = player.paused ? 'paused' : `${clock(s(Math.min(position(), shown.length)))} / ${clock(s(shown.length))}`;
}

// ---- Transport ------------------------------------------------------------

async function start() {
  status.textContent = 'loading instruments...';
  try {
    await player.start();
  } catch {
    // A sample library failed to load: play this piece on the piano rather than not at all.
    output.ready = output.route(pianoOnly(routingFor(player.piece.composition)));
    try {
      await player.start();
    } catch (error) {
      status.textContent = `could not start (${String(error)})`;
    }
  }
  renderStatus();
}

/** Back to the first note of the current piece: a form is heard whole. */
function rewind() {
  player.state = initialState();
  mark = { position: 0, time: 0 };
}

playButton.onclick = async () => {
  if (!player.playing) return start();
  player.stop();
  rewind();
  renderStatus();
};
pauseButton.onclick = async () => {
  if (player.paused) await player.resume();
  else await player.pause();
  renderStatus();
};
// A clean cut: stop the old piece (nothing of it overlaps the new one), route, then start the next from its first note.
nextButton.onclick = async () => {
  const playing = player.playing;
  player.stop();
  const piece = upcoming ?? takeNext();
  upcoming = undefined;
  await output.route(routingFor(piece.composition)).catch(() => {});
  player.edit(piece, 'ui');
  rewind();
  if (playing) await start();
  else renderStatus();
};

const stored = localStorage.getItem('tintinnabuli.volume');
let volume = stored !== null && Number.isFinite(Number(stored)) ? Number(stored) : 0.8;
function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  master.gain.setTargetAtTime(volume * volume, ctx.currentTime, 0.05);
  localStorage.setItem('tintinnabuli.volume', String(volume));
  volumeInput.value = String(volume);
}
setVolume(volume);
volumeInput.oninput = () => setVolume(Number(volumeInput.value));

renderNext();
renderStatus();
requestAnimationFrame(frame);
