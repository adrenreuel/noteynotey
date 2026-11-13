import type { Calibration, PitchFrame, StackDebug } from './audio/pitch';
import { MODES, getMode, type ModeDef, type ModeId } from './game/modes';
import {
  activeProfile,
  currentStreak,
  levelFor,
  loadProgress,
  newProfileId,
  saveProgress,
  trickyKeys,
  xpForLevel,
  type InputKind,
  type PianoProfile,
  type Progress,
} from './game/progress';
import { composeRound, type MelodyPlan } from './game/melody';
import { Session, type NoteResult } from './game/session';
import { StackRound, composeArpeggios, composeStacks, type StackPlan } from './game/chords';
import { ScrollRound, type BeatEvent } from './game/scroll';
import { OnScreenKeyboard } from './input/keyboard';
import { PianoInput, type Connection, type InputProblem } from './input/piano';
import { accidentalFor, C_MAJOR, KEYS, keyTip, spell, type KeyDef } from './music/keys';
import { midiName } from './music/notes';
import { BeatStrip, type BeatMark } from './ui/beatstrip';
import { renderSkillMap, renderSkillStrip } from './ui/skillmap';
import { icon, type IconName } from './ui/icons';
import { NoteDrift } from './ui/drift';
import { StaffView, keySignatureSheet, type StaffState } from './ui/staff';
import { initTooltips, setRichTip } from './ui/tooltip';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  brand: $('brand'),
  dayStreak: $('day-streak'),
  dayStreakText: $('day-streak-text'),
  level: $('level'),
  homeStats: $('home-stats'),
  levelLabel: $('level-label'),
  levelLabelFill: $('level-label-fill'),
  xpFill: $('xp-fill'),
  pianoTrigger: $<HTMLButtonElement>('piano-trigger'),
  pianoSource: $('piano-source'),
  pianoTriggerIcon: $('piano-trigger-icon'),


  pianoFooter: $('piano-footer'),
  pianoFooterIcon: $('piano-footer-icon'),
  pianoFooterIcons: $('piano-footer-icons'),
  pianoChange: $<HTMLButtonElement>('piano-change'),
  pianoFooterName: $('piano-footer-name'),
  pianoFooterStatus: $('piano-footer-status'),
  modeGrid: $('mode-grid'),
  skillStrip: $('skill-strip'),
  skillStripCard: $('skill-strip-card'),
  dailyPlay: $('daily-play'),
  dailyGo: $('daily-go'),
  dailyMonth: $('daily-month'),
  dailyDay: $('daily-day'),
  dailyWeekday: $('daily-weekday'),
  dailyCountdown: $('daily-countdown'),

  practice: $('practice'),
  sessionMode: $('session-mode'),
  sessionKey: $('session-key'),
  sessionMeta: $('session-meta'),
  roundTicks: $('round-ticks'),
  endBtn: $<HTMLButtonElement>('end-btn'),
  staffCard: $('staff-card'),
  staffEl: $('staff'),
  beatStripEl: $('beat-strip'),
  summary: $('summary'),
  summaryTitle: $('summary-title'),
  summaryTicks: $('summary-ticks'),
  summaryText: $('summary-text'),
  summaryHome: $<HTMLButtonElement>('summary-home'),
  summaryAgain: $<HTMLButtonElement>('summary-again'),

  skillsBack: $<HTMLButtonElement>('skills-back'),
  skillMap: $('skill-map'),
  keyboardDock: $('keyboard-dock'),
  dockKeys: $('dock-keys'),
  keysToggle: $<HTMLButtonElement>('keys-toggle'),
  roundTools: $('round-tools'),
  keyPick: $<HTMLButtonElement>('key-pick'),
  keyDialog: $<HTMLDialogElement>('key-dialog'),
  keyClose: $<HTMLButtonElement>('key-close'),
  stackDialog: $<HTMLDialogElement>('stack-dialog'),
  stackOk: $<HTMLButtonElement>('stack-ok'),
  stackClose: $<HTMLButtonElement>('stack-close'),
  stackSwitch: $<HTMLButtonElement>('stack-switch'),
  keyChoices: $('key-choices'),
  topbarEnd: $('topbar-end'),

  pianoSheet: $<HTMLDialogElement>('piano-sheet'),
  choiceMic: $('choice-mic'),
  choiceMidi: $('choice-midi'),
  choiceScreen: $('choice-screen'),
  micStatus: $('mic-status'),
  micNotice: $('mic-notice'),
  micNoticeText: $('mic-notice-text'),
  micRetry: $<HTMLButtonElement>('mic-retry'),
  micToggle: $<HTMLButtonElement>('mic-toggle'),
  footerMicToggle: $<HTMLButtonElement>('piano-mic-toggle'),
  micOffCallout: $('mic-off-callout'),
  pianoFooterLabel: $('piano-footer-label'),
  pianoFooterChange: $('piano-footer-change'),
  profileList: $('profile-list'),
  addPiano: $<HTMLButtonElement>('add-piano'),
  midiStatus: $('midi-status'),
  midiNotice: $('midi-notice'),
  midiNoticeText: $('midi-notice-text'),
  midiRetry: $<HTMLButtonElement>('midi-retry'),
  sheetDone: $<HTMLButtonElement>('sheet-done'),


  tuneDialog: $<HTMLDialogElement>('tune-dialog'),
  tuneTitle: $('tune-title'),
  tuneName: $<HTMLInputElement>('tune-name'),
  tuneText: $('tune-text'),
  tuneFill: $('tune-fill'),
  tuneStart: $<HTMLButtonElement>('tune-start'),
  tuneCancel: $<HTMLButtonElement>('tune-cancel'),

};

const gateEls = document.querySelectorAll<HTMLElement>('[data-gate]');
const gatedEls = document.querySelectorAll<HTMLElement>('[data-gated]');


const DAILY_TICK_MS = 15_000; // how often the daily card's countdown refreshes, in ms

const progress = loadProgress();
const piano = new PianoInput(handleInput, updateInputStatus, handleChord);
const staff = new StaffView($('staff'));
const beatStrip = new BeatStrip($('beat-strip'));
const keyboard = new OnScreenKeyboard($('piano'), (midi) => handleInput(midi));
const drift = new NoteDrift($<HTMLCanvasElement>('note-drift'));

/** True while a tuning step is listening, so its notes aren't scored. */
let tuning = false;

function save(): void {
  saveProgress(progress);
}

/* ---------- Screens ---------- */

type Screen = 'home' | 'session' | 'skills';
let screen: Screen = 'home';
/** False until the first screen shows, so the page doesn't animate in on load. */
let screenShown = false;

const PROFILE_HASH = '#profile';
const OLD_PROFILE_HASH = '#skills'; // its address before it was the profile

/**
 * The profile (the full skill map, for now) has its own address (#profile), so
 * reloading stays on it and the browser's back button returns home. Other
 * screens live at the plain address.
 */
function syncAddress(next: Screen): void {
  const hash = next === 'skills' ? PROFILE_HASH : '';
  if (location.hash === hash) return;
  const url = hash || location.pathname + location.search;
  if (next === 'skills') history.pushState({ fromApp: true }, '', url);
  else history.replaceState(null, '', url);
}

