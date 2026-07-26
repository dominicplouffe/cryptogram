// Fiver: scoring, keyboard state, board rules, and daily determinism.

import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_ROWS, WORD_LENGTH, fiver, keyboardStates, scoreGuess } from '../src/games/fiver.js';
import { ANSWERS, GUESSES } from '../src/words.js';

/** Compact notation: h = right place, n = in the word elsewhere, . = absent. */
const score = (guess, answer) =>
  scoreGuess(guess, answer)
    .map((s) => ({ hit: 'h', near: 'n', miss: '.' })[s])
    .join('');

// --- the word lists ---------------------------------------------------------

test('the word lists are well formed', () => {
  assert.ok(ANSWERS.length > 1500, `only ${ANSWERS.length} answers`);
  assert.ok(GUESSES.size > 4000, `only ${GUESSES.size} guesses`);

  for (const w of ANSWERS) assert.match(w, /^[a-z]{5}$/, `bad answer: ${w}`);
  for (const w of GUESSES) assert.match(w, /^[a-z]{5}$/, `bad guess: ${w}`);
  assert.equal(new Set(ANSWERS).size, ANSWERS.length, 'answers contain duplicates');
});

test('every answer is itself an acceptable guess', () => {
  // Otherwise the game could refuse to accept its own solution.
  const orphans = ANSWERS.filter((w) => !GUESSES.has(w));
  assert.deepEqual(orphans, [], `answers the game would reject: ${orphans.slice(0, 5)}`);
});

test('answers avoid plurals and past tenses', () => {
  const offenders = ANSWERS.filter((w) => /(s|ed)$/.test(w));
  assert.deepEqual(offenders, [], `tedious answers: ${offenders.slice(0, 5)}`);
});

// --- scoring ----------------------------------------------------------------

test('an exact guess is all hits', () => {
  assert.equal(score('crane', 'crane'), 'hhhhh');
});

test('a guess sharing no letters is all misses', () => {
  assert.equal(score('crumb', 'exist'), '.....');
});

test('letters in the wrong place come back near', () => {
  assert.equal(score('stone', 'notes'), 'nnnnn');
});

test('a doubled guess letter is only marked as often as the answer can supply', () => {
  // The duplicate trap. ABIDE holds exactly one E, so of SPEED's two Es only
  // the first may be marked:
  //   guess   S P E E D
  //   answer  A B I D E   -> E supply 1, D supply 1
  //   result  . . n . n   <- the second E has nothing left to claim
  assert.equal(score('speed', 'abide'), '..n.n');
  assert.equal(
    scoreGuess('speed', 'abide').filter((s) => s === 'near').length,
    2,
    'one near for the first E, one for D'
  );

  // The same guess against an answer that *does* hold two Es marks both, which
  // is why a fixed rule about duplicates would be wrong -- it depends on supply.
  //   guess   S P E E D
  //   answer  E R A S E   -> E supply 2, S supply 1
  //   result  n . n n .
  assert.equal(score('speed', 'erase'), 'n.nn.');
});

test('an exact match claims the answer letter before any amber can', () => {
  //   guess   A L L O W
  //   answer  A B L E S   -> A supply 1, L supply 1
  //   pass 1 takes A at 0 and L at 2 exactly, exhausting both
  //   result  h . h . .   <- the first L is left with nothing
  assert.equal(score('allow', 'ables'), 'h.h..');

  //   guess   L L A M A
  //   answer  P L A I T   -> L supply 1, A supply 1
  //   pass 1 takes L at 1 and A at 2, so neither leading L nor trailing A scores
  //   result  . h h . .
  assert.equal(score('llama', 'plait'), '.hh..');
});

test('ARRAY against RADAR resolves duplicates on both sides', () => {
  //   A R R A Y  vs  R A D A R
  //   idx 3 A is exact. RADAR has A:2 R:2 D:1.
  //   After exacts: A:1 R:2 left. idx0 A -> near (A:0), idx1 R -> near (R:1),
  //   idx2 R -> near (R:0), idx4 Y -> miss.
  const result = score('array', 'radar');
  assert.equal(result, 'nnnh.', `got ${result}`);
});

test('scoring never awards more marks for a letter than the answer holds', () => {
  // Property check across the real word lists: for every letter, hits plus nears
  // can never exceed that letter's count in the answer.
  const sample = ANSWERS.slice(0, 300);
  for (const answer of sample) {
    for (const guess of ['speed', 'llama', 'array', 'eeeee', 'aabbc', answer]) {
      const states = scoreGuess(guess, answer);
      const marked = new Map();
      guess.split('').forEach((ch, i) => {
        if (states[i] !== 'miss') marked.set(ch, (marked.get(ch) ?? 0) + 1);
      });
      for (const [ch, count] of marked) {
        const available = answer.split('').filter((c) => c === ch).length;
        assert.ok(
          count <= available,
          `${guess} vs ${answer}: marked ${count} of ${ch} but only ${available} exist`
        );
      }
    }
  }
});

