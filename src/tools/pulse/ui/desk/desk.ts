// UI experiment 1: a desk of targets plus a pattern grid. Edits go through
// player.edit (heard next cycle), targets through player.steer (reached gradually).
// Importing this module builds the page and exports `desk`, the control surface for outside controllers.
import './style.css';
import { ENSEMBLE, EnsembleOutput, INSTRUMENTS, SOLO_PIANO, type InstrumentName, type Routing } from '../../../../runtime/ensemble-output';
import { ASPECTS } from '../../../../runtime/information';
import type { Command, Desk, Snapshot } from '../../control';
import { Player, type Director } from '../../../../runtime/player';
import type { Device } from '../../devices';
import { initialState, step, type PulseState } from '../../engine';
import { CHANGEABLE, DEFAULTS, MAX_BITS, TOP, defaultScope, direct, effectiveScope, force, initialForm, levelFor, type Changeable, type FormScope, type FormState } from '../../form';
import { defaultPiece, defaultTargets, type Piece, type Targets } from '../../model';
import { generateScenario } from '../../scenario';
import { createVoicesView } from './voices';
import { keyName, name, sameStep, type Cell, type Step } from '../../theory';

// Dev: re-running this module in place would start a second player.
// Reload the page on any code update instead.
import.meta.hot?.on('vite:beforeUpdate', () => location.reload());

// Every load is a different piece: key, pattern, chords, accents and canon come from a fresh seed.
const startSeed = Math.floor(Math.random() * 1e9);
const start = generateScenario(startSeed, defaultScope.keys);
const piece: Piece = { ...defaultPiece, key: start.key, pattern: start.pattern, buildOrder: start.buildOrder, chords: start.chords };
const targets: Targets = { ...defaultTargets, key: start.key, grouping: start.grouping, canon: start.canon };

const ctx = new AudioContext();
const master = ctx.createGain();
master.connect(ctx.destination); // our own master node: room for DSP later (D8)
const output = new EnsembleOutput(ctx, master, targets.orchestration);
const player = new Player<PulseState, Piece, Targets>(ctx, output, step, initialState(piece, startSeed), piece, targets);

// The form director (D5b), switchable: when on, it steers through the same command path as the desk.
const formDirector: Director<PulseState, Piece, Targets> & { form: FormState; scope: FormScope; trace: { bits: number; base: number }[] } = {
  form: initialForm(1),
  scope: defaultScope,
  trace: [],
  hear(state, events, targets, piece) {
    const d = direct(this.form, state, events, targets, piece, this.scope);
    this.form = d.form;
    this.trace = [...this.trace, { bits: d.form.info?.total ?? 0, base: d.form.baseline }].slice(-120);
    return { steer: d.steer, edit: d.edit };
  },
};
const setFormAuto = (on: boolean) => {
  if (on) formDirector.form = initialForm(Date.now() % 1e6, levelFor(player.targets));
  player.director = on ? formDirector : undefined;
};
(window as unknown as { player: typeof player }).player = player; // for inspection
const renderListeners: (() => void)[] = [];

const $ = (id: string) => document.getElementById(id)!;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e: HTMLElement = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e as HTMLElementTagNameMap[K];
}

// ---- Page layout ----------------------------------------------------------

const heading = (text: string, hint: string) => el('h2', {}, text, ' ', el('small', { textContent: hint }));
const header = el('header', {},
  el('h1', { textContent: 'Pulse' }),
  el('button', { id: 'play', textContent: 'Start' }),
  el('button', { id: 'pause', textContent: 'Pause', disabled: true }),
  el('label', { className: 'volume' }, 'volume ', el('input', { id: 'volume', type: 'range', min: '0', max: '1', step: '0.01' })),
  el('button', { id: 'regenerate', textContent: 'New scenario', title: 'new pattern, build order, chords and key; the music morphs into it note by note' }),
  el('nav', { className: 'views' }, el('button', { id: 'view-desk', className: 'active', textContent: 'Desk' }), el('button', { id: 'view-voices', textContent: 'Voices' })),
  el('span', { id: 'status', textContent: 'stopped' }),
);
document.body.append(
  header,
  el('main', { id: 'desk-view' },
    el('section', { id: 'desk', ariaLabel: 'Targets' }),
    el('section', {},
      heading('Pattern', 'click to set a note, click again to clear; the click order is the build order'),
      el('div', { id: 'grid' }),
      el('h2', { textContent: 'Sounding' }),
      el('div', { id: 'layers' }),
      heading('Form', "information per cycle (bits) against the music's background flow; novelty per aspect"),
      el('div', { id: 'form' }),
    ),
  ),
  el('section', { id: 'voices', hidden: true, ariaLabel: 'Voices' }),
);

