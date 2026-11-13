import {
  accidentalFor,
  degreeOf,
  KEYS,
  LEADING_TONE,
  scaleNotes,
  signatureAccidental,
  spell,
  type KeyDef,
} from '../music/keys';
import type { Clef, NoteDef } from '../music/notes';
import { TUNES } from '../music/tunes';
import { mastery, noteStatus, trickyKeys, type Progress } from './progress';

/*
 * Writes the notes for the melodic modes (Zen, Tempo Run) in one major or minor key per round: arch-shaped phrases of 4 or 8
 * notes, mostly stepwise, with a reused motif, harmonized I-IV-V-I (i-iv-V in
 * minor). The clef switches every 8 notes. The shapes work in scale steps, so
 * every key sounds alike. Minor melodies use the natural minor scale, then
 * raise the 7th where it leads up to the tonic or sits under the V chord.
 */

export type Chord = 'I' | 'IV' | 'V';

/** Semitones above the tonic in each chord, root first. Minor keys keep a major V, for its leading tone. */
const CHORD_TONES: Record<KeyDef['mode'], Record<Chord, number[]>> = {
  major: { I: [0, 4, 7], IV: [5, 9, 0], V: [7, 11, 2] },
  minor: { I: [0, 3, 7], IV: [5, 8, 0], V: [7, 11, 2] },
};

export function chordTones(chord: Chord, key: KeyDef): number[] {
  return CHORD_TONES[key.mode][chord];
}

// In minor, the 3rd and 6th rub hard against the major V chord, and the plain 7th fights its raised one.
const MINOR_V_CLASH = [3, 8, 10];
const CLASH_W = 0.15; // how much likelier a clashing note isn't

export interface MelodyPlan {
  key: KeyDef;
  notes: NoteDef[];
  /** The chord that starts on each note, or null where the previous chord carries on. */
  chords: (Chord | null)[];
  /** Known tunes woven into the round, by note index (end exclusive). */
  tunes: { name: string; start: number; end: number }[];
}

const BLOCK = 8; // notes per clef before switching, matching the moving line
const TUNE_CHANCE = 0.4; // chance a round includes a known tune, when one fits
const STEP_W = 0.76; // interval weights: mostly steps, some thirds, rare leaps
const THIRD_W = 0.18;
const LEAP_W = 0.03;
const ALONG_ARCH = 0.8; // how often a move follows the arch's direction
const CHORD_TONE_BOOST = 2; // on a chord change, chord tones are this much likelier
const TRIES = 80;
const TRICKY_KEY = 2; // a key that's tricky right now is this much likelier
const REPEAT_KEY = 0.4; // the last round's key is this much less likely

const PHRASE_CHORDS: Record<'eight' | 'question' | 'answer', (Chord | null)[]> = {
  eight: ['I', null, 'IV', null, 'V', null, 'I', null],
  question: ['I', 'IV', 'I', 'V'],
  answer: ['I', 'IV', 'V', 'I'],
};

type End = 'tonic' | 'dominant';

