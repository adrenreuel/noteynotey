# noteynotey

Gamified piano sight-reading. A note appears on the staff, you play it on a real piano (heard through the microphone), a MIDI keyboard, or the on-screen keyboard. Reading speed and accuracy drive per-note mastery, and weak notes come up more often. Every note on both clefs and every game mode is open from the start.

## Run

```bash
npm install
npm run dev      # https://localhost:5173
npm run dev:lan  # also on your network, e.g. https://10.0.0.228:5173 from a phone or iPad
npm run cert:lan # makes the certificate dev:lan needs for other devices (rerun if the Mac's address changes)
npm run build    # type-check and production build into dist/
```

Microphone and Web MIDI need a secure context: `localhost` works, and so does any HTTPS host. Web MIDI is supported in Chromium browsers and Firefox, but not in Safari.

To use the mic from a phone or iPad, run `npm run cert:lan` once. It makes a small local certificate authority in `.cert/` (gitignored) and a certificate for the Mac's network address signed by it. Get `.cert/noteynotey-ca.crt` onto the device (AirDrop works) and trust it once:

1. Open the file, then Settings, Profile Downloaded, Install.
2. Settings, General, About, Certificate Trust Settings: turn on "noteynotey local dev CA".

Then `npm run dev:lan` and open `https://<Mac's address>:5173` on the device. Add `?debug` to the address for a readout of what the mic hears on octaves and chords, for tuning detection on a real piano. Without `.cert/`, the dev server falls back to a throwaway certificate that only covers localhost.

## Structure

```
index.html              App shell: screens, sheets and dialogs
src/main.ts             Screens, rounds, piano sheet, wiring
src/styles.css          Design tokens and component classes
src/music/notes.ts      Note model and clef ranges
src/music/keys.ts       Major and minor keys: spelling, scale notes, accidentals, key signature wording
src/audio/pitch.ts      Mic capture, pitchy detection, onset/stability, tuning measurement
src/input/piano.ts      Mic and MIDI connection state and friendly error messages
src/input/midi.ts       Web MIDI note-on listener
src/input/keyboard.ts   On-screen piano
src/game/progress.ts    Persistence and migration, mastery, note picker, streaks, profiles
src/game/session.ts     One round: dealing notes, scoring answers
src/game/scroll.ts      Moving-line rounds (Zen, Tempo Run): schedule, waiting, timing, misses
src/game/modes.ts       Game modes and their card text
src/game/chords.ts      Octaves, chords and arpeggios: generators and the stacked-note round
src/game/melody.ts      Melody writer: phrases, motifs, chords, known tunes
src/music/tunes.ts      Public-domain tunes, as scale degrees (any key)
src/audio/backing.ts    Soft backing chords (not wired in for now)
src/ui/staff.ts         VexFlow staff: one note, a line of notes, or a stack (octave, chord)
src/ui/beatstrip.ts     Scrolling staff and playhead for the moving-line modes
src/ui/skillmap.ts      Full skill map and the home screen strip
legacy/                 Previous prototype, kept for reference
```

## How it works

- **First visit.** Straight to the home screen, playing on the on-screen keyboard. Clicking the piano name in the footer switches to an acoustic piano (the mic learns its tuning from middle C) or a digital one over MIDI.
- **Home.** Your piano, then the ways to play: Flash Notes (single notes), Zen (notes on a line that only moves when you play, so you go at your own speed), Tempo Run (notes slide toward a line at a steady beat, starting at 50 BPM and speeding up every 8 notes), Octaves (two notes an octave apart), Chords (root-position I, IV and V triads) and Arpeggios (broken chords on the waiting line). Octaves and chords can be played together or one note at a time, so they work with the mic too.
- **Melodies.** Zen and Tempo Run play short melodies in a major or minor key instead of random notes: arch-shaped phrases of 4 or 8 notes, mostly stepwise, ending on the tonic (or a question on the fifth answered by the next phrase), with a reused motif, favoring your weak notes. Sometimes a public-domain tune made only of notes you've played sneaks in, and the summary names it. Flash Notes stays random, in C.
- **Keys.** Every round except Flash Notes picks one of 18 keys, shown with a key signature and a badge in the round header: nine majors (C, G, D, A, E, F, B♭, E♭, A♭) and their relative minors. Minor melodies raise the 7th on the way up to the tonic (G♯ in A minor), drawn as an accidental on the note, with a courtesy accidental when that letter comes back unraised. The key is picked at random, with keys you find tricky coming up twice as often. Each key keeps its own accuracy and speed, and a key reads as tricky when its first-try accuracy is under 70% or well below your best key.
- **Detection.** 2048-sample frames go through pitchy (McLeod). A frame counts as voiced when it clears the noise gate and has clarity above 0.8. The expected note fires after 4 stable frames within 45 cents (about 65 ms); any other note needs 10 (about 165 ms), so attack transients and overtones aren't scored as wrong answers. A note is not repeated until it is released or re-struck (the start of a sharp rise in level, ignored for about 130 ms after a note counts so a ringing note can't count twice).
- **Piano profiles.** Each acoustic piano has a name, a noise floor (gate = 2x the floor, never below about -56 dBFS) and the median cents offset of middle C, so a piano tuned slightly flat or sharp still maps to the right keys.
- **Mastery.** `0.6 * accuracy + 0.4 * speed`, where accuracy is an EMA of first-try correctness and speed scales from 1 at 1.5s to 0 at 6s. It is damped until a note has 6 attempts, and a note counts as mastered at 85%.
- **Scheduling.** Weighted random over every note on both clefs: never-played notes, lower mastery, few attempts, a recent miss, and time since last seen all increase the weight. The same note never appears twice in a row.
- **Streak and practice calendar.** Any day with at least one correct note counts, and skipping a whole day resets the streak. The skill map shows a year of practice days, shaded by notes played.
- **Storage.** Everything lives in `localStorage` under `noteynotey.progress.v1`, including the input choice and piano profiles.

## Ideas for later

Minor keys, both hands at once, chords, a progressive learning zone that widens as notes feel solid (without locking anything), and Hanon exercises. See the "Future ideas" section of [CLAUDE.md](CLAUDE.md) for how each would fit.
