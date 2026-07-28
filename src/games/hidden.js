// Hidden Quote: the whole quote is blank. Call letters to reveal them, and a
// letter that is not in there costs you.
//
// The only game here besides Fiver that you can lose, which is the point of it:
// every other quote game is a deduction you can take all day over. This one
// charges for a guess, so the order you call letters in is the whole skill.
//
// Two things about it run backwards from the other quote games, and both are
// deliberate -- see DIFFICULTIES and livesFor below.

import { hashString, localDateKey, mulberry32 } from '../cipher.js';
import { QUOTES, quotesForDifficulty } from '../quotes.js';
import { QWERTY_ROWS, buildQuoteGrid, paintCell, paintKeyboard } from '../render.js';
import { formatTime } from '../store.js';

/**
 * Length runs backwards here.
 *
 * In Cryptogram a long quote is the hard tier, because it is more cipher to
 * break. In this game a long quote is the *easy* tier: one call reveals eight
 * copies of a letter at once, and the surrounding words make the rest of the
 * phrase guessable long before you have called every letter in it. A short quote
 * gives almost no context, so each call is nearly a blind bet.
 *
 * `band` is the difficulty its quote pool is borrowed from, and it is inverted on
 * purpose. `misses` is the ceiling on lives, not the number of them.
 */
const DIFFICULTIES = {
  easy: { label: 'Easy', band: 'hard', misses: 7 },
  medium: { label: 'Medium', band: 'medium', misses: 5 },
  hard: { label: 'Hard', band: 'easy', misses: 4 },
};

const DIFFICULTY_NOTES = {
  easy: 'The longest quotes. More letters to call, but each one reveals a lot.',
  medium: 'Medium-length quotes, and five wrong letters to spend.',
  hard: 'The shortest quotes. Barely any context, and four wrong letters at most.',
};

/** Every distinct A-Z letter in the text. */
export function lettersIn(text) {
  const out = new Set();
  for (const ch of text.toUpperCase()) if (ch >= 'A' && ch <= 'Z') out.add(ch);
  return out;
}

/**
 * How many wrong letters this puzzle allows.
 *
 * Capped at one below the number of letters that are genuinely absent, because
 * otherwise the game cannot be lost at all: a 140-character quote can use
 * twenty-three letters of the alphabet, leaving three wrong answers in
 * existence, and a fixed allowance of five would make losing impossible while
 * still drawing five pips that never go out.
 *
 * @param {number} absent letters of the alphabet not in the quote
 * @param {number} ceiling the difficulty's nominal allowance
 */
export function livesFor(absent, ceiling) {
  return Math.max(1, Math.min(ceiling, absent - 1));
}

function cellsFor(game) {
  return [...game.plain].map((ch) => {
    if (ch === ' ') return { space: true };
    if (ch >= 'A' && ch <= 'Z') return { editable: true, key: ch };
    return { editable: false, char: ch };
  });
}

