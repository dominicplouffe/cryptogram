// Word Search: find the hidden words in a grid of letters.
//
// The one game here with no keyboard. You tap the first letter of a word and
// then the last, and if the straight line between them spells something on the
// list, it stays lit. Tap-tap rather than drag: a drag across a grid fights the
// page scroll on a phone, and a mis-drag loses the whole word.
//
// It is also the most relaxing thing in the library and the least demanding --
// no deduction, just scanning -- which is deliberate. Not every puzzle has to
// make you think hard.

import { hashString, localDateKey, mulberry32, orderBySeed } from '../cipher.js';
import { SEARCH_WORDS } from '../words.js';
import { formatTime } from '../store.js';

const DIFFICULTIES = {
  easy: { label: 'Easy', size: 8, words: 6, back: false },
  medium: { label: 'Medium', size: 10, words: 8, back: true },
  hard: { label: 'Hard', size: 12, words: 10, back: true },
};

const DIFFICULTY_NOTES = {
  easy: 'An 8x8 grid, six words, all reading forwards.',
  medium: 'A 10x10 grid, eight words, and some of them run backwards.',
  hard: 'A 12x12 grid, ten words, every direction in play.',
};

/** The eight directions, as [dx, dy]. The first four read forwards. */
const HEADINGS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
  [-1, 0],
  [0, -1],
  [-1, -1],
  [-1, 1],
];

/**
 * Filler letters, weighted roughly by how often they turn up in English. A grid
 * of uniformly random letters looks nothing like one and reads as noise -- far
 * too many Qs and Zs to scan comfortably.
 */
const FILLER = 'eeeeeeeeeeeetttttttttaaaaaaaaoooooooiiiiiiinnnnnnnssssssrrrrrrhhhhhdddddlllllcccuuummmwwffggyypbvkjxqz';

// --- construction -----------------------------------------------------------

function key(x, y, size) {
  return y * size + x;
}

/** Cell indices a word would occupy, or null if it runs off the grid. */
function pathFor(word, x, y, [dx, dy], size) {
  const cells = [];
  for (let i = 0; i < word.length; i++) {
    const cx = x + dx * i;
    const cy = y + dy * i;
    if (cx < 0 || cy < 0 || cx >= size || cy >= size) return null;
    cells.push(key(cx, cy, size));
  }
  return cells;
}

/**
 * Lay the words out.
 *
 * Overlaps are allowed where the letters already agree, which is what stops a
 * grid looking like words sprinkled on static. Placement is seeded, so the same
 * day always builds the same grid.
 */
function buildGrid(seed, { size, words: count, back }) {
  const rand = mulberry32(seed);
  const pickFrom = (list) => list[Math.floor(rand() * list.length)];

  const headings = back ? HEADINGS : HEADINGS.slice(0, 4);
  const letters = new Array(size * size).fill('');
  const placed = [];

  // The words this seed offers, in a content-addressed order.
  //
  // The old loop drew a fresh word per attempt with pool[rand() * pool.length],
  // which tied every grid to the pool's indices: adding one word to a blocklist
  // shifted everything after it and changed 99.9% of a year of dailies. Walking
  // an order derived from the seed and the words themselves means a pool that
  // loses a word only changes the grids that word was actually in.
  //
  // Taken in that order and no other. An earlier version sorted the head of it
  // longest-first, on the theory that long words are the hard ones to fit -- but
  // they fit easily on a grid that is still empty, and it skewed two thirds of
  // every board to eight-letter words. The pool's own mix of lengths is the right
  // mix, and rank order preserves it.
  const candidates = orderBySeed(
    SEARCH_WORDS.filter((w) => w.length >= 4 && w.length <= size),
    seed
  );

  for (const word of candidates) {
    if (placed.length >= count) break;

    // A handful of placements tried per word before giving up on it, since where
    // a word can go depends on what is already down.
    for (let tries = 0; tries < 24; tries++) {
      const cells = pathFor(
        word,
        Math.floor(rand() * size),
        Math.floor(rand() * size),
        pickFrom(headings),
        size
      );
      if (!cells) continue;

      // Every cell must be empty or already hold the letter we need.
      if (cells.some((cell, i) => letters[cell] && letters[cell] !== word[i])) continue;

      cells.forEach((cell, i) => {
        letters[cell] = word[i];
      });
      placed.push({ word, cells });
      break;
    }
  }

  // Fill the gaps. Done after placement so filler never blocks a word.
  for (let i = 0; i < letters.length; i++) {
    if (!letters[i]) letters[i] = FILLER[Math.floor(rand() * FILLER.length)];
  }

  return { size, letters, placed: placed.sort((a, b) => a.word.localeCompare(b.word)) };
}

