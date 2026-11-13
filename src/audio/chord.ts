/*
 * Levels for the notes of a known stack (an octave or a chord) in a spectrum.
 * Pitch detection only finds one note, but on a stack round we know which notes
 * to expect, so the listener watches each one's own level and counts it when
 * that level jumps, which is what a strike does. No DOM access.
 *
 * Low fundamentals are too close together to tell apart in a short window, so
 * each note is measured on whichever of its partials are high enough to resolve
 * and aren't shared with another note of the stack.
 */

/** Analyser size for stack listening: about 170 ms at 48 kHz, with bins about 6 Hz wide. */
export const CHORD_FFT_SIZE = 8192;

const PARTIALS = 6; // partials a note may be measured on
const OTHER_PARTIALS = 8; // partials of the other notes checked for overlap
const OVERLAP_CENTS = 40; // partials closer than this are shared
const MIN_RESOLVED_BINS = 2.5; // a semitone must span this many bins to be told from its neighbors
const PEAK_TOLERANCE_CENTS = 35; // how far from the expected pitch a peak may sit

export interface Spectrum {
  /** Magnitudes in dB, one per bin, as from `AnalyserNode.getFloatFrequencyData`. */
  db: Float32Array;
  /** Width of one bin in Hz. */
  binHz: number;
}

export function cents(a: number, b: number): number {
  return Math.abs(1200 * Math.log2(a / b));
}

function bin(s: Spectrum, hz: number): number {
  return Math.min(s.db.length - 1, Math.max(0, Math.round(hz / s.binHz)));
}

function peak(s: Spectrum, hz: number): number {
  const lo = Math.min(bin(s, hz * 2 ** (-PEAK_TOLERANCE_CENTS / 1200)), bin(s, hz) - 1);
  const hi = Math.max(bin(s, hz * 2 ** (PEAK_TOLERANCE_CENTS / 1200)), bin(s, hz) + 1);
  let best = -Infinity;
  for (let i = Math.max(0, lo); i <= Math.min(s.db.length - 1, hi); i++) best = Math.max(best, s.db[i]);
  return best;
}

/** Power sum of the peaks at `freqs`, in dB, or NaN with none. */
function sumDb(s: Spectrum, freqs: number[]): number {
  if (!freqs.length) return NaN;
  let power = 0;
  for (const hz of freqs) power += 10 ** (peak(s, hz) / 10);
  return 10 * Math.log10(power);
}

/** The frequency of `midi`, after the piano's tuning offset. */
export function noteHz(midi: number, centsOffset: number): number {
  return 440 * 2 ** ((midi - 69) / 12 + centsOffset / 1200);
}

/**
 * Each note's level in dB, measured where only that note sounds: its resolved
 * partials that no other stack note shares. In an octave that leaves the lower
 * note its odd partials, and the upper note none, so the upper note's level is
 * how far the lower note's even partials stand above its odd ones: that only
 * climbs when the upper note is struck too. NaN when a note can't be measured.
 */
export function stackLevels(s: Spectrum, notes: number[], centsOffset: number): Map<number, number> {
  const freq = (midi: number) => noteHz(midi, centsOffset);
  const nyquist = s.db.length * s.binHz;
  const resolved = (hz: number) => hz < nyquist && hz * (2 ** (1 / 12) - 1) >= MIN_RESOLVED_BINS * s.binHz;
  const shared = (hz: number, self: number) =>
    notes.some((m) => {
      if (m === self) return false;
      for (let k = 1; k <= OTHER_PARTIALS; k++) if (cents(hz, k * freq(m)) < OVERLAP_CENTS) return true;
      return false;
    });
  const set = new Set(notes);
  const levels = new Map<number, number>();
  for (const m of notes) {
    const f = freq(m);
    if (set.has(m - 12)) {
      const low = f / 2;
      const even = [2, 4, 6].map((k) => k * low).filter(resolved);
      const odd = [1, 3, 5, 7].map((k) => k * low).filter(resolved);
      levels.set(m, even.length && odd.length ? sumDb(s, even) - sumDb(s, odd) : NaN);
      continue;
    }
    const own: number[] = [];
    for (let k = 1; k <= PARTIALS; k++) {
      const hz = k * f;
      if (resolved(hz) && !shared(hz, m)) own.push(hz);
    }
    levels.set(m, sumDb(s, own));
  }
  return levels;
}