function showScreen(next: Screen): void {
  const changed = screenShown && next !== screen;
  screen = next;
  screenShown = true;
  syncAddress(next);
  document.querySelectorAll<HTMLElement>('.screen').forEach((el) => {
    el.hidden = el.dataset.screen !== next;
    // A slight zoom and fade as a screen comes in: forward into a round or the profile, back out to home.
    if (changed && !el.hidden) restartAnimation(el, next === 'home' ? 'is-entering-back' : 'is-entering');
  });
  ui.brand.hidden = next === 'home'; // home shows the wordmark above the modes instead
  // Home shows the streak and level centered under its wordmark; other screens keep them in the top bar.
  if (next === 'home') ui.homeStats.append(ui.dayStreak, ui.level);
  else ui.topbarEnd.append(ui.dayStreak, ui.level);
  ui.pianoTrigger.hidden = next !== 'session';
  ui.pianoFooter.hidden = next !== 'home';
  if (next === 'home') drift.start();
  else drift.stop();
  if (next !== 'session') {
    piano.listener.expected = null;
    piano.listener.setStack(null);
  }
  if (next === 'home') renderHome();
  if (next === 'skills') renderSkills();
  updateTopbar();
  updateInputStatus();
  window.scrollTo(0, 0);
}

function updateTopbar(): void {
  const level = levelFor(progress.xp);
  const floor = xpForLevel(level);
  const ceil = xpForLevel(level + 1);
  // The chip doubles as the XP bar: both copies of the label read the same, the fill's copy in ink on marigold.
  ui.levelLabel.textContent = ui.levelLabelFill.textContent = `Level ${level}`;
  ui.xpFill.style.setProperty('--fill', String((progress.xp - floor) / (ceil - floor)));
  const streak = currentStreak(progress);
  ui.dayStreakText.textContent = streak ? `${streak} day streak` : 'Start a streak';
  ui.dayStreak.classList.toggle('is-on', streak > 0);
}

function showNotice(box: HTMLElement, label: HTMLElement, retry: HTMLElement, problem: InputProblem | null): void {
  box.hidden = problem === null;
  label.textContent = problem?.text ?? '';
  retry.hidden = !problem?.canRetry;
}

/* ---------- Tuning ---------- */

type TuneOutcome = { ok: true; calibration: Calibration } | { ok: false; text: string };

/**
 * Measures the room, then listens to middle C for the piano's tuning offset.
 * Resolves null if cancelled along the way.
 */
async function tunePiano(
  report: (text: string | null, fill: number) => void,
  cancelled: () => boolean,
): Promise<TuneOutcome | null> {
  tuning = true;
  try {
    report('Listening to the room. Stay quiet for a moment.', 0.05);
    const noiseFloor = await piano.listener.measureNoise(1500);
    if (cancelled()) return null;
    report('Now play middle C and hold it until the bar fills.', 0.3);
    const heard = await piano.listener.measureTuning(10000, (f) => report(null, 0.3 + 0.7 * Math.min(1, f)));
    if (cancelled()) return null;
    if (!heard) {
      report(null, 0.3);
      return { ok: false, text: "We couldn't hear a clear note. Play middle C firmly and hold it until the bar fills." };
    }
    if (heard.midi !== 60) {
      report(null, 0.3);
      return {
        ok: false,
        text: `That sounded like ${midiName(heard.midi)}. Middle C is the white key just left of the pair of black keys nearest the middle of your piano. Give it another go.`,
      };
    }
    report(null, 1);
    return { ok: true, calibration: { centsOffset: heard.cents, noiseFloor } };
  } finally {
    tuning = false;
  }
}

function tuningText(cents: number, sentence = false): string {
  const r = Math.round(cents);
  if (Math.abs(r) < 3) return 'in tune';
  const off = `${Math.abs(r)} cents ${r > 0 ? 'sharp' : 'flat'}`;
  return sentence ? `${off}, and noteynotey will adjust for it` : off;
}

/* ---------- Home ---------- */

const DIFFICULTY = ['Easy', 'Medium', 'Hard'];

function modeCard(mode: ModeDef): HTMLButtonElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'mode-card';
  card.dataset.mode = mode.id;

  const badge = document.createElement('span');
  badge.className = 'mode-card-icon';
  badge.append(icon(mode.icon));
  const title = document.createElement('span');
  title.className = 'mode-card-title';
  title.textContent = mode.name;

  // A gentle difficulty hint: three small rising bars, one to three filled, with the word under them.
  const level = document.createElement('span');
  level.className = 'mode-card-level';
  const bars = document.createElement('span');
  bars.className = 'mode-card-dots';
  bars.setAttribute('aria-hidden', 'true');
  for (let i = 1; i <= 3; i++) {
    const bar = document.createElement('span');
    bar.className = i <= mode.difficulty ? 'mode-card-dot is-filled' : 'mode-card-dot';
    bars.append(bar);
  }
  const word = document.createElement('span');
  word.className = 'mode-card-level-word';
  word.textContent = DIFFICULTY[mode.difficulty - 1];
  level.append(bars, word);
  const foot = document.createElement('span');
  foot.className = 'mode-card-foot';
  foot.append(title, level);

  card.append(badge, foot);
  // Guides new players only: gone once any round has been finished.
  if (mode.tag && progress.trial === 0) {
    const tag = document.createElement('span');
    tag.className = 'mode-card-tag';
    tag.textContent = mode.tag;
    card.append(tag);
  }
  return card;
}

function renderHome(): void {
  ui.modeGrid.replaceChildren(...MODES.map(modeCard));

  renderDaily();
  renderSkillStrip(ui.skillStrip, progress);
}

/** The full skill map screen: overview, what needs work, then every note and key. */
function renderSkills(): void {
  renderSkillMap(ui.skillMap, progress);
}

/* ---------- Sessions ---------- */

let session: Session | ScrollRound | StackRound | null = null;
let lastPlan: ModeId | null = null;
let wrongTimer = 0;
/** On the beat, the note last lit up at the playhead, so it's colored once. */
let litNote = -1;
const PLAYHEAD_HALF = 1.5; // half the playhead's width, in px
let beatFrame = 0;
/** The written melody for a melodic round, and the next note whose chord hasn't sounded yet. */
let melody: MelodyPlan | null = null;
/** The octaves or chords for a stacked round. */
let stackPlan: StackPlan | null = null;
let levelAtStart = 1;
/**
 * The round plays on a copy of progress, merged back only when it finishes,
 * so a round left early records nothing: no stats, XP, streak or practice day.
 */
let roundProgress: Progress | null = null;

/** Merges a finished round's results into progress and saves them. Settings stay as they are. */
function commitRound(): void {
  if (!roundProgress) return;
  const { trial, xp, bestStreak, stats, keys, days, activity } = roundProgress;
  Object.assign(progress, { trial, xp, bestStreak, stats, keys, days, activity });
  roundProgress = null;
  save();
  updateTopbar();
}