/**
 * Every straight run of four or more letters in the grid, in every direction.
 * Used to check that random filler has not spelled something it should not.
 */
function runsIn(letters, size) {
  const out = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (const heading of HEADINGS) {
        for (let len = 4; len <= size; len++) {
          const cells = pathFor('x'.repeat(len), x, y, heading, size);
          if (!cells) break;
          out.push(cells.map((c) => letters[c]).join(''));
        }
      }
    }
  }
  return out;
}

/**
 * Short vulgarities and slurs that random filler could plausibly spell. Not the
 * full profanity list -- this only has to cover what four to six random letters
 * might land on.
 */
const BLOCKED_RUNS = new Set([
  'fuck', 'shit', 'cunt', 'piss', 'crap', 'turd', 'fart', 'slut', 'wank', 'tits',
  'anus', 'dick', 'cock', 'coon', 'gook', 'kike', 'spic', 'dyke', 'fags', 'rape',
  'whore', 'bitch', 'pussy', 'penis', 'nigga', 'queer', 'semen', 'porno', 'boobs',
  'nigger', 'faggot', 'wanker', 'fucker', 'shitty',
]);

/**
 * Build a grid, rejecting any whose filler happens to spell something offensive.
 *
 * A hundred-odd cells read in eight directions is a lot of accidental words, and
 * "the computer did it" is not much of a defence when one of them is a slur. The
 * blocked list is small and the odds are low, so this almost never re-rolls.
 */
function buildCleanGrid(seed, spec) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const grid = buildGrid(seed + attempt * 7919, spec);
    const runs = runsIn(grid.letters, grid.size);
    if (!runs.some((run) => BLOCKED_RUNS.has(run))) return grid;
  }
  return buildGrid(seed, spec);
}

