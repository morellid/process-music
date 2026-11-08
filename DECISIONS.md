# Decisions

Started 2026-11-06. Revised after an adversarial review the same day. Status per decision below.

Where this says *conductor*, it means any controller outside the page that steers the music: it uses the control surface in `src/tools/pulse/control.ts` (the same command path as the UI). No conductor ships in this repo.

## D1 - Language and runtime: TypeScript in the browser (agreed)

Vite, no framework yet. Music logic testable in Node with Vitest. Python, Pyodide and Rust/WASM considered and rejected: no web UI loop, or overweight for the need.

## D2 - Order and shape: shared runtime, one engine + UIs per tool (agreed)

Tool 1 is **pulse** (*Music for 18 Musicians*-style, D5). Tool 2 is **tintinnabuli** (Pärt, D6).

Why this order (Davide, 2026-11-06): tintinnabuli form is decided before the music starts; it is a mechanism that unfolds, so it can't react in real time without ceasing to be tintinnabuli. Pulse music changes slowly and can modulate without abrupt changes that steal attention, so it is the natural ground for a real-time conductor.

```
src/
  runtime/        time, NoteEvent, scheduler (Worker clock), smplr output, command API, decisions log
  tools/pulse/    model, stepper engine, ui/<one folder per UI experiment>
  tools/tintinnabuli/  model, composer, stepper, ui/
```

2026-11-08 (Davide): both tools live in this repo, renamed from `pulse` to `process-music`; one page per tool (`/pulse/`, `/tintinnabuli/`) plus a landing page. A separate tintinnabuli repo would have to copy the runtime or publish it as a package. `theory.ts` moved to `runtime/`, since both tools use it.

## D3 - Piano (proposed)

smplr `SplendidGrandPiano` (sampled Steinway, 4 velocity layers, maintained, takes our own AudioContext). Only this output for now; Web MIDI to Pianoteq and WAV export when we actually record.

**Pedal is a Score event** (down/up), not a release time: the smplr output extends each note's duration to the next pedal-up. When MIDI arrives, the same events become CC64.

## D4 - Data model, stepper engine, one command path (proposed)

Most of the value is UI/UX and we will try many UIs, so the contract is serialisable, inspectable data. Three pieces of data, kept separate:

- **Piece**: what the composer wrote, including the **scope**: the parameters they leave open, as `{ choose: T[] }` or `{ range: [T, T] }`. Only parameters a UI or the conductor actually varies are open; everything else is a plain value (widening `T` to `Param<T>` later is cheap).
- **Decisions log**: timestamped resolved values (from the UI, the seeded picker or the AI). Piece + Decisions + seed reproduces exactly what was heard: replay, undo and "explain" depend on it.
- **Engine state**: where the process is (phrase index, last pitch, mode, alternation parity, RNG position).

**The engine is a stepper, not a whole-piece generator**: `step(state, params, rng) -> { events, boundary, nextState }`, one phrase at a time, running one phrase ahead of the clock. This is what makes endless playback, mid-piece changes and AI choices possible; a whole-piece `generate()` can't continue the past after a change. One RNG stream per concern, so changing one parameter doesn't reshuffle everything else.

**One command path.** UI and (later) AI both send commands, quantised to `now` (auditioning: next note), `phrase` or `section`. UIs mostly use `now`; the conductor only uses `phrase`/`section`. Building the UIs builds and tests the AI interface for free.

**Background playback is a day-one requirement.** This is focus music, so the tab is mostly hidden, and browsers throttle timers in hidden tabs. Each phrase is scheduled into Web Audio time ahead of playback, and the lookahead runs on a Worker timer. Acceptance test: 30 minutes in a hidden tab without drift or gaps.

## D5 - Tool 1: pulse engine (proposed, revised after review)

