// Missing Vowels: a quote with every vowel removed.

import { hashString, localDateKey, mulberry32 } from '../cipher.js';
import { QUOTES, quotesForDifficulty } from '../quotes.js';
import { VOWEL_ROWS, buildQuoteGrid, paintCell, paintKeyboard } from '../render.js';
import { formatTime } from '../store.js';

// Y is deliberately left in place. Treating it as a vowel strips RHYTHM and
// MYTH down to nothing and makes too many words unguessable.
export const VOWELS = 'AEIOU';

const DIFFICULTIES = {
  easy: { label: 'Easy' },
  medium: { label: 'Medium' },
  hard: { label: 'Hard' },
};

const DIFFICULTY_NOTES = {
  easy: 'Short quotes with only a handful of gaps to fill.',
  medium: 'Medium-length quotes. A decent sitting-down puzzle.',
  hard: 'The longest quotes, so the most vowels to work out.',
};

export function isVowel(ch) {
  return VOWELS.includes(ch);
}

/**
 * Positions of every vowel in the text.
 * @param {string} text uppercase
 * @returns {number[]}
 */
export function vowelSlots(text) {
  const slots = [];
  for (let i = 0; i < text.length; i++) if (isVowel(text[i])) slots.push(i);
  return slots;
}

/**
 * The text as the player first sees it, with vowels replaced by a placeholder.
 * Used by tests and for reasoning about the puzzle; the grid renders blanks.
 * @param {string} text
 * @param {string} [blank]
 */
export function stripVowels(text, blank = '_') {
  return [...text].map((ch) => (isVowel(ch) ? blank : ch)).join('');
}

function cellsFor(game) {
  return [...game.plain].map((ch, i) => {
    if (ch === ' ') return { space: true };
    if (isVowel(ch)) return { editable: true, key: String(i) };
    return { editable: false, char: ch };
  });
}

/** Next unfilled slot after the given text index, wrapping. */
function nextOpenSlot(game, afterIndex) {
  const at = game.slots.indexOf(afterIndex);
  for (let step = 1; step <= game.slots.length; step++) {
    const slot = game.slots[(at + step) % game.slots.length];
    if (!game.locked.has(slot) && !game.filled[slot]) return slot;
  }
  return null;
}