export const search = {
  id: 'search',
  name: 'Word Search',
  blurb: 'Find the hidden words in the grid.',
  category: 'Grids',
  // The identity hue the shell paints this game with; see --hue-* in styles.css.
  hue: 'azure',
  // A grid with a diagonal run picked out of it.
  icon: `<svg viewBox="0 0 512 512">
      <rect x="56" y="56" width="92" height="92" rx="16" />
      <rect x="184" y="56" width="92" height="92" rx="16" class="dim" />
      <rect x="312" y="56" width="92" height="92" rx="16" class="dim" />
      <rect x="56" y="184" width="92" height="92" rx="16" class="dim" />
      <rect x="184" y="184" width="92" height="92" rx="16" />
      <rect x="312" y="184" width="92" height="92" rx="16" class="dim" />
      <rect x="56" y="312" width="92" height="92" rx="16" class="dim" />
      <rect x="184" y="312" width="92" height="92" rx="16" class="dim" />
      <rect x="312" y="312" width="92" height="92" rx="16" />
    </svg>`,

  difficulties: DIFFICULTIES,
  defaultDifficulty: 'medium',
  difficultyNotes: DIFFICULTY_NOTES,
  tools: ['hint', 'reset', 'new'],
  // Played entirely on the board. The shell hides the key row for this.
  keyboard: null,

  howTo: [
    'Every word on the list is hidden somewhere in the grid, in a straight line.',
    'Tap the first letter of a word, then tap its LAST letter — not the ones in between.',
    'Words run in any direction, including diagonally, and on medium and hard they can run backwards.',
    'Get it wrong and your start stays put, so you can just try a different end. Tap the start again to clear it.',
    'There is no way to lose and no clock pressure. This one is for switching off.',
  ],

  // --- construction ---------------------------------------------------------

  createGame({ mode, difficulty, dateKey = localDateKey(), seed }) {
    const resolvedSeed =
      seed ??
      (mode === 'daily'
        ? hashString(`search|${dateKey}|${difficulty}`)
        : Math.floor(Math.random() * 0xffffffff));

    return this.hydrate({
      mode,
      difficulty,
      dateKey,
      seed: resolvedSeed,
      found: [],
      hintsUsed: 0,
      elapsedMs: 0,
      solved: false,
    });
  },

  hydrate(snapshot) {
    const spec = DIFFICULTIES[snapshot.difficulty];
    const grid = buildCleanGrid(snapshot.seed, spec);

    const hidden = grid.placed.map((entry) => entry.word);
    const found = (snapshot.found ?? []).filter((w) => hidden.includes(w));

    return {
      gameId: 'search',
      mode: snapshot.mode,
      difficulty: snapshot.difficulty,
      dateKey: snapshot.dateKey,
      seed: snapshot.seed,
      size: grid.size,
      letters: grid.letters,
      placed: grid.placed,
      found,
      hintsUsed: snapshot.hintsUsed ?? 0,
      elapsedMs: snapshot.elapsedMs ?? 0,
      solved: snapshot.solved ?? found.length === hidden.length,
      lost: false,
      // transient
      anchor: null,
      missAt: null,
      cells: null,
      listEl: null,
      board: null,
    };
  },

  toSnapshot(game) {
    return {
      mode: game.mode,
      difficulty: game.difficulty,
      dateKey: game.dateKey,
      seed: game.seed,
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
    board.className = 'search-board';

    const grid = document.createElement('div');
    grid.className = 'search-grid';
    grid.style.setProperty('--search-size', String(game.size));
    // Set here rather than in CSS: dividing by a custom property inside calc()
    // is not reliable across browsers, and this only has three values.
    grid.style.setProperty('--search-font', game.size <= 8 ? '19px' : game.size <= 10 ? '16px' : '13px');

    game.cells = [];
    for (let i = 0; i < game.letters.length; i++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'search-cell';
      cell.dataset.index = String(i);
      cell.textContent = game.letters[i].toUpperCase();
      grid.appendChild(cell);
      game.cells.push(cell);
    }

    const list = document.createElement('ul');
    list.className = 'search-list';

    board.append(grid, list);
    root.appendChild(board);

    game.board = board;
    game.listEl = list;
    game.shownFound = -1;
  },

  paint(game) {
    const lit = new Set();
    for (const entry of game.placed) {
      if (game.found.includes(entry.word)) for (const cell of entry.cells) lit.add(cell);
    }

    // While a start is armed, the cells that lie in a straight line from it are
    // marked faintly. It teaches the interaction without giving anything away:
    // all eight rays are always shown, so it says "pick the far end of your
    // word", not "your word is here".
    const reachable = new Set();
    if (game.anchor !== null) {
      const ax = game.anchor % game.size;
      const ay = Math.floor(game.anchor / game.size);
      for (const [dx, dy] of HEADINGS) {
        for (let i = 1; i < game.size; i++) {
          const cx = ax + dx * i;
          const cy = ay + dy * i;
          if (cx < 0 || cy < 0 || cx >= game.size || cy >= game.size) break;
          reachable.add(cy * game.size + cx);
        }
      }
    }

    game.cells.forEach((cell, i) => {
      cell.classList.toggle('is-found', lit.has(i));
      cell.classList.toggle('is-anchor', i === game.anchor);
      cell.classList.toggle('is-reachable', reachable.has(i));
      cell.classList.toggle('is-miss', i === game.missAt);
    });

    if (game.found.length !== game.shownFound) {
      game.listEl.textContent = '';
      for (const entry of game.placed) {
        const item = document.createElement('li');
        item.textContent = entry.word.toUpperCase();
        if (game.found.includes(entry.word)) item.className = 'is-found';
        game.listEl.appendChild(item);
      }
      game.shownFound = game.found.length;
    }
  },

  paintKeys() {
    /* no keyboard */
  },

  // --- interaction ----------------------------------------------------------

  /**
   * First tap sets the anchor, second tap tries the line between the two.
   * Returns a move result either way so the shell saves and checks the outcome:
   * the second tap of the last word is what wins this game.
   *
   * A miss keeps the anchor rather than clearing it. The instinct on a grid is
   * to trace along a word, so the tap after the first letter is usually the
   * SECOND letter, not the last -- and throwing the start away for that made the
   * board feel like it was cancelling your selection at random. Now the start
   * stays put and only the tapped cell flashes, so the next tap can be the real
   * end. Tapping the start again is still how you clear it.
   */
  onSelect(game, index) {
    if (game.anchor === null) {
      game.anchor = index;
      return {};
    }
    if (game.anchor === index) {
      game.anchor = null;
      return {};
    }

    const from = game.anchor;

    const entry = game.placed.find(
      (candidate) =>
        !game.found.includes(candidate.word) &&
        ((candidate.cells[0] === from && candidate.cells[candidate.cells.length - 1] === index) ||
          (candidate.cells[0] === index && candidate.cells[candidate.cells.length - 1] === from))
    );

    if (!entry) {
      game.missAt = index;
      return { clearAfter: 450 };
    }

    game.anchor = null;
    game.missAt = null;
    game.found.push(entry.word);
    return { toast: entry.word.toUpperCase() };
  },

  onKey() {
    return {};
  },

  move() {
    /* no cursor */
  },

  clearTransient(game) {
    game.missAt = null;
  },

  hint(game) {
    game.anchor = null;
    game.missAt = null;
    const missing = game.placed.filter((entry) => !game.found.includes(entry.word));
    if (missing.length === 0) return { toast: 'You have found them all' };

    // Reveal the shortest one still hiding.
    const entry = missing.reduce((a, b) => (a.word.length <= b.word.length ? a : b));
    game.found.push(entry.word);
    game.hintsUsed += 1;
    game.anchor = null;
    return { toast: `Found ${entry.word.toUpperCase()} for you` };
  },

  reset(game) {
    if (game.found.length === 0) return { toast: 'Nothing found yet' };
    if (!window.confirm(`Clear ${game.found.length} found word(s)?`)) return {};
    game.found = [];
    game.anchor = null;
    game.missAt = null;
    return {};
  },

  // --- outcome --------------------------------------------------------------

  isSolved(game) {
    return game.placed.length > 0 && game.found.length === game.placed.length;
  },

  isLost() {
    return false;
  },

  caption(game) {
    // The count lives in the status strip now. The sheet explains
    // tap-first-then-last, but nobody reads the sheet -- say it on the board
    // until they have done it once.
    if (game.found.length === 0) return "Tap a word's first and last letter";
    return '';
  },

  outcomeContent(game) {
    return {
      title: 'All found!',
      body: game.placed.map((entry) => entry.word.toUpperCase()).join(', '),
      caption: `${game.placed.length} words`,
    };
  },

  /** The status strip: words found. */
  progress(game) {
    return {
      label: `${game.found.length} of ${game.placed.length} found`,
      value: game.found.length,
      max: game.placed.length,
      note: '',
    };
  },

  /** The words are the puzzle, so the card carries only the count and time. */
  shareLines(game) {
    return [`All ${game.placed.length} words found \u00b7 ${formatTime(game.elapsedMs)}`];
  },

  statusFor(snapshot, { difficultyLabel }) {
    if (!snapshot) return { state: 'new', text: `Not started · ${difficultyLabel}`, action: 'Play' };

    const found = (snapshot.found ?? []).length;
    const total = DIFFICULTIES[snapshot.difficulty]?.words ?? 0;

    if (snapshot.solved) {
      return { state: 'solved', text: `Solved · all ${found} found`, action: 'View' };
    }
    if (found === 0) {
      return { state: 'new', text: `Not started · ${difficultyLabel}`, action: 'Play' };
    }
    return {
      state: 'progress',
      text: `In progress · ${found} of ${total} found`,
      action: 'Continue',
    };
  },
};
