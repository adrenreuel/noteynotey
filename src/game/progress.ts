import type { Calibration } from '../audio/pitch';
import { KEYS, type KeyDef } from '../music/keys';
import { NOTES, type ClefMode, type NoteDef } from '../music/notes';

export interface NoteStats {
  attempts: number;
  firstTry: number;
  /** Exponential moving average of first-try accuracy, 0 to 1. */
  accEma: number;
  /** Exponential moving average of time to the correct key, in ms. */
  latEma: number;
  lastSeen: number;
  lastMissed: boolean;
}

export type InputKind = 'mic' | 'midi' | 'screen';

/** An acoustic piano heard through the mic, with its own tuning and room noise. */
export interface PianoProfile extends Calibration {
  id: string;
  name: string;
}

export interface Settings {
  input: InputKind;
  profiles: PianoProfile[];
  activeProfileId: string | null;
  /** The player turned the mic off, so it doesn't start again until they turn it back on. */
  micOff: boolean;
  /**
   * The mic was off when the player went back to the input choices, so no input is
   * picked until they choose one.
   */
  noInput: boolean;
  /** The player tucked the on-screen keys away during rounds. */
  keysHidden: boolean;
  /** The key rounds use (a key id like "G" or "F#m"), or null for a random key each round. Flash Notes is always in C. */
  roundKey: string | null;
}

export interface Progress {
  version: 1;
  trial: number;
  xp: number;
  bestStreak: number;
  stats: Record<string, NoteStats>;
  /** How reading goes in each key (melodic modes only), by key id. Same fields as a note's stats. */
  keys: Record<string, NoteStats>;
  settings: Settings;
  /** Days practiced in a row. `last` is a local date key, see `dayKey`. */
  days: { last: string | null; streak: number };
  /** Notes played on each local day, by date key (YYYY-MM-DD). Drives the practice calendar. */
  activity: Record<string, number>;
}

/** Settings fields from before piano profiles. */
interface LegacySettings {
  calibration?: Calibration | null;
  midi?: boolean;
  /** Rounds always use both clefs now. */
  clefMode?: string;
  /** There used to be a first-visit setup screen. */
  onboarded?: boolean;
  /** Backing chords, removed for now. */
  backing?: boolean | null;
  headphones?: boolean;
  /** The on-screen keys always show in a round now. */
  showKeys?: boolean;
  /** The key picker was Zen's alone at first. */
  zenKey?: string | null;
}

/** Every note is playable from the start; `new` means not played yet. */
export type NoteStatus = 'new' | 'learning' | 'mastered';

const STORAGE_KEY = 'noteynotey.progress.v1';
const FAST_MS = 1500;
const SLOW_MS = 6000;
const MIN_ATTEMPTS = 6;
const ACC_ALPHA = 0.25;
const LAT_ALPHA = 0.3;
// Keys get a note at a time too, so they average over more notes: about a round's worth.
const KEY_ACC_ALPHA = 0.08;
const KEY_LAT_ALPHA = 0.08;
const KEY_TRICKY_AFTER = 12; // notes played in a key before it can count as tricky
export const MASTERED_AT = 0.85;

function freshSettings(): Settings {
  return {
    input: 'screen',
    profiles: [],
    activeProfileId: null,
    micOff: false,
    noInput: false,
    keysHidden: false,
    roundKey: null,
  };
}

function freshProgress(settings?: Settings): Progress {
  return {
    version: 1,
    trial: 0,
    xp: 0,
    bestStreak: 0,
    stats: {},
    keys: {},
    settings: settings ?? freshSettings(),
    days: { last: null, streak: 0 },
    activity: {},
  };
}

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as Partial<Progress>;
      if (data.version === 1) return migrate(data);
    }
  } catch {
    // Storage blocked or corrupt; start fresh.
  }
  return freshProgress();
}

