export type MidiConnectResult = 'ok' | 'denied' | 'unsupported';

/** Listens to note-on messages from every connected MIDI input once connected. */
export class MidiInput {
  private access: MIDIAccess | null = null;

  constructor(
    private onNote: (midi: number) => void,
    private onDevicesChange: (names: string[]) => void,
  ) {}

  get supported(): boolean {
    return 'requestMIDIAccess' in navigator;
  }

  get connected(): boolean {
    return this.access !== null;
  }

  /** Requests MIDI access and says why if it could not get it. */
  async connect(): Promise<MidiConnectResult> {
    if (this.access) return 'ok';
    if (!this.supported) return 'unsupported';
    try {
      this.access = await navigator.requestMIDIAccess();
    } catch (e) {
      return (e as DOMException).name === 'NotSupportedError' ? 'unsupported' : 'denied';
    }
    this.access.onstatechange = this.bind;
    this.bind();
    return 'ok';
  }

  disconnect(): void {
    if (!this.access) return;
    this.access.onstatechange = null;
    this.access.inputs.forEach((input) => (input.onmidimessage = null));
    this.access = null;
    this.onDevicesChange([]);
  }

  private bind = (): void => {
    if (!this.access) return;
    const names: string[] = [];
    this.access.inputs.forEach((input) => {
      if (input.state !== 'connected') return;
      input.onmidimessage = (e) => {
        if (!e.data) return;
        const [status, note, velocity] = e.data;
        if ((status & 0xf0) === 0x90 && velocity > 0) this.onNote(note);
      };
      names.push(input.name || 'MIDI keyboard');
    });
    this.onDevicesChange(names);
  };
}
