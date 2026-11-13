/*
 * One shared tooltip for any element with `data-tip`. It shows on hover after
 * a short pause and right away on keyboard focus, and hides on press, scroll
 * or Escape. Inside an open <dialog> it's placed in the dialog, so it renders
 * in the top layer above the backdrop.
 */
const SHOW_DELAY_MS = 350;

/** Elements whose tooltip is built content (a small card) rather than their `data-tip` text. */
const richTips = new WeakMap<HTMLElement, () => Node>();

/**
 * Gives an element a rich tooltip, built each time it shows. The element keeps a plain
 * `data-tip` too: that's what makes it a tooltip target, and its words stay the fallback.
 */
export function setRichTip(el: HTMLElement, text: string, build: () => Node): void {
  el.dataset.tip = text;
  richTips.set(el, build);
}
const GAP = 8; // px between the element and the tooltip
const EDGE = 8; // px to keep from the window edges

export function initTooltips(): void {
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.id = 'tooltip';
  tip.setAttribute('role', 'tooltip');

  let target: HTMLElement | null = null;
  let timer = 0;

  const place = () => {
    if (!target) return;
    const r = target.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const above = r.top - GAP - t.height;
    const top = above >= EDGE ? above : r.bottom + GAP;
    const left = Math.min(Math.max(r.left + r.width / 2 - t.width / 2, EDGE), window.innerWidth - t.width - EDGE);
    tip.style.setProperty('--tip-x', `${left}px`);
    tip.style.setProperty('--tip-y', `${top}px`);
  };

  const show = (el: HTMLElement) => {
    target = el;
    const build = richTips.get(el);
    if (build) tip.replaceChildren(build());
    else tip.textContent = el.dataset.tip ?? '';
    tip.classList.toggle('is-rich', Boolean(build));
    (el.closest('dialog[open]') ?? document.body).append(tip);
    el.setAttribute('aria-describedby', tip.id);
    place();
    tip.classList.add('is-visible');
  };

  const hide = () => {
    window.clearTimeout(timer);
    target?.removeAttribute('aria-describedby');
    target = null;
    tip.classList.remove('is-visible');
  };

  const tipFor = (e: Event) => (e.target as Element | null)?.closest?.<HTMLElement>('[data-tip]') ?? null;

  document.addEventListener('pointerover', (e) => {
    const el = tipFor(e);
    if (el === target) return;
    hide();
    if (!el || (e as PointerEvent).pointerType === 'touch') return;
    timer = window.setTimeout(() => show(el), SHOW_DELAY_MS);
  });
  document.addEventListener('pointerout', (e) => {
    const next = (e as PointerEvent).relatedTarget as Element | null;
    if (!target || !next || !target.contains(next)) {
      if (tipFor(e)) hide();
    }
  });
  document.addEventListener('focusin', (e) => {
    const el = tipFor(e);
    hide();
    if (el?.matches(':focus-visible')) show(el);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide);
  document.addEventListener('scroll', hide, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
}
