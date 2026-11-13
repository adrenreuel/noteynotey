import {
  dayKey,
  keyStatus,
  noteStatus,
  overview,
  trickyKeys,
  trickyNotes,
  type NoteBucket,
  type Overview,
  type NoteStats,
  type Progress,
} from '../game/progress';
import { KEYS, type KeyMode } from '../music/keys';
import { notesForClef, type Clef, type NoteDef } from '../music/notes';
import { icon } from './icons';
import { setRichTip } from './tooltip';

const CLEF_TITLES: Record<Clef, string> = { treble: 'Treble', bass: 'Bass' };
const BUCKETS: { bucket: NoteBucket; label: string }[] = [
  { bucket: 'mastered', label: 'Perfetto' },
  { bucket: 'learning', label: 'Comfortable' },
  { bucket: 'tricky', label: 'Needs work' },
  { bucket: 'new', label: 'Undiscovered' },
];
const NONE = '–';

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function secs(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A note name chip, filled by status. Notes that need work are red. Its tooltip is a small stats card. */
function chip(note: NoteDef, p: Progress, tricky: Set<string>): HTMLElement {
  const status = noteStatus(p, note.id);
  const bucket: NoteBucket = tricky.has(note.id) ? 'tricky' : status;
  const el = document.createElement('span');
  el.className = `note-chip is-${status}${bucket === 'tricky' ? ' is-tricky' : ''}`;
  statsTip(el, note.name, p.stats[note.id], bucket);
  const letter = document.createElement('span');
  letter.textContent = note.name.slice(0, -1);
  const octave = document.createElement('span');
  octave.className = 'note-chip-octave';
  octave.textContent = note.name.slice(-1);
  el.append(letter, octave);
  return el;
}

/** The home screen strip: a row of labeled chips per clef, lowest note first. The full map shows the same rows. */
export function renderSkillStrip(el: HTMLElement, p: Progress): void {
  const tricky = new Set(trickyNotes(p).map((n) => n.id));
  el.replaceChildren(
    ...(['treble', 'bass'] as Clef[]).map((clef) => {
      const row = document.createElement('div');
      row.className = 'strip-row';
      const label = document.createElement('span');
      label.className = 'strip-label';
      label.textContent = CLEF_TITLES[clef].replace(' clef', '');
      const chips = document.createElement('div');
      chips.className = 'strip-chips';
      chips.append(...notesForClef(clef).map((n) => chip(n, p, tricky)));
      row.append(label, chips);
      return row;
    }),
  );
}

/* ---------- Full map ---------- */

const BUCKET_LABELS = Object.fromEntries(BUCKETS.map((b) => [b.bucket, b.label])) as Record<NoteBucket, string>;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** A ring filled to `value` (0 to 1) in the status color, with the percentage inside. */
function ring(value: number, bucket: NoteBucket): HTMLElement {
  const wrap = el('span', `tip-ring is-${bucket}`);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 36 36');
  svg.setAttribute('aria-hidden', 'true');
  // r = 15.9155 makes the circumference 100, so the dash length is the percentage.
  for (const cls of ['tip-ring-track', 'tip-ring-arc']) {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('class', cls);
    c.setAttribute('cx', '18');
    c.setAttribute('cy', '18');
    c.setAttribute('r', '15.9155');
    if (cls === 'tip-ring-arc') c.setAttribute('stroke-dasharray', `${Math.round(value * 100)} 100`);
    svg.append(c);
  }
  wrap.append(svg, el('span', 'tip-ring-value', pct(value)));
  return wrap;
}

/**
 * A chip's tooltip: a small card with the name and its status as in the legend, then
 * (once played) a ring of recent first-try accuracy and the recent reading time.
 */
function statsTip(target: HTMLElement, name: string, s: NoteStats | undefined, bucket: NoteBucket): void {
  const text = s ? `${name}: ${BUCKET_LABELS[bucket]}, ${pct(s.accEma)} accuracy, ${secs(s.latEma)} to read` : `${name}: ${BUCKET_LABELS[bucket]}`;
  setRichTip(target, text, () => {
    const card = el('div', 'tip-card');
    const head = el('div', 'tip-card-head');
    head.append(el('span', 'tip-card-name', name), el('span', `tip-card-status is-${bucket}`, BUCKET_LABELS[bucket]));
    card.append(head);
    if (s) {
      const body = el('div', 'tip-card-body');
      const acc = el('div', 'tip-figure');
      acc.append(ring(s.accEma, bucket), el('span', 'tip-figure-label', 'Accuracy'));
      const read = el('div', 'tip-figure');
      read.append(el('span', 'tip-figure-value', secs(s.latEma)), el('span', 'tip-figure-label', 'Reading time'));
      body.append(acc, read);
      card.append(body);
    }
    return card;
  });
}

/** The three headline figures: recent accuracy, recent reading time, notes played. */
function figuresSection(o: Overview): HTMLElement {
  const figures = el('div', 'map-figures');
  const figure = (value: string, label: string) => {
    const f = el('div', 'map-figure');
    f.append(el('span', 'map-figure-value', value), el('span', 'map-figure-label', label));
    return f;
  };
  figures.append(
    figure(o.accuracy === null ? NONE : pct(o.accuracy), 'Accuracy'),
    figure(o.readingMs === null ? NONE : secs(o.readingMs), 'Avg. Reading time'),
    figure(o.plays ? String(o.plays) : NONE, 'Notes played'),
  );
  return figures;
}

/**
 * A status summary over chip rows: a bar split by status, the chip rows, then the bar's
 * counts doubling as the legend. Used for every note (rows per clef) and every key (major, minor).
 */
function statusSection(title: string, counts: Record<NoteBucket, number>, rows: HTMLElement): HTMLElement {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const section = el('section', 'map-section');
  const bar = el('div', 'dist-bar');
  bar.setAttribute('aria-hidden', 'true');
  const legend = el('div', 'dist-legend');
  for (const { bucket, label } of BUCKETS) {
    const count = counts[bucket];
    if (count) {
      const seg = el('span', `dist-seg is-${bucket}`);
      seg.style.setProperty('--share', String(count / total));
      bar.append(seg);
    }
    const item = el('span', 'dist-item');
    item.append(el('span', `legend-swatch is-${bucket}`), el('strong', 'dist-count', String(count)), label);
    legend.append(item);
  }
  const head = el('div', 'map-section-head');
  head.append(el('h3', 'map-section-title', title), el('span', 'map-section-meta', `${total - counts.new} of ${total} played`));
  section.append(head, bar, rows, legend);
  return section;
}

/** Every note, as the home strip's chip rows per clef. */
function notesSection(o: Overview, p: Progress): HTMLElement {
  const rows = el('div', 'map-strip');
  renderSkillStrip(rows, p);
  return statusSection('Notes', o.counts, rows);
}

/** Every key, as chip rows like the notes: majors, then minors, flats to sharps, so each minor key sits under the major key with its signature. */
function keysSection(p: Progress): HTMLElement {
  const tricky = new Set(trickyKeys(p));
  const counts: Record<NoteBucket, number> = { mastered: 0, learning: 0, tricky: 0, new: 0 };
  const rows = el('div', 'map-strip');
  for (const mode of ['major', 'minor'] as KeyMode[]) {
    const row = el('div', 'strip-row');
    const chips = el('div', 'strip-chips');
    for (const k of KEYS.filter((k) => k.mode === mode).sort((a, b) => a.sig - b.sig)) {
      const bucket: NoteBucket = tricky.has(k) ? 'tricky' : keyStatus(p, k.id);
      counts[bucket]++;
      const c = el('span', `note-chip is-${bucket === 'tricky' ? `${keyStatus(p, k.id)} is-tricky` : bucket}`, k.name.replace(/ (major|minor)$/, ''));
      statsTip(c, k.name, p.keys[k.id], bucket);
      chips.append(c);
    }
    row.append(el('span', 'strip-label', mode === 'major' ? 'Major' : 'Minor'), chips);
    rows.append(row);
  }
  return statusSection('Keys', counts, rows);
}

/* ---------- Practice calendar ---------- */

const CAL_LEVELS = [1, 20, 50, 100]; // notes in a day for each step up in color
const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** What the calendar shows: this month, this year, or a past year with practice in it. */
type CalRange = 'month' | 'year' | number;

let calRange: CalRange = 'month';

function calLevel(notes: number): number {
  return CAL_LEVELS.filter((min) => notes >= min).length;
}

function plural(n: number, word: string): string {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}

/** Past years with any practice, newest first. */
function pastYears(p: Progress, thisYear: number): number[] {
  const years = new Set<number>();
  for (const [key, notes] of Object.entries(p.activity)) {
    const year = Number(key.slice(0, 4));
    if (notes > 0 && year < thisYear) years.add(year);
  }
  return [...years].sort((a, b) => b - a);
}

const tipFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/** Colors a day's square by notes played and gives it a tooltip; returns whether it was practiced. */
function fillDay(cell: HTMLElement, date: Date, p: Progress): boolean {
  const notes = p.activity[dayKey(date)] ?? 0;
  cell.classList.add(`is-level-${calLevel(notes)}`);
  cell.dataset.tip = `${tipFmt.format(date)}: ${notes ? plural(notes, 'note') : 'no practice'}`;
  return notes > 0;
}

/** This month as a plain month calendar: weekdays across, weeks down, the day number in each square. */
function monthView(p: Progress, today: Date): { view: HTMLElement; practiced: number } {
  const grid = el('div', 'cal-month-grid');
  for (const label of WEEKDAYS) grid.append(el('span', 'cal-weekday', label));
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  for (let i = (first.getDay() + 6) % 7; i > 0; i--) grid.append(el('span', ''));
  let practiced = 0;
  const date = new Date(first);
  while (date.getMonth() === first.getMonth()) {
    const cell = el('span', 'cal-cell cal-date', String(date.getDate()));
    if (date > today) cell.classList.add('is-ahead');
    else if (fillDay(cell, date, p)) practiced++;
    if (date.getTime() === today.getTime()) cell.classList.add('is-today');
    grid.append(cell);
    date.setDate(date.getDate() + 1);
  }
  return { view: grid, practiced };
}

/** A whole year like a contribution graph: weeks as columns, Monday at the top. */
function yearView(p: Progress, today: Date, year: number): { view: HTMLElement; practiced: number } {
  const jan1 = new Date(year, 0, 1);
  const start = new Date(jan1);
  start.setDate(1 - ((jan1.getDay() + 6) % 7));
  const dec31 = new Date(year, 11, 31);
  const weeks = Math.ceil((Math.round((dec31.getTime() - start.getTime()) / 86_400_000) + 1) / 7);

  const grid = el('div', 'cal-grid');
  const months = el('div', 'cal-months');
  months.setAttribute('aria-hidden', 'true');
  for (const label of DAY_LABELS) grid.append(el('span', 'cal-day', label));
  months.append(el('span', ''));

  let practiced = 0;
  let todayCell: HTMLElement | null = null;
  const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short' });
  for (let w = 0; w < weeks; w++) {
    let monthLabel = '';
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(start.getDate() + 7 * w + d);
      const cell = el('span', 'cal-cell');
      if (date.getFullYear() !== year || date > today) {
        cell.classList.add('is-future');
      } else {
        if (fillDay(cell, date, p)) practiced++;
        if (date.getTime() === today.getTime()) todayCell = cell;
      }
      if (date.getFullYear() === year && date.getDate() === 1) monthLabel = monthFmt.format(date);
      grid.append(cell);
    }
    months.append(el('span', 'cal-month', monthLabel));
  }

  const scroller = el('div', 'cal-scroll');
  scroller.style.setProperty('--weeks', String(weeks));
  scroller.append(grid, months);
  // Narrow screens scroll the year sideways; this year opens on this week.
  if (todayCell) {
    const cell = todayCell;
    requestAnimationFrame(() => (scroller.scrollLeft = cell.offsetLeft - scroller.clientWidth + 60));
  }
  return { view: scroller, practiced };
}