test('scoring is stable in length and vocabulary', () => {
  for (const answer of ANSWERS.slice(0, 50)) {
    const states = scoreGuess('crane', answer);
    assert.equal(states.length, WORD_LENGTH);
    for (const s of states) assert.ok(['hit', 'near', 'miss'].includes(s));
  }
});

// --- keyboard ---------------------------------------------------------------

test('a keyboard key keeps the best state it has earned', () => {
  // First guess puts E somewhere wrong, second puts it right: it must not
  // downgrade back to amber afterwards.
  const states = keyboardStates(['erase', 'speed'], 'speed');
  assert.equal(states.E, 'hit');
  assert.equal(states.S, 'hit');
  assert.equal(states.R, 'miss');
});

test('keyboard state upgrades regardless of guess order', () => {
  const answer = 'crane';
  const forward = keyboardStates(['acorn', 'crane'], answer);
  const backward = keyboardStates(['crane', 'acorn'], answer);
  assert.equal(forward.C, 'hit');
  assert.equal(backward.C, 'hit');
});

test('an unplayed keyboard has no states', () => {
  assert.deepEqual(keyboardStates([], 'crane'), {});
});

// --- board rules ------------------------------------------------------------

const newGame = (over = {}) =>
  fiver.hydrate({
    mode: 'daily',
    difficulty: null,
    dateKey: '2026-08-01',
    seed: 1,
    answerIndex: ANSWERS.indexOf('crane') >= 0 ? ANSWERS.indexOf('crane') : 0,
    rows: [],
    current: '',
    elapsedMs: 0,
    solved: false,
    lost: false,
    ...over,
  });

const type = (game, word) => {
  for (const ch of word.toUpperCase()) fiver.onKey(game, ch);
};

test('typing fills the current row and stops at five letters', () => {
  const game = newGame();
  type(game, 'abcdefgh');
  assert.equal(game.current.length, WORD_LENGTH);
  assert.equal(game.current, 'abcde');
});

test('delete removes the last letter only', () => {
  const game = newGame();
  type(game, 'abc');
  fiver.onKey(game, 'DEL');
  assert.equal(game.current, 'ab');
});

test('a short guess is refused and the row is kept', () => {
  const game = newGame();
  type(game, 'abc');
  const result = fiver.onKey(game, 'ENTER');
  assert.match(result.toast, /Not enough letters/);
  assert.equal(game.rows.length, 0);
  assert.equal(game.current, 'abc', 'the typed letters must not be thrown away');
  assert.equal(game.shake, true);
});

test('a non-word is refused with the word named', () => {
  const game = newGame();
  type(game, 'zzzzz');
  const result = fiver.onKey(game, 'ENTER');
  assert.match(result.toast, /ZZZZZ is not in the word list/);
  assert.equal(game.rows.length, 0);
  assert.equal(game.current, 'zzzzz');
});

test('a real word commits and clears the row', () => {
  const game = newGame();
  type(game, 'stone');
  fiver.onKey(game, 'ENTER');
  assert.deepEqual(game.rows, ['stone']);
  assert.equal(game.current, '');
});

test('guessing the answer wins', () => {
  const game = newGame();
  type(game, game.answer);
  fiver.onKey(game, 'ENTER');
  assert.equal(fiver.isSolved(game), true);
  assert.equal(fiver.isLost(game), false);
});

test('committing does not set the outcome flags itself', () => {
  // The shell owns solved/lost, because it uses them to tell a board that has
  // just finished from one that was already finished when opened. A game module
  // setting them early makes the shell skip announcing the result entirely.
  const game = newGame();
  type(game, game.answer);
  fiver.onKey(game, 'ENTER');
  assert.equal(game.solved, false, 'commit must leave the flag to the shell');
  assert.equal(game.lost, false);
  assert.equal(fiver.isSolved(game), true, 'but the board itself reports the win');
});

test('six wrong guesses is a loss, and the answer is revealed', () => {
  const game = newGame();
  const wrong = [...GUESSES].filter((w) => w !== game.answer).slice(0, MAX_ROWS);

  for (const w of wrong) {
    type(game, w);
    fiver.onKey(game, 'ENTER');
  }

  assert.equal(game.rows.length, MAX_ROWS);
  assert.equal(fiver.isLost(game), true);
  assert.equal(fiver.isSolved(game), false);

  const outcome = fiver.outcomeContent(game);
  assert.equal(outcome.title, 'Out of guesses');
  assert.equal(outcome.body, game.answer.toUpperCase(), 'the answer must be shown on a loss');
});

