// Boxed: twelve letters, three to a side. Chain words until every letter is used.
//
// The first game here whose difficulty is a constraint rather than a vocabulary.
// The letters are never the problem -- they are all common -- and neither is the
// word list. What is hard is that consecutive letters must come from different
// sides, which rules out most of what you would otherwise type, and that each
// word has to start where the last one ended.
//
// Generated backwards from a two-word solution, the same trick Word Wheel uses:
// pick a pair of words that between them use exactly twelve distinct letters,
// then find a way to deal those twelve onto four sides so that neither word ever
// steps twice on the same side. A box built forwards from random letters would
// usually be unsolvable, and there would be no way to know which.

import { hashString, localDateKey, mulberry32 } from '../cipher.js';
import { SEARCH_WORDS, WHEEL_SOURCES, WORDS } from '../words.js';
import { QWERTY_ROWS, paintKeyboard } from '../render.js';

/** Letters on the box, and how many sides they are dealt onto. */
export const BOX_LETTERS = 12;
export const SIDES = 4;
const PER_SIDE = BOX_LETTERS / SIDES;

/**
 * Shortest word the box will accept.
 *
 * Four rather than the three that this kind of puzzle usually allows, because
 * WORDS starts at four letters -- see the word list section of the README. It
 * makes the game meaningfully harder: three-letter words are what you normally
 * reach for to bridge an awkward junction.
 */
export const MIN_WORD = 4;

const DIFFICULTIES = {
  easy: { label: '6 words', limit: 6 },
  medium: { label: '5 words', limit: 5 },
  hard: { label: '4 words', limit: 4 },
};

const DIFFICULTY_NOTES = {
  easy: 'Six words to use all twelve letters. Room to wander into a corner and back out.',
  medium: 'Five words. Enough to recover from one bad turn, not two.',
  hard: 'Four words. Every one of them has to be pulling its weight.',
};

/**
 * The words a box is built from: common, and long enough that two of them can
 * cover twelve distinct letters. Shared with Word Wheel and Word Search rather
 * than shipping a fourth pool, since nothing about this game wants its own.
 */
const SOURCES = [...new Set([...WHEEL_SOURCES, ...SEARCH_WORDS])]
  .filter((w) => w.length >= 5 && w.length <= 9)
  .sort();

/** Source words grouped by first letter, so a junction can be looked up. */
const BY_FIRST = (() => {
  const out = new Map();
  for (const word of SOURCES) {
    if (!out.has(word[0])) out.set(word[0], []);
    out.get(word[0]).push(word);
  }
  return out;
})();

/** Every adjacent letter pair in a word, unordered, as 'ab' keys both ways. */
function adjacencies(words) {
  const edges = new Set();
  for (const word of words) {
    for (let i = 0; i < word.length - 1; i++) {
      edges.add(word[i] + word[i + 1]);
      edges.add(word[i + 1] + word[i]);
    }
  }
  return edges;
}

/**
 * Deal `letters` onto four sides of three so that no pair in `edges` shares a
 * side.
 *
 * Plain backtracking. Twelve letters over four bins is small enough that this
 * lands immediately, and the letters arrive pre-shuffled by the caller so the
 * layout does not hand back the order they appeared in the solution.
 *
 * @param {string[]} letters exactly BOX_LETTERS of them, distinct
 * @param {Set<string>} edges pairs that may not share a side
 * @returns {string[]|null} SIDES strings of PER_SIDE letters, or null
 */
export function dealSides(letters, edges) {
  const groups = Array.from({ length: SIDES }, () => []);

  const clashes = (group, letter) => group.some((other) => edges.has(other + letter));

  const place = (at) => {
    if (at === letters.length) return true;
    for (let g = 0; g < SIDES; g++) {
      if (groups[g].length >= PER_SIDE || clashes(groups[g], letters[at])) continue;
      groups[g].push(letters[at]);
      if (place(at + 1)) return true;
      groups[g].pop();
    }
    return false;
  };

  return place(0) ? groups.map((g) => g.join('')) : null;
}