/** Practice: this month by default, with a picker for this year and any past year with practice. */
function activitySection(p: Progress): HTMLElement {
  const section = el('section', 'map-section');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisYear = today.getFullYear();
  const years = pastYears(p, thisYear);
  if (typeof calRange === 'number' && !years.includes(calRange)) calRange = 'month';

  const { view, practiced } =
    calRange === 'month' ? monthView(p, today) : yearView(p, today, calRange === 'year' ? thisYear : calRange);
  const span = calRange === 'month' ? 'this month' : calRange === 'year' ? 'this year' : `in ${calRange}`;

  const picker = el('select', 'cal-range-select');
  picker.setAttribute('aria-label', 'Show practice for');
  const options: [string, string][] = [
    ['month', 'This month'],
    ['year', 'This year'],
    ...years.map((y): [string, string] => [String(y), String(y)]),
  ];
  for (const [value, label] of options) {
    const option = el('option', '', label);
    option.value = value;
    option.selected = value === String(calRange);
    picker.append(option);
  }
  picker.addEventListener('change', () => {
    const v = picker.value;
    calRange = v === 'month' || v === 'year' ? v : Number(v);
    const next = activitySection(p);
    section.replaceWith(next);
    next.querySelector<HTMLSelectElement>('.cal-range-select')?.focus();
  });
  const range = el('span', 'cal-range');
  range.append(picker, icon('caretDown'));

  const legend = el('div', 'cal-legend');
  legend.setAttribute('aria-hidden', 'true');
  legend.append('Less', ...[0, 1, 2, 3, 4].map((l) => el('span', `cal-cell is-level-${l}`)), 'More');

  const meta = `${plural(practiced, 'day')} ${span}`;
  const head = el('div', 'map-section-head');
  const end = el('div', 'map-section-end');
  end.append(el('span', 'map-section-meta', meta), range);
  head.append(el('h3', 'map-section-title', 'Practice'), end);
  section.setAttribute('aria-label', `Practice calendar, ${meta}`);
  section.append(head, view, legend);
  return section;
}

/** The full skill map: headline figures, the practice calendar, then every note and every key as chip rows. */
export function renderSkillMap(root: HTMLElement, p: Progress): void {
  const o = overview(p);
  root.replaceChildren(figuresSection(o), activitySection(p), notesSection(o, p), keysSection(p));
}