/** Every round reads both clefs. */
function startSession(kind: ModeId): void {
  // Octaves and Chords are played as notes struck together, which the on-screen keys can't do: ask for a piano.
  const needsPiano = getMode(kind).content === 'octaves' || getMode(kind).content === 'chords';
  if (needsPiano && progress.settings.input === 'screen') {
    ui.stackDialog.showModal();
    return;
  }
  lastPlan = kind;
  levelAtStart = levelFor(progress.xp);
  const mode = getMode(kind);
  const content = mode.content;
  // Rounds use the key picked in the round header, or a random one. Flash Notes is always in C.
  const fixedKey = KEYS.find((k) => k.id === progress.settings.roundKey);
  melody =
    content === 'melody'
      ? composeRound(progress, mode.length, fixedKey)
      : content === 'arpeggios'
        ? composeArpeggios(progress, mode.length, fixedKey)
        : null;
  stackPlan = content === 'octaves' || content === 'chords' ? composeStacks(progress, content, mode.length, fixedKey) : null;
  const config = {
    title: mode.name,
    clef: 'both' as const,
    length: mode.length,
    lineLength: 1,
    xpMultiplier: mode.xpMultiplier,
    sequence: melody?.notes,
    key: (melody ?? stackPlan)?.key.id,
  };
  const scroll = mode.scroll;
  const draft = structuredClone(progress);
  roundProgress = draft;
  session = stackPlan
    ? new StackRound(draft, config, stackPlan.stacks, performance.now())
    : scroll && melody
      ? new ScrollRound(draft, config, scroll, melody.notes, performance.now())
      : new Session(draft, config);
  const key = roundKey();
  staff.setKey(key.id, Math.abs(key.sig));
  staff.ghost(null);
  // A picked key is already named on the key button, so the badge only shows a random key.
  ui.sessionKey.hidden = (!melody && !stackPlan) || Boolean(fixedKey);
  ui.sessionKey.textContent = key.name;
  ui.roundTools.hidden = !melody && !stackPlan; // Flash Notes has no key to pick
  renderKeyPick();

  ui.practice.hidden = false;
  ui.summary.hidden = true;
  ui.staffCard.classList.remove('is-shake');
  ui.staffEl.hidden = Boolean(scroll);
  ui.beatStripEl.hidden = !scroll;
  showScreen('session');
  if (session instanceof ScrollRound) {
    beatStrip.load(session.notes, key.id, Math.abs(key.sig));
    litNote = -1;
    cancelAnimationFrame(beatFrame);
    beatFrame = requestAnimationFrame(beatTick);
  }
  renderSession();
  void ensureInputLive();
}

/** Starts the saved input if it isn't running. Called from a click, so the mic may start. */
async function ensureInputLive(): Promise<void> {
  const kind = progress.settings.input;
  if (kind === 'mic' && piano.mic === 'off' && !progress.settings.micOff) {
    piano.setCalibration(activeProfile(progress));
    await piano.startMic();
  } else if (kind === 'midi' && piano.midiState === 'off') {
    await piano.startMidi();
  }
}

function renderSession(wrong = false): void {
  if (!session) return;
  const s = session;
  const unit = getMode(lastPlan ?? 'single').unit.one;
  let meta = `${unit[0].toUpperCase()}${unit.slice(1)} ${Math.min(s.played + 1, s.config.length)} of ${s.config.length}`;
  if (s instanceof ScrollRound) {
    const next = s.nextIndex();
    if (!s.style.wait) meta = `${s.bpmAt(Math.max(0, next))} BPM, ${meta[0].toLowerCase()}${meta.slice(1)}`;
    if (next >= 0) {
      beatStrip.mark(next, nextMark(s, next, performance.now()));
      beatStrip.showClef(s.notes[next].note.clef);
    }
    piano.listener.expected = next >= 0 ? s.notes[next].note.midi : null;
    piano.listener.setStack(null);
  } else if (s instanceof StackRound) {
    const stack = s.current;
    if (stack) {
      staff.showStack(
        stack.notes,
        stack.notes.map((n) => (s.got.has(n.midi) ? 'correct' : wrong ? 'wrong' : 'idle')),
      );
    }
    piano.listener.expected = s.nextNote?.midi ?? null;
    // Pitch detection only hears one note, so the mic listens for strikes on each of the stack's notes.
    const rest = stack ? stack.notes.filter((n) => !s.got.has(n.midi)).map((n) => n.midi) : [];
    piano.listener.setStack(rest.length ? rest : null);
  } else {
    const states: StaffState[] = s.line.map((_, i) =>
      i < s.index ? 'correct' : i === s.index ? (wrong ? 'wrong' : s.line.length > 1 ? 'current' : 'idle') : 'idle',
    );
    staff.showLine(s.line, states);
    piano.listener.expected = s.current?.midi ?? null;
    piano.listener.setStack(null);
  }

  ui.sessionMode.textContent = s.config.title;
  ui.sessionMeta.textContent = meta;
  renderTicks(ui.roundTicks, s.results, s.labels, s.config.length, !s.finished);
}

/**
 * One tick per note in the round: fern if right first time, tomato if missed
 * or retried, an outlined current note, and dashed outlines for what's to come.
 */
/**
 * The round's progress, as a step counter: a segment per note, checked when
 * right first time, crossed when missed or retried, a clock when on time
 * was missed (early or late on the beat), with the note's name
 * underneath once done.
 */
function renderTicks(el: HTMLElement, results: NoteResult[], labels: string[], length: number, showCurrent: boolean): void {
  const half = Math.ceil(length / 2);
  el.style.setProperty('--half', String(half));
  if (el.childElementCount !== length) {
    el.replaceChildren(
      ...Array.from({ length }, () => {
        const tick = document.createElement('span');
        const dot = document.createElement('span');
        dot.className = 'tick-dot';
        const label = document.createElement('span');
        label.className = 'tick-label';
        tick.append(dot, label);
        return tick;
      }),
    );
  }
  [...el.children].forEach((tick, i) => {
    const state =
      i < results.length ? `is-${results[i]}` : i === results.length && showCurrent ? 'is-current' : 'is-todo';
    const label = i < results.length ? (labels[i] ?? '') : '';
    const key = `${state} ${label}`;
    if ((tick as HTMLElement).dataset.key === key) return;
    (tick as HTMLElement).dataset.key = key;
    // Where the bar breaks into two rows on phones, each row gets its own rounded ends.
    tick.className = `tick ${state}${i === half - 1 ? ' is-row-end' : ''}${i === half ? ' is-row-start' : ''}`;
    const [dot, name] = tick.children;
    const glyph = { 'is-clean': 'check', 'is-rough': 'cross', 'is-offbeat': 'clock' } as const;
    const g = glyph[state as keyof typeof glyph];
    dot.replaceChildren(...(g ? [icon(g)] : []));
    name.textContent = label;
  });
}

/* ---------- Moving line (Zen, Tempo Run) ---------- */

let hiddenAt = 0;

function beatTick(now: number): void {
  const s = session;
  if (!(s instanceof ScrollRound) || screen !== 'session' || !ui.summary.hidden) return;
  const events = s.update(now);
  for (const e of events) onBeatEvent(e);
  if (s.finished) {
    showSummary();
    return;
  }
  beatStrip.scrollTo(trackPosition(s, now));
  if (events.length) renderSession();
  // On the beat, the next note lights up once it touches the playhead.
  const next = s.nextIndex();
  if (!s.style.wait && next >= 0 && litNote !== next && nextMark(s, next, now) === 'current') beatStrip.mark(next, 'current');
  beatFrame = requestAnimationFrame(beatTick);
}

/** The color for the next note: on the beat, plain until its head touches the playhead. */
function nextMark(s: ScrollRound, index: number, now: number): BeatMark {
  const touching = s.style.wait || trackPosition(s, now) >= beatStrip.noteX[index] - (beatStrip.headHalf[index] ?? 0) - PLAYHEAD_HALF;
  if (touching) litNote = index;
  return touching ? 'current' : 'idle';
}

