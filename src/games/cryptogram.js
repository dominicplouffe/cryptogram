// Cryptogram: a quote encrypted with a one-to-one letter substitution.
//
// Rules and rendering for the game; the shell in main.js owns the timer, the
// dialogs and persistence.

import {
  buildPuzzle,
  distinctLetters,
  isSolved as cipherSolved,
  localDateKey,
  mulberry32,
} from '../cipher.js';
import { QUOTES, quotesForDifficulty } from '../quotes.js';
import { hashString } from '../cipher.js';
import { QWERTY_ROWS, buildQuoteGrid, paintCell, paintKeyboard } from '../render.js';
import { formatTime } from '../store.js';

const DIFFICULTIES = {
  easy: { label: 'Easy', prefillRatio: 0.3 },
  medium: { label: 'Medium', prefillRatio: 0.15 },
  hard: { label: 'Hard', prefillRatio: 0 },
};

const DIFFICULTY_NOTES = {
  easy: 'Shorter quotes, with about a third of the letters filled in for you.',
  medium: 'Medium-length quotes with a couple of letters to start you off.',
  hard: 'The longest quotes, and nothing given away. Just you and the cipher.',
};

/**
 * How many distinct cipher letters to give away. Always leaves at least two for
 * the player to deduce, otherwise an easy short quote can arrive nearly solved.
 */
function prefillCountFor(difficulty, distinctCount) {
  const ratio = DIFFICULTIES[difficulty]?.prefillRatio ?? 0;
  if (ratio === 0) return 0;
  return Math.min(Math.round(distinctCount * ratio), Math.max(distinctCount - 2, 0));
}

/** Cells rendered by the shared quote grid. */
function cellsFor(game) {
  return [...game.cipher].map((ch) => {
    if (ch === ' ') return { space: true };
    if (ch >= 'A' && ch <= 'Z') return { editable: true, sub: ch, key: ch };
    return { editable: false, char: ch };
  });
}

/**
 * Plaintext letters currently assigned to more than one coded letter.
 *
 * The cipher is one-to-one, so a repeat guarantees at least one is wrong. We flag
 * rather than block: holding two tentative guesses is normal mid-deduction.
 */
