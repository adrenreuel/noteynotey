import { PitchListener, type Calibration, type PitchFrame } from '../audio/pitch';
import { MidiInput } from './midi';

export type Connection = 'off' | 'starting' | 'on' | 'error';

/** A plain-language problem to show the player, and whether trying again could help. */
export interface InputProblem {
  text: string;
  canRetry: boolean;
}

export const IS_SAFARI = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);

/**
 * Owns the microphone and MIDI connections. Only one of them is live at a
 * time, because a digital piano's speakers would also reach the mic.
 */
export class PianoInput {
  readonly listener = new PitchListener();
  private midi: MidiInput;

  mic: Connection = 'off';
  midiState: Connection = 'off';
  devices: string[] = [];
  micProblem: InputProblem | null = null;
  midiProblem: InputProblem | null = null;

  constructor(
    private onNote: (midi: number) => void,
    private onChange: () => void,
    onChord: (notes: number[]) => void,
  ) {
    this.midi = new MidiInput(onNote, (names) => {
      this.devices = names;
      this.onChange();
    });
    this.listener.onNote = (midi) => this.onNote(midi);
    this.listener.onChord = onChord;
  }

  get midiSupported(): boolean {
    return this.midi.supported;
  }

  /** A real piano is connected: the mic is listening, or MIDI has found a keyboard. */
  get connected(): boolean {
    return this.mic === 'on' || (this.midiState === 'on' && this.devices.length > 0);
  }

  subscribe(fn: (frame: PitchFrame) => void): () => void {
    return this.listener.subscribe(fn);
  }

  setCalibration(cal: Calibration | null): void {
    this.listener.calibration = cal ? { centsOffset: cal.centsOffset, noiseFloor: cal.noiseFloor } : { centsOffset: 0, noiseFloor: 0.002 };
  }

  async startMic(): Promise<boolean> {
    if (this.mic === 'on') return true;
    if (this.mic === 'starting') return false;
    if (this.midiState !== 'off') this.stopMidi();
    this.mic = 'starting';
    this.micProblem = null;
    this.onChange();
    try {
      await this.listener.start();
    } catch (e) {
      this.mic = 'error';
      this.micProblem = micProblem(e);
      this.onChange();
      return false;
    }
    this.mic = 'on';
    this.onChange();
    return true;
  }

  stopMic(): void {
    this.listener.stop();
    this.mic = 'off';
    this.micProblem = null;
    this.onChange();
  }

  async startMidi(): Promise<boolean> {
    if (this.midiState === 'on') return true;
    if (this.midiState === 'starting') return false;
    if (this.mic !== 'off') this.stopMic();
    this.midiState = 'starting';
    this.midiProblem = null;
    this.onChange();
    const result = await this.midi.connect();
    if (result === 'ok') {
      this.midiState = 'on';
    } else {
      this.midiState = 'error';
      this.midiProblem = result === 'unsupported' ? MIDI_UNSUPPORTED : MIDI_DENIED;
    }
    this.onChange();
    return result === 'ok';
  }

  stopMidi(): void {
    this.midi.disconnect();
    this.midiState = 'off';
    this.midiProblem = null;
    this.onChange();
  }

  stopAll(): void {
    if (this.mic !== 'off') this.stopMic();
    if (this.midiState !== 'off') this.stopMidi();
  }
}

const MIDI_UNSUPPORTED: InputProblem = IS_SAFARI
  ? {
      text: "Safari can't connect to MIDI keyboards. Open noteynotey in Chrome to use yours, or pick Piano via Mic or On-screen Keyboard instead.",
      canRetry: false,
    }
  : {
      text: "This browser can't connect to MIDI keyboards. Chrome can, or you can pick Piano via Mic or On-screen Keyboard instead.",
      canRetry: false,
    };

const MIDI_DENIED: InputProblem = {
  text: "Your browser didn't let noteynotey talk to MIDI devices. Click the icon to the left of the web address, allow MIDI, then try again.",
  canRetry: true,
};

function micProblem(e: unknown): InputProblem {
  if (!navigator.mediaDevices) {
    return {
      text: 'The microphone only works when this page is opened securely, over https or on localhost.',
      canRetry: false,
    };
  }
  switch ((e as DOMException).name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        text: "Your browser didn't let noteynotey use the microphone. Click the icon to the left of the web address, allow the microphone, then try again.",
        canRetry: true,
      };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return {
        text: "We couldn't find a microphone. Plug one in or check your computer's sound settings, then try again.",
        canRetry: true,
      };
    case 'NotReadableError':
    case 'AbortError':
      return {
        text: 'Your microphone seems to be busy in another app, like a video call. Close that app, then try again.',
        canRetry: true,
      };
    default:
      return { text: 'Something got in the way of starting the microphone. Try again, or reload the page.', canRetry: true };
  }
}
