// Fiver: find a five-letter word in six guesses.

import { hashString, localDateKey, pickBySeed } from '../cipher.js';
import { ANSWERS, GUESSES } from '../words.js';
import { QWERTY_ROWS, paintKeyboard } from '../render.js';
import { formatTime } from '../store.js';

export const WORD_LENGTH = 5;
export const MAX_ROWS = 6;

/**
 * Score a guess against the answer.
 *
 * Two passes, and this is the detail most implementations get wrong: exact
 * positions are claimed first and decrement a tally of the answer's remaining
 * letters, and only then can leftovers be marked as present-elsewhere. A single
 * pass would report SPEED against ERASE as two ambers for E when the answer only
 * has one E left to give.
 *
 * @param {string} guess
 * @param {string} answer
 * @returns {Array<'hit'|'near'|'miss'>}
 */
export function scoreGuess(guess, answer) {
  const states = new Array(guess.length).fill('miss');
  const remaining = new Map();

  for (const ch of answer) remaining.set(ch, (remaining.get(ch) ?? 0) + 1);

  for (let i = 0; i < guess.length; i++) {
    if (guess[i] !== answer[i]) continue;
    states[i] = 'hit';
    remaining.set(guess[i], remaining.get(guess[i]) - 1);
  }

  for (let i = 0; i < guess.length; i++) {
    if (states[i] === 'hit') continue;
    const left = remaining.get(guess[i]) ?? 0;
    if (left > 0) {
      states[i] = 'near';
      remaining.set(guess[i], left - 1);
    }
  }

  return states;
}

/** hit beats near beats miss, so a letter's key never downgrades. */
const RANK = { miss: 0, near: 1, hit: 2 };

/**
 * Best state each letter has earned across every committed guess.
 * @param {string[]} rows
 * @param {string} answer
 * @returns {Record<string, 'hit'|'near'|'miss'>}
 */
export function keyboardStates(rows, answer) {
  const states = {};
  for (const row of rows) {
    const scored = scoreGuess(row, answer);
    row.split('').forEach((ch, i) => {
      const key = ch.toUpperCase();
      if (!states[key] || RANK[scored[i]] > RANK[states[key]]) states[key] = scored[i];
    });
  }
  return states;
}

const GLYPH = { hit: 'correct', near: 'wrong place', miss: 'not in the word' };

/** The answer this seed draws. A pure function of the seed and the pool. */
function answerFor(seed) {
  return pickBySeed(ANSWERS, seed);
}

