// Shared DOM construction: the quote-shaped letter grid and the on-screen
// keyboard.
//
// This module builds structure and owns layout metrics. It deliberately does not
// know any game's rules -- each game module paints its own cells using the
// elements returned here.

/** Standard letter layout. Games can pass their own rows instead. */
export const QWERTY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

/** Missing Vowels only ever needs five keys, so it gets much bigger targets. */
export const VOWEL_ROWS = ['AEIOU'];

const DELETE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M20 5H9l-6 7 6 7h11a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/>' +
  '<path d="M17 9l-5 6M12 9l5 6"/></svg>';

/**
 * Pick cell metrics that keep a whole quote on screen.
 *
 * Longer quotes get smaller cells. The vw ceiling matters independently: on a
 * 320px phone even a short quote needs narrower cells than the tier suggests.
 * @param {number} length
 */
function metricsFor(length) {
  if (length <= 55) return { cell: 26, font: 20, code: 11 };
  if (length <= 80) return { cell: 22, font: 18, code: 10 };
  if (length <= 105) return { cell: 19, font: 16, code: 9 };
  return { cell: 17, font: 15, code: 9 };
}

/**
 * Build a quote-shaped grid of cells.
 *
 * Words become flex items so a line break can never land inside one, which
 * matters because word shape is most of what you pattern-match on when solving.
 *
 * @param {HTMLElement} container
 * @param {Array<{space?: boolean, char?: string, sub?: string, editable?: boolean, key?: string}>} cells
 *   One entry per character of the source text, in order. `space: true` ends the
 *   current word. `editable` cells are playable; everything else renders static.
 * @returns {Array<HTMLElement|null>} element per input index, null for spaces
 */
export function buildQuoteGrid(container, cells) {
  container.textContent = '';

  const { cell, font, code } = metricsFor(cells.length);
  // The min() lets narrow screens shrink below the tier without a media query.
  container.style.setProperty('--cell-w', `min(${cell}px, 7.6vw)`);
  container.style.setProperty('--cell-font', `min(${font}px, 5.6vw)`);
  container.style.setProperty('--code-font', `min(${code}px, 3.2vw)`);

  // Missing Vowels has no second line under each cell, so the row that holds it
  // is collapsed rather than left reserving vertical space on a phone.
  container.classList.toggle('no-sub', !cells.some((c) => c.sub));

  const out = new Array(cells.length).fill(null);
  let word = null;

  cells.forEach((spec, i) => {
    if (spec.space) {
      word = null; // the next character starts a new flex item
      return;
    }

    if (!word) {
      word = document.createElement('span');
      word.className = 'word';
      container.appendChild(word);
    }

    const el = document.createElement('span');
    el.className = spec.editable ? 'cell' : 'cell static';
    el.dataset.index = String(i);
    if (spec.editable) el.dataset.key = spec.key ?? String(i);

    const value = document.createElement('span');
    value.className = 'cell-value';
    value.textContent = spec.editable ? '' : (spec.char ?? '');

    const sub = document.createElement('span');
    sub.className = 'cell-sub';
    sub.textContent = spec.sub ?? '';

    el.append(value, sub);
    word.appendChild(el);
    out[i] = el;
  });

  return out;
}

/**
 * Set a cell's displayed character and its state classes in one call.
 * @param {HTMLElement} el
 * @param {string} text
 * @param {Record<string, boolean>} states class name -> on/off
 */
export function paintCell(el, text, states) {
  const value = el.firstChild;
  if (value.textContent !== text) value.textContent = text;
  for (const [name, on] of Object.entries(states)) el.classList.toggle(name, on);
}

/**
 * Build the on-screen keyboard.
 *
 * Custom rather than native on purpose: the device keyboard covers half the
 * screen, autocorrects, and emits composition events we would have to unpick.
 *
 * @param {HTMLElement} container
 * @param {{rows?: string[], del?: boolean, enter?: boolean}} layout
 * @returns {Map<string, HTMLElement>} key name -> element ('DEL' and 'ENTER' included)
 */
export function buildKeyboard(container, layout = {}) {
  const rows = layout.rows ?? QWERTY_ROWS;
  const wantsDelete = layout.del !== false;
  const wantsEnter = layout.enter === true;

  container.textContent = '';
  container.classList.toggle('keyboard-wide', rows.length === 1);
  const keys = new Map();

  const addKey = (row, name, { wide = false, label = name, icon = null } = {}) => {
    const key = document.createElement('button');
    key.type = 'button';
    const classes = ['key'];
    if (wide) classes.push('wide');
    // A word-labelled key is set in its own, smaller type. Left at the letter
    // size it does not fit the key on a narrow phone, and because a key is a
    // centred grid that shrinks to nothing, the label escapes out of both sides
    // rather than simply clipping.
    if (!icon && label.length > 1) classes.push('key-word');
    key.className = classes.join(' ');
    key.dataset.key = name;
    if (icon) {
      key.innerHTML = icon;
      key.setAttribute('aria-label', label);
    } else {
      key.textContent = label;
    }
    row.appendChild(key);
    keys.set(name, key);
  };

  rows.forEach((letters, rowIndex) => {
    const row = document.createElement('div');
    row.className = 'krow';
    const isLast = rowIndex === rows.length - 1;

    // ENTER sits left of the last row so DEL keeps its familiar right-hand spot.
    // Spelled out rather than an arrow: the return glyph reads as "new line",
    // which is not what this key does.
    //
    // Written in mixed case even though it renders uppercase. The capitals come
    // from .key-word, which also shrinks the type to fit them. Capitalising here
    // instead would widen the label from a file that can arrive without the rule
    // that makes it fit, which is worse than doing nothing at all.
    if (isLast && wantsEnter) addKey(row, 'ENTER', { wide: true, label: 'Enter' });
    for (const letter of letters) addKey(row, letter);
    if (isLast && wantsDelete) {
      addKey(row, 'DEL', { wide: true, label: 'Delete', icon: DELETE_ICON });
    }

    container.appendChild(row);
  });

  return keys;
}

/**
 * Apply per-key state classes.
 * @param {Map<string, HTMLElement>} keys
 * @param {Record<string, string>} states letter -> class suffix ('used', 'hit', 'near', 'miss')
 */
export function paintKeyboard(keys, states) {
  for (const [name, el] of keys) {
    const state = states[name] ?? '';
    el.classList.toggle('used', state === 'used');
    el.classList.toggle('key-hit', state === 'hit');
    el.classList.toggle('key-near', state === 'near');
    el.classList.toggle('key-miss', state === 'miss');
  }
}

/**
 * Scatter confetti chips into the win sheet. Rebuilt each win so the animation
 * restarts; capped at a small count because this runs on a phone.
 * @param {HTMLElement} host
 */
export function burstConfetti(host) {
  host.textContent = '';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const colors = ['#7aa2f7', '#7dcfa0', '#e0af68', '#f7768e', '#bb9af7'];
  for (let i = 0; i < 40; i++) {
    const chip = document.createElement('i');
    chip.style.left = `${Math.random() * 100}%`;
    chip.style.background = colors[i % colors.length];
    chip.style.animationDelay = `${Math.random() * 0.5}s`;
    chip.style.animationDuration = `${1.1 + Math.random() * 0.8}s`;
    host.appendChild(chip);
  }
}