export const vowels = {
  id: 'vowels',
  name: 'Missing Vowels',
  blurb: 'Put the vowels back into the quote.',
  category: 'Quotes',
  // Rings rather than blocks, with the middle one hollow: a row of vowels with
  // one taken out. Deliberately unlike Cryptogram's cells, which read almost
  // identically at icon size.
  icon: `<svg viewBox="0 0 512 512">
      <circle cx="118" cy="216" r="62" />
      <circle cx="256" cy="216" r="62" class="ring" />
      <circle cx="394" cy="216" r="62" />
      <rect x="86" y="330" width="64" height="26" rx="13" />
      <rect x="224" y="330" width="64" height="26" rx="13" class="dim" />
      <rect x="362" y="330" width="64" height="26" rx="13" />
    </svg>`,

  difficulties: DIFFICULTIES,
  defaultDifficulty: 'medium',
  difficultyNotes: DIFFICULTY_NOTES,
  tools: ['hint', 'check', 'reset', 'new'],
  keyboard: { rows: VOWEL_ROWS, del: true },

  howTo: [
    'Every A, E, I, O and U has been taken out of a quote. Put them back.',
    'Y is left alone, so RHYTHM and MYTH arrive intact.',
    'Tap a blank and choose a vowel from the five-key pad.',
    'Word shape and the consonants around a gap usually settle it: T_ST is TEST far more often than anything else.',
  ],

  // --- construction ---------------------------------------------------------

  createGame({ mode, difficulty, dateKey = localDateKey(), seed }) {
    const resolvedSeed =
      seed ??
      (mode === 'daily'
        ? hashString(`vowels|${dateKey}|${difficulty}`)
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
      filled: {},
      locked: [],
      hintsUsed: 0,
      checksUsed: 0,
      elapsedMs: 0,
      solved: false,
    });
  },

  hydrate(snapshot) {
    const quote = QUOTES[snapshot.quoteIndex];
    const plain = quote.text.toUpperCase();
    const slots = vowelSlots(plain);

    const filled = { ...(snapshot.filled ?? {}) };
    const locked = new Set((snapshot.locked ?? []).map(Number));
    // Revealed slots are authoritative: they always hold the right vowel.
    for (const slot of locked) filled[slot] = plain[slot];

    const game = {
      gameId: 'vowels',
      mode: snapshot.mode,
      difficulty: snapshot.difficulty,
      dateKey: snapshot.dateKey,
      seed: snapshot.seed,
      quoteIndex: snapshot.quoteIndex,
      author: quote.author,
      original: quote.text,
      plain,
      slots,
      filled,
      locked,
      hintsUsed: snapshot.hintsUsed ?? 0,
      checksUsed: snapshot.checksUsed ?? 0,
      elapsedMs: snapshot.elapsedMs ?? 0,
      solved: snapshot.solved ?? false,
      // transient
      selectedIndex: null,
      wrongSlots: new Set(),
      cells: null,
    };

    game.selectedIndex = game.solved ? null : nextOpenSlot(game, slots[slots.length - 1]);
    return game;
  },

  toSnapshot(game) {
    return {
      mode: game.mode,
      difficulty: game.difficulty,
      dateKey: game.dateKey,
      seed: game.seed,
      quoteIndex: game.quoteIndex,
      filled: game.filled,
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
    game.cells.forEach((el, i) => {
      if (!el || !el.dataset.key) return;
      const value = game.filled[i] ?? '';
      paintCell(el, value, {
        selected: i === game.selectedIndex,
        // Each blank is independent here, so there are no peer cells to light up.
        locked: game.locked.has(i),
        wrong: game.wrongSlots.has(i),
      });
    });
  },

  paintKeys(game, keys) {
    // Every vowel stays available: the same one is needed many times over.
    paintKeyboard(keys, {});
  },

  // --- interaction ----------------------------------------------------------

  onSelect(game, index) {
    if (isVowel(game.plain[index])) game.selectedIndex = index;
  },

  onKey(game, key) {
    if (key === 'DEL') return this.deleteLetter(game);
    if (!isVowel(key)) return {};
    if (game.selectedIndex === null) return {};

    const slot = game.selectedIndex;
    if (game.locked.has(slot)) {
      game.selectedIndex = nextOpenSlot(game, slot) ?? slot;
      return { toast: 'That vowel is already revealed' };
    }

    game.filled[slot] = key;
    game.wrongSlots.delete(slot);
    const advance = nextOpenSlot(game, slot);
    if (advance !== null) game.selectedIndex = advance;
    return {};
  },

  deleteLetter(game) {
    if (game.selectedIndex === null) return {};
    const slot = game.selectedIndex;

    if (game.locked.has(slot)) return { toast: 'Revealed vowels cannot be cleared' };
    if (!game.filled[slot]) {
      this.move(game, -1);
      return {};
    }

    delete game.filled[slot];
    game.wrongSlots.delete(slot);
    return {};
  },

  move(game, direction) {
    if (game.selectedIndex === null) return;
    const at = game.slots.indexOf(game.selectedIndex);
    const next = (at + direction + game.slots.length) % game.slots.length;
    game.selectedIndex = game.slots[next];
  },

  hint(game) {
    const open = game.slots.filter((slot) => !game.locked.has(slot));
    if (open.length === 0) return { toast: 'Nothing left to reveal' };

    const selected = game.selectedIndex;
    const slot =
      selected !== null && !game.locked.has(selected)
        ? selected
        : open[Math.floor(Math.random() * open.length)];

    game.filled[slot] = game.plain[slot];
    game.locked.add(slot);
    game.hintsUsed += 1;
    game.wrongSlots.delete(slot);

    const advance = nextOpenSlot(game, slot);
    if (advance !== null) game.selectedIndex = advance;

    return { toast: `Revealed ${game.plain[slot]}` };
  },

  check(game) {
    const wrong = game.slots.filter(
      (slot) => game.filled[slot] && game.filled[slot] !== game.plain[slot]
    );
    game.checksUsed += 1;

    if (wrong.length === 0) {
      const filled = game.slots.filter((slot) => game.filled[slot]).length;
      return { toast: filled === 0 ? 'Nothing to check yet' : 'All correct so far' };
    }

    game.wrongSlots = new Set(wrong);
    return {
      toast: wrong.length === 1 ? '1 vowel is wrong' : `${wrong.length} vowels are wrong`,
      clearAfter: 2200,
    };
  },

  clearTransient(game) {
    game.wrongSlots = new Set();
  },

  reset(game) {
    const filled = game.slots.filter((slot) => game.filled[slot] && !game.locked.has(slot));
    if (filled.length === 0) return { toast: 'Board is already empty' };
    if (!window.confirm(`Clear ${filled.length} vowel${filled.length === 1 ? '' : 's'}?`)) {
      return {};
    }

    for (const slot of filled) delete game.filled[slot];
    game.wrongSlots = new Set();
    game.selectedIndex = nextOpenSlot(game, game.slots[game.slots.length - 1]) ?? game.slots[0];
    return {};
  },

  // --- outcome --------------------------------------------------------------

  isSolved(game) {
    return game.slots.every((slot) => game.filled[slot] === game.plain[slot]);
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
      body: game.original ?? game.plain,
      caption: game.author ? `— ${game.author}` : '',
    };
  },

  statusFor(snapshot, { difficultyLabel }) {
    if (!snapshot) return { state: 'new', text: `Not started · ${difficultyLabel}`, action: 'Play' };
    if (snapshot.solved) {
      return { state: 'solved', text: `Solved in ${formatTime(snapshot.elapsedMs)}`, action: 'View' };
    }

    const game = this.hydrate(snapshot);
    const filled = game.slots.filter((slot) => game.filled[slot]).length;
    if (filled === game.locked.size) {
      return { state: 'new', text: `Not started · ${difficultyLabel}`, action: 'Play' };
    }
    return {
      state: 'progress',
      text: `In progress · ${filled} of ${game.slots.length} vowels`,
      action: 'Continue',
    };
  },
};
