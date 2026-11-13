import { accidentalFor, keyNote, scaleNotes, spell, type KeyDef } from '../music/keys';
import { CLEF_RANGES, type Clef, type NoteDef } from '../music/notes';
import { chordTones, chooseKey, markAccidentals, pick, weakness, type Chord, type MelodyPlan } from './melody';
import { recordTrial, speedScore, type Progress } from './progress';
import type { NoteResult, SessionConfig } from './session';

/*
 * Octaves, chords and arpeggios. Octaves and chords are stacks of notes on the
 * still staff, played together or one at a time in any order (so the mic and
 * the on-screen keys work too). Arpeggios are broken chords for the moving line.
 */

const STACK_BLOCK = 4; // stacks per clef before switching
const ARPEGGIO_BLOCK = 2; // arpeggios per clef before switching, 8 notes like the melodies
const EXTRA_NOTE_MS = 700; // allowed per note after the first before a stack counts as slow, in ms
const ARPEGGIO_CHORDS: Chord[] = ['I', 'IV', 'V', 'I', 'V', 'I'];
const STACK_CHORDS: Chord[] = ['I', 'IV', 'V'];

function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

function clefFor(index: number, block: number): Clef {
  return Math.floor(index / block) % 2 ? 'bass' : 'treble';
}

/** A root-position triad's pitches above `root`: root, third, fifth. */
function triad(chord: Chord, key: KeyDef, root: number): number[] {
  const tones = chordTones(chord, key);
  return tones.map((t) => root + mod12(t - tones[0]));
}

/** Every MIDI pitch of the chord's root on a clef where a shape `span` semitones tall still fits. */
function rootsInClef(chord: Chord, key: KeyDef, clef: Clef, span: number): number[] {
  const [lo, hi] = CLEF_RANGES[clef];
  const rootPc = mod12(key.tonic + chordTones(chord, key)[0]);
  const roots: number[] = [];
  for (let m = lo; m + span <= hi; m++) if (mod12(m) === rootPc) roots.push(m);
  return roots;
}

function isMajor(chord: Chord, key: KeyDef): boolean {
  return mod12(chordTones(chord, key)[1] - chordTones(chord, key)[0]) === 4;
}

/** "C major", "F♯ minor": the chord's name in the key. */
export function chordName(chord: Chord, key: KeyDef, root: number): string {
  return `${spell(root, key).replace(/-?\d+$/, '')} ${isMajor(chord, key) ? 'major' : 'minor'}`;
}

/** "C", "F♯m": the chord's symbol in the key. */
function chordSymbol(chord: Chord, key: KeyDef, root: number): string {
  return `${spell(root, key).replace(/-?\d+$/, '')}${isMajor(chord, key) ? '' : 'm'}`;
}

/* ---------- Arpeggios ---------- */

/** A round of arpeggios for the moving line: each chord broken up to its octave, then back down. */
export function composeArpeggios(p: Progress, length: number, key: KeyDef = chooseKey(p)): MelodyPlan {
  const plan: MelodyPlan = { key, notes: [], chords: [], tunes: [] };
  for (let i = 0; plan.notes.length < length; i++) {
    const chord = ARPEGGIO_CHORDS[i % ARPEGGIO_CHORDS.length];
    const clef = clefFor(i, ARPEGGIO_BLOCK);
    // Up to the octave where it fits on the clef, else up to the fifth and back to the third.
    const octave = rootsInClef(chord, key, clef, 12);
    const roots = octave.length ? octave : rootsInClef(chord, key, clef, 7);
    const root = pick(roots, roots.map((r) => weakness(p, keyNote(clef, r, key))));
    const [a, b, c] = triad(chord, key, root);
    const up = [a, b, c, octave.length ? root + 12 : b];
    const pitches = i % 2 ? up.reverse() : up;
    pitches.slice(0, length - plan.notes.length).forEach((m, j) => {
      plan.notes.push(keyNote(clef, m, key));
      plan.chords.push(j === 0 ? chord : null);
    });
  }
  markAccidentals(plan);
  return plan;
}

/* ---------- Octaves and chords ---------- */

export type StackKind = 'octaves' | 'chords';

/** Notes to play at once, lowest first, with a name for feedback and a short label for the progress row. */
export interface Stack {
  notes: NoteDef[];
  name: string;
  /** "C4" for an octave (its lower note), "F♯m" for a chord. */
  label: string;
}

export interface StackPlan {
  key: KeyDef;
  stacks: Stack[];
}

function withAccidentals(notes: NoteDef[], key: KeyDef): NoteDef[] {
  return notes.map((n) => {
    const accidental = accidentalFor(n.name, key);
    return accidental ? { ...n, accidental } : n;
  });
}

