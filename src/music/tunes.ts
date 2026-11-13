/**
 * Public-domain melodies in C major, written as scale degrees above the tonic
 * (0 = C, 1 = D, ... 7 = the C an octave up). Rhythm is left out: every note
 * takes one beat, which is how the moving line plays them anyway.
 */
export interface Tune {
  name: string;
  degrees: number[];
}

export const TUNES: Tune[] = [
  { name: 'Ode to Joy', degrees: [2, 2, 3, 4, 4, 3, 2, 1, 0, 0, 1, 2, 1, 0, 0] },
  { name: 'Twinkle, Twinkle, Little Star', degrees: [0, 0, 4, 4, 5, 5, 4, 3, 3, 2, 2, 1, 1, 0] },
  { name: 'Mary Had a Little Lamb', degrees: [2, 1, 0, 1, 2, 2, 2, 1, 1, 2, 1, 0] },
  { name: 'Frère Jacques', degrees: [0, 1, 2, 0, 0, 1, 2, 0, 2, 3, 4, 2, 3, 4] },
  { name: 'Hot Cross Buns', degrees: [2, 1, 0, 2, 1, 0, 1, 1, 2, 1, 0] },
  { name: 'London Bridge', degrees: [4, 5, 4, 3, 2, 3, 4, 1, 2, 3, 2, 3, 4] },
];
