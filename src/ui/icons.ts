/*
 * A small set of line icons in the app's ink style: 24px grid, 2px strokes,
 * round ends, colored by `currentColor`. Use them sparingly, one per idea.
 */
const PATHS = {
  // Flash Notes: two flashcards with a note each. On hover they shuffle: the front card slides out and
  // tucks in behind, then the other. Each card is drawn twice (behind and in front) and swaps layers.
  note: '<g class="a-card a-card-a a-layer-back"><rect class="card-face" x="3" y="8" width="13" height="13" rx="1.5"/><ellipse cx="8.5" cy="17" rx="2.6" ry="1.9" fill="currentColor" stroke="none" transform="rotate(-20 8.5 17)"/><path d="M10 17V11"/></g><g class="a-card a-card-b a-layer-back"><rect class="card-face" x="3" y="8" width="13" height="13" rx="1.5"/><ellipse cx="10.5" cy="15" rx="2.6" ry="1.9" fill="currentColor" stroke="none" transform="rotate(-20 10.5 15)"/><path d="M12 15V10"/></g><g class="a-card a-card-b a-layer-front"><rect class="card-face" x="3" y="8" width="13" height="13" rx="1.5"/><ellipse cx="10.5" cy="15" rx="2.6" ry="1.9" fill="currentColor" stroke="none" transform="rotate(-20 10.5 15)"/><path d="M12 15V10"/></g><g class="a-card a-card-a a-layer-front"><rect class="card-face" x="3" y="8" width="13" height="13" rx="1.5"/><ellipse cx="8.5" cy="17" rx="2.6" ry="1.9" fill="currentColor" stroke="none" transform="rotate(-20 8.5 17)"/><path d="M10 17V11"/></g>',
  // Zen: notes coming toward the playhead. On hover they stream left without end and fade out past the line;
  // four notes repeat every two, so shifting by two notes loops seamlessly. A mask fades both edges.
  line: '<defs><linearGradient id="zen-fade" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="24" y2="0"><stop offset="0.167" stop-color="#fff" stop-opacity="0"/><stop offset="0.27" stop-color="#fff"/><stop offset="0.846" stop-color="#fff"/><stop offset="0.8875" stop-color="#fff" stop-opacity="0"/></linearGradient><mask id="zen-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="url(#zen-fade)" stroke="none"/></mask></defs><path d="M4 3v18"/><g mask="url(#zen-mask)"><g class="a-stream"><ellipse cx="9.5" cy="17" rx="3.2" ry="2.4" fill="currentColor" stroke="none" transform="rotate(-20 9.5 17)"/><path d="M11.6 17V8.5"/><ellipse cx="17" cy="13" rx="3.2" ry="2.4" fill="currentColor" stroke="none" transform="rotate(-20 17 13)"/><path d="M19.1 13V4.5"/><ellipse cx="24.5" cy="17" rx="3.2" ry="2.4" fill="currentColor" stroke="none" transform="rotate(-20 24.5 17)"/><path d="M26.6 17V8.5"/><ellipse cx="32" cy="13" rx="3.2" ry="2.4" fill="currentColor" stroke="none" transform="rotate(-20 32 13)"/><path d="M34.1 13V4.5"/></g></g>',
  // Tempo Run: a metronome (the pendulum swings on hover)
  beat: '<path d="M7 21h10L14.2 3.5h-4.4z"/><path d="M8 17h8"/><g class="a-swing"><path d="M12 17l5-10"/><circle cx="15" cy="11" r="1.6" fill="currentColor"/></g>',
  // Octaves: two notes an octave apart on one stem, bracketed (notes and stem dim together on hover)
  octave: '<g class="a-dim"><ellipse cx="8" cy="19" rx="3.3" ry="2.4" fill="currentColor" stroke="none" transform="rotate(-20 8 19)"/><ellipse cx="8" cy="7" rx="3.3" ry="2.4" fill="currentColor" stroke="none" transform="rotate(-20 8 7)"/><path d="M10.2 19V3"/></g><path d="M15 7c2.5 0 3.5 2 3.5 6s-1 6-3.5 6"/>',
  // Chords: three notes stacked on one stem. On hover they move through I, IV and V in close
  // keyboard voicing (C-E-G, C-F-A, B-D-G) and back to I; the stem stretches to reach the B.
  chord: '<g class="a-chord a-chord-1"><ellipse cx="9" cy="18.5" rx="3.2" ry="2.3" fill="currentColor" stroke="none" transform="rotate(-20 9 18.5)"/></g><g class="a-chord a-chord-2"><ellipse cx="9" cy="13" rx="3.2" ry="2.3" fill="currentColor" stroke="none" transform="rotate(-20 9 13)"/></g><g class="a-chord a-chord-3"><ellipse cx="9" cy="7.5" rx="3.2" ry="2.3" fill="currentColor" stroke="none" transform="rotate(-20 9 7.5)"/></g><path class="a-chord-stem" d="M11.1 18.5V1.5"/>',
  // Arpeggios: four beamed notes climbing 1-3-5-8, as the mode plays them (on hover the heads ripple up in a wave, stems shortening so they stay on the beam)
  arpeggio: '<g class="a-wave a-1"><g class="a-wave-head"><ellipse cx="3.5" cy="20.5" rx="2.3" ry="1.75" fill="currentColor" stroke="none" transform="rotate(-20 3.5 20.5)"/></g><path class="a-wave-stem" d="M4.74 20.5V9.5"/></g><g class="a-wave a-2"><g class="a-wave-head"><ellipse cx="9" cy="18" rx="2.3" ry="1.75" fill="currentColor" stroke="none" transform="rotate(-20 9 18)"/></g><path class="a-wave-stem" d="M10.24 18V7.33"/></g><g class="a-wave a-3"><g class="a-wave-head"><ellipse cx="14.5" cy="15.5" rx="2.3" ry="1.75" fill="currentColor" stroke="none" transform="rotate(-20 14.5 15.5)"/></g><path class="a-wave-stem" d="M15.74 15.5V5.17"/></g><g class="a-wave a-4"><g class="a-wave-head"><ellipse cx="20" cy="11.5" rx="2.3" ry="1.75" fill="currentColor" stroke="none" transform="rotate(-20 20 11.5)"/></g><path class="a-wave-stem" d="M21.24 11.5V3.0"/></g><path d="M4.74 9.5L21.24 3" stroke-width="3"/>',
  // Inputs: a piano heard through the mic (a grand, seen from above), a MIDI cable's USB plug, keys on a screen
  grand: '<path d="M5 3h5.5c3 0 4.5 2 4.5 5 0 3 4 3.5 4 8v5H5z"/><path d="M5 16h14"/><path d="M9 16v5M13 16v5M17 16v5"/>',
  cable: '<path d="M9 3h6v5H9z"/><rect x="7" y="8" width="10" height="8" rx="2"/><path d="M12 16v5"/><path d="M11 5.5h.01M13 5.5h.01"/>',
  screen: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><path d="M3 11h18M8 11v5M12 11v5M16 11v5"/>',
  // Connect audio and Disconnect audio
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/>',
  micOff: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/><path d="M4 4l16 16"/>',
  // The round's key picker: Random
  shuffle: '<path d="M3 7h3c2 0 3.2 1 4.3 2.7l2.4 4.6C13.8 16 15 17 17 17h4"/><path d="M3 17h3c1.3 0 2.3-.4 3.1-1.2M14.9 8.2C15.7 7.4 16.7 7 18 7h3"/><path d="M18 4l3 3-3 3M18 14l3 3-3 3"/>',
  // A row's options menu
  more: '<circle cx="5" cy="12" r="1.75" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.75" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.75" fill="currentColor" stroke="none"/>',
  // Footer: the piano name opens the piano sheet
  caret: '<path d="M7 14l5-5 5 5"/>',
  // Round: the on-screen keys, beside a caret that hides them (down) or shows them (up)
  keys: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14M8 13v6M16 13v6"/><rect x="6.5" y="5" width="3" height="8" fill="currentColor" stroke="none"/><rect x="14.5" y="5" width="3" height="8" fill="currentColor" stroke="none"/>',
  // Round: hides the on-screen keys (the up caret shows them)
  caretDown: '<path d="M7 10l5 5 5-5"/>',
  // Footer: an input problem
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5v.01"/>',
  // Progress row: right first time, or missed
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  cross: '<path d="M7 7l10 10M17 7L7 17"/>',
  // Progress row: right first time but early or late (Tempo Run)
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2.5"/>',
  // Home: the daily challenge's Play pill
  play: '<path d="M8 5.5v13l10-6.5z" fill="currentColor"/>',
  // Day streak
  flame: '<path d="M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 2-3 4-3 6-1-1-1.5-2-1.5-3C7 10 6 12 6 15a6 6 0 0 0 6 6z"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, className = 'icon'): SVGSVGElement {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg class="${className}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
  return wrap.firstElementChild as SVGSVGElement;
}
