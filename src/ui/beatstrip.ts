import { Accidental, ModifierContext, Renderer, Stave, StaveNote, TickContext, type RenderContext } from 'vexflow/bravura';
import type { BeatNote } from '../game/scroll';
import { vexKey, type Clef } from '../music/notes';

const SCALE = 1.4;
const SPACING = 64; // staff units per beat
const VIEW_H = 112;
const CLEF_W = 76; // staff units for the fixed clef panel on the left, before any key signature
const SIG_W = 11; // extra room per sharp or flat in the key signature, in staff units
const PLAYHEAD_GAP = 40; // px between the clef panel and the playhead
// Mirrors --ink, --riso, --fern and --tomato in styles.css.
const COLORS = { idle: '#2b2724', current: '#3a62a0', hit: '#5e8c5a', missed: '#d9573f' };

export type BeatMark = keyof typeof COLORS;

/**
 * A long staff of notes that slides right to left under a fixed playhead.
 * The notes are drawn once; scrolling is a CSS transform.
 */
export class BeatStrip {
  private track: HTMLElement;
  private clefPanel: HTMLElement;
  private staveNotes: StaveNote[] = [];
  /** The stave each note sits on, for drawing a ghost beside it. */
  private noteStaves: Stave[] = [];
  private ctx: RenderContext | null = null;
  private ghostEl: SVGElement | null = null;
  private shownClef: Clef | null = null;
  private keySig = 'C';
  /** Width of the fixed clef and key panel, in staff units. */
  private panelW = CLEF_W;
  /** Center of each notehead along the track, in px. */
  noteX: number[] = [];
  /** Half the width of each notehead, in px, matching `noteX`. */
  headHalf: number[] = [];

  constructor(private el: HTMLElement) {
    el.style.setProperty('--strip-h', `${VIEW_H * SCALE}px`);
    el.style.setProperty('--playhead-x', `${this.playheadX}px`);
    this.track = document.createElement('div');
    this.track.className = 'beat-track';
    this.clefPanel = document.createElement('div');
    this.clefPanel.className = 'beat-clef';
    const playhead = document.createElement('div');
    playhead.className = 'beat-playhead';
    el.replaceChildren(this.track, this.clefPanel, playhead);
  }

  get playheadX(): number {
    return this.panelW * SCALE + PLAYHEAD_GAP;
  }

  /** Draws a round's notes in a key: a VexFlow key name like "G" or "Bb", with `sigCount` sharps or flats. */
  load(notes: BeatNote[], keySig = 'C', sigCount = 0): void {
    this.track.replaceChildren();
    this.staveNotes = [];
    this.noteStaves = [];
    this.ctx = null;
    this.ghostEl = null;
    this.noteX = [];
    this.headHalf = [];
    this.shownClef = null;
    this.keySig = keySig;
    this.panelW = CLEF_W + SIG_W * sigCount;
    this.el.style.setProperty('--playhead-x', `${this.playheadX}px`);
    if (!notes.length) return;

    const x = (beat: number) => this.panelW + beat * SPACING;
    const width = x(notes[notes.length - 1].beat + 4);
    const renderer = new Renderer(this.track as HTMLDivElement, Renderer.Backends.SVG);
    renderer.resize(width * SCALE, VIEW_H * SCALE);
    const ctx = renderer.getContext();
    ctx.scale(SCALE, SCALE);
    this.ctx = ctx;

    // One stave per run of notes on the same clef, each opening with its clef.
    let start = 0;
    while (start < notes.length) {
      let end = start;
      while (end + 1 < notes.length && notes[end + 1].note.clef === notes[start].note.clef) end++;
      const clef = notes[start].note.clef;
      const staveX = start === 0 ? 0 : x(notes[start].beat) - 70 - (this.panelW - CLEF_W);
      const staveEnd = end === notes.length - 1 ? width : x(notes[end].beat) + SPACING / 2;
      const stave = new Stave(staveX, -4, staveEnd - staveX);
      // Each new clef restates the key; the first stave sits under the fixed panel, which shows both.
      if (start > 0) {
        stave.addClef(clef);
        if (sigCount) stave.addKeySignature(keySig);
      }
      stave.setContext(ctx).draw();

      for (let i = start; i <= end; i++) {
        const note = new StaveNote({ clef, keys: [vexKey(notes[i].note.name)], duration: 'w' });
        const accidental = notes[i].note.accidental;
        if (accidental) {
          note.addModifier(new Accidental(accidental), 0);
          note.addToModifierContext(new ModifierContext());
        }
        note.setStyle({ fillStyle: COLORS.idle, strokeStyle: COLORS.idle });
        note.setStave(stave).setContext(ctx);
        new TickContext()
          .addTickable(note)
          .preFormat()
          .setX(x(notes[i].beat) - stave.getNoteStartX() - 10);
        note.draw();
        this.staveNotes.push(note);
        this.noteStaves.push(stave);
        this.noteX.push(((note.getNoteHeadBeginX() + note.getNoteHeadEndX()) / 2) * SCALE);
        this.headHalf.push(((note.getNoteHeadEndX() - note.getNoteHeadBeginX()) / 2) * SCALE);
      }
      start = end + 1;
    }
  }

