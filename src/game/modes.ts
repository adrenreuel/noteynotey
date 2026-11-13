import type { IconName } from '../ui/icons';
import type { ScrollStyle } from './scroll';

export type ModeId = 'single' | 'lines' | 'tempo' | 'octaves' | 'chords' | 'arpeggios';

/**
 * Where a round's notes come from: random single notes, melodies, arpeggios on
 * the moving line, or stacks (octaves, chords) to play together on the still staff.
 */
export type ModeContent = 'random' | 'melody' | 'arpeggios' | 'octaves' | 'chords';

export interface ModeDef {
  id: ModeId;
  name: string;
  icon: IconName;
  /** Notes in one round. */
  length: number;
  /** Present for modes played on a moving line. */
  scroll?: ScrollStyle;
  content: ModeContent;
  /** What one tick of the round is, for the round header and summary. */
  unit: { one: string; many: string };
  xpMultiplier: number;
  /** How hard the mode is, 1 to 3, shown as dots on its home card to help beginners choose. */
  difficulty: 1 | 2 | 3;
  /** A tag on the mode's home card for new players, such as "Start here". Shown until the first round is finished. */
  tag?: string;
}

const NOTE = { one: 'note', many: 'notes' };

export const MODES: ModeDef[] = [
  {
    id: 'lines',
    difficulty: 1,
    name: 'Zen',
    icon: 'line',
    length: 20,
    scroll: { startBpm: 60, bpmStep: 0, wait: true }, // no clock; the BPM only spaces the notes
    content: 'melody',
    unit: NOTE,
    xpMultiplier: 1,
    tag: 'Start here',
  },
  {
    id: 'single',
    difficulty: 1,
    name: 'Flash Notes',
    icon: 'note',
    length: 20,
    content: 'random',
    unit: NOTE,
    xpMultiplier: 1,
  },
  {
    id: 'tempo',
    difficulty: 3,
    name: 'Tempo Run',
    icon: 'beat',
    length: 24,
    scroll: { startBpm: 50, bpmStep: 4, wait: false },
    content: 'melody',
    unit: NOTE,
    xpMultiplier: 1.5,
  },
  {
    id: 'arpeggios',
    difficulty: 2,
    name: 'Arpeggios',
    icon: 'arpeggio',
    length: 24,
    scroll: { startBpm: 60, bpmStep: 0, wait: true }, // no clock; the BPM only spaces the notes
    content: 'arpeggios',
    unit: NOTE,
    xpMultiplier: 1,
  },
  {
    id: 'octaves',
    difficulty: 2,
    name: 'Octaves',
    icon: 'octave',
    length: 16,
    content: 'octaves',
    unit: { one: 'octave', many: 'octaves' },
    xpMultiplier: 1,
  },
  {
    id: 'chords',
    difficulty: 3,
    name: 'Chords',
    icon: 'chord',
    length: 16,
    content: 'chords',
    unit: { one: 'chord', many: 'chords' },
    xpMultiplier: 1.5,
  },
];

export function getMode(id: ModeId): ModeDef {
  return MODES.find((m) => m.id === id)!;
}
