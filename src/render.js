// DOM construction and updates for the puzzle grid and the on-screen keyboard.
//
// Split into build vs update deliberately: the grid is rebuilt only when the
// puzzle changes, while updates run on every keystroke and only touch text
// content and class names.

const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

const DELETE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M20 5H9l-6 7 6 7h11a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/>' +
  '<path d="M17 9l-5 6M12 9l5 6"/></svg>';

/**
 * Pick cell metrics that keep the whole quote on screen.
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
 * Build the puzzle grid.
 *
 * Words become flex items so a line break can never land inside one, which
 * matters because word shape is most of what you pattern-match on when solving.
 *
 * @param {HTMLElement} container
 * @param {{cipher: string}} game
 * @returns {Array<HTMLElement|null>} cell element per cipher index (null for spaces)
 */
export function buildPuzzle(container, game) {
  container.textContent = '';

  const { cell, font, code } = metricsFor(game.cipher.length);
  // The min() lets narrow screens shrink below the tier without a media query.
  container.style.setProperty('--cell-w', `min(${cell}px, 7.6vw)`);
  container.style.setProperty('--cell-font', `min(${font}px, 5.6vw)`);
  container.style.setProperty('--code-font', `min(${code}px, 3.2vw)`);

  const cells = new Array(game.cipher.length).fill(null);
  let word = null;

  for (let i = 0; i < game.cipher.length; i++) {
    const ch = game.cipher[i];

    if (ch === ' ') {
      word = null; // next character starts a new flex item
      continue;
    }

    if (!word) {
      word = document.createElement('span');
      word.className = 'word';
      container.appendChild(word);
    }

    const isLetter = ch >= 'A' && ch <= 'Z';

    const el = document.createElement('span');
    el.className = isLetter ? 'cell' : 'cell static';
    el.dataset.index = String(i);
    if (isLetter) el.dataset.code = ch;

    const guess = document.createElement('span');
    guess.className = 'cell-guess';
    guess.textContent = isLetter ? '' : ch;

    const codeEl = document.createElement('span');
    codeEl.className = 'cell-code';
    codeEl.textContent = isLetter ? ch : '';

    el.append(guess, codeEl);
    word.appendChild(el);
    cells[i] = el;
  }

  return cells;
}

/**
 * Refresh cell contents and states. Called after every input.
 *
 * @param {Array<HTMLElement|null>} cells
 * @param {object} game
 * @param {{selectedIndex: number|null, wrongLetters: Set<string>}} view
 */
export function updatePuzzle(cells, game, view) {
  const selectedCode =
    view.selectedIndex === null ? null : game.cipher[view.selectedIndex] ?? null;
  const duplicates = duplicateLetters(game);

  for (let i = 0; i < cells.length; i++) {
    const el = cells[i];
    if (!el || !el.dataset.code) continue;

    const code = el.dataset.code;
    const guess = game.guesses[code] ?? '';
    const guessEl = el.firstChild;
    if (guessEl.textContent !== guess) guessEl.textContent = guess;

    const isLocked = game.locked.has(code);

    el.classList.toggle('selected', i === view.selectedIndex);
    el.classList.toggle('peer', code === selectedCode && i !== view.selectedIndex);
    el.classList.toggle('locked', isLocked);
    // A revealed letter is known-correct, so it never wears the warning colour
    // even when it collides -- the player's own guess is the wrong one.
    el.classList.toggle('dup', Boolean(guess) && duplicates.has(guess) && !isLocked);
    el.classList.toggle('wrong', view.wrongLetters.has(code));
  }
}

/**
 * Plaintext letters currently assigned to more than one coded letter.
 *
 * The cipher is one-to-one, so a repeat guarantees at least one is wrong. We
 * flag rather than block: holding two tentative guesses is normal mid-deduction.
 * @param {object} game
 * @returns {Set<string>}
 */
export function duplicateLetters(game) {
  const seen = new Map();
  for (const code of game.letters) {
    const guess = game.guesses[code];
    if (!guess) continue;
    seen.set(guess, (seen.get(guess) ?? 0) + 1);
  }
  const dupes = new Set();
  for (const [letter, count] of seen) if (count > 1) dupes.add(letter);
  return dupes;
}

/**
 * Build the on-screen keyboard.
 *
 * Custom rather than native on purpose: the device keyboard covers half the
 * screen, autocorrects, and emits composition events we would have to unpick.
 * @param {HTMLElement} container
 * @returns {Map<string, HTMLElement>} letter -> key element
 */
export function buildKeyboard(container) {
  container.textContent = '';
  const keys = new Map();

  KEY_ROWS.forEach((letters, rowIndex) => {
    const row = document.createElement('div');
    row.className = 'krow';

    for (const letter of letters) {
      const key = document.createElement('button');
      key.type = 'button';
      key.className = 'key';
      key.dataset.key = letter;
      key.textContent = letter;
      row.appendChild(key);
      keys.set(letter, key);
    }

    if (rowIndex === KEY_ROWS.length - 1) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'key wide';
      del.dataset.key = 'DEL';
      del.setAttribute('aria-label', 'Delete');
      del.innerHTML = DELETE_ICON;
      row.appendChild(del);
    }

    container.appendChild(row);
  });

  return keys;
}

/**
 * Dim letters that are already in play, so the remaining alphabet reads at a
 * glance. Locked letters count as used.
 * @param {Map<string, HTMLElement>} keys
 * @param {object} game
 */
export function updateKeyboard(keys, game) {
  const used = new Set();
  for (const code of game.letters) {
    const guess = game.guesses[code];
    if (guess) used.add(guess);
  }
  for (const [letter, el] of keys) {
    el.classList.toggle('used', used.has(letter));
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
