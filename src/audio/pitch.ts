import { PitchDetector } from 'pitchy';
import { CHORD_FFT_SIZE, cents, noteHz, stackLevels } from './chord';

export interface Calibration {
  /** How far the instrument sits from A440 equal temperament, in cents. */
  centsOffset: number;
  /** Ambient RMS level measured while the room was quiet. */
  noiseFloor: number;
}

export interface TuningResult {
  /** The note heard most, without calibration. */
  midi: number;
  /** Median offset from A440 equal temperament, in cents. */
  cents: number;
}

export interface PitchFrame {
  rms: number;
  gate: number;
  clarity: number;
  freq: number | null;
  /** Nearest MIDI note after applying the tuning offset, or null when unvoiced. */
  midi: number | null;
  /** Deviation from that note after the tuning offset. */
  cents: number;
  /** Deviation from the nearest A440 semitone, ignoring calibration. Used for tuning. */
  rawCents: number;
}

const BUFFER_SIZE = 2048;
const MIN_CLARITY = 0.8; // the stability check below filters out noise that slips through
const STABLE_FRAMES = 4; // about 65 ms at 60 fps
const UNEXPECTED_STABLE_FRAMES = 10; // about 165 ms, so attack transients and overtones settle first
const MAX_CENTS = 45;
const MIN_GATE = 0.0015; // about -56 dBFS, low enough for soft playing in a quiet room
const GATE_RATIO = 2; // gate sits this far above the measured noise floor

// A stack (octave or chord) counts note by note on strikes: each note's level on
// the partials only it has (see chord.ts) must jump, as in `struck` below. Notes
// struck together count together; the rest of a partly struck stack gets a moment
// to arrive, then the struck ones count on their own.
const STACK_HISTORY = 36; // frames of stack levels kept, about 600 ms
const STACK_RECENT = 10; // the latest frames, where a strike's rise should show
const CHORD_RISE_DB = 6; // how far a stack note's own level must climb
const OCTAVE_RISE_DB = 3; // how far the lower note's even partials must climb over its odd ones for the upper note
const STACK_GRACE_FRAMES = 12; // about 200 ms for the rest of a stack after its first note is struck
const STACK_PARTIALS = 8; // a heard pitch this close to a stack note's partials belongs to the stack, not a wrong key
const PARTIAL_CENTS = 40;

// A note only counts when it was struck, not when it's still ringing from before
// (room reverb, the sustain pedal). Each frame records every note's level on its
// first partials; a note is struck when its own level jumped since it last counted.
const STRIKE_FFT_SIZE = 4096; // about 85 ms at 48 kHz, quick enough to see a strike's rise
const LOW_MIDI = 21; // A0
const HIGH_MIDI = 108; // C8
const LEVEL_PARTIALS = 3; // partials summed for a note's level
const LEVEL_HISTORY = 24; // frames of note levels kept, about 400 ms
const RISE_RECENT = 6; // the latest frames, where a strike's peak should be
const RISE_DB = 6; // how far a note's level must climb above its quietest earlier frame

export const DEFAULT_CALIBRATION: Calibration = { centsOffset: 0, noiseFloor: 0.002 };

/** What the stack listener sees each frame, for the ?debug readout. */
export interface StackDebug {
  notes: { midi: number; level: number; rise: number; struck: boolean }[];
  /** Frames left before a partly struck stack counts what it has, or null. */
  grace: number | null;
}

/**
 * Monophonic note listener. Emits a note once it has been stable for a few
 * frames and was struck since any note last counted, so nothing ringing on
 * (reverb, the sustain pedal, a struck note's partials) counts on its own.
 */
export class PitchListener {
  calibration: Calibration = { ...DEFAULT_CALIBRATION };
  onNote: ((midi: number) => void) | null = null;
  /** The note the player is asked for. Any other note needs longer to confirm. */
  expected: number | null = null;
  /** Called with the notes of the stack on the staff that were struck, together or alone. */
  onChord: ((notes: number[]) => void) | null = null;
  /** Called every frame while a stack is up, with what the stack listener sees. */
  onStackDebug: ((info: StackDebug) => void) | null = null;