export function pick<T>(items: T[], weights: number[]): T {
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** Weak notes come up more often: unplayed and low-mastery notes weigh more. */
export function weakness(p: Progress, note: NoteDef): number {
  const s = p.stats[note.id];
  return s ? 1 + 1.5 * (1 - mastery(s)) : 2;
}

/** The round's key. Module state, set by `composeRound`, so the helpers below don't all need it passed. */
let key: KeyDef = KEYS[0];

function isChordTone(note: NoteDef, chord: Chord | null): boolean {
  return chord !== null && chordTones(chord, key).includes(degreeOf(note.midi, key));
}

/** Positions (indexes into the clef's scale notes) of every tonic, or every fifth. */
function anchors(notes: NoteDef[], end: End): number[] {
  const degree = end === 'tonic' ? 0 : 7;
  return notes.flatMap((n, i) => (degreeOf(n.midi, key) === degree ? [i] : []));
}

/**
 * One arch-shaped phrase over a clef's notes, ending on the tonic or the
 * fifth. `motif` replays the first intervals of an earlier phrase; `sequenceAt`
 * repeats this phrase's own opening motif from that position (a sequence).
 */
function phrase(
  p: Progress,
  notes: NoteDef[],
  home: number,
  chords: (Chord | null)[],
  end: End,
  opts: { motif?: number[]; sequenceAt?: number; from?: number } = {},
): number[] {
  const len = chords.length;
  const lo = Math.max(0, home - 2);
  const hi = Math.min(notes.length - 1, home + 7);
  const targets = anchors(notes, end).filter((i) => i >= lo && i <= hi);
  // The chord sounding under each note, carried on from where it started.
  const sounding = chords.map((_, i) => chords.slice(0, i + 1).filter((c) => c !== null).at(-1) ?? null);
  const clashes = (n: NoteDef, at: number) =>
    key.mode === 'minor' && sounding[at] === 'V' && MINOR_V_CLASH.includes(degreeOf(n.midi, key));
  const weight = (i: number, at: number) =>
    weakness(p, notes[i]) * (isChordTone(notes[i], chords[at]) ? CHORD_TONE_BOOST : 1) * (clashes(notes[i], at) ? CLASH_W : 1);

  for (let attempt = 0; attempt < TRIES; attempt++) {
    // An answer starts a step or a third from where its question stopped, on a note of the I chord if it can.
    const near = (i: number) => opts.from === undefined || (Math.abs(i - opts.from) >= 1 && Math.abs(i - opts.from) <= 2);
    const nearby = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k).filter(near);
    const homeStarts = [home, home + 2, home + 4].filter((i) => i >= lo && i <= hi && near(i));
    const chordStarts = nearby.filter((i) => isChordTone(notes[i], 'I'));
    const starts = homeStarts.length ? homeStarts : chordStarts.length ? chordStarts : nearby;
    if (!starts.length) break;
    const pos = [pick(starts, starts.map((i) => weight(i, 0)))];
    const peakAt = Math.round((len - 1) * 0.55);
    const motif = opts.motif ?? [];
    let ok = true;

    for (let i = 1; i < len - 1 && ok; i++) {
      const prev = pos[i - 1];
      const lastMove = i > 1 ? pos[i - 1] - pos[i - 2] : 0;
      const fromMotif = i <= motif.length ? motif[i - 1] : undefined;
      const seqIndex = opts.sequenceAt !== undefined ? i - opts.sequenceAt : -1;
      const fromSequence = seqIndex >= 1 && seqIndex <= 2 ? pos[seqIndex] - pos[seqIndex - 1] : undefined;
      const fixed = fromMotif ?? (Math.random() < 0.6 ? fromSequence : undefined);

      // No leap right before the landing note: there'd be no room to resolve it.
      const leapOk = i < len - 2;
      if (fixed !== undefined && prev + fixed >= lo && prev + fixed <= hi && fixed !== 0 && (leapOk || Math.abs(fixed) < 3)) {
        pos.push(prev + fixed);
        continue;
      }
      // A leap resolves by step the other way.
      if (Math.abs(lastMove) >= 3) {
        const next = prev - Math.sign(lastMove);
        if (next < lo || next > hi) ok = false;
        else pos.push(next);
        continue;
      }
      const dir = i <= peakAt ? 1 : -1;
      const options: number[] = [];
      const weights: number[] = [];
      for (const size of leapOk ? [1, 2, 3, 4] : [1, 2]) {
        for (const sign of [1, -1]) {
          const next = prev + size * sign;
          if (next < lo || next > hi) continue;
          const shape = size === 1 ? STEP_W : size === 2 ? THIRD_W : LEAP_W;
          options.push(next);
          weights.push(shape * (sign === dir ? ALONG_ARCH : 1 - ALONG_ARCH) * weight(next, i));
        }
      }
      if (!options.length) ok = false;
      else pos.push(pick(options, weights));
    }
    if (!ok) continue;

    // Land on the tonic or fifth by a step or a third.
    const last = pos[pos.length - 1];
    const landings = targets.filter((t) => Math.abs(t - last) >= 1 && Math.abs(t - last) <= 2);
    if (!landings.length) continue;
    pos.push(pick(landings, landings.map((t) => (Math.abs(t - last) === 1 ? 3 : 1))));

    // An arch: the high point is inside the phrase and above where it began.
    const peak = Math.max(...pos);
    const peakIndex = pos.indexOf(peak);
    if (len > 3 && (peakIndex === 0 || peakIndex === len - 1 || peak <= pos[0])) continue;
    return pos;
  }

  // Fallback: a plain step down to the nearest landing note.
  const target = targets[0] ?? home;
  return Array.from({ length: len }, (_, i) => Math.min(hi, target + (len - 1 - i)));
}

