// State logic tests. These run without a DOM: every localStorage access in
// state.js is guarded, so in Node the reads fall back to defaults and the
// writes silently no-op, which is exactly the Safari-private-mode path.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DIFFICULTIES,
  createGame,
  effectiveStreak,
  formatTime,
  hydrateGame,
  loadStats,
  previousDateKey,
  recordSolve,
} from '../src/state.js';
import { QUOTES } from '../src/quotes.js';
import { distinctLetters, isSolved } from '../src/cipher.js';

test('previousDateKey walks back across month and year boundaries', () => {
  assert.equal(previousDateKey('2026-07-25'), '2026-07-24');
  assert.equal(previousDateKey('2026-07-01'), '2026-06-30');
  assert.equal(previousDateKey('2026-01-01'), '2025-12-31');
  assert.equal(previousDateKey('2024-03-01'), '2024-02-29'); // leap year
});

test('formatTime renders M:SS and rolls into hours', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(9000), '0:09');
  assert.equal(formatTime(65000), '1:05');
  assert.equal(formatTime(600000), '10:00');
  assert.equal(formatTime(3661000), '1:01:01');
  assert.equal(formatTime(-500), '0:00');
});

test('daily puzzles are identical for the same date and difficulty', () => {
  const a = createGame({ mode: 'daily', difficulty: 'medium', dateKey: '2026-07-25' });
  const b = createGame({ mode: 'daily', difficulty: 'medium', dateKey: '2026-07-25' });
  assert.equal(a.cipher, b.cipher);
  assert.equal(a.plain, b.plain);
  assert.deepEqual(a.solution, b.solution);
});

test('daily puzzles differ from one day to the next', () => {
  const today = createGame({ mode: 'daily', difficulty: 'medium', dateKey: '2026-07-25' });
  const tomorrow = createGame({ mode: 'daily', difficulty: 'medium', dateKey: '2026-07-26' });
  assert.notEqual(today.cipher, tomorrow.cipher);
});

test('each difficulty prefills the expected number of letters', () => {
  for (const [difficulty, config] of Object.entries(DIFFICULTIES)) {
    for (let day = 1; day <= 20; day++) {
      const dateKey = `2026-07-${String(day).padStart(2, '0')}`;
      const game = createGame({ mode: 'daily', difficulty, dateKey });
      const distinct = distinctLetters(game.cipher).length;
      const expected = Math.min(
        Math.round(distinct * config.prefillRatio),
        Math.max(distinct - 2, 0)
      );

      assert.equal(game.locked.size, expected, `${difficulty} ${dateKey}`);
      // At least two letters must remain for the player to deduce.
      assert.ok(game.locked.size <= distinct - 2 || distinct < 2, `${difficulty}: nothing left`);
      // Prefilled letters are pre-answered, and answered correctly.
      for (const letter of game.locked) {
        assert.equal(game.guesses[letter], game.solution[letter]);
      }
    }
  }
  assert.equal(
    createGame({ mode: 'daily', difficulty: 'hard', dateKey: '2026-07-25' }).locked.size,
    0
  );
});

test('a prefilled game is never already solved', () => {
  for (let day = 1; day <= 20; day++) {
    const game = createGame({
      mode: 'daily',
      difficulty: 'easy',
      dateKey: `2026-08-${String(day).padStart(2, '0')}`,
    });
    assert.equal(isSolved(game.cipher, game.guesses, game.solution), false);
  }
});

test('hydrateGame restores guesses and rebuilds an identical puzzle', () => {
  const original = createGame({ mode: 'free', difficulty: 'medium', dateKey: '2026-07-25' });
  const letter = original.letters.find((l) => !original.locked.has(l));
  original.guesses[letter] = 'Q';

  const restored = hydrateGame({
    mode: original.mode,
    difficulty: original.difficulty,
    dateKey: original.dateKey,
    seed: original.seed,
    quoteIndex: original.quoteIndex,
    guesses: original.guesses,
    locked: [...original.locked],
    hintsUsed: 3,
    checksUsed: 1,
    elapsedMs: 42000,
    solved: false,
  });

  assert.equal(restored.cipher, original.cipher);
  assert.deepEqual(restored.solution, original.solution);
  assert.equal(restored.guesses[letter], 'Q');
  assert.equal(restored.hintsUsed, 3);
  assert.equal(restored.elapsedMs, 42000);
  assert.deepEqual([...restored.locked], [...original.locked]);
});

test('hydrateGame forces locked letters to their correct value', () => {
  const game = createGame({ mode: 'free', difficulty: 'easy', dateKey: '2026-07-25' });
  const lockedLetter = [...game.locked][0];

  // A tampered save claiming a wrong answer for a locked letter must be ignored.
  const restored = hydrateGame({
    ...game,
    locked: [...game.locked],
    guesses: { ...game.guesses, [lockedLetter]: 'Z' },
  });
  assert.equal(restored.guesses[lockedLetter], game.solution[lockedLetter]);
});