  private frameListeners = new Set<(frame: PitchFrame) => void>();
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private chordAnalyser: AnalyserNode | null = null;
  private strikeAnalyser: AnalyserNode | null = null;
  private spectrum = new Float32Array(CHORD_FFT_SIZE / 2);
  private strikeSpectrum = new Float32Array(STRIKE_FFT_SIZE / 2);
  /** Each recent frame's level per note (LOW_MIDI up), oldest first. */
  private levels: { frame: number; db: Float32Array }[] = [];
  /** The frame each note last counted on, alone or in a chord. */
  private lastCounted = new Map<number, number>();
  /** The frame any note last counted on. */
  private lastCountFrame = -Infinity;
  private frameNo = 0;
  private buffer = new Float32Array(BUFFER_SIZE);
  private detector = PitchDetector.forFloat32Array(BUFFER_SIZE);
  private raf = 0;

  private candidate: number | null = null;
  private candidateFrames = 0;
  private onsetsMutedUntil = 0;

  /** The stack's notes still to play, or null. */
  private stack: number[] | null = null;
  /** Every note of the stack as first shown, which levels are measured against. */
  private stackAll: number[] = [];
  private stackSince = 0;
  private stackHistory: { frame: number; levels: Map<number, number> }[] = [];
  /** Notes struck while waiting for the rest of the stack. */
  private pending = new Set<number>();
  private grace: number | null = null;

  get running(): boolean {
    return this.ctx !== null;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.ctx = new AudioContext();
    await this.ctx.resume();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = BUFFER_SIZE;
    this.chordAnalyser = this.ctx.createAnalyser();
    this.chordAnalyser.fftSize = CHORD_FFT_SIZE;
    this.chordAnalyser.smoothingTimeConstant = 0;
    this.strikeAnalyser = this.ctx.createAnalyser();
    this.strikeAnalyser.fftSize = STRIKE_FFT_SIZE;
    this.strikeAnalyser.smoothingTimeConstant = 0;
    const source = this.ctx.createMediaStreamSource(this.stream);
    source.connect(this.analyser);
    source.connect(this.chordAnalyser);
    source.connect(this.strikeAnalyser);
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
    this.chordAnalyser = null;
    this.strikeAnalyser = null;
    this.candidate = null;
    this.levels = [];
    this.lastCounted.clear();
    this.lastCountFrame = -Infinity;
  }

  /**
   * The notes (MIDI) still to play of the stack on the staff, or null. Struck
   * notes go to `onChord`, together when struck together. Fewer notes of the same
   * stack (some were just found) keep its history, so the rest can still count.
   */
  setStack(notes: number[] | null): void {
    const prev = this.stack;
    if (prev && notes && prev.length === notes.length && prev.every((m, i) => m === notes[i])) return;
    const same = prev !== null && notes !== null && notes.every((m) => this.stackAll.includes(m));
    this.stack = notes;
    this.pending.clear();
    this.grace = null;
    if (!same) {
      this.stackAll = notes ?? [];
      this.stackHistory = [];
      this.stackSince = this.frameNo;
    }
  }

  /** Ignores stack strikes for a moment, as when a backing chord changes and the level jumps. */
  muteOnsets(ms: number): void {
    this.onsetsMutedUntil = performance.now() + ms;
  }