function duplicateLetters(game) {
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

/** Index of the next cell whose coded letter still needs an answer. */
function nextOpenIndex(game, afterIndex) {
  const start = game.letterIndices.indexOf(afterIndex);
  for (let step = 1; step <= game.letterIndices.length; step++) {
    const index = game.letterIndices[(start + step) % game.letterIndices.length];
    const code = game.cipher[index];
    if (!game.locked.has(code) && !game.guesses[code]) return index;
  }
  return null;
}

export const cryptogram = {
  id: 'cryptogram',
  name: 'Cryptogram',
  blurb: 'Decode the quote, one letter at a time.',
  icon: `<svg viewBox="0 0 512 512">
      <rect x="61" y="159" width="102" height="128" rx="18" />
      <rect x="61" y="317" width="102" height="28" rx="14" />
      <rect x="205" y="317" width="102" height="28" rx="14" class="dim" />
      <rect x="349" y="159" width="102" height="128" rx="18" />
      <rect x="349" y="317" width="102" height="28" rx="14" />
    </svg>`,

  difficulties: DIFFICULTIES,
  defaultDifficulty: 'medium',
  difficultyNotes: DIFFICULTY_NOTES,
  tools: ['hint', 'check', 'reset', 'new'],
  keyboard: { rows: QWERTY_ROWS, del: true },

  // --- construction ---------------------------------------------------------

  createGame({ mode, difficulty, dateKey = localDateKey(), seed }) {
    const resolvedSeed =
      seed ??
      (mode === 'daily'
        ? hashString(`${dateKey}|${difficulty}`)
        : Math.floor(Math.random() * 0xffffffff));

    const pool = quotesForDifficulty(difficulty);
    const pick = mulberry32(resolvedSeed);
    const quote = pool[Math.floor(pick() * pool.length)];

    return this.hydrate({
      mode,
      difficulty,
      dateKey,
      seed: resolvedSeed,
      quoteIndex: QUOTES.indexOf(quote),
      guesses: {},
      locked: null,
      hintsUsed: 0,
      checksUsed: 0,
      elapsedMs: 0,
      solved: false,
    });
  },

  /**
   * Rebuild a live board from a snapshot. The puzzle text is always recomputed
   * from quoteIndex + seed rather than stored, so a saved game can never
   * disagree with its own cipher.
   */
  hydrate(snapshot) {
    const quote = QUOTES[snapshot.quoteIndex];
    const distinct = distinctLetters(buildPuzzle(quote, snapshot.seed, 0).cipher).length;
    const puzzle = buildPuzzle(
      quote,
      snapshot.seed,
      prefillCountFor(snapshot.difficulty, distinct)
    );

    const guesses = { ...(snapshot.guesses ?? {}) };
    const locked = new Set(snapshot.locked ?? puzzle.prefilled);
    // Locked letters are authoritative: they are always the correct answer.
    for (const letter of locked) guesses[letter] = puzzle.solution[letter];

    const letterIndices = [];
    for (let i = 0; i < puzzle.cipher.length; i++) {
      const ch = puzzle.cipher[i];
      if (ch >= 'A' && ch <= 'Z') letterIndices.push(i);
    }

    const game = {
      gameId: 'cryptogram',
      mode: snapshot.mode,
      difficulty: snapshot.difficulty,
      dateKey: snapshot.dateKey,
      seed: snapshot.seed,
      quoteIndex: snapshot.quoteIndex,
      author: puzzle.author,
      plain: puzzle.plain,
      original: quote.text,
      cipher: puzzle.cipher,
      solution: puzzle.solution,
      letters: distinctLetters(puzzle.cipher),
      letterIndices,
      guesses,
      locked,
      hintsUsed: snapshot.hintsUsed ?? 0,
      checksUsed: snapshot.checksUsed ?? 0,
      elapsedMs: snapshot.elapsedMs ?? 0,
      solved: snapshot.solved ?? false,
      // transient
      selectedIndex: null,
      wrongLetters: new Set(),
    };

    game.selectedIndex = game.solved
      ? null
      : nextOpenIndex(game, letterIndices[letterIndices.length - 1]);
    return game;
  },

  toSnapshot(game) {
    return {
      mode: game.mode,
      difficulty: game.difficulty,
      dateKey: game.dateKey,
      seed: game.seed,
      quoteIndex: game.quoteIndex,
      guesses: game.guesses,
      locked: [...game.locked],
      hintsUsed: game.hintsUsed,
      checksUsed: game.checksUsed,
      elapsedMs: game.elapsedMs,
      solved: game.solved,
    };
  },

  // --- rendering ------------------------------------------------------------

  mount(root, game) {
    game.cells = buildQuoteGrid(root, cellsFor(game));
  },

  paint(game) {
    const selectedCode =
      game.selectedIndex === null ? null : game.cipher[game.selectedIndex] ?? null;
    const duplicates = duplicateLetters(game);

    game.cells.forEach((el, i) => {
      if (!el || !el.dataset.key) return;
      const code = el.dataset.key;
      const guess = game.guesses[code] ?? '';
      const isLocked = game.locked.has(code);

      paintCell(el, guess, {
        selected: i === game.selectedIndex,
        peer: code === selectedCode && i !== game.selectedIndex,
        locked: isLocked,
        // A revealed letter is known-correct, so it never wears the warning
        // colour even when it collides -- the player's own guess is the wrong one.
        dup: Boolean(guess) && duplicates.has(guess) && !isLocked,
        wrong: game.wrongLetters.has(code),
      });
    });
  },

  paintKeys(game, keys) {
    const states = {};
    for (const code of game.letters) {
      const guess = game.guesses[code];
      if (guess) states[guess] = 'used';
    }
    paintKeyboard(keys, states);
  },

  // --- interaction ----------------------------------------------------------

  onSelect(game, index) {
    const ch = game.cipher[index];
    if (ch >= 'A' && ch <= 'Z') game.selectedIndex = index;
  },

  onKey(game, key) {
    if (key === 'DEL') return this.deleteLetter(game);
    if (key.length !== 1 || key < 'A' || key > 'Z') return {};
    if (game.selectedIndex === null) return {};

    const code = game.cipher[game.selectedIndex];
    if (game.locked.has(code)) {
      game.selectedIndex = nextOpenIndex(game, game.selectedIndex) ?? game.selectedIndex;
      return { toast: 'That letter is already revealed' };
    }

    game.guesses[code] = key;
    game.wrongLetters.delete(code);
    const advance = nextOpenIndex(game, game.selectedIndex);
    if (advance !== null) game.selectedIndex = advance;
    return {};
  },

  deleteLetter(game) {
    if (game.selectedIndex === null) return {};
    const code = game.cipher[game.selectedIndex];

    if (game.locked.has(code)) return { toast: 'Revealed letters cannot be cleared' };
    if (!game.guesses[code]) {
      // Nothing here: step back so repeated taps walk backwards, like a real
      // keyboard's backspace.
      this.move(game, -1);
      return {};
    }

    delete game.guesses[code];
    game.wrongLetters.delete(code);
    return {};
  },

  move(game, direction) {
    if (game.selectedIndex === null) return;
    const at = game.letterIndices.indexOf(game.selectedIndex);
    const next = (at + direction + game.letterIndices.length) % game.letterIndices.length;
    game.selectedIndex = game.letterIndices[next];
  },

  hint(game) {
    const open = game.letters.filter((code) => !game.locked.has(code));
    if (open.length === 0) return { toast: 'Nothing left to reveal' };

    // Prefer the selected cell, so a hint answers the question you were asking.
    const selected = game.selectedIndex === null ? null : game.cipher[game.selectedIndex];
    const code =
      selected && !game.locked.has(selected)
        ? selected
        : open[Math.floor(Math.random() * open.length)];

    game.guesses[code] = game.solution[code];
    game.locked.add(code);
    game.hintsUsed += 1;
    game.wrongLetters.delete(code);

    const advance = nextOpenIndex(game, game.selectedIndex ?? game.letterIndices[0]);
    if (advance !== null) game.selectedIndex = advance;

    return { toast: `Revealed ${code} = ${game.solution[code]}` };
  },

  check(game) {
    const wrong = game.letters.filter(
      (code) => game.guesses[code] && game.guesses[code] !== game.solution[code]
    );
    game.checksUsed += 1;

    if (wrong.length === 0) {
      const filled = game.letters.filter((code) => game.guesses[code]).length;
      return { toast: filled === 0 ? 'Nothing to check yet' : 'All correct so far' };
    }

    game.wrongLetters = new Set(wrong);
    return {
      toast: wrong.length === 1 ? '1 letter is wrong' : `${wrong.length} letters are wrong`,
      clearAfter: 2200,
    };
  },

  clearTransient(game) {
    game.wrongLetters = new Set();
  },

  reset(game) {
    const filled = game.letters.filter((code) => game.guesses[code] && !game.locked.has(code));
    if (filled.length === 0) return { toast: 'Board is already empty' };
    if (!window.confirm(`Clear ${filled.length} letter${filled.length === 1 ? '' : 's'}?`)) {
      return {};
    }

    for (const code of filled) delete game.guesses[code];
    game.wrongLetters = new Set();
    game.selectedIndex =
      nextOpenIndex(game, game.letterIndices[game.letterIndices.length - 1]) ??
      game.letterIndices[0];
    return {};
  },

  // --- outcome --------------------------------------------------------------

  isSolved(game) {
    return cipherSolved(game.cipher, game.guesses, game.solution);
  },

  isLost() {
    return false;
  },

  caption(game) {
    return game.solved && game.author ? `— ${game.author}` : '';
  },

  outcomeContent(game) {
    return {
      title: 'Solved!',
      // The board needs uppercase, but this reads far better in original casing.
      body: game.original ?? game.plain,
      caption: game.author ? `— ${game.author}` : '',
    };
  },

  /**
   * The home card's status line and button label.
   * @param {object|null} snapshot
   */
  statusFor(snapshot, { difficultyLabel }) {
    if (!snapshot) return { state: 'new', text: `Not started · ${difficultyLabel}`, action: 'Play' };
    if (snapshot.solved) {
      return { state: 'solved', text: `Solved in ${formatTime(snapshot.elapsedMs)}`, action: 'View' };
    }

    const game = this.hydrate(snapshot);
    const filled = game.letters.filter((code) => game.guesses[code]).length;
    if (filled === game.locked.size) {
      return { state: 'new', text: `Not started · ${difficultyLabel}`, action: 'Play' };
    }
    return {
      state: 'progress',
      text: `In progress · ${filled} of ${game.letters.length} letters`,
      action: 'Continue',
    };
  },
};
