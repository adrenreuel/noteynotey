import type { Clef, NoteDef } from '../music/notes';
import { recordTrial, speedScore, type Progress } from './progress';
import type { NoteResult, SessionConfig } from './session';

const PHRASE = 8; // notes between tempo steps
const LEAD_BEATS = 4; // count-in before the first note reaches the playhead, on the beat only (a waiting line starts on its first note)
const CLEF_GAP_BEATS = 2; // empty beats before a clef change, room to see it coming
const WINDOW_BEATS = 0.45; // how early or late a hit still counts on the beat, in beats
const ON_TIME_BEATS = 0.2; // a clean hit further off than this is marked early or late, in beats
const GLIDE_MS = 260; // in wait mode, how long the line takes to slide to the next note after a hit
const MISS_LATENCY_MS = 6000; // recorded for a note that slid past, so it reads as slow

/** How a scrolling round moves. */
export interface ScrollStyle {
  startBpm: number;
  /** Faster by this much every PHRASE notes. */
  bpmStep: number;
  /**
   * The line only moves when the player plays: each right note slides the next one
   * onto the playhead, so any speed works. No misses, no clock.
   */
  wait: boolean;
}

export type BeatState = 'waiting' | 'hit' | 'missed';

export interface BeatNote {
  note: NoteDef;
  /** When the note reaches the playhead, in ms of round time. */
  time: number;
  /** Position along the line, in beats, including the count-in and clef gaps. */
  beat: number;
  beatMs: number;
  state: BeatState;
  /** No wrong key was played while this note was up. */
  clean: boolean;
  /**
   * Wall-clock time the note came within a beat of the line (in wait mode, when it
   * became the next note), for reading time.
   */
  approachAt?: number;
}

export type BeatEvent =
  | { kind: 'hit'; index: number; note: NoteDef; deviation: number; latency: number; gained: number }
  | { kind: 'missed'; index: number; note: NoteDef }
  | { kind: 'wrong'; index: number; note: NoteDef };

function beatMs(bpm: number): number {
  return 60000 / bpm;
}

/**
 * A round on a moving line. On the beat (Tempo Run), notes reach a playhead on a
 * schedule and each must be played within a window or it's missed. In wait mode
 * (Zen, Arpeggios), the player's notes move the line: it sits still on the next
 * note and slides on to the one after when it's played. No DOM access.
 */
export class ScrollRound {
  readonly notes: BeatNote[] = [];
  played = 0;
  /** Notes played. `played` also counts misses. */
  hits = 0;
  firstTry = 0;
  totalLatency = 0;
  combo = 0;
  bestCombo = 0;
  xp = 0;
  /** One entry per finished note, in order. */
  results: NoteResult[] = [];
  /** The name of each finished note, matching `results`. */
  labels: string[] = [];

  private startedAt: number;
  // Wait mode: the line slides from one note's time to the next over GLIDE_MS.
  private glideFrom = 0;
  private glideTo = 0;
  private glideAt = 0;

  /** `sequence` is the round's notes in order, written by the melody generator. */
  constructor(
    private p: Progress,
    readonly config: SessionConfig,
    readonly style: ScrollStyle,
    sequence: NoteDef[],
    now: number,
  ) {
    const lead = style.wait ? 0 : LEAD_BEATS;
    let time = lead * beatMs(style.startBpm);
    let beat = lead;
    let prevClef: Clef | null = null;
    sequence.forEach((note, i) => {
      const ms = beatMs(this.bpmAt(i));
      if (prevClef && note.clef !== prevClef) {
        time += CLEF_GAP_BEATS * ms;
        beat += CLEF_GAP_BEATS;
      }
      this.notes.push({ note, time, beat, beatMs: ms, state: 'waiting', clean: true });
      prevClef = note.clef;
      time += ms;
      beat += 1;
    });
    this.startedAt = now;
    if (style.wait && this.notes.length) {
      this.glideFrom = this.glideTo = this.notes[0].time;
      this.glideAt = now;
      this.notes[0].approachAt = now;
    }
  }