  subscribe(fn: (frame: PitchFrame) => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  /** Measures room noise for `ms` milliseconds and returns the mean RMS. */
  measureNoise(ms: number): Promise<number> {
    const samples: number[] = [];
    return this.collect(ms, (f) => {
      samples.push(f.rms);
      return false;
    }).then(() => (samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0));
  }

  /**
   * Listens for a sustained note and returns the note heard (ignoring any
   * calibration) with its median offset from A440 in cents. Resolves with null
   * if not enough clear frames arrive before the timeout.
   */
  measureTuning(timeoutMs: number, onProgress: (fraction: number) => void): Promise<TuningResult | null> {
    const needed = 40;
    const cents: number[] = [];
    const notes = new Map<number, number>();
    return this.collect(timeoutMs, (f) => {
      if (f.freq !== null && f.clarity > 0.94) {
        cents.push(f.rawCents);
        const midi = Math.round(69 + 12 * Math.log2(f.freq / 440));
        notes.set(midi, (notes.get(midi) ?? 0) + 1);
        onProgress(cents.length / needed);
      }
      return cents.length >= needed;
    }).then(() => {
      if (cents.length < needed / 2) return null;
      cents.sort((a, b) => a - b);
      const midi = [...notes.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return { midi, cents: cents[Math.floor(cents.length / 2)] };
    });
  }

  private collect(ms: number, onFrame: (f: PitchFrame) => boolean): Promise<void> {
    return new Promise((resolve) => {
      const unsub = this.subscribe((f) => {
        if (onFrame(f)) finish();
      });
      const timer = window.setTimeout(finish, ms);
      function finish() {
        window.clearTimeout(timer);
        unsub();
        resolve();
      }
    });
  }

  private tick = (): void => {
    if (!this.ctx || !this.analyser) return;
    this.raf = requestAnimationFrame(this.tick);
    this.analyser.getFloatTimeDomainData(this.buffer);

    let sum = 0;
    for (let i = 0; i < this.buffer.length; i++) sum += this.buffer[i] * this.buffer[i];
    const rms = Math.sqrt(sum / this.buffer.length);
    const gate = Math.max(MIN_GATE, this.calibration.noiseFloor * GATE_RATIO);
    const [freq, clarity] = this.detector.findPitch(this.buffer, this.ctx.sampleRate);

    const voiced = rms > gate && clarity > MIN_CLARITY && freq > 60 && freq < 1400;
    const frame: PitchFrame = { rms, gate, clarity, freq: null, midi: null, cents: 0, rawCents: 0 };
    if (voiced) {
      const raw = 69 + 12 * Math.log2(freq / 440);
      const corrected = raw - this.calibration.centsOffset / 100;
      frame.freq = freq;
      frame.rawCents = (raw - Math.round(raw)) * 100;
      frame.midi = Math.round(corrected);
      frame.cents = (corrected - frame.midi) * 100;
    }

    this.frameNo++;
    this.recordLevels();
    this.detectNote(frame);
    this.detectStack(frame);
    this.frameListeners.forEach((fn) => fn(frame));
  };

  private detectNote(frame: PitchFrame): void {
    if (frame.midi === null) {
      this.candidate = null;
      this.candidateFrames = 0;
      return;
    }

    if (frame.midi === this.candidate) {
      this.candidateFrames++;
    } else {
      this.candidate = frame.midi;
      this.candidateFrames = 1;
    }

    const needed = this.candidate === this.expected ? STABLE_FRAMES : UNEXPECTED_STABLE_FRAMES;
    const stable = this.candidateFrames >= needed && Math.abs(frame.cents) < MAX_CENTS;
    if (!stable) return;
    // While a stack is up, its notes and their partials are the stack listener's
    // to count; pitch detection would only ever find one of them.
    if (this.ownedByStack(this.candidate)) return;
    // A note still ringing from before never counts, however clear it sounds: it
    // needs its own rise in level, the same for a repeat of the note just played.
    if (!this.struck(this.candidate)) return;
    this.lastCounted.set(this.candidate, this.frameNo);
    this.lastCountFrame = this.frameNo;
    this.onNote?.(this.candidate);
  }

  /** Records this frame's level for every note, on its first few partials. */
  private recordLevels(): void {
    if (!this.strikeAnalyser || !this.ctx) return;
    this.strikeAnalyser.getFloatFrequencyData(this.strikeSpectrum);
    const binHz = this.ctx.sampleRate / STRIKE_FFT_SIZE;
    const db = this.levels.length >= LEVEL_HISTORY ? this.levels.shift()!.db : new Float32Array(HIGH_MIDI - LOW_MIDI + 1);
    const top = this.strikeSpectrum.length - 2;
    for (let m = LOW_MIDI; m <= HIGH_MIDI; m++) {
      const f = 440 * 2 ** ((m - 69 + this.calibration.centsOffset / 100) / 12);
      let power = 0;
      for (let h = 1; h <= LEVEL_PARTIALS; h++) {
        const bin = Math.round((h * f) / binHz);
        if (bin < 1 || bin > top) break;
        const peak = Math.max(this.strikeSpectrum[bin - 1], this.strikeSpectrum[bin], this.strikeSpectrum[bin + 1]);
        power += 10 ** (peak / 10);
      }
      db[m - LOW_MIDI] = power > 0 ? 10 * Math.log10(power) : -200;
    }
    this.levels.push({ frame: this.frameNo, db });
  }

  /**
   * Whether `midi` was struck rather than left ringing: its level in the latest
   * frames rose by RISE_DB over its quietest frame before them, counting only
   * frames since any note last counted. So a strike that already counted can't
   * count again as another note: its octave or other partials rose with it, and
   * pitch detection sometimes lands on them a moment later. Just after the mic
   * starts, anything counts.
   */
  private struck(midi: number): boolean {
    if (midi < LOW_MIDI || midi > HIGH_MIDI || this.levels.length < LEVEL_HISTORY) return true;
    const i = midi - LOW_MIDI;
    const since = Math.max(this.lastCounted.get(midi) ?? -Infinity, this.lastCountFrame);
    const split = this.levels.length - RISE_RECENT;
    let before = Infinity;
    for (let k = 0; k < split; k++) {
      if (this.levels[k].frame > since) before = Math.min(before, this.levels[k].db[i]);
    }
    if (before === Infinity) return false; // it counted too recently to tell a new strike
    let recent = -Infinity;
    for (let k = split; k < this.levels.length; k++) recent = Math.max(recent, this.levels[k].db[i]);
    return recent - before >= RISE_DB;
  }

  /** A heard pitch that is a stack note or one of its partials, unless that note can't be measured. */
  private ownedByStack(midi: number): boolean {
    if (!this.stack) return false;
    const latest = this.stackHistory[this.stackHistory.length - 1]?.levels;
    if (this.stack.includes(midi) && latest && !Number.isFinite(latest.get(midi) ?? NaN)) return false;
    const hz = noteHz(midi, this.calibration.centsOffset);
    return this.stackAll.some((m) => {
      const f = noteHz(m, this.calibration.centsOffset);
      for (let k = 1; k <= STACK_PARTIALS; k++) if (cents(hz, k * f) < PARTIAL_CENTS) return true;
      return false;
    });
  }

  /**
   * A stack note's rise: its level in the latest frames over its quietest earlier
   * frame since the stack appeared and since any note last counted.
   */
  private stackRise(midi: number): { level: number; rise: number } {
    const h = this.stackHistory;
    const level = h[h.length - 1]?.levels.get(midi) ?? NaN;
    if (!Number.isFinite(level) || h.length <= STACK_RECENT) return { level, rise: -Infinity };
    const since = Math.max(this.stackSince, this.lastCounted.get(midi) ?? -Infinity, this.lastCountFrame);
    const split = h.length - STACK_RECENT;
    let before = Infinity;
    for (let k = 0; k < split; k++) {
      const v = h[k].levels.get(midi) ?? NaN;
      if (h[k].frame > since && Number.isFinite(v)) before = Math.min(before, v);
    }
    let recent = -Infinity;
    for (let k = split; k < h.length; k++) {
      const v = h[k].levels.get(midi) ?? NaN;
      if (Number.isFinite(v)) recent = Math.max(recent, v);
    }
    return { level, rise: before === Infinity ? -Infinity : recent - before };
  }

  private detectStack(frame: PitchFrame): void {
    if (!this.stack || !this.chordAnalyser || !this.ctx) return;
    this.chordAnalyser.getFloatFrequencyData(this.spectrum);
    const spectrum = { db: this.spectrum, binHz: this.ctx.sampleRate / CHORD_FFT_SIZE };
    this.stackHistory.push({ frame: this.frameNo, levels: stackLevels(spectrum, this.stackAll, this.calibration.centsOffset) });
    if (this.stackHistory.length > STACK_HISTORY) this.stackHistory.shift();

    const muted = performance.now() < this.onsetsMutedUntil || frame.rms <= frame.gate;
    const rows = this.stack.map((midi) => {
      const { level, rise } = this.stackRise(midi);
      const needed = this.stackAll.includes(midi - 12) ? OCTAVE_RISE_DB : CHORD_RISE_DB;
      return { midi, level, rise, struck: !muted && rise >= needed };
    });
    for (const r of rows) if (r.struck) this.pending.add(r.midi);
    // A note that can't be measured goes along with the ones that were struck.
    const hit = this.pending.size ? rows.filter((r) => this.pending.has(r.midi) || !Number.isFinite(r.level)) : [];

    if (hit.length && hit.length === rows.length) {
      this.countStack(hit.map((r) => r.midi));
    } else if (hit.length) {
      this.grace = this.grace === null ? STACK_GRACE_FRAMES : this.grace - 1;
      if (this.grace <= 0) this.countStack(hit.map((r) => r.midi));
    }
    this.onStackDebug?.({ notes: rows, grace: this.grace });
  }

  private countStack(notes: number[]): void {
    // Its notes ring on, so none of them may count again until a new strike.
    for (const m of notes) this.lastCounted.set(m, this.frameNo);
    this.lastCountFrame = this.frameNo;
    this.pending.clear();
    this.grace = null;
    this.candidate = null;
    this.candidateFrames = 0;
    this.onChord?.(notes);
  }
}
