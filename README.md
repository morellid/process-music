# Pulse

**Play it: https://morellid.github.io/pulse/**

Minimalist pulse music that composes itself in the browser, in the general aesthetic of Steve Reich's *Music for 18 Musicians* period: pulsing chord cycles, breath-length swells, patterns built up one note at a time, canons, slow modulation. Not a pastiche, and it never stops: it changes slowly enough to sit behind your work.

## How it works

- **One note at a time.** Every change, from the UI or from the form, adds or removes a single note per stage, so the music morphs instead of jumping.
- **Form driven by information.** A listener measures how much is new in every cycle (in bits, per aspect: rhythm, pitch, register, loudness, harmony, texture, timbre). With form on *auto*, a director adds the next thing only once the last has been absorbed, builds to a climax, releases, then changes whichever aspect the ear has got most used to.
- **Orchestration is part of the form.** Each layer plays on piano, marimba or vibraphone; the same structure in a new colour counts as news.
- **You steer.** Set the ceiling and valley of the arcs, the novelty budget in bits per change, the pace, the keys it may modulate to, which aspects may change, and slow modulation of the form's own parameters. Or draw the pattern on the grid: click order is build order. "New scenario" generates a new pattern, chords and key, and the music morphs into it.
- **Two views.** *Desk* for the controls, *Voices* for every layer live as a scrolling piano roll.

Runs entirely in the browser: TypeScript, Vite, Web Audio, [smplr](https://github.com/danigb/smplr). Playback is scheduled ahead on a Worker clock, so it keeps playing in a background tab.

## Run

```bash
npm install
npm run dev     # http://localhost:7802
npm test
npm run build   # static site in dist/
```

## Code

- `src/runtime/`: player (Worker clock, lookahead scheduling, decisions log), instrument output, the information listener.
- `src/tools/pulse/`: model, stepper engine, compositional devices, form director, scenario generator.
- `src/tools/pulse/ui/desk/`: the page.
- `src/tools/pulse/control.ts`: the control surface for anything outside the page that wants to steer the music (the same command path as the UI).

Design decisions and their reasons: [DECISIONS.md](DECISIONS.md).

## Credits

Samples are loaded at runtime from the [smpldsnds](https://github.com/smpldsnds) mirrors used by smplr; none are in this repo.

- Piano: [Splendid Grand Piano](https://github.com/sfzinstruments/SplendidGrandPiano), Steinway samples released into the public domain by Akai.
- Marimba and vibraphone: [Versilian Community Sample Library](https://github.com/sgossner/VCSL), CC0.

## License

Code: MIT.
