/*
 * A quiet field of notes drifting behind the home screen, wrapping around the
 * edges. Notes are drawn solid in the text color and the whole canvas is faded
 * in CSS (.note-drift), so overlapping strokes don't stack into brighter spots.
 * It reads as white on black in dark mode and ink on paper in light mode.
 * A few famous pianists' names drift among them, no two the same at once.
 */

const AREA_PER_NOTE = 70000; // px² of window per note
const MIN_NOTES = 8;
const MAX_NOTES = 18;
const SPEED = [4, 11]; // px per second
const SPIN = 0.06; // most a note turns, in radians per second
const SIZE = [16, 30]; // notehead width, in px
const MAX_STEP_MS = 50; // longest frame step, so a paused tab doesn't jump
const AREA_PER_NAME = 260000; // px² of window per pianist's name
const MIN_NAMES = 3;
const MAX_NAMES = 6;
const NAME_SIZE = [13, 18]; // font size of a name, in px
const NAME_TILT = 0.25; // most a name leans either way, in radians
const NAME_SPIN = 0.015; // most a name turns, in radians per second

const PIANISTS = [
  'Chopin', 'Liszt', 'Clara Schumann', 'Rachmaninoff', 'Horowitz', 'Glenn Gould',
  'Martha Argerich', 'Mitsuko Uchida', 'Sviatoslav Richter', 'Arthur Rubinstein',
  'Alicia de Larrocha', 'Yuja Wang', 'Lang Lang', 'Art Tatum', 'Oscar Peterson',
  'Thelonious Monk', 'Bill Evans', 'Nina Simone', 'Herbie Hancock', 'Keith Jarrett',
  'Hiromi', 'Mary Lou Williams', 'Daniil Trifonov', 'Maria João Pires',
];

type Kind = 'quarter' | 'eighth' | 'pair' | 'whole';
const KINDS: Kind[] = ['quarter', 'quarter', 'eighth', 'eighth', 'pair', 'whole'];

