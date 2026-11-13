import type { ClefMode, Clef, NoteDef } from '../music/notes';
import { pickNext, recordTrial, speedScore, type Progress } from './progress';

export interface SessionConfig {
  title: string;
  clef: ClefMode;
  length: number;
  lineLength: number;
  xpMultiplier: number;
  /** Notes to play in order, as written by the melody generator. Random picks when absent. */
  sequence?: NoteDef[];
  /** The melody's key id, for per-key stats. Absent for random notes. */
  key?: string;
}

/** How each finished note went: right first time, or missed or needed another try. */
/** Right first time, missed or retried, or (on the beat) right first time but early or late. */
export type NoteResult = 'clean' | 'rough' | 'offbeat';

export interface AnswerResult {
  correct: boolean;
  note: NoteDef;
  latency: number;
  gained: number;
  /** The line on the staff is finished and a new one was dealt. */
  newLine: boolean;
  finished: boolean;
}

/**
 * One round of practice. Deals notes in lines (a line of one for Flash Notes),
 * scores answers and records them in the progress object. No DOM access.
 */
export class Session {
  line: NoteDef[] = [];
  index = 0;
  played = 0;
  firstTry = 0;
  totalLatency = 0;
  combo = 0;
  bestCombo = 0;
  xp = 0;
  /** One entry per finished note, in order. */
  results: NoteResult[] = [];
  /** The name of each finished note, matching `results`. */
  labels: string[] = [];

  private shownAt = 0;
  private missed = false;
  private lastId: string | null = null;

  constructor(
    private p: Progress,
    readonly config: SessionConfig,
  ) {
    this.deal(performance.now());
  }

  get current(): NoteDef {
    return this.line[this.index];
  }

  get finished(): boolean {
    return this.played >= this.config.length;
  }

  /** Notes answered correctly. Every note here ends with a correct key. */
  get hits(): number {
    return this.played;
  }

  answer(midi: number, now: number): AnswerResult {
    const note = this.current;
    if (midi !== note.midi) {
      this.missed = true;
      this.combo = 0;
      return { correct: false, note, latency: 0, gained: 0, newLine: false, finished: false };
    }

    const latency = now - this.shownAt;
    recordTrial(this.p, note, latency, this.missed, this.config.key);
    const base = this.missed ? 2 : 10 + Math.round(10 * speedScore(latency));
    const gained = Math.round(base * this.config.xpMultiplier);
    this.p.xp += gained;
    this.xp += gained;
    this.played++;
    this.results.push(this.missed ? 'rough' : 'clean');
    this.labels.push(note.name);
    this.totalLatency += latency;
    if (!this.missed) {
      this.firstTry++;
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.p.bestStreak = Math.max(this.p.bestStreak, this.combo);
    }

    this.index++;
    this.missed = false;
    this.shownAt = now;
    const newLine = this.index >= this.line.length && !this.finished;
    if (newLine) this.deal(now);
    return { correct: true, note, latency, gained, newLine, finished: this.finished };
  }

  private deal(now: number): void {
    const count = Math.min(this.config.lineLength, this.config.length - this.played);
    // A line sits on one staff, so "both" picks a clef per line.
    const clef: ClefMode | Clef =
      this.config.clef === 'both' && this.config.lineLength > 1 ? (Math.random() < 0.5 ? 'treble' : 'bass') : this.config.clef;
    this.line = [];
    for (let i = 0; i < count; i++) {
      const note = this.config.sequence?.[this.played + i] ?? pickNext(this.p, this.lastId, clef);
      this.line.push(note);
      this.lastId = note.id;
    }
    this.index = 0;
    this.shownAt = now;
    this.missed = false;
  }
}