/** The tonics each clef's phrases can center on, with room for a phrase above. */
function homes(notes: NoteDef[], clef: Clef): number[] {
  const cs = anchors(notes, 'tonic');
  return clef === 'treble' ? cs.filter((i) => i + 5 < notes.length) : cs.filter((i) => i >= 2 && i + 5 < notes.length);
}

function chooseHome(p: Progress, notes: NoteDef[], clef: Clef): number {
  const options = homes(notes, clef);
  if (!options.length) return Math.max(0, notes.length - 8);
  // Lean toward the register holding weaker notes.
  return pick(
    options,
    options.map((h) => notes.slice(h, h + 6).reduce((sum, n) => sum + weakness(p, n), 0)),
  );
}

/** A block of 4 or 8 notes on one clef: a single phrase, or a question and its answer. */
function block(p: Progress, clef: Clef, len: number): { notes: NoteDef[]; chords: (Chord | null)[] } {
  const notes = scaleNotes(clef, key);
  const home = chooseHome(p, notes, clef);
  if (len === 8 && Math.random() < 0.5) {
    const q = phrase(p, notes, home, PHRASE_CHORDS.question, 'dominant');
    const motif = [q[1] - q[0], q[2] - q[1]];
    const a = phrase(p, notes, home, PHRASE_CHORDS.answer, 'tonic', { motif, from: q[q.length - 1] });
    return { notes: [...q, ...a].map((i) => notes[i]), chords: [...PHRASE_CHORDS.question, ...PHRASE_CHORDS.answer] };
  }
  const chords = len === 8 ? PHRASE_CHORDS.eight : len === 4 ? PHRASE_CHORDS.answer : chordPlan(len);
  const pos = phrase(p, notes, home, chords, 'tonic', len === 8 ? { sequenceAt: 4 } : {});
  return { notes: pos.map((i) => notes[i]), chords };
}

/** Chords for an odd-length stretch: a change every two notes, ending on I. */
function chordPlan(len: number): (Chord | null)[] {
  const cycle: Chord[] = ['I', 'IV', 'V'];
  const plan: (Chord | null)[] = Array.from({ length: len }, (_, i) => (i % 2 === 0 ? cycle[(i / 2) % 3] : null));
  plan[len - 1 - ((len - 1) % 2)] = 'I';
  return plan;
}

/** Harmonizes a known tune: every two notes, the chord that holds the most of them. */
function harmonize(notes: NoteDef[]): (Chord | null)[] {
  const order: Chord[] = ['I', 'V', 'IV'];
  return notes.map((_, i) => {
    if (i % 2) return null;
    if (i >= notes.length - 2) return 'I';
    const group = notes.slice(i, i + 2);
    const score = (c: Chord) => group.filter((n) => isChordTone(n, c)).length;
    return order.reduce((best, c) => (score(c) > score(best) ? c : best));
  });
}

/** A known tune whose every note the player has already played, placed on a clef. */
function knownTune(p: Progress, room: number) {
  // The tunes are major melodies; in a minor key they'd come out changed.
  if (key.mode === 'minor') return null;
  const fits: { name: string; notes: NoteDef[] }[] = [];
  for (const tune of TUNES) {
    if (tune.degrees.length > room) continue;
    for (const clef of ['treble', 'bass'] as Clef[]) {
      const notes = scaleNotes(clef, key);
      for (const home of homes(notes, clef)) {
        if (home + Math.max(...tune.degrees) >= notes.length) continue;
        const placed = tune.degrees.map((d) => notes[home + d]);
        if (placed.every((n) => noteStatus(p, n.id) !== 'new')) fits.push({ name: tune.name, notes: placed });
      }
    }
  }
  return fits.length ? fits[Math.floor(Math.random() * fits.length)] : null;
}

/**
 * Picks the round's key at random. Keys that are tricky right now come up
 * twice as often, and the last round's key is less likely so rounds vary.
 */