test('a finished board ignores further input', () => {
  const game = newGame();
  type(game, game.answer);
  fiver.onKey(game, 'ENTER');
  // The shell sets this once it has announced the result.
  game.solved = true;

  type(game, 'stone');
  assert.equal(game.current, '', 'typing after the win changed the board');
  assert.equal(game.rows.length, 1);
});

test('winning on the first guess is called out', () => {
  const game = newGame();
  type(game, game.answer);
  fiver.onKey(game, 'ENTER');
  assert.equal(fiver.outcomeContent(game).title, 'First try!');
});

// --- daily and persistence --------------------------------------------------

test('the daily answer is fixed per date and varies across dates', () => {
  const a = fiver.createGame({ mode: 'daily', dateKey: '2026-08-01' });
  const b = fiver.createGame({ mode: 'daily', dateKey: '2026-08-01' });
  assert.equal(a.answer, b.answer);

  const answers = new Set();
  for (let d = 1; d <= 28; d++) {
    const key = `2026-09-${String(d).padStart(2, '0')}`;
    answers.add(fiver.createGame({ mode: 'daily', dateKey: key }).answer);
  }
  assert.ok(answers.size > 20, `only ${answers.size} distinct answers across 28 days`);
});

test('every daily answer over a long run is a real word', () => {
  for (let d = 0; d < 400; d++) {
    const date = new Date(2026, 0, 1 + d);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const game = fiver.createGame({ mode: 'daily', dateKey: key });
    assert.ok(GUESSES.has(game.answer), `${key} produced ${game.answer}`);
  }
});

test('free play varies between boards', () => {
  const seen = new Set();
  for (let i = 0; i < 30; i++) seen.add(fiver.createGame({ mode: 'free' }).answer);
  assert.ok(seen.size > 20, `only ${seen.size} distinct answers in 30 free games`);
});

test('a board round-trips through a snapshot', () => {
  const game = newGame();
  type(game, 'stone');
  fiver.onKey(game, 'ENTER');
  type(game, 'abc');
  game.elapsedMs = 12345;

  const restored = fiver.hydrate(fiver.toSnapshot(game));
  assert.equal(restored.answer, game.answer);
  assert.deepEqual(restored.rows, ['stone']);
  assert.equal(restored.current, 'abc');
  assert.equal(restored.elapsedMs, 12345);
  assert.equal(restored.solved, false);
});

test('a solved board reloads as solved even without the flag', () => {
  const game = newGame();
  const snapshot = { ...fiver.toSnapshot(game), rows: [game.answer], solved: undefined };
  const restored = fiver.hydrate(snapshot);
  assert.equal(restored.solved, true);
});

test('a lost board reloads as lost even without the flag', () => {
  const game = newGame();
  const wrong = [...GUESSES].filter((w) => w !== game.answer).slice(0, MAX_ROWS);
  const restored = fiver.hydrate({ ...fiver.toSnapshot(game), rows: wrong, lost: undefined });
  assert.equal(restored.lost, true);
  assert.equal(restored.solved, false);
});

// --- home card --------------------------------------------------------------

test('the home card reports each board state', () => {
  assert.equal(fiver.statusFor(null, {}).state, 'new');
  assert.equal(fiver.statusFor(null, {}).action, 'Play');

  const game = newGame();
  assert.equal(fiver.statusFor(fiver.toSnapshot(game), {}).state, 'new');

  type(game, 'stone');
  fiver.onKey(game, 'ENTER');
  const progress = fiver.statusFor(fiver.toSnapshot(game), {});
  assert.equal(progress.state, 'progress');
  assert.match(progress.text, /1 of 6 guesses/);
  assert.equal(progress.action, 'Continue');

  type(game, game.answer);
  fiver.onKey(game, 'ENTER');
  const solved = fiver.statusFor(fiver.toSnapshot(game), {});
  assert.equal(solved.state, 'solved');
  assert.match(solved.text, /Solved in 2 of 6/);
  assert.equal(solved.action, 'View');
});

test('a part-typed row counts as in progress', () => {
  const game = newGame();
  type(game, 'ab');
  assert.equal(fiver.statusFor(fiver.toSnapshot(game), {}).state, 'progress');
});

test('Fiver declares no difficulty levels', () => {
  assert.equal(fiver.difficulties, null);
  assert.deepEqual(fiver.tools, ['new']);
  assert.equal(fiver.keyboard.enter, true);
});