  get finished(): boolean {
    return this.played >= this.notes.length;
  }

  /** Round time in ms. In wait mode it stands on the next note, sliding there after each hit. */
  elapsed(now: number): number {
    if (!this.style.wait) return now - this.startedAt;
    const f = Math.min(1, Math.max(0, (now - this.glideAt) / GLIDE_MS));
    const ease = 1 - (1 - f) ** 3;
    return this.glideFrom + (this.glideTo - this.glideFrom) * ease;
  }

  /** Moves the clock forward, as when the round was paused in a hidden tab. */
  shift(ms: number): void {
    this.startedAt += ms;
    this.glideAt += ms;
  }

  bpmAt(index: number): number {
    return this.style.startBpm + this.style.bpmStep * Math.floor(index / PHRASE);
  }

  /** The first note still waiting, or -1 when all are done. */
  nextIndex(): number {
    return this.notes.findIndex((n) => n.state === 'waiting');
  }

  /** Marks missed notes on the beat. In wait mode only the player moves the line, so nothing happens. */
  update(now: number): BeatEvent[] {
    const events: BeatEvent[] = [];
    const next = this.nextIndex();
    if (next < 0 || this.style.wait) return events;
    const n = this.notes[next];
    const t = this.elapsed(now);
    if (n.approachAt === undefined && t >= n.time - n.beatMs) n.approachAt = now;

    for (let i = next; i < this.notes.length; i++) {
      const m = this.notes[i];
      if (m.state !== 'waiting') continue;
      if (t <= m.time + WINDOW_BEATS * m.beatMs) break;
      m.state = 'missed';
      recordTrial(this.p, m.note, MISS_LATENCY_MS, true, this.config.key);
      this.played++;
      this.results.push('rough');
      this.labels.push(m.note.name);
      this.combo = 0;
      events.push({ kind: 'missed', index: i, note: m.note });
    }
    return events;
  }

  /** Scores a key against the next note. Null when that note isn't close enough to the line yet. */
  answer(midi: number, now: number): BeatEvent | null {
    const t = this.elapsed(now);
    const index = this.nextIndex();
    if (index < 0) return null;
    const n = this.notes[index];
    if (!this.style.wait && t < n.time - WINDOW_BEATS * n.beatMs) return null;

    if (midi !== n.note.midi) {
      n.clean = false;
      this.combo = 0;
      return { kind: 'wrong', index, note: n.note };
    }

    const deviation = t - n.time;
    const latency = Math.max(200, now - (n.approachAt ?? now));
    recordTrial(this.p, n.note, latency, !n.clean, this.config.key);
    // On the beat, XP rewards timing. In wait mode, it rewards reading speed.
    const score = this.style.wait
      ? speedScore(latency)
      : 1 - Math.min(1, Math.abs(deviation) / (WINDOW_BEATS * n.beatMs));
    const base = n.clean ? 10 + Math.round(10 * score) : 2;
    const gained = Math.round(base * this.config.xpMultiplier);

    n.state = 'hit';
    this.p.xp += gained;
    this.xp += gained;
    this.played++;
    const offbeat = !this.style.wait && Math.abs(deviation) > ON_TIME_BEATS * n.beatMs;
    this.results.push(!n.clean ? 'rough' : offbeat ? 'offbeat' : 'clean');
    this.labels.push(n.note.name);
    this.hits++;
    this.totalLatency += latency;
    if (n.clean) {
      this.firstTry++;
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.p.bestStreak = Math.max(this.p.bestStreak, this.combo);
    }
    // In wait mode, the hit slides the next note onto the playhead.
    const next = this.notes[index + 1];
    if (this.style.wait && next) {
      this.glideFrom = t;
      this.glideTo = next.time;
      this.glideAt = now;
      next.approachAt = now;
    }
    return { kind: 'hit', index, note: n.note, deviation, latency, gained };
  }
}