// ---- Desk -------------------------------------------------------------

// Controls re-read their target on every render, so changes from elsewhere (the conductor) show up.
const syncs: (() => void)[] = [];

function slider(label: string, min: number, max: number, stepBy: number, get: () => number, set: (v: number) => void, show = (v: number) => String(v)) {
  const out = el('output', { textContent: show(get()) });
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(stepBy), value: String(get()) });
  input.oninput = () => { set(Number(input.value)); out.textContent = show(Number(input.value)); };
  syncs.push(() => { if (document.activeElement !== input) { input.value = String(get()); out.textContent = show(get()); } });
  return el('label', {}, label, input, out);
}

function select<V extends string | number>(label: string, options: [V, string][], get: () => V, set: (v: V) => void) {
  const s = el('select');
  for (const [v, text] of options) s.append(el('option', { value: String(v), textContent: text, selected: v === get() }));
  s.onchange = () => set(options[s.selectedIndex]![0]);
  syncs.push(() => { s.selectedIndex = options.findIndex(([v]) => v === get()); });
  return el('label', {}, label, s, el('output'));
}

function check(label: string, get: () => boolean, set: (v: boolean) => void) {
  const c = el('input', { type: 'checkbox', checked: get() });
  c.onchange = () => set(c.checked);
  syncs.push(() => { c.checked = get(); });
  return el('label', {}, label, c, el('output'));
}

const t = () => player.targets;
const steer = (patch: Partial<Targets>) => player.steer(patch, 'ui');
const pct = (v: number) => `${Math.round(v * 100)}%`;

// Devices are read from the targets, so changes made by the form director show up here too.
const devices = () => t().devices;
const transposeSteps = () => { const d = devices().find((x) => x.kind === 'transpose'); return d?.kind === 'transpose' ? d.steps : 0; };
const hasDevice = (kind: Device['kind']) => devices().some((d) => d.kind === kind);
const withDevice = (kind: Device['kind'], device?: Device) => steer({ devices: [...devices().filter((d) => d.kind !== kind), ...(device ? [device] : [])] });

const group = (legend: string, ...children: Node[]) => el('fieldset', {}, el('legend', { textContent: legend }), ...children);

// Orchestration is a target (part of the form, D5b): every change goes through steer and is heard by the
// listener; the output follows the targets once the instruments have loaded (see syncOrchestration).
function routingControls() {
  const names = Object.keys(INSTRUMENTS) as InstrumentName[];
  const layers = Object.keys(SOLO_PIANO);
  const preset = (label: string, routing: Routing) => {
    const b = el('button', { textContent: label });
    b.onclick = () => steer({ orchestration: { ...routing } });
    return b;
  };
  return group('instruments',
    el('label', {}, 'preset', el('span', {}, preset('solo piano', SOLO_PIANO), ' ', preset('ensemble', ENSEMBLE)), el('output')),
    ...layers.map((layer) => select(layer, names.map((n) => [n, INSTRUMENTS[n].label] as [InstrumentName, string]),
      () => t().orchestration[layer] ?? 'piano', (name) => steer({ orchestration: { ...t().orchestration, [layer]: name } }))),
  );
}

let routing = '';
/** Make the output play the orchestration in the targets (loads new instruments first). */
async function syncOrchestration() {
  const wanted = JSON.stringify(player.targets.orchestration);
  if (wanted === routing || wanted === JSON.stringify(output.routing)) { routing = wanted; return; }
  routing = wanted;
  try {
    await output.route(player.targets.orchestration);
  } catch (error) {
    $('status').textContent = `could not load instruments (${String(error)}); kept the previous ones`;
  }
}

// ---- Form guidance ------------------------------------------------------