/** Fills in fields added since the data was saved. Settings are merged key by key. */
function migrate(data: Partial<Progress>): Progress {
  const saved = (data.settings ?? {}) as Partial<Settings> & LegacySettings;
  const { calibration, midi, clefMode: _clefMode, onboarded: _onboarded, backing: _backing, headphones: _headphones, showKeys: _showKeys, zenKey, ...rest } = saved;
  const settings: Settings = { ...freshSettings(), ...rest };
  if (saved.roundKey === undefined && zenKey) settings.roundKey = zenKey;

  if (calibration && settings.profiles.length === 0) {
    const profile: PianoProfile = { id: newProfileId(), name: 'My piano', ...calibration };
    settings.profiles = [profile];
    settings.activeProfileId = profile.id;
  }
  if (saved.input === undefined) settings.input = midi ? 'midi' : calibration ? 'mic' : 'screen';
  // Piano via Mic needs a tuned piano before the mic connects; older saves could pick it without one.
  if (settings.input === 'mic' && settings.profiles.length === 0) settings.input = 'screen';

  // Notes used to unlock one by one, and there used to be a daily round (Dawn Chorus, then Daily Warm-up).
  const {
    unlocked: _unlocked,
    chorusDone: _chorusDone,
    dailyDone: _dailyDone,
    ...fields
  } = data as Partial<Progress> & { unlocked?: string[]; chorusDone?: string | null; dailyDone?: string | null };

  const progress = { ...freshProgress(), ...fields, settings } as Progress;
  // Saves from before the practice calendar: the current streak's days were practiced, count unknown.
  if (!data.activity && progress.days.last) seedActivity(progress);
  return progress;
}

function seedActivity(p: Progress): void {
  const [y, m, d] = p.days.last!.split('-').map(Number);
  for (let i = 0; i < p.days.streak; i++) p.activity[dayKey(new Date(y, m - 1, d - i))] = 1;
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Storage unavailable; progress lasts for this session only.
  }
}

