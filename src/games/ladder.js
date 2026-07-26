// Word Ladder: change one letter at a time to get from one word to another.
//
// COLD -> CORD -> CARD -> WARD -> WARM
//
// Four letters rather than five on purpose. The "one letter apart" graph over
// five-letter words is sparse enough that most words are isolated; over four it
// averages seven neighbours a word, which is what makes ladders exist at all.

import { hashString, localDateKey, mulberry32 } from '../cipher.js';
import { LADDER_COMMON, LADDER_WORDS } from '../words.js';
import { QWERTY_ROWS, paintKeyboard } from '../render.js';

export const WORD_LENGTH = 4;

const DIFFICULTIES = {
  easy: { label: 'Easy', steps: 3 },
  medium: { label: 'Medium', steps: 4 },
  hard: { label: 'Hard', steps: 5 },
};

const DIFFICULTY_NOTES = {
  easy: 'Three steps between the two words.',
  medium: 'Four steps. Enough room to go wrong and come back.',
  hard: 'Five steps, so the middle of the ladder is a long way from either end.',
};

// --- the word graph ---------------------------------------------------------

let adjacency = null;

/**
 * word -> the set of words exactly one letter away.
 *
 * Built from wildcard buckets (C_LD, CO_D, ...) rather than by comparing every
 * pair: 2,413 words is 2.9 million comparisons the naive way, against four
 * bucket lookups per word here.
 *
 * Built on first use rather than at import, so a player who never opens this
 * game never pays for it.
 *
 * @returns {Map<string, Set<string>>}
 */
function neighbours() {
  if (adjacency) return adjacency;

  const buckets = new Map();
  for (const word of LADDER_WORDS) {
    for (let i = 0; i < WORD_LENGTH; i++) {
      const key = `${word.slice(0, i)}.${word.slice(i + 1)}`;
      const group = buckets.get(key);
      if (group) group.push(word);
      else buckets.set(key, [word]);
    }
  }

  adjacency = new Map();
  for (const group of buckets.values()) {
    for (const word of group) {
      let set = adjacency.get(word);
      if (!set) adjacency.set(word, (set = new Set()));
      for (const other of group) if (other !== word) set.add(other);
    }
  }
  return adjacency;
}

/**
 * Breadth-first search out from a word.
 *
 * @param {string} from
 * @param {(word: string) => boolean} [allowed] restricts which words may be
 *   stepped on. Generation passes the common pool so the ladder it guarantees
 *   only runs through familiar words; hints pass nothing, so a player who has
 *   wandered onto an obscure word can still be helped back.
 * @returns {Map<string, {from: string|null, dist: number}>}
 */
function explore(from, allowed) {
  const adj = neighbours();
  const reached = new Map([[from, { from: null, dist: 0 }]]);
  let frontier = [from];

  while (frontier.length) {
    const next = [];
    for (const word of frontier) {
      const dist = reached.get(word).dist + 1;
      for (const other of adj.get(word) ?? []) {
        if (reached.has(other)) continue;
        if (allowed && !allowed(other)) continue;
        reached.set(other, { from: word, dist });
        next.push(other);
      }
    }
    frontier = next;
  }
  return reached;
}

/**
 * Pick a start and a goal exactly `steps` apart, deterministically from a seed.
 *
 * About one word in eleven sits in a component with nothing at the required
 * distance, so this retries. The fallback keeps the longest shorter ladder it
 * saw, and records that as par rather than claiming the length it wanted.
 *
 * @param {number} seed
 * @param {number} steps
 */
function generate(seed, steps) {
  const pick = mulberry32(seed);
  const common = new Set(LADDER_COMMON);
  const inCommon = (word) => common.has(word);
  let fallback = null;

  for (let attempt = 0; attempt < 40; attempt++) {
    const start = LADDER_COMMON[Math.floor(pick() * LADDER_COMMON.length)];
    const reached = explore(start, inCommon);

    const exact = [];
    let longest = null;
    for (const [word, { dist }] of reached) {
      if (dist === steps) exact.push(word);
      else if (dist >= 2 && dist < steps && (!longest || dist > longest.dist)) {
        longest = { word, dist };
      }
    }

    if (exact.length) {
      return { start, goal: exact[Math.floor(pick() * exact.length)], par: steps };
    }
    if (longest && (!fallback || longest.dist > fallback.par)) {
      fallback = { start, goal: longest.word, par: longest.dist };
    }
  }

  if (fallback) return fallback;

  // Deterministic last resort. Unreachable with this word list, but a puzzle has
  // to exist rather than the game handing back a board that is already solved.
  for (const start of LADDER_COMMON) {
    for (const [word, { dist }] of explore(start, inCommon)) {
      if (dist >= 2) return { start, goal: word, par: dist };
    }
  }
  throw new Error('word list contains no ladder');
}

