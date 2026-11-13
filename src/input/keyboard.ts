import { isNatural, midiName } from '../music/notes';

const FIRST = 36; // C2
const LAST = 84; // C6
const FLOAT_MS = 650; // how long a pressed key's block takes to float up and fade, in ms

export class OnScreenKeyboard {
  private keys = new Map<number, HTMLElement>();
  /** The block just sent up by a press, waiting to be colored by its result. */
  private pending = new Map<number, HTMLElement>();

  constructor(
    private el: HTMLElement,
    private onNote: (midi: number) => void,
  ) {
    this.render();
  }

  flash(midi: number, kind: 'correct' | 'wrong'): void {
    const key = this.keys.get(midi);
    if (!key) return;
    const cls = `is-${kind}`;
    key.classList.remove(cls);
    void key.offsetWidth; // restart the animation
    key.classList.add(cls);
    window.setTimeout(() => key.classList.remove(cls), 450);
    (this.pending.get(midi) ?? this.float(midi))?.classList.add(cls);
  }

  /**
   * Sends a small block up from the key that fades as it rises. It's fixed to
   * the window, since the keyboard's sideways scroll would clip it.
   */
  private float(midi: number): HTMLElement | null {
    const key = this.keys.get(midi);
    const rect = key?.getBoundingClientRect();
    if (!rect || rect.width === 0 || this.el.closest('[inert]') || matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
    const block = document.createElement('div');
    block.className = 'key-float';
    const width = Math.max(10, rect.width - 8);
    block.style.setProperty('--x', `${rect.left + (rect.width - width) / 2}px`);
    block.style.setProperty('--y', `${rect.top}px`);
    block.style.setProperty('--w', `${width}px`);
    document.body.append(block);
    window.setTimeout(() => block.remove(), FLOAT_MS);
    return block;
  }

  scrollToMiddleC(): void {
    const c4 = this.keys.get(60);
    if (!c4) return;
    this.el.scrollLeft = c4.offsetLeft - this.el.clientWidth / 2 + c4.offsetWidth / 2;
  }

  private render(): void {
    this.el.replaceChildren();
    const row = document.createElement('div');
    row.className = 'piano-keys';

    for (let midi = FIRST; midi <= LAST; midi++) {
      if (!isNatural(midi)) continue;
      const slot = document.createElement('div');
      slot.className = 'piano-slot';
      const white = this.makeKey(midi, 'piano-key piano-key-white');
      if (midi % 12 === 0) {
        const label = document.createElement('span');
        label.className = midi === 60 ? 'piano-label is-middle' : 'piano-label';
        label.textContent = midiName(midi);
        white.append(label);
      }
      slot.append(white);
      if (midi < LAST && !isNatural(midi + 1)) {
        slot.append(this.makeKey(midi + 1, 'piano-key piano-key-black'));
      }
      row.append(slot);
    }
    this.el.append(row);
  }

  private makeKey(midi: number, className: string): HTMLElement {
    const key = document.createElement('button');
    key.type = 'button';
    key.className = className;
    key.setAttribute('aria-label', midiName(midi));
    key.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const block = this.float(midi);
      if (block) this.pending.set(midi, block);
      this.onNote(midi);
      this.pending.delete(midi);
    });
    this.keys.set(midi, key);
    return key;
  }
}