export function chooseKey(p: Progress): KeyDef {
  const tricky = new Set(trickyKeys(p).map((k) => k.id));
  const last = KEYS.reduce<KeyDef | null>((best, k) => {
    const seen = p.keys[k.id]?.lastSeen ?? -1;
    return seen >= 0 && (!best || seen > (p.keys[best.id]?.lastSeen ?? -1)) ? k : best;
  }, null);
  const weights = KEYS.map((k) => (tricky.has(k.id) ? TRICKY_KEY : 1) * (k === last ? REPEAT_KEY : 1));
  return pick(KEYS, weights);
}

/** All the notes for a melodic round in one key, with chords and any known tune. */
export function composeRound(p: Progress, length: number, roundKey: KeyDef = chooseKey(p)): MelodyPlan {
  key = roundKey;
  const plan: MelodyPlan = { key, notes: [], chords: [], tunes: [] };
  const tune = Math.random() < TUNE_CHANCE ? knownTune(p, length) : null;
  // The tune comes after the first block, so the round opens with a warm-up phrase.
  const tuneAt = tune ? Math.min(BLOCK, length - tune.notes.length) : -1;
  let blockIndex = 0;

  while (plan.notes.length < length) {
    if (tune && plan.notes.length === tuneAt) {
      plan.tunes.push({ name: tune.name, start: plan.notes.length, end: plan.notes.length + tune.notes.length });
      plan.notes.push(...tune.notes);
      plan.chords.push(...harmonize(tune.notes));
      continue;
    }
    const room = (tune && plan.notes.length < tuneAt ? tuneAt : length) - plan.notes.length;
    const len = room >= BLOCK ? BLOCK : room;
    const clef: Clef = blockIndex % 2 ? 'bass' : 'treble';
    const b = len >= 3 ? block(p, clef, len) : { notes: [], chords: [] };
    if (!b.notes.length) {
      // One or two notes left over: carry on stepwise toward C.
      const notes = scaleNotes(clef, key);
      const c = anchors(notes, 'tonic').find((i) => i + len <= notes.length) ?? 0;
      for (let i = len - 1; i >= 0; i--) {
        plan.notes.push(notes[c + i]);
        plan.chords.push(i === len - 1 ? 'I' : null);
      }
    } else {
      plan.notes.push(...b.notes);
      plan.chords.push(...b.chords);
    }
    blockIndex++;
  }
  if (key.mode === 'minor') raiseLeadingTones(plan);
  markAccidentals(plan);
  return plan;
}

/**
 * In minor, the 7th is raised a semitone (G to G♯ in A minor) where it sits
 * under the V chord, or steps up to the tonic over anything but iv. Coming
 * straight up from the 6th (F to G♯, an awkward augmented second), it's only
 * raised under V, where the plain 7th would clash.
 */
function raiseLeadingTones(plan: MelodyPlan): void {
  let chord: Chord | null = null;
  plan.notes.forEach((n, i) => {
    chord = plan.chords[i] ?? chord;
    if (degreeOf(n.midi, key) !== LEADING_TONE - 1) return;
    const next = plan.notes[i + 1];
    const prev = plan.notes[i - 1];
    const resolves = next && next.clef === n.clef && next.midi === n.midi + 2;
    const fromSixth = prev && prev.clef === n.clef && prev.midi === n.midi - 2;
    if (chord === 'V' || (resolves && chord !== 'IV' && !fromSixth)) {
      const midi = n.midi + 1;
      plan.notes[i] = { ...n, id: `${n.clef}:${midi}`, midi, name: spell(midi, key) };
    }
  });
}

/**
 * Marks the accidentals to draw: any note the signature doesn't cover, and a
 * courtesy reminder on the next note of the same letter and octave after one,
 * since there are no bar lines to cancel it.
 */
/**
 * Marks every note the signature doesn't cover, plus a courtesy accidental on
 * the next note of the same letter and octave, since there are no bar lines.
 */
export function markAccidentals(plan: { key: KeyDef; notes: NoteDef[] }): void {
  const key = plan.key;
  const altered = new Set<string>();
  plan.notes.forEach((n, i) => {
    const place = n.name[0] + n.name.replace(/^[A-G][♯♭]?/, '');
    const own = accidentalFor(n.name, key);
    if (own) {
      plan.notes[i] = { ...n, accidental: own };
      altered.add(place);
    } else if (altered.has(place)) {
      plan.notes[i] = { ...n, accidental: signatureAccidental(n.name, key) };
      altered.delete(place);
    }
  });
}