  /** The fixed clef on the left, so the reader always knows the current clef. */
  showClef(clef: Clef): void {
    if (clef === this.shownClef) return;
    this.shownClef = clef;
    this.clefPanel.replaceChildren();
    const renderer = new Renderer(this.clefPanel as HTMLDivElement, Renderer.Backends.SVG);
    renderer.resize(this.panelW * SCALE, VIEW_H * SCALE);
    const ctx = renderer.getContext();
    ctx.scale(SCALE, SCALE);
    const stave = new Stave(0, -4, this.panelW).addClef(clef);
    if (this.keySig !== 'C') stave.addKeySignature(this.keySig);
    stave.setContext(ctx).draw();
  }

  mark(index: number, mark: BeatMark): void {
    const group = this.staveNotes[index]?.getSVGElement();
    if (!group) return;
    const heads = group.querySelectorAll('.vf-notehead path');
    (heads.length ? heads : group.querySelectorAll('path')).forEach((el) => {
      el.setAttribute('fill', COLORS[mark]);
      el.setAttribute('stroke', COLORS[mark]);
    });
  }

  /**
   * A faint note at note `index`'s place showing the pitch actually played (a
   * spelled name like "F♯4", with its accidental against the key, if any), so the
   * player sees where it sits. Replaces any earlier ghost; null clears it.
   */
  ghost(index: number, name: string | null, accidental: string | null = null): void {
    this.ghostEl?.remove();
    this.ghostEl = null;
    const stave = this.noteStaves[index];
    const at = this.staveNotes[index];
    if (!name || !stave || !at || !this.ctx) return;
    const note = new StaveNote({ clef: stave.getClef(), keys: [vexKey(name)], duration: 'w' });
    if (accidental) {
      note.addModifier(new Accidental(accidental), 0);
      note.addToModifierContext(new ModifierContext());
    }
    note.setStyle({ fillStyle: COLORS.idle, strokeStyle: COLORS.idle });
    note.setStave(stave).setContext(this.ctx);
    new TickContext().addTickable(note).preFormat().setX(at.getTickContext().getX());
    note.draw();
    const el = note.getSVGElement();
    if (!el) return;
    el.classList.add('beat-ghost');
    // Under the real notes, so the note to play stays on top.
    el.parentNode?.insertBefore(el, el.parentNode.firstChild);
    this.ghostEl = el;
  }

  /** Slides the track so that track position `x` sits under the playhead. */
  scrollTo(x: number): void {
    this.track.style.transform = `translateX(${this.playheadX - x}px)`;
  }
}