test('free-play games vary between calls', () => {
  const seeds = new Set();
  for (let i = 0; i < 25; i++) {
    seeds.add(createGame({ mode: 'free', difficulty: 'medium' }).seed);
  }
  assert.ok(seeds.size > 20, `expected varied seeds, got ${seeds.size}/25`);
});

test('every quote in the pack builds a playable puzzle', () => {
  QUOTES.forEach((quote, index) => {
    const game = hydrateGame({
      mode: 'free',
      difficulty: 'medium',
      dateKey: '2026-07-25',
      seed: 1000 + index,
      quoteIndex: index,
      guesses: {},
      locked: null,
      hintsUsed: 0,
      checksUsed: 0,
      elapsedMs: 0,
      solved: false,
    });
    assert.ok(game.letters.length >= 5, `quote ${index} has too few distinct letters`);
    assert.equal(game.cipher.length, game.plain.length);
    assert.equal(isSolved(game.cipher, game.solution, game.solution), true);
  });
});

test('streak increments on consecutive days and resets after a gap', () => {
  let stats = loadStats();

  stats = recordSolve(stats, {
    mode: 'daily', difficulty: 'medium', elapsedMs: 60000, hintsUsed: 0, dateKey: '2026-07-25',
  });
  assert.equal(stats.currentStreak, 1);
  assert.equal(stats.solved, 1);

  stats = recordSolve(stats, {
    mode: 'daily', difficulty: 'medium', elapsedMs: 60000, hintsUsed: 0, dateKey: '2026-07-26',
  });
  assert.equal(stats.currentStreak, 2);
  assert.equal(stats.maxStreak, 2);

  // Skipping 07-27 breaks the run.
  stats = recordSolve(stats, {
    mode: 'daily', difficulty: 'medium', elapsedMs: 60000, hintsUsed: 0, dateKey: '2026-07-28',
  });
  assert.equal(stats.currentStreak, 1);
  assert.equal(stats.maxStreak, 2, 'max streak must survive a reset');
});

test('solving the same daily twice does not double count the streak', () => {
  let stats = loadStats();
  const result = {
    mode: 'daily', difficulty: 'medium', elapsedMs: 60000, hintsUsed: 0, dateKey: '2026-07-25',
  };
  stats = recordSolve(stats, result);
  stats = recordSolve(stats, result);
  assert.equal(stats.currentStreak, 1);
});

test('free play does not affect the daily streak', () => {
  let stats = loadStats();
  stats = recordSolve(stats, {
    mode: 'free', difficulty: 'medium', elapsedMs: 60000, hintsUsed: 0, dateKey: '2026-07-25',
  });
  assert.equal(stats.currentStreak, 0);
  assert.equal(stats.lastDailySolved, null);
  assert.equal(stats.solved, 1);
});

test('best time records only hint-free solves, and only improvements', () => {
  let stats = loadStats();

  stats = recordSolve(stats, {
    mode: 'free', difficulty: 'easy', elapsedMs: 90000, hintsUsed: 2, dateKey: '2026-07-25',
  });
  assert.equal(stats.bestTimes.easy, null, 'a hinted solve must not set a record');

  stats = recordSolve(stats, {
    mode: 'free', difficulty: 'easy', elapsedMs: 80000, hintsUsed: 0, dateKey: '2026-07-25',
  });
  assert.equal(stats.bestTimes.easy, 80000);

  stats = recordSolve(stats, {
    mode: 'free', difficulty: 'easy', elapsedMs: 95000, hintsUsed: 0, dateKey: '2026-07-25',
  });
  assert.equal(stats.bestTimes.easy, 80000, 'a slower solve must not overwrite');

  stats = recordSolve(stats, {
    mode: 'free', difficulty: 'easy', elapsedMs: 50000, hintsUsed: 0, dateKey: '2026-07-25',
  });
  assert.equal(stats.bestTimes.easy, 50000);
  assert.equal(stats.bestTimes.medium, null, 'difficulties track separately');
});

test('effectiveStreak lapses once a day is missed', () => {
  const stats = { ...loadStats(), currentStreak: 5, lastDailySolved: '2026-07-25' };
  assert.equal(effectiveStreak(stats, '2026-07-25'), 5, 'solved today');
  assert.equal(effectiveStreak(stats, '2026-07-26'), 5, 'still alive the next day');
  assert.equal(effectiveStreak(stats, '2026-07-27'), 0, 'lapsed after a missed day');
  assert.equal(effectiveStreak({ ...loadStats(), lastDailySolved: null }, '2026-07-25'), 0);
});
