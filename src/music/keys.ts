import { CLEF_RANGES, noteId, type Clef, type NoteDef } from './notes';

/*
 * Major and minor keys for the melodic modes, up to four sharps or flats. Each
 * key spells its own notes (F♯ in G major, B♭ in F major), so the staff shows
 * the right line or space and the key signature does the rest. Minor keys use
 * the natural minor scale, plus a raised 7th (the leading tone, G♯ in A minor)
 * that the melody writer adds where it leads up to the tonic.
 */

export type KeyMode = 'major' | 'minor';

export interface KeyDef {
  /** Stable id for saved stats, and VexFlow's key signature name ("G", "F#m"). */
  id: string;
  /** For people: "G major", "F♯ minor". */
  name: string;
  mode: KeyMode;
  /** Pitch class of the tonic, 0 = C. */
  tonic: number;
  /** Sharps (positive) or flats (negative) in the signature. */
  sig: number;
}

const major = (id: string, name: string, tonic: number, sig: number): KeyDef => ({ id, name, mode: 'major', tonic, sig });
const minor = (id: string, name: string, tonic: number, sig: number): KeyDef => ({ id, name, mode: 'minor', tonic, sig });

export const KEYS: KeyDef[] = [
  major('C', 'C major', 0, 0),
  major('G', 'G major', 7, 1),
  major('F', 'F major', 5, -1),
  major('D', 'D major', 2, 2),
  major('Bb', 'B♭ major', 10, -2),
  major('A', 'A major', 9, 3),
  major('Eb', 'E♭ major', 3, -3),
  major('E', 'E major', 4, 4),
  major('Ab', 'A♭ major', 8, -4),
  // The relative minors: same signatures, a minor third lower.
  minor('Am', 'A minor', 9, 0),
  minor('Em', 'E minor', 4, 1),
  minor('Dm', 'D minor', 2, -1),
  minor('Bm', 'B minor', 11, 2),
  minor('Gm', 'G minor', 7, -2),
  minor('F#m', 'F♯ minor', 6, 3),
  minor('Cm', 'C minor', 0, -3),
  minor('C#m', 'C♯ minor', 1, 4),
  minor('Fm', 'F minor', 5, -4),
];

export const C_MAJOR = KEYS[0];
const BY_ID = new Map(KEYS.map((k) => [k.id, k]));

export function getKey(id: string): KeyDef | undefined {
  return BY_ID.get(id);
}

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const STEPS: Record<KeyMode, number[]> = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
/** The raised 7th of a minor key, in semitones above the tonic. */
export const LEADING_TONE = 11;
const SHARP = '♯';
const FLAT = '♭';
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

/** Semitones above the key's tonic, 0 to 11. */
export function degreeOf(midi: number, key: KeyDef): number {
  return mod12(midi - key.tonic);
}

export function inKey(midi: number, key: KeyDef): boolean {
  return STEPS[key.mode].includes(degreeOf(midi, key));
}

/**
 * The letter for a pitch: the key's own spelling for scale notes, the 7th's
 * letter for a minor key's leading tone (E♯ in F♯ minor, not F), else sharps in
 * sharp keys and flats in flat keys.
 */
function letterFor(midi: number, key: KeyDef): number {
  const tonicLetter = LETTERS.indexOf(key.id[0]);
  const step = STEPS[key.mode].indexOf(degreeOf(midi, key));
  if (step >= 0) return (tonicLetter + step) % 7;
  if (key.mode === 'minor' && degreeOf(midi, key) === LEADING_TONE) return (tonicLetter + 6) % 7;
  const pc = mod12(midi);
  const natural = LETTER_PC.indexOf(pc);
  if (natural >= 0) return natural;
  return key.sig < 0 ? LETTER_PC.indexOf(pc + 1) : LETTER_PC.indexOf(pc - 1);
}

/** Name a pitch the way it's written in this key, like "F♯4" or "B♭3". */
export function spell(midi: number, key: KeyDef): string {
  const letter = letterFor(midi, key);
  // -1 flat, 0 natural, 1 sharp. Wraps so B♯ and C♭ would land in the right octave.
  let shift = mod12(midi - LETTER_PC[letter]);
  if (shift > 6) shift -= 12;
  const octave = Math.floor((midi - shift) / 12) - 1;
  return LETTERS[letter] + (shift > 0 ? SHARP : shift < 0 ? FLAT : '') + octave;
}

/** How the signature plays a letter: 1 sharp, -1 flat, 0 natural. */
function sigShift(letter: string, key: KeyDef): number {
  const n = Math.abs(key.sig);
  if (key.sig > 0 && SHARP_ORDER.slice(0, n).includes(letter)) return 1;
  if (key.sig < 0 && FLAT_ORDER.slice(0, n).includes(letter)) return -1;
  return 0;
}

function shiftOf(name: string): number {
  return name.includes(SHARP) ? 1 : name.includes(FLAT) ? -1 : 0;
}

/** VexFlow's accidental for a spelled note against the signature ('#', 'b' or 'n'), or null when the signature covers it. */
export function accidentalFor(name: string, key: KeyDef): string | null {
  const shift = shiftOf(name);
  if (shift === sigShift(name[0], key)) return null;
  return shift > 0 ? '#' : shift < 0 ? 'b' : 'n';
}

/** The accidental the signature itself gives a letter, for a courtesy reminder. */
export function signatureAccidental(name: string, key: KeyDef): string {
  const shift = sigShift(name[0], key);
  return shift > 0 ? '#' : shift < 0 ? 'b' : 'n';
}

/** A note on a clef, named for the key. Its id stays `"<clef>:<midi>"`, so stats are per pitch. */
export function keyNote(clef: Clef, midi: number, key: KeyDef): NoteDef {
  return { id: noteId(clef, midi), clef, midi, name: spell(midi, key) };
}

/** The key's scale notes within a clef's reading range, lowest first. */
export function scaleNotes(clef: Clef, key: KeyDef): NoteDef[] {
  const [lo, hi] = CLEF_RANGES[clef];
  const notes: NoteDef[] = [];
  for (let midi = lo; midi <= hi; midi++) if (inKey(midi, key)) notes.push(keyNote(clef, midi, key));
  return notes;
}

/** A pitch class named in the key, without an octave: "F♯", "B♭". */
function pitchName(degree: number, key: KeyDef): string {
  return spell(60 + mod12(key.tonic + degree), key).replace(/-?\d+$/, '');
}

/**
 * What the key signature means, in words: "G major: every F is played sharp,
 * the black key just above." Minor keys add a line about the raised 7th.
 */
export function keyTip(key: KeyDef): string {
  const letters = (key.sig > 0 ? SHARP_ORDER : FLAT_ORDER).slice(0, Math.abs(key.sig));
  const which = letters.length === 1 ? `every ${letters[0]} is` : `${letters.slice(0, -1).join(', ')} and ${letters.at(-1)} are always`;
  const signature = !key.sig
    ? key.mode === 'major'
      ? 'no sharps or flats, all white keys.'
      : 'no sharps or flats.'
    : key.sig > 0
      ? `${which} played sharp, the black key just above.`
      : `${which} played flat, the black key just below.`;
  if (key.mode === 'major') return `${key.name}: ${signature}`;
  const seventh = pitchName(10, key);
  const raised = pitchName(LEADING_TONE, key);
  const raisedWord = shiftOf(raised) === 0 ? `${raised} natural` : raised;
  return `${key.name}: ${signature} Its 7th note is often raised from ${seventh} to ${raisedWord} on the way up to ${pitchName(0, key)}, marked on the note.`;
}