Reference: *Music for 18 Musicians*, *Music for a Large Ensemble*, *Eight Lines* (Reich's middle period, 1974-1983). Solo-piano reduction, not a pastiche.

### Pitch: a collection, not chords

- The Piece has a **pitch collection** (a diatonic mode). *18 Musicians* stays in one collection (3 sharps) for the whole hour: its 11 chords are voicings and bass changes inside it, not modulations.
- **Patterns are stored as degrees of the collection, never relative to the chord.** A chord change touches only the pulse and bass layers; patterns keep their pitches while the harmony moves underneath.
- **Chord cycle:** an ordered, fixed list of voicings inside the collection (as in Reich). The conductor varies how long each chord lasts and which cycle is used, not individual moves.
- **Modulation is our extension, and it is gradual by construction:** neighbouring keys on the circle of fifths differ by one pitch, so modulating means changing one pitch of the collection (e.g. D -> D#), one step at a time. Pattern notes on that degree move by a semitone; everything else stays. A distant key is reached by several one-pitch steps, each with its own dwell.

### Layers, each with its own register band and process state

1. **Pulse**: the current chord on every eighth note, **steady**, inside one velocity band, pedal dry. The ground never breathes.
2. **Breath**: a pulse doubling in another register that swells and fades by adding and removing notes, velocity moving only within one band. Each breath has its own length (jittered, ~5-10 s), free-running, not aligned to cycles.
3. **Pattern**: a rhythmic-melodic pattern over a fixed number of pulses (e.g. 12). **Build-up**: substitute notes for rests in a **composed order stored in the Piece** (every intermediate stage must be music, so no random order); strip-down is the reverse.
4. **Canon**: a second copy of the pattern displaced by k pulses (fixed-beat canon, not phasing), with its own substitution order. Gives resulting patterns.
5. Later: resulting-pattern highlights (the most foreground element of the original, so maybe never for focus use).

Deliberately left out: **cues** (in the original every change is announced by an audible cue; focus music wants the opposite) and **tempo changes** (tempo is a fixed Piece value, never a target: a tempo slew breaks the canon grid).

### One primitive for all change: add or remove one note per stage

Everything the policy can change is expressed as stages of that single primitive, so nothing can jump:

| Target | Realised as |
|---|---|
| density | build-up depth of pattern and canon |
| energy: register | add/drop one octave doubling at a time |
| energy: breath | breath depth (notes added per swell) |
| pulse on/off | thin chord tones one at a time, then rests replace pulses |
| canon offset k | strip the canon, rebuild at the new offset (only at a section boundary) |
| harmony | next chord in the cycle: voices move one at a time at the section boundary, finishing within the first N cycles |
| key | one pitch of the collection at a time (see above) |

Velocity only moves within a velocity band, never across smplr's 4 layers (a slew across them would switch timbre).

**Pacing:** each stage dwells several cycles (e.g. 4-8, biased by the policy). Targets have a **deadband**, and a direction reversal is allowed only after a dwell, so a policy hovering around a value can't make the music flicker. Changes are timed under a breath swell rather than on the exposed cycle downbeat.

### Compositional devices

**Principle: a device is a pure function that produces a *target* pattern (or layer state); the engine reaches it with the one-note primitive, using a composed or derived order, with dwell.** Devices never apply instantly. So the composer's vocabulary can grow without ever breaking "no abrupt change". Patterns are stored as `(degree, octave) | rest` on the pulse grid, which is what makes these transforms one-liners.

Pitch devices:

| Device | What it does | Reached by |
|---|---|---|
| **Collection change** (modulation) | Pattern keeps its degrees; pitches follow the new collection. C F E D in C major -> C F# E D (G major) -> C# F# E D (D major) | one pitch of the collection per step, circle of fifths |
| **Tonal-centre shift** | Same collection, different centre via the bass (A major <-> F# minor, the ambiguity *18 Musicians* lives in) | bass layer only, one note |
| **Diatonic transposition** | Pattern moved up/down n degrees inside the collection | one note at a time |
| **Melodic drift / morph** | Pattern A becomes pattern B (e.g. per work context) | one note substitution per stage |
| **Inversion, retrograde** | Diatonic mirror around an axis; reversed order | as morph targets, never instant |
| **Octave displacement** | One note moved an octave: new contour, same pitch classes | one note per stage |
| **Diatonic doubling** | Parallel 3rds/6ths (or octaves) added under/over the pattern | one doubled note per stage |
| **Canon at an interval** | Canon voice at a diatonic 3rd/5th/6th instead of the unison | canon strip/rebuild |

Rhythm and texture devices:

| Device | What it does | Reached by |
|---|---|---|
| **Build-up / strip-down** | Notes replace rests in a composed order, and back | one note per stage |
| **Accent regrouping** | 12 pulses heard as 3x4, 4x3 or 2x6 by moving accents; no pitch changes (a Reich hallmark) | accents move one at a time, within the velocity band |
| **Hocket** | Pattern split between two registers in alternation | one note reassigned per stage |
| **Augmentation** | A pattern's chord tones held 2x/3x longer in a slow lower layer (Reich's rhythmic augmentation) | built up as a new layer |
| **Resulting-pattern extraction** | Notes that emerge from pattern+canon composite brought out (later, foreground) | built up as a new layer |
| **Rotation** | Pattern starts on a different pulse | only at a section boundary (it is a jump) |
| **Additive length** | Pattern grows by a pulse (Glass-like), changes the cycle | only at a section boundary; breaks the canon grid, so off by default |

The composer opens a subset of devices in the scope (with their parameters); the policy/conductor picks among them. Devices compose: e.g. drift + diatonic doubling + collection change can run on different layers at once, each with its own dwell.

### Two kinds of change (fixes the D4 "now" conflict)

- **Piece edits** (pattern content, substitution order, collection, cycle, tempo): applied at the next cycle. This is what the composing UIs use; an edit is heard within seconds.
- **Targets** (the table above): slewed. The **slew rate belongs to the command source**: fast for UI preview, slow for the conductor.

### Time units

- **Cycle** = one pattern length (D4's "phrase" for this tool): the stepper unit.
- **Section** = the dwell on one chord. Its boundary is the only place a pattern swap or a canon-offset rebuild may start; the decisions log and `explain` refer to it.
- Breath phase is free-running state.

### Piano realism (test in build step 2.1)

- **Retrigger cuts the previous voice of the same key** in the output layer (a real piano re-strikes the string); otherwise repeated chords under pedal stack samples: mud, comb filtering, CPU.
- Pedal policy per layer (pulse dry; breath maybe a short pedal per swell).
- Per-note velocity and timing jitter (what sounds mechanical is identical retriggers).
- Check that smplr's velocity bands are usable; if not, Web MIDI to Pianoteq moves earlier.

First UI candidates: a targets desk with the process state visible; a pattern grid where you set the pattern and its substitution order and hear it build; a chord-cycle strip with voice-leading shown.

## D5b - Form driven by information flow (2026-11-06)

Davide's brief: the form builds up progressively, becomes rich, goes down, changes, goes up again, driven by a constant flow of information, balancing repetition vs variation and intensity vs sparsity in every aspect.

**Measure what the listener can predict.** An adaptive model listens to the engine's own output and computes the surprisal (-log2 p) of each cycle, per aspect, conditioned on the rhythmic slot (layer x position in the cycle), so exact repetition becomes predictable and its information falls towards zero:

| Aspect | Predicted symbol | Context |
|---|---|---|
| rhythm | onset or silence | layer x position |
| pitch | pitch class | layer x position |
| register | octave | layer x position |
| loudness | velocity bin | layer x position |
| harmony | pitch-class set of the cycle | previous cycle's set |
| texture | set of active layers | previous cycle's set |

Counts decay every cycle (memory of roughly 10 cycles = 20 s), so the model habituates like a listener: what repeats stops being news.

**Form = a director that keeps news flowing, one item at a time.** The director is a deterministic policy that steers targets each cycle:

- **Intensity ladder:** an ordered list of rungs (one pulse voice, two, a quarter of the pattern, breath, ..., full canon, 3rds) climbed and descended one rung at a time. Each rung is a target patch, realised by the engine one note per stage.
- **build:** add the next rung **when the last addition has been absorbed** (information rate back under a threshold), until this arc's peak.
- **sustain (rich):** repetition at full richness; one small variation (accent regrouping) halfway; leaves once the music is fully absorbed for a while.
- **release:** remove rungs, again one at a time as each is absorbed, down to this arc's floor.
- **turn (sparse):** change one thing, in the **most habituated aspect** (lowest recent novelty): harmony (key step), pitch (transpose, inversion, retrograde), rhythm (accent grouping, canon offset), register (canon interval). Change happens when the texture is sparse, so the novelty lands on few notes and does not steal attention.
- Each arc picks its own peak and floor (seeded), so arcs differ in height.

The principle: information per second ~ notes per second x surprise per note. Rich sections are repetitive (many notes, little surprise each); sparse sections carry the change (few notes, more surprise each). The director keeps the product moving without spikes: nothing new until the last new thing is absorbed.

Composer control: the director only acts on aspects and ranges left open in the scope (key range, allowed devices); "form: auto" can be switched off to steer by hand.

Refinements found by simulation and review (2026-11-06):
- **News is relative to the music's own background flow**, not an absolute number of bits: the chord cycle and the free-running breath keep producing information that never settles. A slow baseline (falls faster than it rises, a spike can't inflate it more than 2x) against a fast estimate.
- The breath is heard as a swell (how many notes per cycle), not note by note.
- **Warm-up:** nothing is steered for the first 10 cycles, while the listener has heard nothing.
- **Settled = the engine has realised the current rung and its news is absorbed.** Otherwise several layers morph at once.
- A returning symbol is never more surprising than a new one (blended escape estimate); faded counts are forgotten.
- **Turn choice:** most habituated relative to the aspect's own usual novelty, discounted by staleness (arcs since it last changed: the long timescale the 10-cycle model can't see), never the aspect just turned, and only aspects audible at the sparse point (pitch and register need the pattern sounding; register = canon interval if the canon sounds, else one pattern note displaced an octave).
- Keys outside the scope walk back one fifth at a time.

Simulated over 100 minutes: 8+ arcs of ~5-6 minutes, peaks of different heights, all four aspects turned.

Davide's adjustments (2026-11-06):
- **The pulsing chord is a climax element**: it enters at rung 8 of 14 (after pattern, breath, canon and 3rds), so arcs start and end without it. Low energy (cap rung 7) therefore means no pulse at all.
- **Novelty controls** in the scope, exposed in the desk and in `set_form`: `amount` (1-3: rungs per step and aspects per turn) and `quietCycles` (how long the music must sit absorbed before the next change; also stretches sustains).
- **New scenario** button: a seeded pattern (6-9 notes, mostly stepwise, downbeat always sounding), build order (strong pulses first), a cycle of 4 added-note chords over distinct basses (3rd, 5th, 7th, 9th), and a key. Applied as Piece edits, so the music morphs into it note by note.

Orchestration, novelty in bits and form guidance (2026-11-06):
- **Orchestration is part of the form.** The instrument per layer is a target (`orchestration`); the listener hears it as a seventh aspect, *timbre*. A timbre turn moves one sounding layer to another allowed instrument (only instruments that reach the layer's register: no bass on the vibraphone). The sustain variation is an accent regrouping or a re-colouring, whichever is more habituated: the same structure in a new colour.
- **Novelty is a budget of bits per change**, not a count. The director learns what each kind of change costs (a rung, a harmony fifth, a pitch device, ...) from the news the listener actually measured after it, and spends the budget: more rungs per step, more aspects per turn, and a harmony turn may modulate up to `reach` fifths.
- **Form guidance:** ceiling and valley of the arcs, keys the form may modulate to, which aspects may turn, which instruments timbre may use, and buttons to force climax, release or a turn.
- **Slow modulation of the form's own parameters** (bits, pace, ceiling) with a period in minutes, so the macro-form swells and ebbs too. "Modulation" in Davide's request was read both ways (key modulation reach, and parameter modulation).

## D3b - Instruments per layer (2026-11-06)

Each layer is routed to an instrument: piano (smplr SplendidGrandPiano), marimba (VCSL, F2-C#7), vibraphone soft mallets (smplr `Mallet`, F3-F6). Notes outside an instrument's range are folded by octaves into range. Vibraphone samples have two velocity layers split at 84; all engine velocities stay below it.

- The VCSL marimba separates soft/med/loud only with crossfades, which smplr ignores (all three layers sounded on every note). We load its SFZ ourselves and turn the crossfades into hard bands (0-41, 42-105, 106-127) in a smplr `Sampler` preset.
- VCSL files ask for a 15 s release; we use 0.3 s (marimba) and 0.6 s (vibraphone), otherwise every retrigger is a 15 s fade.
- A routing change takes effect only once its instruments have loaded; on failure the previous routing stays. Default is solo piano; an "ensemble" preset maps pulse/bass to piano, pattern/canon to marimba, breath to vibraphone, as in the *18 Musicians* line-up.

## D6 - Tool 2: tintinnabuli engine (built 2026-11-08)

Rules (Hillier's formalisation; Arvo Pärt Centre "formal algorithms"):

- **Tonality:** one tonic triad for the whole piece; no modulation. The M-voice moves in the matching diatonic scale.
- **M-voice:** stepwise around a central pitch, in one of four modes: 1 ascending from the centre, 2 descending to it from above, 3 descending from it, 4 ascending to it from below.
- **Several M-lines from day one** (`mvoices[]`): mensuration canon (the same line at proportional speeds, as in *Cantus* and *Arbos*) and register doubling are core devices. The first UI may expose only one line, but the model, engine and UIs must not assume one.
- **Phrase-length process:** additive (1, 2, 3 ... n), subtractive, fixed, or text-driven.
- **Text setting (verify against Hillier before coding):** one word = one M-voice gesture anchored on the centre; the syllable count sets how far it moves from or towards the centre; punctuation sets phrase ends and rest lengths (comma shorter than full stop); mode per word by position or alternation.
- **T-voice:** derived note by note from the M-voice: the 1st or 2nd triad note above/below, **excluding the unison** (if M is itself a triad note, superior 1st position is the next triad note above). Superior / inferior / alternating. Property tests: T is always in the triad, M is always stepwise.
- **Rhythm:** equal values with a lengthened phrase-final note, or text-derived; a breath between phrases.
- **Piano texture:** which hand plays which line, register, doublings, pedal per phrase.

**Form is fixed before the music starts** and unfolds as a mechanism; no changes mid-piece. The only place the conductor can act is *between* pieces: choosing the next piece's parameters (and so its length) before it starts. Form emerges from the process (an additive section ends when the phrase reaches n notes).

First UI candidates: text-to-music; centre-and-mode wheel with the T-voice ringing around it; phrase "staircase" timeline for form.

### As built (2026-11-08)

- **Composed whole, then stepped.** `compose(spec)` returns every note of the piece; the stepper only plays the notes that fall in each cycle (one unit per cycle). The shared Player and smplr output are reused unchanged. A *director* acts only once a piece and 5 s of silence are over, by swapping in the next composition (the "between pieces" of this decision).
- **Centre = tonic**, natural minor (70% of random pieces) or major. One M line per piece; modes cycle phrase by phrase.
- **Mensuration:** speeds where every speed divides the slowest (1:2, 1:3, 1:4, 1:2:4). Faster voices repeat the line; slower voices enter later by one breath per extra unit of speed (staggered entries, as in Cantus), which makes every voice's last note end at the same moment. A tutti tonic chord (each voice's centre and its T note) closes the piece. Cantus holds its last notes instead, which a decaying piano can't.
- **Instrument ranges:** pitches are never folded. A layer whose notes don't fit its instrument's range plays on the piano (`routingFor`); random pieces pick the register where most voices fit. The lowest canon voice often lands on piano, which suits a bass line.
- **Instruments never change inside a piece:** the next piece's samples are preloaded while the controls show it, its routing is set when the silence after the current piece begins, and already-scheduled notes keep their instrument. "Next piece now" stops the old piece and starts the new one from its first note: a clean cut, no overlap.
- **Rhythm:** equal units, the phrase-final note doubled, a breath of 1-3 units after each phrase, all scaled by the voice's speed.
- **Random pieces:** the phrase count is fitted to a random target length of 75-210 s.
- **Not built yet:** text setting (still to verify against Hillier), staggered canon entries, pedal, bells. Instruments: piano, vibraphone, marimba.
- **UI:** the whole piece as a score with a playhead (form is fixed, so it can be shown in full); controls edit only the next piece.

## D7 - Strudel: no (recommended)

Research and headless test (2026-11-06, `@strudel/core` 1.2.6): its pattern model fits cyclic music. But for solo-piano pulse music, build-up, fixed-beat canons and chord cycles are simple array operations in a stepper, while Strudel brings AGPL-3.0, an explicit anti-LLM project policy (Oct 2026), loose releases (npm last released Jan 2026; output API changed on unreleased `main`, PR 2138; the published package doesn't import in plain Node), no TypeScript types and opaque patterns that UIs can't inspect. A slew-limited stepper with persistent process state (D5) is also something Strudel's stateless patterns don't model. Would change the call only if we want a live-coding text UI.

## D8 - DSP: YAGNI

Composition never touches audio; we own the AudioContext and a master node, so an AudioWorklet can be inserted later.

## Build order

1. Runtime: stepper contract, Worker-clock scheduler, smplr output with pedal, command API, decisions log. Hidden-tab test.
2. Pulse engine: (2.1) steady pulse on one chord + piano realism tests; (2.2) breath layer; (2.3) pattern build-up with composed order; (2.4) canon; (2.5) chord cycle; (2.6) one-pitch modulation.
3. First pulse UI (targets desk); then more UI experiments.
4. Tintinnabuli tool (first version 2026-11-08).
