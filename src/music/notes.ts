export type Clef = 'treble' | 'bass';
export type ClefMode = Clef | 'both';

export interface NoteDef {
  id: string;
  clef: Clef;
  midi: number;
  name: string;
  /** An accidental to draw on the note ('#', 'b' or 'n'), when the key signature doesn't cover it. */
  accidental?: string;
}

const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NATURALS = new Set([0, 2, 4, 5, 7, 9, 11]);

// Playable range per clef, inclusive. Two ledger lines beyond each staff.
export const CLEF_RANGES: Record<Clef, [number, number]> = {
  treble: [60, 81], // C4 to A5
  bass: [40, 60], // E2 to C4
};


export function noteId(clef: Clef, midi: number): string {
  return `${clef}:${midi}`;
}

export function isNatural(midi: number): boolean {
  return NATURALS.has(midi % 12);
}

export function midiName(midi: number): string {
  return PITCH_CLASSES[midi % 12] + (Math.floor(midi / 12) - 1);
}

/** VexFlow's key for a note name: "F♯4" becomes "f#/4", "B♭3" becomes "bb/3". */
export function vexKey(name: string): string {
  const [, letter, accidental, octave] = name.match(/^([A-G])([♯♭#]?)(-?\d+)$/)!;
  return `${letter.toLowerCase()}${accidental === '♭' ? 'b' : accidental ? '#' : ''}/${octave}`;
}

function buildNotes(): NoteDef[] {
  const notes: NoteDef[] = [];
  for (const clef of ['treble', 'bass'] as Clef[]) {
    const [lo, hi] = CLEF_RANGES[clef];
    for (let midi = lo; midi <= hi; midi++) {
      if (isNatural(midi)) notes.push({ id: noteId(clef, midi), clef, midi, name: midiName(midi) });
    }
  }
  return notes;
}

export const NOTES: NoteDef[] = buildNotes();
const BY_ID = new Map(NOTES.map((n) => [n.id, n]));

export function getNote(id: string): NoteDef | undefined {
  return BY_ID.get(id);
}

export function notesForClef(clef: Clef): NoteDef[] {
  return NOTES.filter((n) => n.clef === clef);
}