/** Where the track should sit at this moment: interpolated between the notes' beats. */
function trackPosition(s: ScrollRound, now: number): number {
  const t = s.elapsed(now);
  const xs = beatStrip.noteX;
  const notes = s.notes;
  const first = notes[0];
  if (t <= first.time) return xs[0] - ((first.time - t) / first.beatMs) * (xs.length > 1 ? (xs[1] - xs[0]) / (notes[1].beat - first.beat) : 90);
  for (let i = 0; i < notes.length - 1; i++) {
    if (t < notes[i + 1].time) {
      const f = (t - notes[i].time) / (notes[i + 1].time - notes[i].time);
      return xs[i] + f * (xs[i + 1] - xs[i]);
    }
  }
  const last = notes.length - 1;
  const perBeat = last > 0 ? (xs[last] - xs[last - 1]) / (notes[last].beat - notes[last - 1].beat) : 90;
  return xs[last] + ((t - notes[last].time) / notes[last].beatMs) * perBeat;
}

function onBeatEvent(e: BeatEvent): void {
  if (e.kind === 'missed') {
    beatStrip.mark(e.index, 'missed');
  } else if (e.kind === 'wrong') {
    // As in Flash Notes: a red notehead and a shake, then back to the current note's color.
    beatStrip.mark(e.index, 'missed');
    restartAnimation(ui.staffCard, 'is-shake');
    window.clearTimeout(wrongTimer);
    wrongTimer = window.setTimeout(() => {
      if (session instanceof ScrollRound && session.notes[e.index].state === 'waiting') beatStrip.mark(e.index, nextMark(session, e.index, performance.now()));
    }, 500);
  } else if (e.kind === 'hit') {
    beatStrip.mark(e.index, 'hit');
  }
}

/** A wrong note's spelled name in the round's key and its accidental, for the faint ghost drawn beside the note to play. */
function ghostOf(midi: number): [string, string | null] {
  const key = KEYS.find((k) => k.id === session?.config.key) ?? C_MAJOR;
  const name = spell(midi, key);
  return [name, accidentalFor(name, key)];
}

// A hidden tab stops the animation, so pause the clock with it.
document.addEventListener('visibilitychange', () => {
  if (!(session instanceof ScrollRound) || screen !== 'session' || !ui.summary.hidden) return;
  if (document.hidden) {
    hiddenAt = performance.now();
    cancelAnimationFrame(beatFrame);
  } else if (hiddenAt) {
    session.shift(performance.now() - hiddenAt);
    hiddenAt = 0;
    beatFrame = requestAnimationFrame(beatTick);
  }
});

/** Every note of the current stack, heard together by the mic. */
function handleChord(notes: number[]): void {
  if (tuning || ui.pianoSheet.open || ui.tuneDialog.open || ui.keyDialog.open || ui.stackDialog.open) return;
  if (screen !== 'session' || !(session instanceof StackRound) || session.finished || !ui.summary.hidden) return;
  const s = session;
  const stack = s.current;
  for (const midi of notes) {
    if (s.current !== stack) break;
    answerStack(s, midi);
  }
}

function handleInput(midi: number): void {
  if (tuning || ui.pianoSheet.open || ui.tuneDialog.open || ui.keyDialog.open || ui.stackDialog.open) return;
  if (screen !== 'session' || !session || session.finished || !ui.summary.hidden) return;

  if (session instanceof ScrollRound) {
    const event = session.answer(midi, performance.now());
    if (!event) return;
    keyboard.flash(midi, event.kind === 'hit' ? 'correct' : 'wrong');
    // Render first, since it marks the next note as current; the event's mark then shows over it.
    renderSession();
    onBeatEvent(event);
    if (event.kind === 'wrong') beatStrip.ghost(event.index, ...ghostOf(midi));
    else beatStrip.ghost(event.index, null);
    if (session.finished) showSummary();
    return;
  }

  if (session instanceof StackRound) {
    answerStack(session, midi);
    return;
  }

  const result = session.answer(midi, performance.now());
  keyboard.flash(midi, result.correct ? 'correct' : 'wrong');

  if (!result.correct) {
    restartAnimation(ui.staffCard, 'is-shake');
    staff.ghost(...ghostOf(midi));
    renderSession(true);
    window.clearTimeout(wrongTimer);
    wrongTimer = window.setTimeout(() => renderSession(), 500);
    return;
  }

  window.clearTimeout(wrongTimer);
  staff.ghost(null);
  if (result.finished) showSummary();
  else renderSession();
}

/** A key against the current octave or chord: notes found so far stay found. */
function answerStack(s: StackRound, midi: number): void {
  const result = s.answer(midi, performance.now());
  if (!result || result.kind === 'again') return;
  keyboard.flash(midi, result.kind === 'wrong' ? 'wrong' : 'correct');
  window.clearTimeout(wrongTimer);
  if (result.kind === 'wrong') {
    restartAnimation(ui.staffCard, 'is-shake');
    staff.ghost(...ghostOf(midi));
    renderSession(true);
    wrongTimer = window.setTimeout(() => renderSession(), 500);
    return;
  }
  staff.ghost(null);
  if (result.kind === 'part') {
    renderSession();
    return;
  }
  if (result.finished) showSummary();
  else renderSession();
}

function showSummary(): void {
  if (!session || !lastPlan) return;
  const s = session;
  cancelAnimationFrame(beatFrame);
  commitRound();
  piano.listener.expected = null;
  piano.listener.setStack(null);

  ui.practice.hidden = true;
  ui.summary.hidden = false;
  ui.summaryTitle.textContent = 'Round complete';

  const lines: string[] = [];
  const units = getMode(lastPlan).unit.many;
  // Lead with what was found; first tries are a bonus, never a score against.
  if (s.played && s.firstTry === s.played) lines.push(`You found all ${s.played} ${units}, every one on the first try. Lovely.`);
  else if (s.played && s.hits === s.played) {
    lines.push(`You found all ${s.played} ${units}${s.firstTry ? `, ${s.firstTry} of them on the first try` : ''}.`);
  } else if (s.played) lines.push(`You caught ${s.hits} of ${s.played} ${units} as they went by.`);
  if (s.bestCombo >= 3 && s.firstTry !== s.played) lines.push(`Your best run was ${s.bestCombo} in a row.`);
  for (const tune of melody?.tunes ?? []) {
    if (s.played >= tune.end) lines.unshift(`Did you recognize it? That melody was ${tune.name}.`);
  }
  const keyed = melody ?? stackPlan;
  if (keyed && s.played) {
    const key = keyed.key;
    lines.push(
      trickyKeys(progress).includes(key)
        ? `${key.name} is a little trickier for you than your other keys, so it'll come up a bit more.`
        : `This round was in ${key.name}.`,
    );
  }
  const level = levelFor(progress.xp);
  if (level > levelAtStart) lines.push(`You reached level ${level}.`);
  const streak = currentStreak(progress);
  if (streak > 1) lines.push(`That's ${streak} days of practice in a row.`);
  else if (streak === 1) lines.push('Come back tomorrow to start a streak.');
  ui.summaryText.textContent = lines.join(' ') || 'Nice work. Every round sharpens your reading.';
  renderTicks(ui.summaryTicks, s.results, s.labels, s.results.length, false);
  ui.summaryTicks.hidden = s.results.length === 0;
  ui.summaryTicks.setAttribute('aria-label', `${s.firstTry} of ${s.results.length} ${units} right first time`);
  updateKeyboardVisibility();
  (ui.summaryAgain.hidden ? ui.summaryHome : ui.summaryAgain).focus();
}

/** The key the current round is written in. Flash Notes reads in C, with no key signature. */
function roundKey() {
  return (melody ?? stackPlan)?.key ?? C_MAJOR;
}