const scope = () => formDirector.scope;
const setScope = (patch: Partial<FormScope>) => { formDirector.scope = { ...formDirector.scope, ...patch }; render(player.state); };
const modulation = () => scope().modulation ?? { periodMin: 0, bits: 0, pace: 0, ceiling: 0 };
const setModulation = (patch: Partial<NonNullable<FormScope['modulation']>>) => setScope({ modulation: { ...modulation(), ...patch } });
const secondsPerCycle = () => (60 / player.piece.pulsesPerMinute) * player.piece.cycleLength;
const KEY_OPTIONS = Array.from({ length: 11 }, (_, i) => [i - 4, keyName(i - 4)] as [number, string]);

/** A select without its own label row, for compact pairs. */
function bare<V extends string | number>(options: [V, string][], get: () => V, set: (v: V) => void) {
  const s = el('select');
  for (const [v, text] of options) s.append(el('option', { value: String(v), textContent: text, selected: v === get() }));
  s.onchange = () => set(options[s.selectedIndex]![0]);
  syncs.push(() => { s.selectedIndex = options.findIndex(([v]) => v === get()); });
  return s;
}

function toggles<V extends string>(label: string, options: V[], get: () => V[], set: (v: V[]) => void) {
  const box = el('span', { className: 'toggles' });
  for (const o of options) {
    const c = el('input', { type: 'checkbox', checked: get().includes(o) });
    c.onchange = () => {
      const next = c.checked ? [...get(), o] : get().filter((x) => x !== o);
      if (next.length) set(next); else c.checked = true; // at least one
    };
    syncs.push(() => { c.checked = get().includes(o); });
    box.append(el('label', { className: 'toggle' }, c, o));
  }
  return el('div', { className: 'row' }, el('span', { className: 'row-label', textContent: label }), box);
}

function buttons(...items: [string, string, () => void][]) {
  return el('div', { className: 'buttons' }, ...items.map(([text, title, onclick]) => {
    const b = el('button', { textContent: text, title });
    b.onclick = onclick;
    return b;
  }));
}

const forcePhase = (phase: 'build' | 'release' | 'turn') => {
  if (player.director !== formDirector) setFormAuto(true);
  formDirector.form = force(formDirector.form, phase, scope());
  render(player.state);
};