interface Drifter {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  size: number;
  kind: Kind;
  /** Set for a pianist's name instead of a note. */
  name?: string;
  /** The name's drawn width, in px. */
  width?: number;
}

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export class NoteDrift {
  private ctx: CanvasRenderingContext2D;
  private notes: Drifter[] = [];
  private names: Drifter[] = [];
  private frame = 0;
  private last = 0;
  private running = false;
  private color = '';
  private readonly still = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    window.addEventListener('resize', () => this.running && this.resize());
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      this.readColor();
      if (this.running) this.draw();
    });
    // Names are measured in the UI font, which may still be loading.
    void document.fonts?.ready.then(() => {
      this.names.forEach((n) => this.measure(n));
      if (this.running) this.draw();
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.canvas.hidden = false;
    this.resize();
    if (this.still.matches) return; // drawn once, standing still
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    this.canvas.hidden = true;
    cancelAnimationFrame(this.frame);
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.readColor();
    const count = Math.max(MIN_NOTES, Math.min(MAX_NOTES, Math.round((w * h) / AREA_PER_NOTE)));
    while (this.notes.length < count) this.notes.push(this.spawn(w, h));
    this.notes.length = count;
    const names = Math.max(MIN_NAMES, Math.min(MAX_NAMES, Math.round((w * h) / AREA_PER_NAME)));
    while (this.names.length < names) this.names.push(this.spawnName(w, h));
    this.names.length = names;
    this.draw();
  }

  /** A note-like drifter carrying a pianist's name not already showing. */
  private spawnName(w: number, h: number): Drifter {
    const d = this.spawn(w, h);
    d.name = this.freeName();
    d.size = rand(NAME_SIZE[0], NAME_SIZE[1]);
    d.angle = rand(-NAME_TILT, NAME_TILT);
    d.spin = rand(-NAME_SPIN, NAME_SPIN);
    this.measure(d);
    return d;
  }

  /** A pianist whose name isn't showing yet. */
  private freeName(): string {
    const showing = new Set(this.names.map((n) => n.name));
    const free = PIANISTS.filter((p) => !showing.has(p));
    return free[Math.floor(Math.random() * free.length)];
  }

  private measure(d: Drifter): void {
    this.ctx.font = nameFont(d.size);
    d.width = this.ctx.measureText(d.name ?? '').width;
  }

  private readColor(): void {
    this.color = getComputedStyle(document.body).getPropertyValue('--text').trim() || this.color;
  }

  private spawn(w: number, h: number): Drifter {
    const heading = rand(0, Math.PI * 2);
    const speed = rand(SPEED[0], SPEED[1]);
    return {
      x: rand(0, w),
      y: rand(0, h),
      vx: Math.cos(heading) * speed,
      vy: Math.sin(heading) * speed,
      angle: rand(-0.5, 0.5),
      spin: rand(-SPIN, SPIN),
      size: rand(SIZE[0], SIZE[1]),
      kind: KINDS[Math.floor(Math.random() * KINDS.length)],
    };
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min(now - this.last, MAX_STEP_MS) / 1000;
    this.last = now;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const n of [...this.notes, ...this.names]) {
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      n.angle += n.spin * dt;
      // A name only leans a little, turning back before it tips over.
      if (n.name && Math.abs(n.angle) > NAME_TILT) n.spin = -Math.sign(n.angle) * Math.abs(n.spin);
      // Off one edge, back in at the other, like the old arcade games.
      const margin = n.name ? (n.width ?? 0) / 2 + 20 : n.size * 3;
      const x = n.x;
      const y = n.y;
      if (n.x < -margin) n.x += w + 2 * margin;
      else if (n.x > w + margin) n.x -= w + 2 * margin;
      if (n.y < -margin) n.y += h + 2 * margin;
      else if (n.y > h + margin) n.y -= h + 2 * margin;
      // A name comes back in as a different pianist.
      if (n.name && (n.x !== x || n.y !== y)) {
        n.name = this.freeName();
        this.measure(n);
      }
    }
    this.draw();
    this.frame = requestAnimationFrame(this.tick);
  };

  private draw(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = this.color;
    ctx.strokeStyle = this.color;
    ctx.lineCap = 'round';
    for (const n of this.notes) {
      ctx.save();
      ctx.translate(n.x, n.y);
      ctx.rotate(n.angle);
      drawNote(ctx, n.kind, n.size);
      ctx.restore();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const n of this.names) {
      ctx.save();
      ctx.translate(n.x, n.y);
      ctx.rotate(n.angle);
      ctx.font = nameFont(n.size);
      ctx.fillText(n.name ?? '', 0, 0);
      ctx.restore();
    }
  }
}

function nameFont(size: number): string {
  return `600 ${size.toFixed(1)}px "Roboto Mono", ui-monospace, monospace`;
}

/** A note glyph centered near its head, `size` px wide at the head. */
function drawNote(ctx: CanvasRenderingContext2D, kind: Kind, size: number): void {
  const rx = size / 2;
  const ry = size * 0.34;
  const stem = size * 2.2;
  ctx.lineWidth = Math.max(1.5, size * 0.09);

  const head = (x: number, y: number, open = false) => {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, -0.35, 0, Math.PI * 2);
    if (open) ctx.stroke();
    else ctx.fill();
  };
  const stemAt = (x: number, y: number) => {
    ctx.beginPath();
    ctx.moveTo(x + rx * 0.9, y - ry * 0.3);
    ctx.lineTo(x + rx * 0.9, y - stem);
    ctx.stroke();
  };

  if (kind === 'whole') {
    head(0, 0, true);
    return;
  }
  if (kind === 'pair') {
    const gap = size * 1.6;
    head(-gap / 2, 0);
    head(gap / 2, -size * 0.3);
    stemAt(-gap / 2, 0);
    stemAt(gap / 2, -size * 0.3);
    ctx.beginPath();
    ctx.lineWidth = size * 0.28;
    ctx.lineCap = 'butt';
    ctx.moveTo(-gap / 2 + rx * 0.9, -stem);
    ctx.lineTo(gap / 2 + rx * 0.9, -stem - size * 0.3);
    ctx.stroke();
    ctx.lineCap = 'round';
    return;
  }
  head(0, 0);
  stemAt(0, 0);
  if (kind === 'eighth') {
    const x = rx * 0.9;
    ctx.beginPath();
    ctx.moveTo(x, -stem);
    ctx.quadraticCurveTo(x + size * 0.9, -stem + size * 0.7, x + size * 0.5, -stem + size * 1.4);
    ctx.stroke();
  }
}