export function newProfileId(): string {
  return `piano-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function activeProfile(p: Progress): PianoProfile | null {
  return p.settings.profiles.find((x) => x.id === p.settings.activeProfileId) ?? null;
}

/* ---------- Days and streaks ---------- */

/** Local calendar date as YYYY-MM-DD. */
export function dayKey(date = new Date()): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

function daysBetween(a: string, b: string): number {
  const toUtc = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** The streak as it stands today: it lapses once a whole day is skipped. */
export function currentStreak(p: Progress): number {
  if (!p.days.last) return 0;
  return daysBetween(p.days.last, dayKey()) <= 1 ? p.days.streak : 0;
}

function markPracticed(p: Progress): void {
  const today = dayKey();
  p.activity[today] = (p.activity[today] ?? 0) + 1;
  if (p.days.last === today) return;
  p.days.streak = p.days.last && daysBetween(p.days.last, today) === 1 ? p.days.streak + 1 : 1;
  p.days.last = today;
}

/* ---------- Mastery ---------- */

/** 1 when the note is played in FAST_MS or less, 0 at SLOW_MS or more. */
export function speedScore(ms: number): number {
  return Math.min(1, Math.max(0, (SLOW_MS - ms) / (SLOW_MS - FAST_MS)));
}

/** Blends accuracy and speed, scaled down until the note has enough attempts. */
export function mastery(s: NoteStats | undefined): number {
  if (!s || s.attempts === 0) return 0;
  const raw = 0.6 * s.accEma + 0.4 * speedScore(s.latEma);
  return raw * Math.min(1, s.attempts / MIN_ATTEMPTS);
}

export function noteStatus(p: Progress, id: string): NoteStatus {
  if (!p.stats[id]) return 'new';
  return mastery(p.stats[id]) >= MASTERED_AT ? 'mastered' : 'learning';
}

const TRICKY_ACCURACY = 0.7; // first-try accuracy (EMA) below this marks a played note as tricky

/**
 * Played notes that are giving trouble right now: missed last time or often
 * missed on the first try. Weakest first.
 */
export function trickyNotes(p: Progress): NoteDef[] {
  return NOTES.filter((n) => {
    const s = p.stats[n.id];
    return s && (s.lastMissed || s.accEma < TRICKY_ACCURACY);
  })
    .sort((a, b) => p.stats[a.id].accEma - p.stats[b.id].accEma);
}

/** A note's status for the skill map, with "needs work" taking priority. */
export type NoteBucket = NoteStatus | 'tricky';

export function noteBucket(p: Progress, id: string, tricky: Set<string>): NoteBucket {
  return tricky.has(id) ? 'tricky' : noteStatus(p, id);
}

export interface Overview {
  counts: Record<NoteBucket, number>;
  /** Recent first-try accuracy (each note's `accEma`, weighted by plays), 0 to 1. Null before anything is played. */
  accuracy: number | null;
  /** Recent time to the right key (each note's `latEma`, weighted by plays), in ms. Null before anything is played. */
  readingMs: number | null;
  plays: number;
}

/** Headline numbers for the skill map, over every note on both clefs. */
export function overview(p: Progress): Overview {
  const tricky = new Set(trickyNotes(p).map((n) => n.id));
  const counts: Record<NoteBucket, number> = { mastered: 0, learning: 0, tricky: 0, new: 0 };
  let plays = 0;
  let accuracy = 0;
  let latency = 0;
  for (const n of NOTES) {
    counts[noteBucket(p, n.id, tricky)]++;
    const s = p.stats[n.id];
    if (!s) continue;
    plays += s.attempts;
    accuracy += s.accEma * s.attempts;
    latency += s.latEma * s.attempts;
  }
  return {
    counts,
    accuracy: plays ? accuracy / plays : null,
    readingMs: plays ? latency / plays : null,
    plays,
  };
}

export function keyStatus(p: Progress, keyId: string): NoteStatus {
  if (!p.keys[keyId]) return 'new';
  return mastery(p.keys[keyId]) >= MASTERED_AT ? 'mastered' : 'learning';
}

/**
 * Keys giving trouble: played a fair amount and often missed on the first
 * try, compared with how the player reads in their other keys. Weakest first.
 */
export function trickyKeys(p: Progress): KeyDef[] {
  const played = KEYS.filter((k) => (p.keys[k.id]?.attempts ?? 0) >= KEY_TRICKY_AFTER);
  // A key stands out when it's well below the player's best key, or low on its own.
  const best = Math.max(0, ...played.map((k) => p.keys[k.id].accEma));
  return played
    .filter((k) => {
      const acc = p.keys[k.id].accEma;
      return acc < TRICKY_ACCURACY || (played.length > 1 && acc < best - 0.15);
    })
    .sort((a, b) => p.keys[a.id].accEma - p.keys[b.id].accEma);
}

function updateStats(s: NoteStats | undefined, trial: number, latencyMs: number, missed: boolean, accAlpha: number, latAlpha: number): NoteStats {
  const acc = missed ? 0 : 1;
  if (!s) return { attempts: 1, firstTry: acc, accEma: acc, latEma: latencyMs, lastSeen: trial, lastMissed: missed };
  s.attempts++;
  s.firstTry += acc;
  s.accEma += accAlpha * (acc - s.accEma);
  s.latEma += latAlpha * (latencyMs - s.latEma);
  s.lastSeen = trial;
  s.lastMissed = missed;
  return s;
}

/** Records a finished trial, and how it went in the round's key when there is one. */
export function recordTrial(p: Progress, note: NoteDef, latencyMs: number, missed: boolean, keyId?: string): void {
  p.stats[note.id] = updateStats(p.stats[note.id], p.trial, latencyMs, missed, ACC_ALPHA, LAT_ALPHA);
  if (keyId) p.keys[keyId] = updateStats(p.keys[keyId], p.trial, latencyMs, missed, KEY_ACC_ALPHA, KEY_LAT_ALPHA);
  p.trial++;
  markPracticed(p);
}

/* ---------- Picking notes ---------- */

function inClef(note: NoteDef, clef: ClefMode): boolean {
  return clef === 'both' || note.clef === clef;
}

/**
 * Weighted random pick from every note in the clef. Weak, new, recently
 * missed and long-unseen notes come up more often. Avoids repeating the
 * previous note.
 */
export function pickNext(p: Progress, prevId: string | null, clef: ClefMode): NoteDef {
  const pool = NOTES.filter((n) => inClef(n, clef));
  const candidates = pool.length > 1 ? pool.filter((n) => n.id !== prevId) : pool;

  const weights = candidates.map((n) => {
    const s = p.stats[n.id];
    if (!s) return 3;
    let w = 0.2 + 1.5 * (1 - mastery(s));
    if (s.attempts < 3) w += 1;
    if (s.lastMissed) w += 1;
    const gap = (p.trial - s.lastSeen) / Math.max(1, pool.length);
    return w * (1 + 0.3 * Math.min(gap, 3));
  });

  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/* ---------- Levels ---------- */

export function xpForLevel(level: number): number {
  return 75 * level * (level - 1);
}

export function levelFor(xp: number): number {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  return level;
}
