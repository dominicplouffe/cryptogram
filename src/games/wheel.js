// Word Wheel: nine letters, one of them compulsory, find as many words as you
// can.
//
// The first game here that is not a single right answer. Every other game is
// "deduce the one solution and stop"; this one you can dip into for ninety
// seconds, find three words and put down. Reaching the target counts as solved
// and rings the bell, but the board deliberately stays live afterwards so you
// can keep hunting -- the shell only gates the keyboard if a module chooses to.

import { hashString, localDateKey, mulberry32 } from '../cipher.js';
import { WHEEL_SOURCES, WORDS } from '../words.js';
import { QWERTY_ROWS, paintKeyboard } from '../render.js';

export const MIN_WORD = 4;

const DIFFICULTIES = {
  easy: { label: '7 letters', size: 7 },
  medium: { label: '8 letters', size: 8 },
  hard: { label: '9 letters', size: 9 },
};

const DIFFICULTY_NOTES = {
  easy: 'Seven letters. Fewer words to find, and a shorter target.',
  medium: 'Eight letters. The middle of the road.',
  hard: 'Nine letters, and far more hiding in them than you would think.',
};

/**
 * Share of the findable words that counts as done.
 *
 * Not 100%: the long tail of a nine-letter wheel is words nobody says, and a
 * target you cannot reach is a target that stops meaning anything.
 */
const TARGET_SHARE = 0.3;

// --- puzzle -----------------------------------------------------------------

/** Letter counts, so a word can be checked against the letters available. */
function tally(word) {
  const counts = new Map();
  for (const ch of word) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  return counts;
}

/** Can `word` be built from `pool`, using each letter no more often than it appears? */
function buildableFrom(word, pool) {
  const left = new Map(pool);
  for (const ch of word) {
    const n = left.get(ch) ?? 0;
    if (n === 0) return false;
    left.set(ch, n - 1);
  }
  return true;
}

/**
 * Every word this wheel can make: at least MIN_WORD long, uses the centre
 * letter, and fits the letters available.
 *
 * A full scan of the 44k-word list, which sounds worse than it is -- the length
 * and centre-letter tests reject almost everything before the letter counting
 * starts. Measured at a few milliseconds.
 *
 * @param {string} letters the whole wheel, centre included
 * @param {string} centre
 * @returns {string[]} sorted longest-first, then alphabetically
 */
export function solutionsFor(letters, centre) {
  const pool = tally(letters);
  const found = [];

  for (const word of WORDS) {
    if (word.length < MIN_WORD || word.length > letters.length) continue;
    if (!word.includes(centre)) continue;
    if (!buildableFrom(word, pool)) continue;
    found.push(word);
  }

  found.sort((a, b) => b.length - a.length || a.localeCompare(b));
  return found;
}

/**
 * Build a wheel from a seed.
 *
 * Backwards from a source word, so a word using every letter is guaranteed to
 * exist -- without that the wheel would just be nine letters with no pangram in
 * them, and the best find on the board would be an accident.
 */
function generate(seed, size) {
  const pick = mulberry32(seed);
  const pool = WHEEL_SOURCES.filter((w) => w.length === size);

  for (let attempt = 0; attempt < 40; attempt++) {
    const source = pool[Math.floor(pick() * pool.length)];

    // The centre letter is compulsory, so it has to be one that actually leads
    // somewhere. Trying each distinct letter keeps a dud source from being
    // thrown away when one of its letters would have worked.
    const distinct = [...new Set(source)];
    const centre = distinct[Math.floor(pick() * distinct.length)];
    const solutions = solutionsFor(source, centre);

    // Too thin and the puzzle is a chore rather than a pastime.
    if (solutions.length >= 12) {
      const letters = [...source].sort((a, b) => a.localeCompare(b)).join('');
      return { source, letters, centre, total: solutions.length };
    }
  }

  // Deterministic last resort, so a puzzle always exists.
  for (const source of pool) {
    for (const centre of new Set(source)) {
      const solutions = solutionsFor(source, centre);
      if (solutions.length >= 12) {
        const letters = [...source].sort((a, b) => a.localeCompare(b)).join('');
        return { source, letters, centre, total: solutions.length };
      }
    }
  }
  throw new Error('no usable wheel in the source list');
}

/** How many words count as done. Always at least four, never more than exists. */
export function targetFor(total) {
  return Math.max(4, Math.min(total, Math.round(total * TARGET_SHARE)));
}

/** The rank a count has earned, for the caption and the win sheet. */
function tierFor(found, target) {
  if (found >= target * 2) return 'Excellent';
  if (found >= target * 1.5) return 'Very good';
  if (found >= target) return 'Good';
  return null;
}

