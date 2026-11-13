import { Accidental, Formatter, ModifierContext, Renderer, Stave, StaveNote, TickContext, Voice, type RenderContext } from 'vexflow/bravura';
import { vexKey, type NoteDef } from '../music/notes';

/** `current` marks the note to play in a line; a lone note uses `idle`. */
export type StaffState = 'idle' | 'current' | 'correct' | 'wrong';

const NOTE_W = 70; // horizontal room per note in a line, in staff units
const SINGLE_W = 220;
const SIG_W = 11; // extra room per sharp or flat in the key signature, in staff units
const VIEW_H = 112;
// Mirrors --ink, --riso, --fern and --tomato in styles.css.
const COLORS: Record<StaffState, string> = {
  idle: '#2b2724',
  current: '#3a62a0',
  correct: '#5e8c5a',
  wrong: '#d9573f',
};

/**
 * Draws one note, a line of notes, or a stack of notes played together (an
 * octave or chord) on a single clef, scaled to fit its container.
 */
export class StaffView {
  /** Each column is one note or one stack, lowest note first. */
  private columns: NoteDef[][] = [];
  private states: StaffState[][] = [];
  private lastWidth = 0;
  private keySig = 'C';
  private sigCount = 0;
  /** A faint wrong note beside the first column, and when it appeared, so a redraw keeps its fade going. */
  private ghostNote: { name: string; accidental: string | null; at: number } | null = null;

  constructor(private el: HTMLElement) {
    new ResizeObserver(() => {
      if (el.clientWidth !== this.lastWidth) this.render();
    }).observe(el);
  }

  /** The key signature to draw (a VexFlow key name like "G" or "Bb") and how many sharps or flats it has. */
  setKey(id: string, count: number): void {
    this.keySig = id;
    this.sigCount = count;
  }

  show(note: NoteDef, state: StaffState = 'idle'): void {
    this.showLine([note], [state]);
  }

  showLine(notes: NoteDef[], states: StaffState[]): void {
    this.columns = notes.map((n) => [n]);
    this.states = states.map((st) => [st]);
    this.render();
  }

  /** One stack of notes, lowest first, each colored by its own state. */
  showStack(notes: NoteDef[], states: StaffState[]): void {
    this.columns = [notes];
    this.states = [states];
    this.render();
  }

  /**
   * A faint note beside the note to play showing the pitch actually played (a
   * spelled name like "F♯4", with its accidental against the key, if any). It
   * fades out in CSS and stays through redraws until replaced; null clears it.
   */
  ghost(name: string | null, accidental: string | null = null): void {
    this.ghostNote = name ? { name, accidental, at: performance.now() } : null;
    this.render();
  }

  private render(): void {
    this.el.replaceChildren();
    if (!this.columns.length) return;

    const width = this.el.clientWidth;
    this.lastWidth = width;
    if (width === 0) return;
    const sigW = SIG_W * this.sigCount;
    const viewW = (this.columns.length === 1 ? SINGLE_W : 90 + NOTE_W * this.columns.length) + sigW;
    const scale = Math.min(width / viewW, 2.6);
    const height = VIEW_H * scale;

    const renderer = new Renderer(this.el as HTMLDivElement, Renderer.Backends.SVG);
    renderer.resize(width, height);
    const ctx = renderer.getContext();
    ctx.scale(scale, scale);

    const clef = this.columns[0][0].clef;
    const staveWidth = viewW - 20;
    const offsetX = (width / scale - staveWidth) / 2;
    const stave = new Stave(offsetX, -4, staveWidth);
    stave.addClef(clef);
    if (this.sigCount) stave.addKeySignature(this.keySig);
    stave.setContext(ctx).draw();

    const staveNotes = this.columns.map((col, i) => {
      const note = new StaveNote({ clef, keys: col.map((n) => vexKey(n.name)), duration: 'w' });
      col.forEach((n, k) => {
        const color = COLORS[this.states[i]?.[k] ?? 'idle'];
        if (n.accidental) note.addModifier(new Accidental(n.accidental).setStyle({ fillStyle: color, strokeStyle: color }), k);
        note.setKeyStyle(k, { fillStyle: color, strokeStyle: color });
      });
      note.setLedgerLineStyle({ fillStyle: COLORS.idle, strokeStyle: COLORS.idle });
      return note.setStave(stave).setContext(ctx);
    });

    const noteArea = stave.getNoteEndX() - stave.getNoteStartX();
    if (staveNotes.length === 1) {
      const x = noteArea / 2 - 12;
      // Drawn first, so the note to play sits on top.
      if (this.ghostNote) drawGhostNote(this.ghostNote, clef, stave, ctx, x);
      if (this.columns[0].some((n) => n.accidental)) staveNotes[0].addToModifierContext(new ModifierContext());
      new TickContext().addTickable(staveNotes[0]).preFormat().setX(x);
      staveNotes[0].draw();
      return;
    }
    const voice = new Voice({ num_beats: 4 * staveNotes.length, beat_value: 4 })
      .setMode(Voice.Mode.SOFT)
      .addTickables(staveNotes);
    new Formatter().joinVoices([voice]).format([voice], noteArea - 20);
    voice.draw(ctx, stave);
  }
}

function drawGhostNote(
  g: { name: string; accidental: string | null; at: number },
  clef: string,
  stave: Stave,
  ctx: RenderContext,
  x: number,
): void {
  const note = new StaveNote({ clef, keys: [vexKey(g.name)], duration: 'w' });
  if (g.accidental) {
    note.addModifier(new Accidental(g.accidental), 0);
    note.addToModifierContext(new ModifierContext());
  }
  note.setStyle({ fillStyle: COLORS.idle, strokeStyle: COLORS.idle });
  note.setStave(stave).setContext(ctx);
  new TickContext().addTickable(note).preFormat().setX(x);
  note.draw();
  const el = note.getSVGElement();
  if (!el) return;
  el.classList.add('staff-ghost');
  // Pick the fade up where it was, since every redraw makes a new element.
  el.style.animationDelay = `${-(performance.now() - g.at)}ms`;
}

/**
 * A key's signature on a treble and a bass staff, for the key picker's tooltip.
 * Ink on a paper sheet in both themes, like the round's staff card.
 */
export function keySignatureSheet(keyId: string, sigCount: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'tip-sig';
  const scale = 0.85;
  const viewW = 64 + SIG_W * sigCount;
  const viewH = 146;
  const renderer = new Renderer(el as HTMLDivElement, Renderer.Backends.SVG);
  renderer.resize(Math.ceil(viewW * scale), Math.ceil(viewH * scale));
  const ctx = renderer.getContext();
  ctx.scale(scale, scale);
  ctx.setFillStyle(COLORS.idle);
  ctx.setStrokeStyle(COLORS.idle);
  for (const [clef, y] of [['treble', -22], ['bass', 50]] as const) {
    const stave = new Stave(0, y, viewW);
    stave.addClef(clef);
    if (sigCount) stave.addKeySignature(keyId);
    stave.setContext(ctx).draw();
  }
  return el;
}