function octaveStacks(p: Progress, key: KeyDef, length: number): Stack[] {
  const stacks: Stack[] = [];
  let prev = -1;
  for (let i = 0; i < length; i++) {
    const clef = clefFor(i, STACK_BLOCK);
    const [, hi] = CLEF_RANGES[clef];
    const lows = scaleNotes(clef, key).filter((n) => n.midi + 12 <= hi && n.midi !== prev);
    const low = pick(lows, lows.map((n) => weakness(p, n) + weakness(p, keyNote(clef, n.midi + 12, key))));
    const high = keyNote(clef, low.midi + 12, key);
    stacks.push({ notes: withAccidentals([low, high], key), name: `${low.name} and ${high.name}`, label: low.name });
    prev = low.midi;
  }
  return stacks;
}

function chordStacks(p: Progress, key: KeyDef, length: number): Stack[] {
  const stacks: Stack[] = [];
  let prev: Chord | null = null;
  for (let i = 0; i < length; i++) {
    const clef = clefFor(i, STACK_BLOCK);
    const options = STACK_CHORDS.flatMap((chord) =>
      rootsInClef(chord, key, clef, 7).map((root) => ({ chord, root })),
    ).filter((o) => o.chord !== prev);
    const weights = options.map((o) => triad(o.chord, key, o.root).reduce((w, m) => w + weakness(p, keyNote(clef, m, key)), 0));
    const choice = pick(options, weights);
    const notes = triad(choice.chord, key, choice.root).map((m) => keyNote(clef, m, key));
    stacks.push({ notes: withAccidentals(notes, key), name: chordName(choice.chord, key, choice.root), label: chordSymbol(choice.chord, key, choice.root) });
    prev = choice.chord;
  }
  return stacks;
}

/** A round of octaves or root-position I, IV and V chords in one key, switching clef every few. */
export function composeStacks(p: Progress, kind: StackKind, length: number, key: KeyDef = chooseKey(p)): StackPlan {
  return { key, stacks: kind === 'octaves' ? octaveStacks(p, key, length) : chordStacks(p, key, length) };
}

export type StackAnswer =
  | { kind: 'wrong'; stack: Stack }
  /** A right note, with more of the stack still to play. */
  | { kind: 'part'; stack: Stack; note: NoteDef; left: number }
  | { kind: 'done'; stack: Stack; latency: number; gained: number; finished: boolean }
  /** A note of the stack that was already played. */
  | { kind: 'again'; stack: Stack };

/**
 * A round of stacks on the still staff. Each stack is done once every note in
 * it has been played, together or one at a time. A wrong key marks it as
 * retried but keeps the notes already found. No DOM access.
 */
export class StackRound {
  index = 0;
  played = 0;
  firstTry = 0;
  totalLatency = 0;
  combo = 0;
  bestCombo = 0;
  xp = 0;
  /** One entry per finished stack, in order. */
  results: NoteResult[] = [];
  /** The label of each finished stack, matching `results`. */
  labels: string[] = [];
  /** Pitches of the current stack played so far. */
  readonly got = new Set<number>();

  private shownAt: number;
  private missed = false;

  constructor(
    private p: Progress,
    readonly config: SessionConfig,
    readonly stacks: Stack[],
    now: number,
  ) {
    this.shownAt = now;
  }

  get current(): Stack | undefined {
    return this.stacks[this.index];
  }

  get finished(): boolean {
    return this.played >= this.stacks.length;
  }

  /** Stacks finished. Every stack here ends with all its notes played. */
  get hits(): number {
    return this.played;
  }

  /** The lowest note of the current stack not played yet. */
  get nextNote(): NoteDef | undefined {
    return this.current?.notes.find((n) => !this.got.has(n.midi));
  }

  answer(midi: number, now: number): StackAnswer | null {
    const stack = this.current;
    if (!stack) return null;
    const note = stack.notes.find((n) => n.midi === midi);
    if (!note) {
      this.missed = true;
      this.combo = 0;
      return { kind: 'wrong', stack };
    }
    if (this.got.has(midi)) return { kind: 'again', stack };
    this.got.add(midi);
    const left = stack.notes.length - this.got.size;
    if (left > 0) return { kind: 'part', stack, note, left };

    // Playing notes one at a time takes longer, so each extra note gets some time.
    const latency = Math.max(200, now - this.shownAt - EXTRA_NOTE_MS * (stack.notes.length - 1));
    stack.notes.forEach((n, i) => recordTrial(this.p, n, latency, this.missed, i === 0 ? this.config.key : undefined));
    const base = this.missed ? 2 : 10 + Math.round(10 * speedScore(latency));
    const gained = Math.round(base * this.config.xpMultiplier);
    this.p.xp += gained;
    this.xp += gained;
    this.played++;
    this.results.push(this.missed ? 'rough' : 'clean');
    this.labels.push(stack.label);
    this.totalLatency += latency;
    if (!this.missed) {
      this.firstTry++;
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.p.bestStreak = Math.max(this.p.bestStreak, this.combo);
    }

    this.index++;
    this.got.clear();
    this.missed = false;
    this.shownAt = now;
    return { kind: 'done', stack, latency, gained, finished: this.finished };
  }
}