let commonPool = null;

/** The endpoint pool as a set, for the "may I step here" test. */
function isCommon(word) {
  if (!commonPool) commonPool = new Set(LADDER_COMMON);
  return commonPool.has(word);
}

/**
 * The next word along a shortest route to the goal, or null if there is no route
 * from here -- which a player can reach by stepping onto a dead end.
 *
 * Restricted to the common pool, and it matters: par is the shortest route
 * *through familiar words*, so a hint searching the full word list would find
 * genuine shortcuts through obscure ones and hand you a par-5 ladder solved in
 * three. Par has to mean the same thing to the generator and to the hint, and
 * the version a player can actually find for themselves is the common one.
 *
 * A player standing on an obscure word is still helped: the filter gates where a
 * step may land, not where the search starts.
 */
function nextStepToward(from, goal) {
  if (from === goal) return null;

  const reached = explore(from, isCommon);
  if (!reached.has(goal)) return null;

  let cursor = goal;
  while (reached.get(cursor).from !== from) cursor = reached.get(cursor).from;
  return cursor;
}

// --- board ------------------------------------------------------------------

/** The word the next rung has to differ from. */
function tip(game) {
  return game.rungs.length ? game.rungs[game.rungs.length - 1] : game.start;
}

/** Index of the single letter that changed, or -1. */
function changedAt(before, after) {
  if (!before || !after || before.length !== after.length) return -1;
  let at = -1;
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue;
    if (at !== -1) return -1;
    at = i;
  }
  return at;
}

function differsByOne(a, b) {
  return changedAt(a, b) !== -1 && a !== b;
}

/**
 * The rows to draw, top to bottom. While unsolved the goal stays pinned at the
 * bottom with a gap above it, so you can always see what you are aiming at and
 * that you are not necessarily one step away.
 */
function ladderRows(game) {
  const rows = [{ word: game.start, kind: 'start' }];

  game.rungs.forEach((word, i) => {
    const last = i === game.rungs.length - 1;
    rows.push({ word, kind: last && game.solved ? 'goal' : 'rung' });
  });

  if (!game.solved) {
    rows.push({ word: game.current, kind: 'current' });
    rows.push({ kind: 'gap' });
    rows.push({ word: game.goal, kind: 'goal' });
  }
  return rows;
}