/**
 * Plays a one-shot CSS animation class, then removes it. A class left behind
 * would replay the animation whenever the element is shown again.
 */
function restartAnimation(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

/* ---------- Piano input ---------- */

const MIC_LABELS = ['Connect audio', 'Disconnect audio', 'Connecting…'];
const MIC_TEXT: Record<Connection, string> = {
  off: '',
  starting: '',
  on: '',
  error: 'Not connected',
};
/** One icon per input, in the piano sheet's choices and the home footer. */
const INPUT_ICON: Record<InputKind, IconName> = { mic: 'grand', midi: 'cable', screen: 'screen' };
/** The inputs in the piano sheet's order, which the home footer's icons follow. */
const INPUT_ORDER: InputKind[] = ['mic', 'midi', 'screen'];
const MIDI_TEXT: Record<Connection, string> = {
  off: 'Not connected',
  starting: 'Connecting',
  on: 'No MIDI device connected. Plug it in or pair it.',
  error: 'Not connected',
};

function meterLevel(rms: number): number {
  return Math.min(1, Math.max(0, (20 * Math.log10(rms + 1e-9) + 60) / 60));
}

function onFrame(f: PitchFrame): void {
  const level = String(meterLevel(f.rms));
  const gate = String(meterLevel(f.gate));
  // Queried each frame, since the active piano row is redrawn with its own meter.
  document.querySelectorAll<HTMLElement>('[data-level]').forEach((el) => el.style.setProperty('--level', level));
  gateEls.forEach((el) => el.style.setProperty('--level', gate));
  gatedEls.forEach((el) => el.classList.toggle('is-gated', f.rms <= f.gate));
}

/** Switches input. Picking a kind connects it right away. */
async function chooseInput(kind: InputKind): Promise<void> {
  progress.settings.input = kind;
  progress.settings.noInput = false;
  if (kind === 'mic') progress.settings.micOff = false;
  save();
  if (kind === 'screen') {
    piano.stopAll();
    return;
  }
  if (kind === 'midi') {
    await piano.startMidi();
    return;
  }
  piano.setCalibration(activeProfile(progress));
  await piano.startMic();
}

/** Renders every piano connection label, in words, from `piano` and the settings. */
function updateInputStatus(): void {
  const input = progress.settings.input;
  const micOn = piano.mic === 'on';
  const midiFound = piano.midiState === 'on' && piano.devices.length > 0;
  const profile = activeProfile(progress);
  const micOff = progress.settings.micOff && piano.mic === 'off';

  ui.pianoTrigger.classList.toggle('is-on', piano.connected);
  ui.pianoTrigger.classList.toggle('is-listening', micOn);

  // Sheet: choice buttons. Only which one is picked, never its connection state.
  // Going back to the choices with the mic off leaves nothing picked (`noInput`).
  const noInput = input === 'mic' && progress.settings.micOff && progress.settings.noInput;
  for (const [btn, kind] of [[ui.choiceMic, 'mic'], [ui.choiceMidi, 'midi'], [ui.choiceScreen, 'screen']] as const) {
    const picked = input === kind && !noInput;
    btn.classList.toggle('is-on', picked);
    btn.setAttribute('aria-pressed', String(picked));
  }

  // Sheet: acoustic page. While listening, onFrame keeps the status line live.
  ui.micStatus.classList.toggle('is-on', micOn);
  // Only a problem gets words; Connect audio and Disconnect audio already show the mic's state.
  ui.micStatus.textContent = micOn || micOff ? '' : MIC_TEXT[piano.mic];
  showNotice(ui.micNotice, ui.micNoticeText, ui.micRetry, piano.micProblem);
  // While the mic starts, the button stays in place, disabled, saying so. Every label is
  // stacked in the same cell so the button keeps one width and nothing beside it moves.
  const starting = piano.mic === 'starting';
  const micLabel = starting ? 'Connecting…' : progress.settings.micOff ? 'Connect audio' : 'Disconnect audio';
  for (const btn of [ui.micToggle, ui.footerMicToggle]) {
    const labels = document.createElement('span');
    labels.className = 'btn-labels';
    for (const text of MIC_LABELS) {
      const label = document.createElement('span');
      label.textContent = text;
      if (text !== micLabel) label.setAttribute('aria-hidden', 'true');
      label.classList.toggle('is-shown', text === micLabel);
      labels.append(label);
    }
    (btn.querySelector('.btn-content') ?? btn).replaceChildren(icon(starting || progress.settings.micOff ? 'mic' : 'micOff'), labels);
    btn.disabled = starting;
    btn.hidden = input !== 'mic' || piano.mic === 'error';
    // With no input picked, the footer asks for one instead of offering Connect audio.
    if (btn === ui.footerMicToggle && noInput) btn.hidden = true;
  }
  // In the footer, an open callout over Connect audio says the mic is off.
  ui.micOffCallout.hidden = ui.footerMicToggle.hidden || !micOff;
  renderProfiles();

  // Sheet: MIDI page
  ui.midiStatus.classList.toggle('is-on', midiFound);
  ui.midiStatus.textContent = midiFound ? piano.devices.join(', ') : MIDI_TEXT[piano.midiState];
  showNotice(ui.midiNotice, ui.midiNoticeText, ui.midiRetry, piano.midiProblem);

  // Home footer
  // With no input picked, as on the sheet's first page, the footer asks for one.
  const footerIcon: IconName = noInput ? 'micOff' : INPUT_ICON[input];
  if (ui.pianoFooterIcon.dataset.icon !== footerIcon) {
    ui.pianoFooterIcon.dataset.icon = footerIcon;
    ui.pianoFooterIcon.replaceChildren(icon(footerIcon));
    ui.pianoTriggerIcon.replaceChildren(icon(footerIcon));
    // Every input in the sheet's order, the current one on its paper tile and the others muted beside it.
    // With no input picked the footer asks for one, so only the crossed-out mic shows.
    ui.pianoFooterIcons.replaceChildren(
      ...(noInput ? ['current' as const] : INPUT_ORDER).map((k) => {
        if (k === 'current' || k === input) return ui.pianoFooterIcon;
        const tile = document.createElement('span');
        tile.className = 'piano-footer-other';
        tile.append(icon(INPUT_ICON[k]));
        return tile;
      }),
    );
  }
  ui.pianoFooter.classList.toggle('is-on', piano.connected);
  // The footer's Disconnect audio button doubles as the mic meter, filling with the level.
  ui.footerMicToggle.classList.toggle('is-metering', micOn);
  ui.pianoFooter.classList.toggle('is-empty', noInput);
  ui.pianoFooterLabel.hidden = noInput;
  ui.pianoFooterChange.hidden = noInput;
  if (noInput) {
    ui.pianoFooterName.textContent = 'Choose an input';
    setFooterStatus('');
  } else if (input === 'mic') {
    ui.pianoFooterName.textContent = profile?.name ?? 'Piano via Mic';
    if (piano.mic === 'error') setFooterStatus('Not connected', true);
    else setFooterStatus('');
  } else if (input === 'midi') {
    ui.pianoFooterName.textContent = piano.devices[0] ?? 'MIDI Keyboard';
    if (piano.midiState === 'error') setFooterStatus('Not connected', true);
    else if (piano.midiState === 'on' && !midiFound) setFooterStatus('No MIDI device connected', true);
    else setFooterStatus(midiFound ? 'Connected' : MIDI_TEXT[piano.midiState]);
  } else {
    ui.pianoFooterName.textContent = 'On-screen Keyboard';
    // The keys only show during a round, so home says where to find them.
    setFooterStatus('Shows up when you start playing', true, true);
  }

  // A round's Piano button names the input the same way as the home footer.
  ui.pianoSource.textContent = ui.pianoFooterName.textContent;

  updateKeyboardVisibility();
}

/**
 * The footer's status line. A problem, or a note like where the on-screen keys are, shows as a dark chip with an info icon.
 * A `hint` (a note, not a problem) is hidden on phones, where the footer has no room for it.
 */
function setFooterStatus(text: string, warn = false, hint = false): void {
  const el = ui.pianoFooterStatus;
  el.classList.toggle('is-warn', warn);
  el.classList.toggle('is-hint', hint);
  if (warn) {
    const label = document.createElement('span');
    label.textContent = text;
    el.replaceChildren(icon('info'), label);
  } else {
    el.textContent = text;
  }
}

/** Tucks the on-screen keys away or brings them back; the dock's controls stay. */
function renderKeysToggle(): void {
  const hidden = progress.settings.keysHidden;
  ui.keyboardDock.classList.toggle('is-collapsed', hidden);
  ui.dockKeys.inert = hidden;
  ui.keysToggle.setAttribute('aria-expanded', String(!hidden));
  ui.keysToggle.setAttribute('aria-label', hidden ? 'Show keyboard' : 'Hide keyboard');
  ui.keysToggle.replaceChildren(icon('keys'), icon(hidden ? 'caret' : 'caretDown'));
}

/** The keyboard dock shows during a round, whatever the input; the player can tuck its keys away. */
function updateKeyboardVisibility(): void {
  const show = screen === 'session' && ui.summary.hidden;
  if (show === !ui.keyboardDock.hidden) return;
  ui.keyboardDock.hidden = !show;
  if (show) keyboard.scrollToMiddleC();
}

function renderProfiles(): void {
  const profiles = progress.settings.profiles;
  ui.profileList.hidden = profiles.length === 0;
  ui.profileList.replaceChildren(
    ...profiles.map((profile) => {
      const active = profile.id === progress.settings.activeProfileId;
      const row = document.createElement('div');
      row.className = `profile-row${active ? ' is-active' : ''}`;
      // The piano in use doubles as the mic meter, like the Disconnect audio button.
      if (active) {
        row.classList.add('btn-metered');
        row.classList.toggle('is-metering', piano.mic === 'on');
        const meter = document.createElement('span');
        meter.className = 'btn-meter';
        meter.setAttribute('aria-hidden', 'true');
        const fill = document.createElement('span');
        fill.className = 'btn-meter-fill';
        fill.dataset.level = '';
        meter.append(fill);
        row.append(meter);
      }

      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'profile-pick';
      pick.dataset.profile = profile.id;
      const name = document.createElement('span');
      name.className = 'profile-name';
      name.textContent = profile.name;
      const meta = document.createElement('span');
      meta.className = 'profile-meta';
      const tune = tuningText(profile.centsOffset);
      meta.textContent = active ? `In use, ${tune}` : tune[0].toUpperCase() + tune.slice(1);
      pick.append(name, meta);

      // A three-dot menu holds the piano's options.
      const menu = document.createElement('div');
      menu.className = 'row-menu';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'row-menu-btn';
      toggle.dataset.menu = profile.id;
      toggle.setAttribute('aria-label', `Options for ${profile.name}`);
      toggle.setAttribute('aria-haspopup', 'menu');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.append(icon('more'));
      const list = document.createElement('div');
      list.className = 'row-menu-list';
      list.setAttribute('role', 'menu');
      list.hidden = true;
      const manage = document.createElement('button');
      manage.type = 'button';
      manage.className = 'row-menu-item';
      manage.setAttribute('role', 'menuitem');
      manage.dataset.retune = profile.id;
      manage.textContent = 'Manage';
      list.append(manage);
      menu.append(toggle, list);

      // The piano in use holds the Disconnect audio button.
      if (active) row.append(pick, ui.micToggle, menu);
      else row.append(pick, menu);
      return row;
    }),
  );
  if (!ui.profileList.contains(ui.micToggle)) ui.addPiano.after(ui.micToggle);
}

/** Opens one row's three-dot menu, or closes them all with `null`. */
function setRowMenu(toggle: HTMLElement | null): void {
  ui.profileList.querySelectorAll<HTMLElement>('.row-menu-btn').forEach((btn) => {
    const open = btn === toggle;
    btn.setAttribute('aria-expanded', String(open));
    const list = btn.nextElementSibling as HTMLElement;
    list.hidden = !open;
    if (open) list.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  });
}

function usePianoProfile(id: string): void {
  progress.settings.activeProfileId = id;
  save();
  piano.setCalibration(activeProfile(progress));
  updateInputStatus();
}

/* ---------- Piano sheet ---------- */

type SheetView = 'choose' | 'mic' | 'midi';

function openPianoSheet(): void {
  const { input, micOff, noInput } = progress.settings;
  // With no input picked, the sheet opens on the choices.
  showSheetView(input === 'screen' || (input === 'mic' && micOff && noInput) ? 'choose' : input, false);
  ui.pianoSheet.showModal();
}

/** Swaps the sheet to another page. Going back slides the other way and refocuses the choice made. */
function showSheetView(view: SheetView, focus = true): void {
  const back = view === 'choose';
  // Back at the choices with the mic disconnected, Piano via Mic is no longer picked.
  const settings = progress.settings;
  if (back && settings.input === 'mic' && settings.micOff && !settings.noInput) {
    settings.noInput = true;
    save();
    updateInputStatus();
  }
  const from = ui.pianoSheet.querySelector<HTMLElement>('.panel-view:not([hidden])')?.dataset.view;
  ui.pianoSheet.querySelectorAll<HTMLElement>('.panel-view').forEach((el) => {
    el.hidden = el.dataset.view !== view;
    el.classList.toggle('is-back', back);
  });
  if (!focus) return;
  const target = back
    ? ui.pianoSheet.querySelector<HTMLElement>(`.choice-btn[data-pick="${from}"]`)
    : ui.pianoSheet.querySelector<HTMLElement>(`.panel-view[data-view="${view}"] .back-link`);
  target?.focus();
}

/* ---------- The round's key ---------- */

/** Key names without "major" or "minor", for chips sitting in a Major or Minor row. */
const shortKeyName = (k: KeyDef) => k.name.replace(/ (major|minor)$/, '');

/** The round header's key button: Random Key with a shuffle icon, or the chosen key. */
function renderKeyPick(): void {
  const chosen = KEYS.find((k) => k.id === progress.settings.roundKey);
  const label = document.createElement('span');
  label.textContent = chosen ? chosen.name : 'Random Key';
  ui.keyPick.replaceChildren(...(chosen ? [] : [icon('shuffle')]), label, icon('caretDown'));
  ui.keyPick.setAttribute('aria-label', `Key: ${label.textContent}, change`);
}

/** Random, then the major and minor keys from flats to sharps, so each minor sits under its relative major. */
function renderKeyChoices(): void {
  const current = progress.settings.roundKey;
  const choice = (id: string | null, content: Node[]): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'key-choice';
    btn.dataset.key = id ?? '';
    btn.classList.toggle('is-on', id === current);
    btn.setAttribute('aria-pressed', String(id === current));
    btn.append(...content);
    return btn;
  };
  const random = choice(null, [icon('shuffle'), document.createTextNode('Random')]);
  random.classList.add('key-choice-random');
  const row = (mode: 'major' | 'minor', title: string) => {
    const el = document.createElement('div');
    el.className = 'key-row';
    const name = document.createElement('span');
    name.className = 'key-row-name';
    name.textContent = title;
    const keys = KEYS.filter((k) => k.mode === mode).sort((a, b) => a.sig - b.sig);
    el.append(name, ...keys.map((k) => {
      const btn = choice(k.id, [document.createTextNode(shortKeyName(k))]);
      btn.setAttribute('aria-label', k.name);
      // Hovered or focused: the key's name and its signature on both staves.
      setRichTip(btn, keyTip(k), () => keyTipCard(k));
      return btn;
    }));
    return el;
  };
  ui.keyChoices.replaceChildren(random, row('major', 'Major'), row('minor', 'Minor'));
}