export const hidden = {
  id: 'hidden',
  name: 'Hidden Quote',
  blurb: 'Call the letters. Wrong ones cost you.',
  category: 'Quotes',
  // The identity hue the shell paints this game with; see --hue-* in styles.css.
  hue: 'magenta',
  // Blanks with one letter standing in them: the board part way through.
  icon: `<svg viewBox="0 0 512 512">
      <rect x="56" y="300" width="88" height="22" rx="11" />
      <rect x="168" y="300" width="88" height="22" rx="11" class="dim" />
      <rect x="280" y="300" width="88" height="22" rx="11" />
      <rect x="392" y="300" width="64" height="22" rx="11" class="dim" />
      <rect x="180" y="170" width="64" height="96" rx="16" />
      <rect x="292" y="170" width="64" height="96" rx="16" class="dim" />
    </svg>`,

  difficulties: DIFFICULTIES,
  defaultDifficulty: 'medium',
  difficultyNotes: DIFFICULTY_NOTES,
  // No check and no reset: there is nothing on the board that could be wrong,
  // and clearing your calls would hand back the lives you already spent.
  tools: ['hint', 'new'],
  // No Enter and no Delete. A letter is called the moment you press it, and it
  // cannot be taken back -- that irreversibility is the game.
  keyboard: { rows: QWERTY_ROWS, del: false },

  howTo: [
    'The whole quote is blank. Press a letter to call it.',
    'If the letter is in the quote, every copy of it appears at once.',
    'If it is not, you lose a life. The pips above the quote are what you have left.',
    'A call cannot be taken back, so spend the common letters first: E, T, A, O and N.',
    'Punctuation and word lengths are shown from the start. They are most of what you have to go on.',
    'You win by calling every letter in the quote before the pips run out.',
  ],

  // --- construction ---------------------------------------------------------

  createGame({ mode, difficulty, dateKey = localDateKey(), seed }) {
    const resolvedSeed =
      seed ??
      (mode === 'daily'
        ? hashString(`hidden|${dateKey}|${difficulty}`)
        : Math.floor(Math.random() * 0xffffffff));

    const pool = quotesForDifficulty(DIFFICULTIES[difficulty].band);
    const pick = mulberry32(resolvedSeed);
    const quote = pool[Math.floor(pick() * pool.length)];

    return this.hydrate({
      mode,
      difficulty,
      dateKey,
      seed: resolvedSeed,
      // An index into the whole pack, so appending quotes can never repoint a
      // saved game at a different one.
      quoteIndex: QUOTES.indexOf(quote),
      called: [],
      hinted: [],
      hintsUsed: 0,
      elapsedMs: 0,
      solved: false,
      lost: false,
    });
  },

  hydrate(snapshot) {
    const quote = QUOTES[snapshot.quoteIndex];
    const plain = quote.text.toUpperCase();
    const present = lettersIn(plain);
    const lives = livesFor(26 - present.size, DIFFICULTIES[snapshot.difficulty].misses);

    // Only A-Z, and only once each: a tampered save cannot spend a life twice or
    // reveal something that is not a letter.
    const called = [];
    for (const raw of snapshot.called ?? []) {
      const ch = String(raw).toUpperCase();
      if (ch >= 'A' && ch <= 'Z' && !called.includes(ch)) called.push(ch);
    }

    const misses = called.filter((ch) => !present.has(ch));
    const found = [...present].filter((ch) => called.includes(ch));

    return {
      gameId: 'hidden',
      mode: snapshot.mode,
      difficulty: snapshot.difficulty,
      dateKey: snapshot.dateKey,
      seed: snapshot.seed,
      quoteIndex: snapshot.quoteIndex,
      author: quote.author,
      original: quote.text,
      plain,
      present,
      lives,
      called,
      misses,
      hinted: (snapshot.hinted ?? []).filter((ch) => called.includes(ch)),
      hintsUsed: snapshot.hintsUsed ?? 0,
      elapsedMs: snapshot.elapsedMs ?? 0,
      solved: snapshot.solved ?? found.length === present.size,
      lost: snapshot.lost ?? misses.length >= lives,
      // transient
      cells: null,
      pipEls: null,
      missEl: null,
      shownMisses: -1,
    };
  },

  toSnapshot(game) {
    return {
      mode: game.mode,
      difficulty: game.difficulty,
      dateKey: game.dateKey,
      seed: game.seed,
      quoteIndex: game.quoteIndex,
      called: game.called,
      hinted: game.hinted,
      hintsUsed: game.hintsUsed,
      elapsedMs: game.elapsedMs,
      solved: game.solved,
      lost: game.lost,
    };
  },

  // --- rendering ------------------------------------------------------------

  mount(root, game) {
    root.textContent = '';

    const board = document.createElement('div');
    board.className = 'hidden-board';

    const pips = document.createElement('div');
    pips.className = 'hidden-lives';
    pips.setAttribute('role', 'img');
    game.pipEls = [];
    for (let i = 0; i < game.lives; i++) {
      const pip = document.createElement('i');
      pips.appendChild(pip);
      game.pipEls.push(pip);
    }

    // The grid carries the `puzzle` class as well, because the shared cell styles
    // are scoped to it -- buildQuoteGrid also toggles `no-sub` there.
    const grid = document.createElement('div');
    grid.className = 'puzzle';

    const misses = document.createElement('div');
    misses.className = 'hidden-misses';

    board.append(pips, grid, misses);
    root.appendChild(board);

    game.cells = buildQuoteGrid(grid, cellsFor(game));
    game.missEl = misses;
    game.shownMisses = -1;
  },

  paint(game) {
    const spent = game.misses.length;
    game.pipEls.forEach((pip, i) => pip.classList.toggle('is-spent', i < spent));
    game.pipEls[0]?.parentElement?.setAttribute(
      'aria-label',
      `${game.lives - spent} of ${game.lives} lives left`
    );

    // A lost board gives up the rest of the quote: the answer is the whole point
    // of having played, and Fiver shows its word for the same reason.
    const reveal = game.lost;

    game.cells.forEach((el) => {
      if (!el || !el.dataset.key) return;
      const ch = el.dataset.key;
      const shown = reveal || game.called.includes(ch);
      paintCell(el, shown ? ch : '', {
        locked: game.hinted.includes(ch),
        wrong: reveal && !game.called.includes(ch),
      });
    });

    if (spent !== game.shownMisses) {
      game.missEl.textContent = '';
      for (const ch of game.misses) {
        const chip = document.createElement('span');
        chip.textContent = ch;
        game.missEl.appendChild(chip);
      }
      game.shownMisses = spent;
    }

    // A called letter ripples through every copy of itself, nearest first.
    if (game.justSet) {
      const { code, at } = game.justSet;
      game.justSet = null;
      game.cells.forEach((el, i) => {
        if (!el || el.dataset.key !== code) return;
        el.style.setProperty('--rip', `${Math.min(Math.abs(i - at) * 16, 480)}ms`);
        el.classList.remove('is-pop');
        void el.offsetWidth;
        el.classList.add('is-pop');
      });
    }
  },

  paintKeys(game, keys) {
    // Reuses Fiver's key colours: green for a letter that was in the quote, grey
    // for one that was not. A key you have not pressed stays neutral.
    const states = {};
    for (const ch of game.called) states[ch] = game.present.has(ch) ? 'hit' : 'miss';
    paintKeyboard(keys, states);
  },

  // --- interaction ----------------------------------------------------------

  onSelect() {
    /* the board is a read-out; every move is made on the keyboard */
  },

  onKey(game, key) {
    if (game.solved || game.lost) return {};
    if (key.length !== 1 || key < 'A' || key > 'Z') return {};
    if (game.called.includes(key)) {
      return { toast: `${key} has already been called` };
    }

    game.called.push(key);
    if (game.present.has(key)) {
      const count = [...game.plain].filter((ch) => ch === key).length;
      // Every copy appearing at once is this game's whole payoff; the ripple
      // makes it visible, staggered outward from the first copy.
      game.justSet = { code: key, at: game.plain.indexOf(key) };
      return { toast: count === 1 ? `One ${key}` : `${count} of them` };
    }

    game.misses.push(key);
    // Deliberately not setting game.lost here. The shell owns solved and lost and
    // uses them to tell a board that has just finished from one that was already
    // finished when it was opened.
    const left = game.lives - game.misses.length;
    return {
      toast: left > 0 ? `No ${key}. ${left} left.` : `No ${key}.`,
      clearAfter: 1200,
    };
  },

  clearTransient() {
    /* nothing transient: a call is permanent */
  },

  move() {
    /* no cursor to move */
  },

  hint(game) {
    const missing = [...game.present].filter((ch) => !game.called.includes(ch));
    if (missing.length === 0) return { toast: 'Nothing left to reveal' };

    // The most common letter still hidden. A hint should open the quote up, not
    // hand over the one J that was never going to be the problem.
    const countOf = (letter) => [...game.plain].filter((ch) => ch === letter).length;
    const best = missing.reduce((a, b) => (countOf(a) >= countOf(b) ? a : b));

    game.called.push(best);
    game.hinted.push(best);
    game.hintsUsed += 1;
    return { toast: `Revealed ${best}` };
  },

  // --- outcome --------------------------------------------------------------

  isSolved(game) {
    for (const ch of game.present) if (!game.called.includes(ch)) return false;
    return true;
  },

  isLost(game) {
    return game.misses.length >= game.lives;
  },

  caption(game) {
    // While playing, the status strip carries the counts; the caption stays
    // clear for the author reveal.
    if (game.solved || game.lost) return game.author ? `— ${game.author}` : '';
    return '';
  },

  outcomeContent(game) {
    if (this.isSolved(game)) {
      const spent = game.misses.length;
      return {
        title: spent === 0 ? 'Not a single miss!' : 'Solved!',
        // Reads far better in its original casing than the board can show it.
        body: game.original,
        caption: game.author ? `— ${game.author}` : '',
      };
    }
    return {
      title: 'Out of lives',
      body: game.original,
      caption: game.author ? `— ${game.author}` : '',
    };
  },

  /** The status strip: letters found, and the lives that finding them costs. */
  progress(game) {
    const found = [...game.present].filter((ch) => game.called.includes(ch)).length;
    return {
      label: `${found} of ${game.present.size} letters`,
      value: found,
      max: game.present.size,
      note: `${Math.max(0, game.lives - game.misses.length)} of ${game.lives} lives`,
    };
  },

  /** Lives as hearts, which is the whole story of this game, and no quote. */
  shareLines(game) {
    const spent = game.misses.length;
    const pips = '\u2764\ufe0f'.repeat(Math.max(0, game.lives - spent)) + '\ud83d\udda4'.repeat(spent);
    if (game.misses.length >= game.lives) return ['Out of lives', pips];
    return [pips, `Solved in ${formatTime(game.elapsedMs)}`];
  },

  /**
   * The home card's status line. Reads the quote straight out of the pack rather
   * than hydrating a board, because this runs for every game on every home paint.
   */
  statusFor(snapshot, { difficultyLabel }) {
    if (!snapshot) return { state: 'new', text: `Not started · ${difficultyLabel}`, action: 'Play' };

    const quote = QUOTES[snapshot.quoteIndex];
    if (!quote) return { state: 'new', text: `Not started · ${difficultyLabel}`, action: 'Play' };

    const present = lettersIn(quote.text);
    const called = snapshot.called ?? [];
    const found = [...present].filter((ch) => called.includes(ch)).length;

    if (snapshot.solved || found === present.size) {
      return {
        state: 'solved',
        text: `Solved in ${formatTime(snapshot.elapsedMs ?? 0)}`,
        action: 'View',
      };
    }

    const lives = livesFor(26 - present.size, DIFFICULTIES[snapshot.difficulty].misses);
    const misses = called.filter((ch) => !present.has(ch)).length;
    if (snapshot.lost || misses >= lives) {
      return { state: 'lost', text: 'Out of lives', action: 'View' };
    }
    if (called.length === 0) {
      return { state: 'new', text: `Not started · ${difficultyLabel}`, action: 'Play' };
    }
    return {
      state: 'progress',
      text: `In progress · ${found} of ${present.size} letters`,
      action: 'Continue',
    };
  },
};