$('desk').append(
  group('form',
    check('auto', () => player.director === formDirector, setFormAuto),
    buttons(
      ['climax', 'build up to the ceiling now', () => forcePhase('build')],
      ['release', 'start coming down now', () => forcePhase('release')],
      ['turn', 'change something now', () => forcePhase('turn')],
    ),
    slider('ceiling', 2, TOP, 1, () => scope().maxLevel ?? TOP, (v) => setScope({ maxLevel: v }), (v) => `rung ${v + 1}${v >= 7 ? '' : ' (no pulse)'}`),
    slider('valley', 0, 6, 1, () => scope().valley ?? DEFAULTS.valley, (v) => setScope({ valley: v }), (v) => `rung ${v + 1}`),
  ),
  group('novelty',
    // In bits: how much news one change brings (the director learns what each kind of change costs).
    slider('bits per change', 2, MAX_BITS, 1, () => scope().budgetBits ?? DEFAULTS.budgetBits, (v) => setScope({ budgetBits: v }), (v) => `${v} bits`),
    slider('pace', 0, 16, 1, () => scope().quietCycles ?? DEFAULTS.quietCycles, (v) => setScope({ quietCycles: v }),
      (v) => (v ? `${Math.round(v * secondsPerCycle())} s quiet` : 'no wait')),
    slider('modulation reach', 1, 3, 1, () => scope().reach ?? DEFAULTS.reach, (v) => setScope({ reach: v }), (v) => `${v} fifth${v > 1 ? 's' : ''}`),
    el('div', { className: 'row' }, el('span', { className: 'row-label', textContent: 'keys' }), el('span', { className: 'pair' },
      bare(KEY_OPTIONS, () => scope().keys[0], (lo) => setScope({ keys: [Math.min(lo, scope().keys[1]), scope().keys[1]] })), ' to ',
      bare(KEY_OPTIONS, () => scope().keys[1], (hi) => setScope({ keys: [scope().keys[0], Math.max(hi, scope().keys[0])] })))),
    toggles('turns may change', CHANGEABLE, () => scope().aspects, (aspects) => setScope({ aspects: aspects as Changeable[] })),
    toggles('timbre uses', Object.keys(INSTRUMENTS) as InstrumentName[], () => scope().instruments ?? (Object.keys(INSTRUMENTS) as InstrumentName[]),
      (instruments) => setScope({ instruments })),
  ),
  group('slow modulation of the form',
    slider('period', 0, 30, 1, () => modulation().periodMin, (v) => setModulation({ periodMin: v }), (v) => (v ? `${v} min` : 'off')),
    slider('on bits', 0, 1, 0.05, () => modulation().bits, (v) => setModulation({ bits: v }), pct),
    slider('on pace', 0, 1, 0.05, () => modulation().pace, (v) => setModulation({ pace: v }), pct),
    slider('on ceiling', 0, 1, 0.05, () => modulation().ceiling, (v) => setModulation({ ceiling: v }), pct),
  ),
  group('texture',
    slider('density', 0, 1, 0.05, () => t().density, (v) => steer({ density: v }), pct),
    slider('pulse voices', 0, 4, 1, () => t().pulseVoices, (v) => steer({ pulseVoices: v })),
    slider('breath', 0, 4, 1, () => t().breath, (v) => steer({ breath: v })),
    slider('3rds below', 0, 1, 0.05, () => t().doubling, (v) => steer({ doubling: v }), pct),
    select('accents', [[2, '6 x 2'], [3, '4 x 3'], [4, '3 x 4'], [6, '2 x 6']], () => t().grouping, (v) => steer({ grouping: v })),
  ),
  group('canon',
    check('on', () => t().canon.on, (on) => steer({ canon: { ...t().canon, on } })),
    slider('offset', 1, 11, 1, () => t().canon.offset, (offset) => steer({ canon: { ...t().canon, offset } }), (v) => `${v} p`),
    select('interval', [[0, 'unison'], [2, '3rd up'], [4, '5th up'], [5, '6th up'], [-2, '3rd down']], () => t().canon.interval, (interval) => steer({ canon: { ...t().canon, interval } })),
  ),
  group('pitch',
    select('key', Array.from({ length: 11 }, (_, i) => [i - 4, keyName(i - 4)] as [number, string]), () => t().key, (key) => steer({ key })),
    slider('transpose', -3, 3, 1, transposeSteps, (v) => withDevice('transpose', v ? { kind: 'transpose', steps: v } : undefined)),
    check('inversion', () => hasDevice('invert'), (v) => withDevice('invert', v ? { kind: 'invert', axis: { letter: 2, octave: 5 } } : undefined)),
    check('retrograde', () => hasDevice('retrograde'), (v) => withDevice('retrograde', v ? { kind: 'retrograde' } : undefined)),
  ),
  group('pace',
    slider('stage dwell', 1, 8, 1, () => t().stageDwell, (v) => steer({ stageDwell: v }), (v) => `${v} cy`),
    slider('chord dwell', 2, 16, 1, () => t().chordDwell, (v) => steer({ chordDwell: v }), (v) => `${v} cy`),
  ),
  routingControls(),
);

// ---- Pattern grid -------------------------------------------------------

const ROWS: Step[] = Array.from({ length: 11 }, (_, i) => 43 - i).map((n) => ({ letter: n % 7, octave: Math.floor(n / 7) }));

function editCell(col: number, pitch: Step) {
  const { pattern, buildOrder } = player.piece;
  const clearing = sameStep(pattern[col] ?? null, pitch);
  const next: Cell[] = pattern.map((c, i) => (i === col ? (clearing ? null : pitch) : c));
  const order = clearing ? buildOrder.filter((i) => i !== col) : buildOrder.includes(col) ? buildOrder : [...buildOrder, col];
  player.edit({ pattern: next, buildOrder: order }, 'ui');
  render(player.state);
}

function renderGrid(state: PulseState) {
  const { pattern, buildOrder, cycleLength } = player.piece;
  const key = state.key;
  const grid = el('div', { className: 'grid' });
  grid.style.setProperty('--cols', String(cycleLength));
  for (const pitch of ROWS) {
    grid.append(el('span', { className: 'row-label', textContent: name(pitch, key) }));
    for (let col = 0; col < cycleLength; col++) {
      const composed = sameStep(pattern[col] ?? null, pitch);
      const sounding = sameStep(state.pattern[col] ?? null, pitch);
      const cell = el('div', {
        className: `cell${sounding ? ' on' : composed ? ' goal' : ''}${col % player.targets.grouping === 0 ? ' beat' : ''}`,
        textContent: composed ? String(buildOrder.indexOf(col) + 1) : '',
        title: `${name(pitch, key)}, pulse ${col + 1}`,
      });
      cell.onclick = () => editCell(col, pitch);
      grid.append(cell);
    }
  }
  $('grid').replaceChildren(grid);
}