/** The key picker's tooltip: the key's name over its signature. */
function keyTipCard(k: KeyDef): HTMLElement {
  const card = document.createElement('div');
  card.className = 'tip-card tip-card-key';
  const name = document.createElement('span');
  name.className = 'tip-card-name';
  name.textContent = k.name;
  card.append(name, keySignatureSheet(k.id, Math.abs(k.sig)));
  return card;
}

ui.keyPick.addEventListener('click', () => {
  renderKeyChoices();
  ui.keyDialog.showModal();
  ui.keyChoices.querySelector<HTMLElement>('.is-on')?.focus();
});
ui.keyClose.replaceChildren(icon('cross'));

// The ask-for-a-piano dialog: Switch input opens the piano sheet on its input choices.
ui.stackOk.addEventListener('click', () => ui.stackDialog.close());
ui.stackClose.replaceChildren(icon('cross'));
ui.stackClose.addEventListener('click', () => ui.stackDialog.close());
ui.stackSwitch.addEventListener('click', () => {
  ui.stackDialog.close();
  openPianoSheet();
});
ui.stackDialog.addEventListener('click', (e) => {
  if (e.target === ui.stackDialog) ui.stackDialog.close(); // clicked the dimmed backdrop
});
ui.keyClose.addEventListener('click', () => ui.keyDialog.close());
ui.keyDialog.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target === ui.keyDialog) {
    ui.keyDialog.close(); // clicked the dimmed backdrop
    return;
  }
  const btn = target.closest<HTMLElement>('[data-key]');
  if (!btn) return;
  // A new key means new notes, so the round starts over in it.
  progress.settings.roundKey = btn.dataset.key || null;
  save();
  ui.keyDialog.close();
  if (lastPlan) startSession(lastPlan);
});