export const fiver = {
  id: 'fiver',
  name: 'Fiver',
  blurb: 'Find the five-letter word in six guesses.',
  category: 'Guessing',
  icon: `<svg viewBox="0 0 512 512">
      <rect x="52" y="112" width="118" height="118" rx="20" />
      <rect x="197" y="112" width="118" height="118" rx="20" class="dim" />
      <rect x="342" y="112" width="118" height="118" rx="20" />
      <rect x="52" y="282" width="118" height="118" rx="20" class="dim" />
      <rect x="197" y="282" width="118" height="118" rx="20" />
      <rect x="342" y="282" width="118" height="118" rx="20" class="dim" />
    </svg>`,

  // No difficulty control: the word length and guess count are the difficulty.
  difficulties: null,
  defaultDifficulty: null,
  tools: ['new'],
  keyboard: { rows: QWERTY_ROWS, del: true, enter: true },

  howTo: [
    'Guess a five-letter word in six tries. Type it in and press Enter.',
    'Green means the letter is in the right place. Amber means it is in the word but somewhere else. Grey means it is not in the word at all.',
    'A green tile also carries a dot and an amber one a ring, so the result reads without relying on colour.',
    'Any real five-letter word is accepted as a guess, but the answer is always a reasonably common one.',
  ],

  // --- construction ---------------------------------------------------------

  createGame({ mode, dateKey = localDateKey(), seed }) {
    const resolvedSeed =
      seed ??
      (mode === 'daily' ? hashString(`fiver|${dateKey}`) : Math.floor(Math.random() * 0xffffffff));
    // The answer is derived from the seed, not stored as an index into ANSWERS.
    // An index is a position, and a position moves the moment a word is added to
    // or removed from the pool -- which would repoint every saved game at a
    // different answer. The seed is the identifier; see orderBySeed in cipher.js.
    return this.hydrate({
      mode,
      difficulty: null,
      dateKey,
      seed: resolvedSeed,
      rows: [],
      current: '',
      elapsedMs: 0,
      solved: false,
      lost: false,
    });
  },

  hydrate(snapshot) {
    const answer = answerFor(snapshot.seed);
    const rows = (snapshot.rows ?? []).slice(0, MAX_ROWS);

    return {
      gameId: 'fiver',
      mode: snapshot.mode,
      difficulty: null,
      dateKey: snapshot.dateKey,
      seed: snapshot.seed,
      answer,
      rows,
      current: (snapshot.current ?? '').slice(0, WORD_LENGTH),
      elapsedMs: snapshot.elapsedMs ?? 0,
      solved: snapshot.solved ?? rows.includes(answer),
      lost: snapshot.lost ?? (rows.length >= MAX_ROWS && !rows.includes(answer)),
      // transient
      shake: false,
      cells: null,
    };
  },

  toSnapshot(game) {
    return {
      mode: game.mode,
      difficulty: null,
      dateKey: game.dateKey,
      seed: game.seed,
      rows: game.rows,
      current: game.current,
      elapsedMs: game.elapsedMs,
      solved: game.solved,
      lost: game.lost,
    };
  },

  // --- rendering ------------------------------------------------------------

  mount(root, game) {
    root.textContent = '';
    const board = document.createElement('div');
    board.className = 'fiver-board';

    game.cells = [];
    for (let r = 0; r < MAX_ROWS; r++) {
      const row = document.createElement('div');
      row.className = 'fiver-row';
      row.dataset.row = String(r);
      const tiles = [];
      for (let c = 0; c < WORD_LENGTH; c++) {
        const tile = document.createElement('span');
        tile.className = 'tile';
        row.appendChild(tile);
        tiles.push(tile);
      }
      board.appendChild(row);
      game.cells.push({ row, tiles });
    }

    root.appendChild(board);
  },

  paint(game) {
    game.cells.forEach(({ row, tiles }, r) => {
      const committed = r < game.rows.length;
      const isCurrent = r === game.rows.length && !game.solved && !game.lost;
      const text = committed ? game.rows[r] : isCurrent ? game.current : '';
      const states = committed ? scoreGuess(game.rows[r], game.answer) : null;

      row.classList.toggle('shake', isCurrent && game.shake);

      tiles.forEach((tile, c) => {
        const ch = (text[c] ?? '').toUpperCase();
        if (tile.textContent !== ch) tile.textContent = ch;

        const state = states ? states[c] : null;
        tile.classList.toggle('tile-hit', state === 'hit');
        tile.classList.toggle('tile-near', state === 'near');
        tile.classList.toggle('tile-miss', state === 'miss');
        tile.classList.toggle('tile-filled', Boolean(ch) && !state);

        // Colour alone excludes colour-blind players, so committed tiles carry a
        // shape marker as well and announce themselves to screen readers.
        if (state) {
          tile.dataset.state = state;
          tile.setAttribute('aria-label', `${ch}, ${GLYPH[state]}`);
        } else {
          delete tile.dataset.state;
          tile.removeAttribute('aria-label');
        }
      });
    });
  },

  paintKeys(game, keys) {
    paintKeyboard(keys, keyboardStates(game.rows, game.answer));
  },

  // --- interaction ----------------------------------------------------------

  onSelect() {
    /* tiles are not individually selectable */
  },

  onKey(game, key) {
    if (game.solved || game.lost) return {};

    if (key === 'DEL') {
      game.current = game.current.slice(0, -1);
      return {};
    }
    if (key === 'ENTER') return this.commit(game);
    if (key.length !== 1 || key < 'A' || key > 'Z') return {};

    if (game.current.length >= WORD_LENGTH) return {};
    game.current += key.toLowerCase();
    return {};
  },

  commit(game) {
    if (game.current.length < WORD_LENGTH) {
      game.shake = true;
      return { toast: 'Not enough letters', clearAfter: 600 };
    }
    if (!GUESSES.has(game.current)) {
      game.shake = true;
      return { toast: `${game.current.toUpperCase()} is not in the word list`, clearAfter: 900 };
    }

    game.rows.push(game.current);
    game.current = '';

    // Deliberately not setting game.solved / game.lost here. The shell owns those
    // flags and uses them to tell "just finished" from "was already finished when
    // opened"; setting them early made it skip announcing the result.
    // isSolved and isLost below read the board, so nothing is lost by waiting.
    return {};
  },

  clearTransient(game) {
    game.shake = false;
  },

  move() {
    /* no cursor to move */
  },

  // --- outcome --------------------------------------------------------------

  isSolved(game) {
    return game.rows.includes(game.answer);
  },

  isLost(game) {
    return game.rows.length >= MAX_ROWS && !game.rows.includes(game.answer);
  },

  caption(game) {
    if (game.solved) return `${game.rows.length} of ${MAX_ROWS} guesses`;
    if (game.lost) return `The word was ${game.answer.toUpperCase()}`;
    return '';
  },

  outcomeContent(game) {
    if (this.isSolved(game)) {
      return {
        title: game.rows.length === 1 ? 'First try!' : 'Solved!',
        body: game.answer.toUpperCase(),
        caption: `in ${game.rows.length} of ${MAX_ROWS} guesses`,
      };
    }
    return {
      title: 'Out of guesses',
      body: game.answer.toUpperCase(),
      caption: 'That was the word.',
    };
  },

  statusFor(snapshot) {
    if (!snapshot) return { state: 'new', text: 'Not started', action: 'Play' };
    const rows = snapshot.rows ?? [];
    const answer = answerFor(snapshot.seed);

    if (snapshot.solved || rows.includes(answer)) {
      return {
        state: 'solved',
        text: `Solved in ${rows.length} of ${MAX_ROWS} · ${formatTime(snapshot.elapsedMs ?? 0)}`,
        action: 'View',
      };
    }
    if (snapshot.lost || rows.length >= MAX_ROWS) {
      return { state: 'lost', text: 'Out of guesses', action: 'View' };
    }
    if (rows.length === 0 && !(snapshot.current ?? '')) {
      return { state: 'new', text: 'Not started', action: 'Play' };
    }
    return {
      state: 'progress',
      text: `In progress · ${rows.length} of ${MAX_ROWS} guesses`,
      action: 'Continue',
    };
  },
};