function renderLayers(state: PulseState) {
  const L = player.piece.cycleLength;
  const row = (label: string, cells: Cell[]) => {
    const r = el('div', { className: 'layer' }, el('span', { className: 'name', textContent: label }));
    r.style.setProperty('--cols', String(L));
    cells.forEach((c, i) => r.append(el('span', { className: state.accents[i] ? 'accent' : '', textContent: c ? name(c, state.key) : '' })));
    return r;
  };
  const canon = Array.from({ length: L }, (_, p) => state.canon[(p - state.canonOffset + L) % L] ?? null);
  const chord = [...state.chord, ...Array<Cell>(L - state.chord.length).fill(null)];
  $('layers').replaceChildren(
    row('pattern', state.pattern), row('canon', canon), row('3rds', state.doubling),
    row(`chord ${state.chordIndex + 1}/${player.piece.chords.length}`, chord),
  );
}

function renderForm() {
  if (player.director !== formDirector) {
    $('form').replaceChildren(el('div', { className: 'muted', textContent: 'off: steer by hand, or switch form to auto' }));
    return;
  }
  const f = formDirector.form;
  const W = 480, H = 60, trace = formDirector.trace;
  const max = Math.max(20, ...trace.map((p) => p.bits));
  const line = (get: (p: { bits: number; base: number }) => number) =>
    trace.map((p, i) => `${(i / 119) * W},${H - (get(p) / max) * H}`).join(' ');
  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><polyline points="${line((p) => p.base)}" fill="none" stroke="#c9d6dd" stroke-width="2"/><polyline points="${line((p) => p.bits)}" fill="none" stroke="#2f4b5c" stroke-width="1.2"/></svg>`;
  const aspects = el('div', { className: 'aspects' });
  for (const a of ASPECTS) {
    const v = f.noveltyEma[a];
    const bar = el('div', { className: 'bar' });
    bar.style.width = `${Math.round(Math.min(1, v * 2) * 200)}px`;
    aspects.append(el('span', { className: 'muted', textContent: a }), el('div', {}, bar), el('span', { className: 'muted', textContent: v.toFixed(2) }));
  }
  const phase = el('div', { className: 'phase' });
  phase.innerHTML = `<b>${f.phase}</b> . rung ${f.level + 1} of peak ${f.peak + 1} . arc ${f.arc}${f.lastTurn ? ` . last turn: ${f.lastTurn}` : ''}`;
  const now = effectiveScope(scope(), (f.heard * secondsPerCycle()) / 60);
  const last = f.lastChange ? ` . last change: planned ${Math.round(f.lastChange.planned)}, measured ${Math.round(f.lastChange.measured)} bits` : '';
  const costs = Object.entries(f.cost).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ');
  const params = el('div', { className: 'muted', textContent: `now: ${Math.round(now.budgetBits)} bits per change, ${now.quietCycles} quiet cycles, ceiling rung ${now.ceiling + 1}${last}` });
  const learned = el('div', { className: 'muted', textContent: `learned cost (bits): ${costs}` });
  const chart = el('div');
  chart.innerHTML = svg;
  $('form').replaceChildren(phase, params, learned, chart, aspects);
}

function render(state: PulseState) {
  for (const sync of syncs) sync();
  void syncOrchestration();
  renderGrid(state);
  renderLayers(state);
  renderForm();
  $('pause').textContent = player.paused ? 'Resume' : 'Pause';
  ($('pause') as HTMLButtonElement).disabled = !player.playing;
  $('status').textContent = player.paused ? 'paused' : player.playing
    ? `${keyName(state.key)} . cycle ${state.cycle} . pulse ${state.pulseVoices} . breath ${state.breathDepth} . ${player.decisions.length} decisions`
    : 'stopped';
  for (const listener of renderListeners) listener();
}

async function play() {
  if (player.paused) return resume();
  $('status').textContent = 'loading instruments...';
  try {
    await player.start();
  } catch (error) {
    $('status').textContent = `could not start (${String(error)})`;
    throw error;
  }
  $('play').textContent = 'Stop';
  render(player.state);
}

function stop() {
  player.stop();
  $('play').textContent = 'Start';
  render(player.state);
}

async function pause() {
  const paused = await player.pause();
  render(player.state);
  if (!paused) throw new Error('nothing is playing');
}

async function resume() {
  await player.resume();
  render(player.state);
}

/** Master volume, 0..1, on our own master node (perceptually: squared). */
const stored = Number(localStorage.getItem('pulse.volume'));
let volume = localStorage.getItem('pulse.volume') !== null && Number.isFinite(stored) ? stored : 0.8;
function setVolume(v: number) {
  volume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : volume;
  master.gain.setTargetAtTime(volume * volume, ctx.currentTime, 0.05);
  localStorage.setItem('pulse.volume', String(volume));
  ($('volume') as HTMLInputElement).value = String(volume);
}
setVolume(volume);
$('volume').oninput = () => setVolume(Number(($('volume') as HTMLInputElement).value));

$('play').onclick = () => (player.playing ? stop() : play().catch(() => {}));
$('pause').onclick = () => void (player.paused ? resume() : pause().catch(() => {}));

/** A new scenario: pattern, build order, chords and key. Piece edits, so the engine morphs into it note by note. */
function regenerate() {
  const seed = Math.floor(Math.random() * 1e9);
  const scenario = generateScenario(seed, formDirector.scope.keys);
  player.edit({ pattern: scenario.pattern, buildOrder: scenario.buildOrder, chords: scenario.chords }, 'scenario');
  player.steer({ key: scenario.key, devices: [], grouping: scenario.grouping, canon: { ...scenario.canon, on: player.targets.canon.on } }, 'scenario');
  if (player.director === formDirector) formDirector.form = initialForm(seed, levelFor(player.targets));
  render(player.state);
}
$('regenerate').onclick = regenerate;

// ---- Control surface: outside controllers use the same command path as the UI ----

function snapshot(): Snapshot {
  const f = formDirector.form;
  const st = player.state;
  return {
    playing: player.playing,
    paused: player.paused,
    volume,
    cycle: st.cycle,
    secondsPerCycle: (60 / player.piece.pulsesPerMinute) * player.piece.cycleLength,
    key: st.key,
    chord: { index: st.chordIndex, count: player.piece.chords.length },
    targets: player.targets,
    form: { auto: player.director === formDirector, phase: f.phase, level: f.level, peak: f.peak, arc: f.arc, lastTurn: f.lastTurn, scope: formDirector.scope },
    routing: output.routing,
    recent: player.decisions.slice(-8),
  };
}

async function apply(c: Command) {
  switch (c.type) {
    case 'steer': {
      const { canon, ...rest } = c.patch;
      player.steer({ ...rest, ...(canon && { canon: { ...player.targets.canon, ...canon } }) }, 'conductor');
      break;
    }
    case 'form':
      if (c.scope) formDirector.scope = c.scope;
      if (c.auto !== undefined) setFormAuto(c.auto);
      if (c.force) forcePhase(c.force);
      break;
    case 'instruments':
      player.steer({ orchestration: c.routing }, 'conductor');
      routing = JSON.stringify(c.routing);
      await output.route(c.routing); // answer once loaded
      break;
    case 'transport':
      if (c.action === 'stop') stop();
      else if (c.action === 'pause') await pause();
      // Browsers only allow audio after the user has interacted with the page.
      else if (!navigator.userActivation.hasBeenActive) throw new Error('the browser blocks audio until the user clicks the page once: ask them to press Start');
      else await play();
      break;
    case 'volume': setVolume(c.value); break;
  }
  render(player.state);
}

export const desk: Desk = {
  apply,
  snapshot,
  onRender: (listener) => void renderListeners.push(listener),
  header,
};

player.onCycle = (state) => render(state);

// ---- Views: the desk, or every voice live --------------------------------
const voices = createVoicesView($('voices'), ctx, () => output.routing);
player.onNote = (note) => voices.add(note);
function showView(view: 'desk' | 'voices') {
  $('desk-view').hidden = view !== 'desk';
  voices.show(view === 'voices');
  $('view-desk').classList.toggle('active', view === 'desk');
  $('view-voices').classList.toggle('active', view === 'voices');
}
$('view-desk').onclick = () => showView('desk');
$('view-voices').onclick = () => showView('voices');

setFormAuto(true); // the form is on from the start: press Start and it builds, sustains, releases and turns by itself
render(player.state);