/* ---------- Tune dialog ---------- */

let tuneRun = 0;
let tuneTarget: PianoProfile | null = null;

function openTuneDialog(profile: PianoProfile | null): void {
  tuneTarget = profile;
  ui.tuneTitle.textContent = profile ? `Retune ${profile.name}` : 'Add a piano';
  ui.tuneName.value = profile?.name ?? (progress.settings.profiles.length ? 'Another piano' : 'My piano');
  ui.tuneText.textContent =
    'First we listen to the room for a moment, then you play middle C. Keep things quiet and press Start.';
  ui.tuneFill.style.setProperty('--fill', '0');
  ui.tuneStart.textContent = 'Start';
  ui.tuneStart.disabled = false;
  ui.tuneStart.dataset.action = 'start';
  if (ui.pianoSheet.open) ui.pianoSheet.close();
  ui.tuneDialog.showModal();
}

function closeTuneDialog(): void {
  tuneRun++;
  tuning = false;
  if (ui.tuneDialog.open) ui.tuneDialog.close();
  // Tuning starts the mic. Without a piano to show for it, go back to what was in use.
  if (progress.settings.input !== 'mic' && piano.mic !== 'off') {
    if (progress.settings.input === 'midi') void piano.startMidi();
    else piano.stopMic();
  }
}

async function runTuneDialog(): Promise<void> {
  const run = ++tuneRun;
  ui.tuneStart.disabled = true;
  if (piano.mic !== 'on') {
    const ok = await piano.startMic();
    if (run !== tuneRun) return;
    if (!ok) {
      ui.tuneText.textContent = piano.micProblem?.text ?? 'The microphone did not start.';
      ui.tuneStart.textContent = 'Try again';
      ui.tuneStart.disabled = false;
      return;
    }
  }
  const outcome = await tunePiano(
    (text, fill) => {
      if (text) ui.tuneText.textContent = text;
      ui.tuneFill.style.setProperty('--fill', String(fill));
    },
    () => run !== tuneRun,
  );
  if (!outcome) return;
  if (!outcome.ok) {
    ui.tuneText.textContent = outcome.text;
    ui.tuneStart.textContent = 'Try again';
    ui.tuneStart.disabled = false;
    return;
  }

  const name = ui.tuneName.value.trim() || 'My piano';
  let profile = tuneTarget;
  if (profile) {
    Object.assign(profile, outcome.calibration, { name });
  } else {
    profile = { id: newProfileId(), name, ...outcome.calibration };
    progress.settings.profiles.push(profile);
  }
  progress.settings.input = 'mic';
  progress.settings.micOff = false;
  progress.settings.noInput = false;
  usePianoProfile(profile.id);

  ui.tuneText.textContent = `All set. ${name} sounds ${tuningText(profile.centsOffset, true)}.`;
  ui.tuneStart.textContent = 'Done';
  ui.tuneStart.disabled = false;
  ui.tuneStart.dataset.action = 'done';
  ui.tuneStart.focus();
}

/* ---------- Events ---------- */

ui.brand.addEventListener('click', () => showScreen('home'));

ui.pianoChange.addEventListener('click', openPianoSheet);
ui.pianoFooterIcons.addEventListener('click', openPianoSheet); // a pointer shortcut; the name button is the real control
$('piano-footer-caret').replaceChildren(icon('caret'));
document.querySelectorAll('.choice-check').forEach((el) => el.replaceChildren(icon('check')));
for (const [btn, kind] of [[ui.choiceMic, 'mic'], [ui.choiceMidi, 'midi'], [ui.choiceScreen, 'screen']] as const) {
  btn.querySelector('.choice-icon')?.replaceChildren(icon(INPUT_ICON[kind]));
}
ui.pianoTrigger.addEventListener('click', openPianoSheet);
ui.keysToggle.addEventListener('click', () => {
  progress.settings.keysHidden = !progress.settings.keysHidden;
  save();
  renderKeysToggle();
});
renderKeysToggle();
ui.modeGrid.addEventListener('click', (e) => {
  const card = (e.target as HTMLElement).closest<HTMLButtonElement>('.mode-card');
  if (card) startSession(card.dataset.mode as ModeId);
});
ui.skillStripCard.addEventListener('click', () => showScreen('skills'));

/* ---------- Daily challenge ---------- */