/** Seeded Fisher-Yates, so a box is the same every time it is built. */
function shuffled(items, pick) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(pick() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A pair of source words is usable if together they use exactly twelve distinct
 * letters and neither ever doubles a letter -- a doubled letter would need to
 * sit on two sides at once, which no dealing can satisfy.
 */
function pairUsable(first, second) {
  if (new Set(first + second).size !== BOX_LETTERS) return false;
  for (const word of [first, second]) {
    for (let i = 0; i < word.length - 1; i++) if (word[i] === word[i + 1]) return false;
  }
  return true;
}

/** Try to turn one pair into a dealt box. */
function boxFrom(first, second, pick) {
  if (!pairUsable(first, second)) return null;
  const edges = adjacencies([first, second]);
  const sides = dealSides(shuffled(new Set(first + second), pick), edges);
  return sides ? { sides, sources: [first, second] } : null;
}

/**
 * Build a box from a seed.
 *
 * Roughly one junction pair in eight uses exactly twelve distinct letters, so
 * the random attempts almost always land; the exhaustive sweep afterwards exists
 * so that a puzzle is guaranteed rather than probable.
 */
function generate(seed) {
  const pick = mulberry32(seed);

  for (let attempt = 0; attempt < 200; attempt++) {
    const first = SOURCES[Math.floor(pick() * SOURCES.length)];
    const candidates = BY_FIRST.get(first[first.length - 1]);
    if (!candidates || candidates.length === 0) continue;

    const second = candidates[Math.floor(pick() * candidates.length)];
    if (second === first) continue;

    const box = boxFrom(first, second, pick);
    if (box) return box;
  }

  // Deterministic last resort, so a box always exists.
  for (const first of SOURCES) {
    for (const second of BY_FIRST.get(first[first.length - 1]) ?? []) {
      if (second === first) continue;
      const box = boxFrom(first, second, pick);
      if (box) return box;
    }
  }
  throw new Error('no usable box in the source list');
}

// --- rules ------------------------------------------------------------------

/** letter -> which side it sits on. */
function sideMap(sides) {
  const out = new Map();
  sides.forEach((side, index) => {
    for (const ch of side) out.set(ch, index);
  });
  return out;
}

/** Every distinct letter the played words have used between them. */
function coveredBy(words) {
  const out = new Set();
  for (const word of words) for (const ch of word) out.add(ch);
  return out;
}

/**
 * Why a word cannot be played, or null if it can.
 *
 * Ordered so the message names the rule the player has actually broken rather
 * than the first one that happens to fail: being off the box is more useful to
 * hear than not being in the dictionary.
 *
 * @returns {string|null}
 */
export function rejectionFor(word, { sides, words }) {
  if (word.length < MIN_WORD) return `At least ${MIN_WORD} letters`;

  const onSide = sideMap(sides);
  for (const ch of word) {
    if (!onSide.has(ch)) return `${ch.toUpperCase()} is not on the box`;
  }
  for (let i = 0; i < word.length - 1; i++) {
    if (onSide.get(word[i]) === onSide.get(word[i + 1])) {
      return `${word[i].toUpperCase()} and ${word[i + 1].toUpperCase()} are on the same side`;
    }
  }

  const last = words[words.length - 1];
  if (last && word[0] !== last[last.length - 1]) {
    return `Must start with ${last[last.length - 1].toUpperCase()}`;
  }
  if (words.includes(word)) return `${word.toUpperCase()} is already played`;
  if (!WORDS.has(word)) return `${word.toUpperCase()} is not in the word list`;
  return null;
}

/**
 * The legal next word that covers the most letters you still owe.
 *
 * A full sweep of the word list, like Word Wheel's solver: the cheap tests
 * reject almost everything before the side rule is consulted. Ties go to the
 * shorter word, so a hint is something you might plausibly have thought of.
 */
export function bestNextWord(game) {
  const needed = new Set(sideMap(game.sides).keys());
  for (const ch of coveredBy(game.words)) needed.delete(ch);

  const last = game.words[game.words.length - 1];
  const start = last ? last[last.length - 1] : null;

  let best = null;
  let bestGain = 0;
  for (const word of WORDS) {
    if (start && word[0] !== start) continue;
    if (word.length < MIN_WORD) continue;
    if (rejectionFor(word, game)) continue;

    let gain = 0;
    for (const ch of new Set(word)) if (needed.has(ch)) gain += 1;
    if (gain > bestGain || (gain === bestGain && best && word.length < best.length)) {
      best = word;
      bestGain = gain;
    }
  }
  return bestGain > 0 ? best : null;
}

export const boxed = {
  id: 'boxed',
  name: 'Boxed',
  blurb: 'Twelve letters on four sides. Use every one.',
  category: 'Letters',
  // The identity hue the shell paints this game with; see --hue-* in styles.css.
  hue: 'amber',
  // The four rails themselves: a square drawn as four separate bars, with the
  // corners left open because no letter sits on a corner.
  //
  // Twelve dots on a frame is what the board actually looks like, and it was the
  // first attempt, but the home row draws this at 24px and both the dots and the
  // frame silted up into one rounded blob. Four bars survive the size.
  icon: `<svg viewBox="0 0 512 512">
      <rect x="146" y="76" width="220" height="60" rx="30" />
      <rect x="146" y="376" width="220" height="60" rx="30" />
      <rect x="76" y="146" width="60" height="220" rx="30" />
      <rect x="376" y="146" width="60" height="220" rx="30" />
    </svg>`,

  difficulties: DIFFICULTIES,
  defaultDifficulty: 'medium',
  difficultyNotes: DIFFICULTY_NOTES,
  // Reset rather than check: there is nothing hidden to verify, but a chain that
  // has painted itself into a corner is worth being able to abandon.
  tools: ['hint', 'reset', 'new'],
  keyboard: { rows: QWERTY_ROWS, del: true, enter: true },

  howTo: [
    'Twelve letters sit around a box, three to each side. Use all twelve to win.',
    'Type a word and press Enter. Words are at least four letters long.',
    'Two letters in a row may not come from the same side of the box.',
    'Every word after the first has to start with the letter the last one ended on.',
    'Letters can be reused as often as you like. It is covering all twelve that counts.',
    'There is always a two-word solution, though almost nobody finds it.',
  ],

  // --- construction ---------------------------------------------------------

  createGame({ mode, difficulty, dateKey = localDateKey(), seed }) {
    const resolvedSeed =
      seed ??
      (mode === 'daily'
        ? hashString(`boxed|${dateKey}|${difficulty}`)
        : Math.floor(Math.random() * 0xffffffff));

    const built = generate(resolvedSeed);

    return this.hydrate({
      mode,
      difficulty,
      dateKey,
      seed: resolvedSeed,
      // The sides are stored, not an index into SOURCES.
      //
      // Deliberate, and the one place this game departs from Word Wheel: a
      // capped pool is resampled whenever words.js is regenerated, which
      // repoints every stored index at a different word. The dealt sides are the
      // premise of the puzzle rather than its answer, and storing them outright
      // means a regeneration can never rewrite a box someone is halfway through.
      sides: built.sides,
      sources: built.sources,
      words: [],
      hintsUsed: 0,
      elapsedMs: 0,
      solved: false,
      lost: false,
    });
  },

  hydrate(snapshot) {
    const sides = snapshot.sides;
    const limit = DIFFICULTIES[snapshot.difficulty].limit;

    // A tampered save cannot credit a word this box does not allow. Replayed in
    // order, because legality depends on what came before it.
    const words = [];
    for (const word of snapshot.words ?? []) {
      if (!rejectionFor(word, { sides, words })) words.push(word);
    }

    const covered = coveredBy(words);
    const solved = covered.size >= BOX_LETTERS;

    return {
      gameId: 'boxed',
      mode: snapshot.mode,
      difficulty: snapshot.difficulty,
      dateKey: snapshot.dateKey,
      seed: snapshot.seed,
      sides,
      sources: snapshot.sources ?? [],
      letters: sides.join(''),
      limit,
      words,
      covered,
      current: '',
      hintsUsed: snapshot.hintsUsed ?? 0,
      elapsedMs: snapshot.elapsedMs ?? 0,
      solved: snapshot.solved ?? solved,
      lost: snapshot.lost ?? (words.length >= limit && !solved),
      // transient
      shake: false,
      board: null,
      inputEl: null,
      listEl: null,
      tiles: null,
    };
  },

  toSnapshot(game) {
    return {
      mode: game.mode,
      difficulty: game.difficulty,
      dateKey: game.dateKey,
      seed: game.seed,
      sides: game.sides,
      sources: game.sources,
      words: game.words,
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
    board.className = 'boxed-board';

    const frame = document.createElement('div');
    frame.className = 'boxed-frame';

    // Four sides in a three-by-three grid, with the current word in the middle.
    // The visual is the rule: you can see at a glance which letters are shut off
    // from each other.
    const places = ['top', 'right', 'bottom', 'left'];
    game.tiles = [];

    const middle = document.createElement('div');
    middle.className = 'boxed-middle';

    const input = document.createElement('div');
    input.className = 'boxed-input';
    middle.appendChild(input);

    let index = 0;
    const rails = places.map((place) => {
      const rail = document.createElement('div');
      rail.className = `boxed-rail boxed-${place}`;
      for (const ch of game.sides[places.indexOf(place)]) {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'boxed-tile';
        // The position in game.letters, which is what onSelect reads.
        tile.dataset.index = String(index++);
        tile.textContent = ch.toUpperCase();
        rail.appendChild(tile);
        game.tiles.push(tile);
      }
      return rail;
    });

    frame.append(rails[0], rails[3], middle, rails[1], rails[2]);

    const list = document.createElement('ol');
    list.className = 'boxed-chain';

    board.append(frame, list);
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

    const onSide = sideMap(game.sides);
    const last = game.words[game.words.length - 1];
    const start = last ? last[last.length - 1] : null;
    const currentTail = game.current[game.current.length - 1] ?? null;

    game.tiles.forEach((tile, at) => {
      const ch = game.letters[at];
      tile.classList.toggle('is-used', game.covered.has(ch));
      // Where the next letter may legally come from: not the side you are
      // standing on, and if the word has not started yet, the junction letter.
      const blocked = currentTail
        ? onSide.get(ch) === onSide.get(currentTail)
        : Boolean(start) && ch !== start;
      tile.classList.toggle('is-blocked', blocked && !game.solved && !game.lost);
    });

    if (game.words.length !== game.shownCount) {
      game.listEl.textContent = '';
      for (const word of game.words) {
        const item = document.createElement('li');
        item.textContent = word.toUpperCase();
        game.listEl.appendChild(item);
      }
      game.shownCount = game.words.length;
    }
  },

  paintKeys(game, keys) {
    // Grey out anything not on the box, so the alphabet stops being noise. The
    // side rule is left to the board -- a key cannot show what it depends on.
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
    if (game.solved || game.lost) return {};
    const ch = game.letters[index];
    if (!ch) return {};
    game.current += ch;
    return {};
  },

  onKey(game, key) {
    if (game.solved || game.lost) return {};

    if (key === 'DEL') {
      game.current = game.current.slice(0, -1);
      return {};
    }
    if (key === 'ENTER') return this.commit(game);
    if (key.length !== 1 || key < 'A' || key > 'Z') return {};

    game.current += key.toLowerCase();
    return {};
  },

  commit(game) {
    const word = game.current;
    const reason = rejectionFor(word, game);

    if (reason) {
      game.shake = true;
      // The word survives a rejection: it is nearly always one letter away from
      // legal, and retyping eight letters to fix the last one is a punishment.
      return { toast: reason, clearAfter: 1100 };
    }

    game.words.push(word);
    for (const ch of word) game.covered.add(ch);
    game.current = '';

    // Deliberately not setting solved or lost here -- the shell owns those and
    // uses them to tell a board that has just finished from one that was already
    // finished when it was opened.
    const left = BOX_LETTERS - game.covered.size;
    if (left === 0) return { toast: '' };
    const wordsLeft = game.limit - game.words.length;
    return {
      toast:
        wordsLeft > 0
          ? `${left} letter${left === 1 ? '' : 's'} to go, ${wordsLeft} word${wordsLeft === 1 ? '' : 's'} left`
          : '',
    };
  },

  clearTransient(game) {
    game.shake = false;
  },

  move() {
    /* nothing to move */
  },

  hint(game) {
    if (game.words.length >= game.limit) return { toast: 'No words left to play' };

    const word = bestNextWord(game);
    if (!word) return { toast: 'No word can be played from here. Try Reset.' };

    game.words.push(word);
    for (const ch of word) game.covered.add(ch);
    game.current = '';
    game.hintsUsed += 1;
    return { toast: `Played ${word.toUpperCase()}` };
  },

  reset(game) {
    if (game.words.length === 0 && game.current === '') {
      return { toast: 'Board is already empty' };
    }
    const count = game.words.length;
    if (count > 0 && !window.confirm(`Clear ${count} word${count === 1 ? '' : 's'}?`)) {
      return {};
    }

    game.words = [];
    game.covered = new Set();
    game.current = '';
    return {};
  },

  // --- outcome --------------------------------------------------------------

  isSolved(game) {
    return game.covered.size >= BOX_LETTERS;
  },

  isLost(game) {
    return game.words.length >= game.limit && game.covered.size < BOX_LETTERS;
  },

  caption(game) {
    // While playing, the status strip carries the letter and word counts.
    if (game.solved) return `${game.words.length} word${game.words.length === 1 ? '' : 's'}`;
    if (game.lost) return 'Out of words';
    return '';
  },

  outcomeContent(game) {
    const pair = game.sources.map((w) => w.toUpperCase()).join(', ');

    if (this.isSolved(game)) {
      return {
        title: game.words.length <= 2 ? 'Two words!' : 'Solved!',
        body: game.words.map((w) => w.toUpperCase()).join(' - '),
        caption: pair ? `A two-word solution: ${pair}` : '',
      };
    }
    return {
      title: 'Out of words',
      body: pair,
      caption: 'That pair covers all twelve.',
    };
  },

  /** The status strip: letters covered is the goal; words spent is the budget. */
  progress(game) {
    return {
      label: `${game.covered.size} of ${BOX_LETTERS} letters`,
      value: game.covered.size,
      max: BOX_LETTERS,
      note: `${game.words.length} of ${game.limit} words`,
    };
  },

  /** Counts only; the chain itself would spoil the junctions. */
  shareLines(game) {
    if (game.covered.size >= BOX_LETTERS) {
      return [
        `Solved in ${game.words.length} of ${game.limit} words`,
        `All ${BOX_LETTERS} letters \u2705`,
      ];
    }
    return [`Out of words \u00b7 ${game.covered.size} of ${BOX_LETTERS} letters`];
  },

  /**
   * The home card's status line. Reads the saved words directly rather than
   * hydrating, because this runs for every game on every home paint.
   */
  statusFor(snapshot, { difficultyLabel }) {
    if (!snapshot) return { state: 'new', text: `Not started · ${difficultyLabel}`, action: 'Play' };

    const words = snapshot.words ?? [];
    const covered = coveredBy(words).size;

    if (snapshot.solved || covered >= BOX_LETTERS) {
      return {
        state: 'solved',
        text: `Solved · ${words.length} word${words.length === 1 ? '' : 's'}`,
        action: 'View',
      };
    }
    const limit = DIFFICULTIES[snapshot.difficulty]?.limit ?? 0;
    if (snapshot.lost || (limit && words.length >= limit)) {
      return { state: 'lost', text: 'Out of words', action: 'View' };
    }
    if (words.length === 0) {
      return { state: 'new', text: `Not started · ${difficultyLabel}`, action: 'Play' };
    }
    return {
      state: 'progress',
      text: `In progress · ${covered} of ${BOX_LETTERS} letters`,
      action: 'Continue',
    };
  },
};
