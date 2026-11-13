
/*
 * Soft backing chords for the melodic modes. Each chord rings until the next
 * one, with gentle fades so changes don't click.
 *
 * Chords arrive as semitones above the tonic, root first, so any key or mode
 * works. Two voicings. The open one (root, fifth, and the third an octave up)
 * sits low, about G1 to E4 across keys, on soft triangle waves, for
 * MIDI, the on-screen keys, or a mic with headphones. The mic voicing keeps
 * every tone below A#1 (about 58 Hz), under both the lowest reading note (E2)
 * and the pitch detector's 60 Hz floor, on pure sine waves with no overtones
 * to mistake for notes, and it leaves out the pitch classes of the notes the
 * chord rings under.
 * Most laptop speakers barely play that low, so it's felt more than heard.
 */

const OPEN_ROOT = 36; // C2: the tonic of the open voicing in C, moved by at most a fifth for other keys
const SUB_LOW = 22; // the mic voicing puts each chord tone in the octave from A#0 to A1 (MIDI 22 to 33)
const OPEN_GAIN = 0.05; // per voice, before the master gain
const SUB_GAIN = 0.12; // sub tones need more level to be noticed at all
const MASTER_GAIN = 0.7;
const ATTACK_S = 0.12;
const RELEASE_S = 0.5;

export type Voicing = 'open' | 'below-reading';

function hz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export class Backing {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices: { osc: OscillatorNode; gain: GainNode }[] = [];

  /** Creates the audio graph. Call from a click so the browser allows sound. */
  async start(): Promise<void> {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    await this.ctx.resume();
    this.master = this.ctx.createGain();
    this.master.gain.value = MASTER_GAIN;
    const soften = this.ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 900;
    this.master.connect(soften).connect(this.ctx.destination);
  }

  /**
   * Fades out the current chord and fades in the next. `chord` is semitones
   * above `tonic` (a pitch class), root first. `avoid` lists the melody notes
   * it rings under.
   */
  play(chord: number[], tonic: number, voicing: Voicing, avoid: number[]): void {
    if (!this.ctx || !this.master) return;
    this.release();
    const now = this.ctx.currentTime;
    const pcs = chord.map((d) => (tonic + d) % 12);
    let tones: number[];
    if (voicing === 'open') {
      // The tonic sits within a fifth of C2 and the chord is built on its degree, as the C voicing was.
      const root = OPEN_ROOT + ((tonic + 6) % 12) - 6 + chord[0];
      tones = [root, root + 7, root + 12 + ((pcs[1] - pcs[0] + 12) % 12)];
    } else {
      tones = pcs.map((pc) => SUB_LOW + ((pc - SUB_LOW + 24) % 12));
    }
    // With a mic, never sound a pitch the player is about to play, in any octave.
    if (voicing === 'below-reading') {
      const pcs = new Set(avoid.map((m) => m % 12));
      tones = tones.filter((m) => !pcs.has(m % 12));
    }
    for (const midi of tones) {
      const osc = this.ctx.createOscillator();
      osc.type = voicing === 'open' ? 'triangle' : 'sine';
      osc.frequency.value = hz(midi);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(voicing === 'open' ? OPEN_GAIN : SUB_GAIN, now + ATTACK_S);
      osc.connect(gain).connect(this.master);
      osc.start(now);
      this.voices.push({ osc, gain });
    }
  }

  /** Fades out whatever is sounding. */
  release(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const { osc, gain } of this.voices) {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + RELEASE_S);
      osc.stop(now + RELEASE_S + 0.05);
    }
    this.voices = [];
  }
}