/** The home card's tear-off calendar page (today) and the time left until the next challenge, at local midnight. */
function renderDaily(): void {
  const now = new Date();
  ui.dailyMonth.textContent = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(now);
  ui.dailyDay.textContent = String(now.getDate());
  ui.dailyWeekday.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(now);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const minutes = Math.max(1, Math.ceil((midnight.getTime() - now.getTime()) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  ui.dailyCountdown.textContent = h ? `${h}h ${m}m` : `${m}m`;
}

// Keeps the countdown (and the page, past midnight) current while home is showing.
window.setInterval(() => {
  if (screen === 'home') renderDaily();
}, DAILY_TICK_MS);

// The daily challenge isn't built yet (see Daily Challenge in CLAUDE.md); this is its entry point.
ui.dailyGo.prepend(icon('play', 'icon icon-small'));
ui.dailyPlay.addEventListener('click', () => {
  // Opens today's challenge.
});
/** Leaves the profile for home. Opened from home, it steps back in history, so the browser's back button doesn't return here. */
function leaveProfile(): void {
  if ((history.state as { fromApp?: boolean } | null)?.fromApp) history.back();
  else showScreen('home');
}
ui.skillsBack.addEventListener('click', leaveProfile);
// Escape leaves the profile too, like a round, unless a tooltip or dialog has it.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented || screen !== 'skills') return;
  if (ui.pianoSheet.open || ui.tuneDialog.open || ui.keyDialog.open || ui.stackDialog.open) return;
  e.preventDefault();
  leaveProfile();
});
window.addEventListener('popstate', () => {
  if (location.hash === PROFILE_HASH) {
    if (screen !== 'skills') showScreen('skills');
  } else if (screen === 'skills') {
    showScreen('home');
  }
});


ui.endBtn.addEventListener('click', leaveRound);

/** Leaves a round or its summary for home at once. A round left early records nothing. */
function leaveRound(): void {
  roundProgress = null;
  window.clearTimeout(wrongTimer);
  showScreen('home');
}

// Escape leaves a round straight for home. An open dialog takes it first, to close itself.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented || screen !== 'session') return;
  if (ui.pianoSheet.open || ui.tuneDialog.open || ui.keyDialog.open || ui.stackDialog.open) return;
  e.preventDefault();
  leaveRound();
});
ui.summaryHome.addEventListener('click', () => showScreen('home'));
ui.summaryAgain.addEventListener('click', () => {
  if (lastPlan) startSession(lastPlan);
});

ui.pianoSheet.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  // Any click closes an open row menu; a click on a row's three dots toggles its own.
  const menuBtn = target.closest<HTMLElement>('[data-menu]');
  setRowMenu(menuBtn && menuBtn.getAttribute('aria-expanded') !== 'true' ? menuBtn : null);
  if (target === ui.pianoSheet) {
    ui.pianoSheet.close(); // clicked the dimmed backdrop
    return;
  }
  const pick = target.closest<HTMLElement>('[data-pick]')?.dataset.pick as InputKind | undefined;
  if (pick === 'screen') {
    void chooseInput('screen');
    ui.pianoSheet.close();
  } else if (pick === 'mic' && !activeProfile(progress)) {
    // No piano yet: the mic stays off until one is added (tuning starts it and picks the input).
    showSheetView('mic');
  } else if (pick) {
    showSheetView(pick);
    void chooseInput(pick);
  }
  const go = target.closest<HTMLElement>('[data-view-go]')?.dataset.viewGo as SheetView | undefined;
  if (go) showSheetView(go);
  const profileId = target.closest<HTMLElement>('[data-profile]')?.dataset.profile;
  if (profileId) usePianoProfile(profileId);
  const retuneId = target.closest<HTMLElement>('[data-retune]')?.dataset.retune;
  if (retuneId) openTuneDialog(progress.settings.profiles.find((p) => p.id === retuneId) ?? null);
});
ui.micRetry.addEventListener('click', () => void chooseInput('mic'));
/** Disconnects the mic and keeps it off, or connects it again. */
function toggleMic(): void {
  if (progress.settings.micOff) {
    void chooseInput('mic');
    return;
  }
  progress.settings.micOff = true;
  save();
  if (piano.mic === 'off') updateInputStatus();
  else piano.stopMic();
}
ui.micToggle.addEventListener('click', toggleMic);
// Escape closes an open row menu first, and only then the sheet.
ui.pianoSheet.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = ui.profileList.querySelector<HTMLElement>('.row-menu-btn[aria-expanded="true"]');
  if (!open) return;
  e.preventDefault();
  e.stopPropagation();
  setRowMenu(null);
  open.focus();
});
ui.footerMicToggle.addEventListener('click', toggleMic);
ui.midiRetry.addEventListener('click', () => void chooseInput('midi'));
ui.addPiano.addEventListener('click', () => openTuneDialog(null));
ui.sheetDone.addEventListener('click', () => ui.pianoSheet.close());
ui.sheetDone.replaceChildren(icon('cross'));


ui.tuneCancel.addEventListener('click', closeTuneDialog);
ui.tuneDialog.addEventListener('cancel', () => closeTuneDialog());
ui.tuneStart.addEventListener('click', () => {
  if (ui.tuneStart.dataset.action === 'done') closeTuneDialog();
  else void runTuneDialog();
});


// Browsers only let the mic start from a tap or key press, so a saved mic
// input starts on the first one. A press on a Disconnect audio button doesn't count.
const startMicOnGesture = (e: Event): void => {
  if ((e.target as HTMLElement).closest?.('[data-mic-toggle]')) return;
  document.removeEventListener('pointerdown', startMicOnGesture);
  document.removeEventListener('keydown', startMicOnGesture);
  if (progress.settings.input === 'mic' && piano.mic === 'off') void ensureInputLive();
};
document.addEventListener('pointerdown', startMicOnGesture);
document.addEventListener('keydown', startMicOnGesture);

/* ---------- Start ---------- */

initTooltips();
ui.dayStreak.prepend(icon('flame', 'icon icon-small'));
piano.subscribe(onFrame);
piano.setCalibration(activeProfile(progress));

if (location.hash === OLD_PROFILE_HASH) history.replaceState(null, '', PROFILE_HASH);
showScreen(location.hash === PROFILE_HASH ? 'skills' : 'home');
if (progress.settings.input === 'midi') void piano.startMidi();

/* ---------- ?debug ---------- */

/**
 * A plain readout of what the mic hears on a stack, for tuning the stack
 * thresholds in audio/pitch.ts against a real piano. Shown only with ?debug in
 * the address; a developer tool, not part of the app's interface.
 */
function setupDebug(): void {
  const box = document.createElement('pre');
  box.className = 'debug-panel';
  document.body.append(box);
  const events: string[] = [];
  const log = (text: string) => {
    events.unshift(`${(performance.now() / 1000).toFixed(2)}s  ${text}`);
    events.length = Math.min(events.length, 5);
  };
  const listener = piano.listener;
  const onNote = listener.onNote;
  listener.onNote = (midi) => {
    log(`note  ${midiName(midi)}`);
    onNote?.(midi);
  };
  const onChord = listener.onChord;
  listener.onChord = (notes) => {
    log(`stack ${notes.map(midiName).join(' ')}`);
    onChord?.(notes);
  };
  let last: StackDebug | null = null;
  let lastAt = 0;
  listener.onStackDebug = (info) => {
    last = info;
    lastAt = performance.now();
  };
  const num = (v: number) => (Number.isFinite(v) ? v.toFixed(1).padStart(6) : '     -');
  window.setInterval(() => {
    const lines = [`mic ${piano.mic}`];
    if (last && performance.now() - lastAt < 300) {
      lines.push('note   level   rise');
      for (const n of last.notes) lines.push(`${midiName(n.midi).padEnd(5)}${num(n.level)} ${num(n.rise)}${n.struck ? '  struck' : ''}`);
      lines.push(`grace ${last.grace ?? '-'}`);
    } else {
      lines.push('no stack up');
    }
    lines.push('', ...events);
    box.textContent = lines.join('\n');
  }, 100);
}

if (new URLSearchParams(location.search).has('debug')) setupDebug();