export const ladder = {
  id: 'ladder',
  name: 'Word Ladder',
  blurb: 'Change one letter at a time.',
  category: 'Letters',
  // Three bars stepping upward. Deliberately unlike the other three marks, which
  // are all blocks or circles in a row.
  icon: `<svg viewBox="0 0 512 512">
      <rect x="52" y="330" width="152" height="48" rx="24" />
      <rect x="180" y="232" width="152" height="48" rx="24" class="dim" />
      <rect x="308" y="134" width="152" height="48" rx="24" />
    </svg>`,

  difficulties: DIFFICULTIES,
  defaultDifficulty: 'medium',
  difficultyNotes: DIFFICULTY_NOTES,
  // No check: every rung is validated the moment you enter it, so there is never
  // a wrong letter sitting on the board to go looking for.
  tools: ['hint', 'reset', 'new'],
  keyboard: { rows: QWERTY_ROWS, del: true, enter: true },

  howTo: [
    'Get from the top word to the bottom one by changing a single letter at a time.',
    'Every step has to be a real four-letter word. Type one and press Enter.',
    'The letter you changed is highlighted, so you can read the ladder back at a glance.',
    'Par is the shortest route there is. Taking longer is fine, and you can always beat par by finding a shortcut.',
    'Delete on an empty row removes your last step, so a wrong turn costs nothing.',
  ],

  // --- construction ---------------------------------------------------------

  createGame({ mode, difficulty, dateKey = localDateKey(), seed }) {
    const resolvedSeed =
      seed ??
      (mode === 'daily'
        ? hashString(`ladder|${dateKey}|${difficulty}`)
        : Math.floor(Math.random() * 0xffffffff));

    const { start, goal, par } = generate(resolvedSeed, DIFFICULTIES[difficulty].steps);

    return this.hydrate({
      mode,
      difficulty,
      dateKey,
      seed: resolvedSeed,
      startIndex: LADDER_COMMON.indexOf(start),
      goalIndex: LADDER_COMMON.indexOf(goal),
      par,
      rungs: [],
      current: '',
      hintsUsed: 0,
      elapsedMs: 0,
      solved: false,
    });
  },

  hydrate(snapshot) {
    const start = LADDER_COMMON[snapshot.startIndex];
    const goal = LADDER_COMMON[snapshot.goalIndex];
    const rungs = (snapshot.rungs ?? []).slice();

    return {
      gameId: 'ladder',
      mode: snapshot.mode,
      difficulty: snapshot.difficulty,
      dateKey: snapshot.dateKey,
      seed: snapshot.seed,
      startIndex: snapshot.startIndex,
      goalIndex: snapshot.goalIndex,
      par: snapshot.par,
      start,
      goal,
      rungs,
      current: (snapshot.current ?? '').slice(0, WORD_LENGTH),
      hintsUsed: snapshot.hintsUsed ?? 0,
      elapsedMs: snapshot.elapsedMs ?? 0,
      solved: snapshot.solved ?? rungs[rungs.length - 1] === goal,
      lost: false,
      // transient
      shake: false,
      board: null,
      signature: null,
    };
  },

  toSnapshot(game) {
    return {
      mode: game.mode,
      difficulty: game.difficulty,
      dateKey: game.dateKey,
      seed: game.seed,
      startIndex: game.startIndex,
      goalIndex: game.goalIndex,
      par: game.par,
      rungs: game.rungs,
      current: game.current,
      hintsUsed: game.hintsUsed,
      elapsedMs: game.elapsedMs,
      solved: game.solved,
    };
  },

  // --- rendering ------------------------------------------------------------

  mount(root, game) {
    root.textContent = '';
    const board = document.createElement('div');
    board.className = 'ladder-board';
    root.appendChild(board);
    game.board = board;
    game.signature = null;
  },

  paint(game) {
    const rows = ladderRows(game);

    // The ladder grows as you climb, so the DOM is rebuilt when its shape
    // changes and only repainted otherwise.
    const signature = rows.map((row) => row.kind).join(',');
    if (signature !== game.signature) {
      game.board.textContent = '';
      for (const row of rows) {
        if (row.kind === 'gap') {
          const gap = document.createElement('div');
          gap.className = 'ladder-gap';
          gap.textContent = '⋮';
          gap.setAttribute('aria-hidden', 'true');
          game.board.appendChild(gap);
          continue;
        }
        const el = document.createElement('div');
        el.className = 'ladder-row';
        for (let i = 0; i < WORD_LENGTH; i++) {
          const tile = document.createElement('span');
          tile.className = 'tile';
          el.appendChild(tile);
        }
        game.board.appendChild(el);
      }
      game.signature = signature;
    }

    const elements = [...game.board.children];
    let previous = null;

    rows.forEach((row, index) => {
      const el = elements[index];
      if (row.kind === 'gap') return;

      el.classList.toggle('is-start', row.kind === 'start');
      el.classList.toggle('is-goal', row.kind === 'goal');
      el.classList.toggle('is-current', row.kind === 'current');
      el.classList.toggle('shake', row.kind === 'current' && game.shake);

      // Only committed rungs show which letter moved; the goal is not something
      // you have reached yet, so nothing there is "changed".
      const highlight = row.kind === 'rung' || (row.kind === 'goal' && game.solved);
      const moved = highlight ? changedAt(previous, row.word) : -1;

      [...el.children].forEach((tile, i) => {
        const ch = (row.word[i] ?? '').toUpperCase();
        if (tile.textContent !== ch) tile.textContent = ch;
        tile.classList.toggle('tile-filled', Boolean(ch) && row.kind === 'current');
        tile.classList.toggle('is-changed', i === moved);
      });

      if (row.kind !== 'goal' || game.solved) previous = row.word;
    });
  },

  paintKeys(game, keys) {
    // Every letter stays available: any of them might be the one that changes.
    paintKeyboard(keys, {});
  },

  // --- interaction ----------------------------------------------------------

  onSelect() {
    /* rows are not individually selectable */
  },

  onKey(game, key) {
    if (game.solved) return {};

    if (key === 'DEL') return this.deleteLetter(game);
    if (key === 'ENTER') return this.commit(game);
    if (key.length !== 1 || key < 'A' || key > 'Z') return {};

    if (game.current.length >= WORD_LENGTH) return {};
    game.current += key.toLowerCase();
    return {};
  },

  deleteLetter(game) {
    if (game.current.length > 0) {
      game.current = game.current.slice(0, -1);
      return {};
    }
    if (game.rungs.length === 0) return {};

    // Backspacing off an empty row undoes the step above it, so a wrong turn
    // costs nothing and there is no separate undo to find.
    const removed = game.rungs.pop();
    return { toast: `Removed ${removed.toUpperCase()}` };
  },

  commit(game) {
    const word = game.current;

    if (word.length < WORD_LENGTH) {
      game.shake = true;
      return { toast: 'Not enough letters', clearAfter: 600 };
    }
    if (!LADDER_WORDS.has(word)) {
      game.shake = true;
      return { toast: `${word.toUpperCase()} is not in the word list`, clearAfter: 900 };
    }
    // Checked before the one-letter rule so that retyping the word you are
    // standing on says "you are already here" rather than the confusing
    // "change exactly one letter".
    if (word === game.start || game.rungs.includes(word)) {
      game.shake = true;
      return { toast: `${word.toUpperCase()} is already on the ladder`, clearAfter: 900 };
    }
    if (!differsByOne(tip(game), word)) {
      game.shake = true;
      return { toast: 'Change exactly one letter', clearAfter: 900 };
    }

    game.rungs.push(word);
    game.current = '';
    // The shell owns solved: it reads isSolved below.
    return {};
  },

  clearTransient(game) {
    game.shake = false;
  },

  move() {
    /* no cursor to move */
  },

  hint(game) {
    if (game.solved) return { toast: 'Nothing left to add' };

    const step = nextStepToward(tip(game), game.goal);
    if (!step) {
      return { toast: 'No way on from here — remove a step and try again' };
    }

    game.rungs.push(step);
    game.current = '';
    game.hintsUsed += 1;
    return { toast: `Added ${step.toUpperCase()}` };
  },

  reset(game) {
    if (game.rungs.length === 0 && !game.current) return { toast: 'Ladder is already empty' };

    const count = game.rungs.length;
    if (count > 0 && !window.confirm(`Clear ${count} step${count === 1 ? '' : 's'}?`)) {
      return {};
    }
    game.rungs = [];
    game.current = '';
    return {};
  },

  // --- outcome --------------------------------------------------------------

  isSolved(game) {
    return game.rungs.length > 0 && game.rungs[game.rungs.length - 1] === game.goal;
  },

  isLost() {
    // There is no way to fail a ladder, only to take the long way round.
    return false;
  },

  caption(game) {
    const steps = game.rungs.length;
    if (game.solved) return `${steps} step${steps === 1 ? '' : 's'} · par ${game.par}`;
    return steps === 0
      ? `Par ${game.par}`
      : `${steps} step${steps === 1 ? '' : 's'} · par ${game.par}`;
  },

  outcomeContent(game) {
    const steps = game.rungs.length;
    const chain = [game.start, ...game.rungs].map((w) => w.toUpperCase()).join(' → ');

    return {
      title: steps < game.par ? 'Under par!' : steps === game.par ? 'Perfect ladder!' : 'Solved!',
      body: chain,
      caption: `${steps} step${steps === 1 ? '' : 's'} · par ${game.par}`,
    };
  },

  /**
   * The home card's status line. Reads the snapshot directly and never touches
   * the word graph, because this runs for every game on every home paint.
   */
  statusFor(snapshot, { difficultyLabel }) {
    if (!snapshot) return { state: 'new', text: `Not started · ${difficultyLabel}`, action: 'Play' };

    const rungs = snapshot.rungs ?? [];
    const goal = LADDER_COMMON[snapshot.goalIndex];

    if (snapshot.solved || rungs[rungs.length - 1] === goal) {
      const steps = rungs.length;
      return {
        state: 'solved',
        text: `Solved in ${steps} step${steps === 1 ? '' : 's'}`,
        action: 'View',
      };
    }
    if (rungs.length === 0 && !(snapshot.current ?? '')) {
      return { state: 'new', text: `Not started · ${difficultyLabel}`, action: 'Play' };
    }
    return {
      state: 'progress',
      text: `In progress · ${rungs.length} step${rungs.length === 1 ? '' : 's'}`,
      action: 'Continue',
    };
  },
};