export const wheel = {
  id: 'wheel',
  name: 'Word Wheel',
  blurb: 'Nine letters. How many words can you find?',
  category: 'Letters',
  // A ring of dots around a filled centre: the compulsory letter in the middle.
  icon: `<svg viewBox="0 0 512 512">
      <circle cx="256" cy="256" r="66" />
      <circle cx="256" cy="106" r="34" class="dim" />
      <circle cx="256" cy="406" r="34" class="dim" />
      <circle cx="106" cy="256" r="34" class="dim" />
      <circle cx="406" cy="256" r="34" class="dim" />
      <circle cx="150" cy="150" r="30" class="dim" />
      <circle cx="362" cy="150" r="30" class="dim" />
      <circle cx="150" cy="362" r="30" class="dim" />
      <circle cx="362" cy="362" r="30" class="dim" />
    </svg>`,

  difficulties: DIFFICULTIES,
  defaultDifficulty: 'medium',
  difficultyNotes: DIFFICULTY_NOTES,
  // No check and no reset: there is nothing wrong on the board to find, and
  // clearing a list you spent ten minutes building is not a feature.
  tools: ['hint', 'new'],
  keyboard: { rows: QWERTY_ROWS, del: true, enter: true },

  howTo: [
    'Make as many words as you can from the letters on the wheel.',
    'Every word has to use the middle letter, and be at least four letters long.',
    'Letters can only be used as often as they appear on the wheel.',
    'One word uses every letter. Finding it is the best thing you can do here.',
    'Reaching the target counts as solved, but the board stays open — keep going as long as you like.',
  ],

  // --- construction ---------------------------------------------------------

  createGame({ mode, difficulty, dateKey = localDateKey(), seed }) {
    const resolvedSeed =
      seed ??
      (mode === 'daily'
        ? hashString(`wheel|${dateKey}|${difficulty}`)
        : Math.floor(Math.random() * 0xffffffff));

    const built = generate(resolvedSeed, DIFFICULTIES[difficulty].size);

    return this.hydrate({
      mode,
      difficulty,
      dateKey,
      seed: resolvedSeed,
      sourceIndex: WHEEL_SOURCES.indexOf(built.source),
      centre: built.centre,
      found: [],
      hintsUsed: 0,
      elapsedMs: 0,
      solved: false,
    });
  },

  hydrate(snapshot) {
    const source = WHEEL_SOURCES[snapshot.sourceIndex];
    const centre = snapshot.centre;
    const solutions = solutionsFor(source, centre);
    const target = targetFor(solutions.length);

    // A tampered save cannot credit a word this wheel does not contain.
    const legal = new Set(solutions);
    const found = (snapshot.found ?? []).filter((w) => legal.has(w));

    return {
      gameId: 'wheel',
      mode: snapshot.mode,
      difficulty: snapshot.difficulty,
      dateKey: snapshot.dateKey,
      seed: snapshot.seed,
      sourceIndex: snapshot.sourceIndex,
      centre,
      source,
      // Sorted so the wheel is not a giveaway of the source word's spelling.
      letters: [...source].sort((a, b) => a.localeCompare(b)).join(''),
      solutions,
      target,
      found,
      current: '',
      hintsUsed: snapshot.hintsUsed ?? 0,
      elapsedMs: snapshot.elapsedMs ?? 0,
      solved: snapshot.solved ?? found.length >= target,
      lost: false,
      // transient
      shake: false,
      board: null,
      listEl: null,
      inputEl: null,
    };
  },

  toSnapshot(game) {
    return {
      mode: game.mode,
      difficulty: game.difficulty,
      dateKey: game.dateKey,
      seed: game.seed,
      sourceIndex: game.sourceIndex,
      centre: game.centre,
      found: game.found,
      hintsUsed: game.hintsUsed,
      elapsedMs: game.elapsedMs,
      solved: game.solved,
    };
  },

  // --- rendering ------------------------------------------------------------

  mount(root, game) {
    root.textContent = '';

    const board = document.createElement('div');
    board.className = 'wheel-board';

    const input = document.createElement('div');
    input.className = 'wheel-input';

    // The outer letters, then the compulsory one on its own below. One instance
    // of the centre is taken out of the ring rather than all of them: a wheel
    // holding two Es really does let you use two.
    const ring = document.createElement('div');
    ring.className = 'wheel-ring';

    const outer = [...game.letters];
    outer.splice(outer.indexOf(game.centre), 1);
    ring.style.setProperty('--wheel-cols', String(Math.ceil(outer.length / 2)));

    const addKey = (ch, index, className) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = className;
      tile.dataset.index = String(index);
      tile.textContent = ch.toUpperCase();
      return tile;
    };

    // data-index is the position in game.letters, which is what onSelect reads.
    const used = new Set([game.letters.indexOf(game.centre)]);
    for (const ch of outer) {
      let at = game.letters.indexOf(ch);
      while (used.has(at)) at = game.letters.indexOf(ch, at + 1);
      used.add(at);
      ring.appendChild(addKey(ch, at, 'wheel-key'));
    }

    const hub = document.createElement('div');
    hub.className = 'wheel-hub';
    hub.appendChild(
      addKey(game.centre, game.letters.indexOf(game.centre), 'wheel-key is-centre')
    );

    const list = document.createElement('ul');
    list.className = 'wheel-found';

    board.append(input, ring, hub, list);
    root.appendChild(board);

    game.board = board;
    game.inputEl = input;
    game.listEl = list;
    game.shownCount = -1;
  },

  paint(game) {
    game.inputEl.textContent = game.current.toUpperCase();
    game.inputEl.classList.toggle('is-empty', game.current.length === 0);
    game.inputEl.classList.toggle('shake', game.shake);

    // Rebuilt only when the list actually grew.
    if (game.found.length !== game.shownCount) {
      game.listEl.textContent = '';
      // Newest first: the thing you just did should be the thing you can see.
      for (const word of [...game.found].reverse()) {
        const item = document.createElement('li');
        item.textContent = word.toUpperCase();
        if (word.length === game.letters.length) item.className = 'is-pangram';
        game.listEl.appendChild(item);
      }
      game.shownCount = game.found.length;
    }
  },

  paintKeys(game, keys) {
    // Grey out anything not on the wheel, so the alphabet stops being noise.
    const states = {};
    for (const [name] of keys) {
      if (name.length === 1 && !game.letters.includes(name.toLowerCase())) {
        states[name] = 'miss';
      }
    }
    paintKeyboard(keys, states);
  },

  // --- interaction ----------------------------------------------------------

  /** Tapping a letter types it. The keyboard still works; this is just nearer. */
  onSelect(game, index) {
    const ch = game.letters[index];
    if (!ch) return {};
    if (game.current.length >= game.letters.length) return {};
    game.current += ch;
    return {};
  },

  onKey(game, key) {
    if (key === 'DEL') {
      game.current = game.current.slice(0, -1);
      return {};
    }
    if (key === 'ENTER') return this.commit(game);
    if (key.length !== 1 || key < 'A' || key > 'Z') return {};

    if (game.current.length >= game.letters.length) return {};
    game.current += key.toLowerCase();
    return {};
  },

  commit(game) {
    const word = game.current;
    game.current = '';

    if (word.length < MIN_WORD) {
      game.shake = true;
      return { toast: `At least ${MIN_WORD} letters`, clearAfter: 700 };
    }
    if (!word.includes(game.centre)) {
      game.shake = true;
      return { toast: `Every word needs ${game.centre.toUpperCase()}`, clearAfter: 900 };
    }
    if (game.found.includes(word)) {
      return { toast: `${word.toUpperCase()} is already on your list`, clearAfter: 700 };
    }
    if (!game.solutions.includes(word)) {
      game.shake = true;
      // Distinguishing "not a word" from "not in these letters" is worth the
      // extra check: one is your vocabulary, the other is your reading.
      const reason = WORDS.has(word) ? 'not in these letters' : 'not in the word list';
      return { toast: `${word.toUpperCase()} is ${reason}`, clearAfter: 900 };
    }

    game.found.push(word);
    const pangram = word.length === game.letters.length;
    return { toast: pangram ? `${word.toUpperCase()} — every letter!` : '' };
  },

  clearTransient(game) {
    game.shake = false;
  },

  move() {
    /* nothing to move */
  },

  hint(game) {
    const missing = game.solutions.filter((w) => !game.found.includes(w));
    if (missing.length === 0) return { toast: 'You have found them all' };

    // The shortest missing word: a hint should get you moving again, not hand
    // over the pangram you were saving.
    const word = missing.reduce((a, b) => (a.length <= b.length ? a : b));
    game.found.push(word);
    game.hintsUsed += 1;
    game.current = '';
    return { toast: `Added ${word.toUpperCase()}` };
  },

  // --- outcome --------------------------------------------------------------

  isSolved(game) {
    return game.found.length >= game.target;
  },

  isLost() {
    return false;
  },

  caption(game) {
    const tier = tierFor(game.found.length, game.target);
    const base = `${game.found.length} of ${game.solutions.length} found`;
    return tier ? `${base} · ${tier}` : `${base} · ${game.target} for a win`;
  },

  outcomeContent(game) {
    const pangram = game.found.find((w) => w.length === game.letters.length);
    const tier = tierFor(game.found.length, game.target) ?? 'Good';

    return {
      title: pangram ? 'Every letter!' : `${tier}!`,
      // Their own list read back, longest first.
      body: [...game.found]
        .sort((a, b) => b.length - a.length || a.localeCompare(b))
        .map((w) => w.toUpperCase())
        .join(', '),
      caption: `${game.found.length} of ${game.solutions.length} words. Keep going if you like.`,
    };
  },

  /**
   * The home card's status line. Counts the saved list without solving the wheel
   * again, because this runs for every game on every home paint and scanning the
   * word list four times over would be felt.
   */
  statusFor(snapshot, { difficultyLabel }) {
    if (!snapshot) return { state: 'new', text: `Not started · ${difficultyLabel}`, action: 'Play' };

    const found = (snapshot.found ?? []).length;
    if (snapshot.solved) {
      return { state: 'solved', text: `Solved · ${found} words found`, action: 'View' };
    }
    if (found === 0) {
      return { state: 'new', text: `Not started · ${difficultyLabel}`, action: 'Play' };
    }
    return {
      state: 'progress',
      text: `In progress · ${found} word${found === 1 ? '' : 's'} found`,
      action: 'Continue',
    };
  },
};
