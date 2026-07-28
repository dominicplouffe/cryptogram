// Cryptogram and Missing Vowels: construction, rules, persistence, and the
// contract every game module has to satisfy.

import test from 'node:test';
import assert from 'node:assert/strict';

import { cryptogram } from '../src/games/cryptogram.js';
import { vowels, stripVowels, vowelSlots, VOWELS } from '../src/games/vowels.js';
import { fiver } from '../src/games/fiver.js';
import { ladder } from '../src/games/ladder.js';
import { search } from '../src/games/search.js';
import { wheel, solutionsFor, targetFor } from '../src/games/wheel.js';
import { boxed, BOX_LETTERS, MIN_WORD as BOX_MIN, rejectionFor } from '../src/games/boxed.js';
import { hidden, lettersIn, livesFor } from '../src/games/hidden.js';
import {
  ANSWERS, LADDER_COMMON, LADDER_WORDS, SEARCH_WORDS, WHEEL_SOURCES, WORDS,
} from '../src/words.js';
import { QUOTES } from '../src/quotes.js';
import { distinctLetters } from '../src/cipher.js';

const GAMES = [cryptogram, fiver, vowels, hidden, ladder, wheel, boxed, search];

// --- the shared contract ----------------------------------------------------

test('every game satisfies the module contract', () => {
  const required = [
    'id', 'name', 'blurb', 'category', 'icon', 'hue', 'howTo', 'tools', 'keyboard',
    'createGame', 'hydrate', 'toSnapshot', 'mount', 'paint', 'paintKeys',
    'onKey', 'onSelect', 'move', 'clearTransient',
    'isSolved', 'isLost', 'caption', 'outcomeContent', 'statusFor', 'shareLines',
  ];

  // The hues styles.css actually defines. A typo here is an invisible failure:
  // var(--hue-nope) resolves to nothing and the mark silently goes black.
  const HUES = ['coral', 'tangerine', 'magenta', 'mint', 'cyan', 'violet', 'amber', 'azure'];

  for (const mod of GAMES) {
    for (const key of required) {
      assert.ok(mod[key] !== undefined, `${mod.id} is missing ${key}`);
    }
    assert.ok(Array.isArray(mod.tools), `${mod.id}.tools`);
    assert.ok(HUES.includes(mod.hue), `${mod.id}.hue "${mod.hue}" is not a defined --hue-*`);
    // keyboard is either a layout or explicitly null (Word Search plays on the board).
    assert.ok(
      mod.keyboard === null || Array.isArray(mod.keyboard.rows),
      `${mod.id}.keyboard`
    );
    // difficulties is either a map of levels or explicitly null.
    assert.ok(
      mod.difficulties === null || typeof mod.difficulties === 'object',
      `${mod.id}.difficulties`
    );
    if (mod.difficulties) {
      assert.ok(mod.difficulties[mod.defaultDifficulty], `${mod.id} default not in difficulties`);
    }
  }
});

test('every game writes a usable share card', () => {
  // The card is spoiler-free by contract: no game may put its quote, answer or
  // any hidden word in it. Checked against a board in its just-created state,
  // which is the least information a card can carry.
  for (const mod of GAMES) {
    const difficulty = mod.difficulties ? mod.defaultDifficulty : null;
    const game = mod.createGame({ mode: 'daily', difficulty, dateKey: '2026-08-01' });
    const lines = mod.shareLines(game);

    assert.ok(Array.isArray(lines) && lines.length >= 1, `${mod.id}.shareLines`);
    for (const line of lines) {
      assert.equal(typeof line, 'string', `${mod.id}: a share line is not a string`);
      assert.ok(!line.includes('\n'), `${mod.id}: one line per array entry`);
    }

    const card = lines.join('\n').toUpperCase();
    // The obvious leaks. Ladder's endpoints are public and allowed.
    if (game.answer) assert.ok(!card.includes(game.answer.toUpperCase()), `${mod.id} leaks its answer`);
    if (game.plain) {
      const firstWord = game.plain.split(' ')[0];
      if (firstWord.length >= 4) assert.ok(!card.includes(firstWord), `${mod.id} leaks its quote`);
    }
    if (game.placed) {
      for (const entry of game.placed) {
        assert.ok(!card.includes(entry.word.toUpperCase()), `${mod.id} leaks ${entry.word}`);
      }
    }
  }
});

test('game ids are unique', () => {
  const ids = GAMES.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every game carries rules the sheet can render', () => {
  // The per-game sheet is the only place the rules appear, so a game that ships
  // without them ships unexplained. Rendered with textContent, hence no markup.
  for (const mod of GAMES) {
    assert.ok(mod.howTo.length >= 2, `${mod.id} needs at least two lines of rules`);
    for (const line of mod.howTo) {
      assert.equal(typeof line, 'string', `${mod.id}: a rule line is not a string`);
      assert.ok(line.length > 20, `${mod.id}: "${line}" is too short to be a rule`);
      assert.ok(!/[<>]/.test(line), `${mod.id}: rules are plain prose, not markup`);
    }
  }
});

test('category labels are short enough for a filter chip', () => {
  for (const mod of GAMES) {
    assert.match(mod.category, /^[A-Z][A-Za-z ]{2,11}$/, `${mod.id}.category`);
  }
});

test('a board built by any game round-trips through its snapshot', () => {
  for (const mod of GAMES) {
    const difficulty = mod.difficulties ? mod.defaultDifficulty : null;
    const game = mod.createGame({ mode: 'daily', difficulty, dateKey: '2026-08-01' });
    const restored = mod.hydrate(mod.toSnapshot(game));

    assert.equal(restored.mode, game.mode, `${mod.id}: mode`);
    assert.equal(restored.dateKey, game.dateKey, `${mod.id}: dateKey`);
    assert.equal(restored.solved, game.solved, `${mod.id}: solved`);
    assert.equal(mod.isSolved(restored), mod.isSolved(game), `${mod.id}: solved state differs`);
  }
});

test('a snapshot carries no derived puzzle text', () => {
  // Rebuilding from an identifier is what keeps a saved board from disagreeing
  // with its own puzzle.
  for (const mod of GAMES) {
    const difficulty = mod.difficulties ? mod.defaultDifficulty : null;
    const snap = mod.toSnapshot(mod.createGame({ mode: 'daily', difficulty, dateKey: '2026-08-01' }));
    const serialised = JSON.stringify(snap);
    assert.ok(!('cipher' in snap), `${mod.id} stored its cipher`);
    assert.ok(!('plain' in snap), `${mod.id} stored its plaintext`);
    assert.ok(!('answer' in snap), `${mod.id} stored its answer`);
    assert.ok(!('solution' in snap), `${mod.id} stored its solution`);
    assert.equal(serialised, JSON.stringify(JSON.parse(serialised)), `${mod.id} not serialisable`);
  }
});

test('a daily board is identical for the same date and differs across dates', () => {
  for (const mod of GAMES) {
    const difficulty = mod.difficulties ? mod.defaultDifficulty : null;
    const a = mod.createGame({ mode: 'daily', difficulty, dateKey: '2026-08-01' });
    const b = mod.createGame({ mode: 'daily', difficulty, dateKey: '2026-08-01' });
    assert.deepEqual(mod.toSnapshot(a), mod.toSnapshot(b), `${mod.id} is not stable per day`);

    const c = mod.createGame({ mode: 'daily', difficulty, dateKey: '2026-08-02' });
    assert.notDeepEqual(mod.toSnapshot(a), mod.toSnapshot(c), `${mod.id} repeats the next day`);
  }
});

test('every game seeds its daily differently from the others', () => {
  // Sharing the date as a seed without namespacing would correlate the games,
  // e.g. always drawing the same quote index on the same day.
  const day = '2026-08-01';
  const crypto = cryptogram.createGame({ mode: 'daily', difficulty: 'medium', dateKey: day });
  const vow = vowels.createGame({ mode: 'daily', difficulty: 'medium', dateKey: day });
  assert.notEqual(crypto.seed, vow.seed, 'Cryptogram and Missing Vowels share a seed');
});

// --- Cryptogram -------------------------------------------------------------

test('Cryptogram prefills by difficulty and always leaves work to do', () => {
  for (const [difficulty, ratio] of [['easy', 0.3], ['medium', 0.15], ['hard', 0]]) {
    for (let d = 1; d <= 15; d++) {
      const dateKey = `2026-08-${String(d).padStart(2, '0')}`;
      const game = cryptogram.createGame({ mode: 'daily', difficulty, dateKey });
      const distinct = distinctLetters(game.cipher).length;
      const expected = Math.min(Math.round(distinct * ratio), Math.max(distinct - 2, 0));

      assert.equal(game.locked.size, expected, `${difficulty} ${dateKey}`);
      assert.equal(cryptogram.isSolved(game), false, `${difficulty} ${dateKey} arrived solved`);
      for (const code of game.locked) {
        assert.equal(game.guesses[code], game.solution[code], 'a revealed letter is wrong');
      }
    }
  }
});

test('Cryptogram assigns a letter to every instance of a code at once', () => {
  const game = cryptogram.createGame({ mode: 'daily', difficulty: 'hard', dateKey: '2026-08-01' });
  const code = game.cipher[game.selectedIndex];
  cryptogram.onKey(game, 'Q');
  assert.equal(game.guesses[code], 'Q');
});

test('Cryptogram refuses to overwrite a revealed letter', () => {
  const game = cryptogram.createGame({ mode: 'daily', difficulty: 'easy', dateKey: '2026-08-01' });
  const lockedCode = [...game.locked][0];
  const before = game.guesses[lockedCode];

  game.selectedIndex = game.cipher.indexOf(lockedCode);
  const result = cryptogram.onKey(game, 'Q');
  assert.match(result.toast, /already revealed/);
  assert.equal(game.guesses[lockedCode], before);

  // The rejected keystroke correctly advances past the locked cell, so it has to
  // be reselected before testing delete against it.
  game.selectedIndex = game.cipher.indexOf(lockedCode);
  const del = cryptogram.deleteLetter(game);
  assert.match(del.toast, /cannot be cleared/);
  assert.equal(game.guesses[lockedCode], before);
});

test('Cryptogram hint reveals, locks, and counts', () => {
  const game = cryptogram.createGame({ mode: 'daily', difficulty: 'hard', dateKey: '2026-08-01' });
  const result = cryptogram.hint(game);
  assert.match(result.toast, /Revealed/);
  assert.equal(game.hintsUsed, 1);
  assert.equal(game.locked.size, 1);

  const code = [...game.locked][0];
  assert.equal(game.guesses[code], game.solution[code]);
});

test('Cryptogram check finds exactly the wrong letters', () => {
  const game = cryptogram.createGame({ mode: 'daily', difficulty: 'hard', dateKey: '2026-08-01' });
  assert.match(cryptogram.check(game).toast, /Nothing to check/);

  const code = game.letters[0];
  const wrongLetter = game.solution[code] === 'Z' ? 'Q' : 'Z';
  game.guesses[code] = wrongLetter;
  const result = cryptogram.check(game);
  assert.match(result.toast, /1 letter is wrong/);
  assert.deepEqual([...game.wrongLetters], [code]);

  game.guesses[code] = game.solution[code];
  assert.match(cryptogram.check(game).toast, /All correct so far/);
});

test('Cryptogram is solved only when every letter is right', () => {
  const game = cryptogram.createGame({ mode: 'daily', difficulty: 'hard', dateKey: '2026-08-01' });
  assert.equal(cryptogram.isSolved(game), false);

  for (const code of game.letters) game.guesses[code] = game.solution[code];
  assert.equal(cryptogram.isSolved(game), true);
  assert.equal(cryptogram.isLost(game), false);
});

test('Cryptogram never loses', () => {
  const game = cryptogram.createGame({ mode: 'daily', difficulty: 'hard', dateKey: '2026-08-01' });
  assert.equal(cryptogram.isLost(game), false);
});

test('Cryptogram shows the quote in its original casing when won', () => {
  const game = cryptogram.createGame({ mode: 'daily', difficulty: 'hard', dateKey: '2026-08-01' });
  const outcome = cryptogram.outcomeContent(game);
  assert.equal(outcome.body.toUpperCase(), game.plain);
  assert.notEqual(outcome.body, game.plain, 'the win sheet should not shout');
});

test('Cryptogram home card reports progress in letters', () => {
  assert.equal(cryptogram.statusFor(null, { difficultyLabel: 'Medium' }).state, 'new');

  const game = cryptogram.createGame({ mode: 'daily', difficulty: 'hard', dateKey: '2026-08-01' });
  assert.equal(cryptogram.statusFor(cryptogram.toSnapshot(game), { difficultyLabel: 'Hard' }).state, 'new');

  cryptogram.onKey(game, 'Q');
  const progress = cryptogram.statusFor(cryptogram.toSnapshot(game), { difficultyLabel: 'Hard' });
  assert.equal(progress.state, 'progress');
  assert.match(progress.text, /1 of \d+ letters/);
});

// --- Missing Vowels ---------------------------------------------------------

test('Y is never treated as a vowel', () => {
  assert.equal(VOWELS.includes('Y'), false);
  assert.equal(stripVowels('RHYTHM'), 'RHYTHM', 'a word of consonants and Y is untouched');
  assert.equal(stripVowels('MYTH'), 'MYTH');
  assert.equal(stripVowels('EVERYONE'), '_V_RY_N_');
});

test('stripVowels removes exactly the five vowels and nothing else', () => {
  assert.equal(stripVowels("IT'S A TEST, OK?"), "_T'S _ T_ST, _K?");
  const text = 'THE QUICK BROWN FOX';
  assert.equal(stripVowels(text).length, text.length, 'length must be preserved');
});

test('vowelSlots finds every vowel position', () => {
  assert.deepEqual(vowelSlots('ABE'), [0, 2]);
  assert.deepEqual(vowelSlots('XYZ'), []);
  const text = 'MISSING VOWELS';
  for (const i of vowelSlots(text)) assert.ok(VOWELS.includes(text[i]));
});

test('every quote in the pack makes a playable Missing Vowels board', () => {
  QUOTES.forEach((quote, index) => {
    const game = vowels.hydrate({
      mode: 'free', difficulty: 'medium', dateKey: '2026-08-01', seed: 1,
      quoteIndex: index, filled: {}, locked: [], hintsUsed: 0, checksUsed: 0,
      elapsedMs: 0, solved: false,
    });
    assert.ok(game.slots.length >= 3, `quote ${index} has only ${game.slots.length} vowels`);
    assert.equal(vowels.isSolved(game), false, `quote ${index} arrived solved`);
  });
});

test('Missing Vowels starts empty and fills one slot at a time', () => {
  const game = vowels.createGame({ mode: 'daily', difficulty: 'medium', dateKey: '2026-08-01' });
  assert.equal(Object.keys(game.filled).length, 0, 'no vowels are given away');

  const first = game.selectedIndex;
  vowels.onKey(game, 'A');
  assert.equal(game.filled[first], 'A');
  // Each blank is independent, unlike Cryptogram: one entry must not fill others.
  assert.equal(Object.keys(game.filled).length, 1);
});

test('Missing Vowels ignores consonants', () => {
  const game = vowels.createGame({ mode: 'daily', difficulty: 'medium', dateKey: '2026-08-01' });
  const slot = game.selectedIndex;
  vowels.onKey(game, 'Z');
  assert.equal(game.filled[slot], undefined);
});

test('Missing Vowels selection advances and delete steps back', () => {
  const game = vowels.createGame({ mode: 'daily', difficulty: 'medium', dateKey: '2026-08-01' });
  const first = game.selectedIndex;
  vowels.onKey(game, 'A');
  assert.notEqual(game.selectedIndex, first, 'selection did not advance');

  game.selectedIndex = first;
  vowels.onKey(game, 'DEL');
  assert.equal(game.filled[first], undefined);
});

test('Missing Vowels hint reveals the correct vowel and locks it', () => {
  const game = vowels.createGame({ mode: 'daily', difficulty: 'medium', dateKey: '2026-08-01' });
  const result = vowels.hint(game);
  assert.match(result.toast, /Revealed [AEIOU]/);
  assert.equal(game.hintsUsed, 1);

  const slot = [...game.locked][0];
  assert.equal(game.filled[slot], game.plain[slot]);
});

test('Missing Vowels check flags only the wrong vowels', () => {
  const game = vowels.createGame({ mode: 'daily', difficulty: 'medium', dateKey: '2026-08-01' });
  assert.match(vowels.check(game).toast, /Nothing to check/);

  const slot = game.slots[0];
  game.filled[slot] = game.plain[slot] === 'A' ? 'E' : 'A';
  assert.match(vowels.check(game).toast, /1 vowel is wrong/);
  assert.deepEqual([...game.wrongSlots], [slot]);

  game.filled[slot] = game.plain[slot];
  assert.match(vowels.check(game).toast, /All correct so far/);
});

test('Missing Vowels is solved when every slot holds its own vowel', () => {
  const game = vowels.createGame({ mode: 'daily', difficulty: 'medium', dateKey: '2026-08-01' });
  assert.equal(vowels.isSolved(game), false);

  for (const slot of game.slots) game.filled[slot] = game.plain[slot];
  assert.equal(vowels.isSolved(game), true);
  assert.equal(vowels.isLost(game), false);
});

test('Missing Vowels is not solved by the right vowels in the wrong slots', () => {
  const game = vowels.createGame({ mode: 'daily', difficulty: 'medium', dateKey: '2026-08-01' });
  // Fill every slot with the same vowel; unless the quote genuinely only uses
  // that one, it must not count as solved.
  for (const slot of game.slots) game.filled[slot] = 'A';
  const allA = game.slots.every((s) => game.plain[s] === 'A');
  assert.equal(vowels.isSolved(game), allA);
});

test('a revealed Missing Vowels slot cannot be overwritten or cleared', () => {
  const game = vowels.createGame({ mode: 'daily', difficulty: 'medium', dateKey: '2026-08-01' });
  vowels.hint(game);
  const slot = [...game.locked][0];
  const correct = game.plain[slot];

  game.selectedIndex = slot;
  assert.match(vowels.onKey(game, correct === 'A' ? 'E' : 'A').toast, /already revealed/);
  assert.equal(game.filled[slot], correct);

  game.selectedIndex = slot;
  assert.match(vowels.deleteLetter(game).toast, /cannot be cleared/);
  assert.equal(game.filled[slot], correct);
});

test('a tampered Missing Vowels save cannot fake a revealed slot', () => {
  const game = vowels.createGame({ mode: 'daily', difficulty: 'medium', dateKey: '2026-08-01' });
  vowels.hint(game);
  const slot = [...game.locked][0];

  const snapshot = vowels.toSnapshot(game);
  snapshot.filled = { ...snapshot.filled, [slot]: 'U' };
  const restored = vowels.hydrate(snapshot);
  assert.equal(restored.filled[slot], restored.plain[slot], 'a locked slot must be authoritative');
});

test('Missing Vowels home card counts vowels filled', () => {
  assert.equal(vowels.statusFor(null, { difficultyLabel: 'Medium' }).state, 'new');

  const game = vowels.createGame({ mode: 'daily', difficulty: 'medium', dateKey: '2026-08-01' });
  assert.equal(vowels.statusFor(vowels.toSnapshot(game), { difficultyLabel: 'Medium' }).state, 'new');

  vowels.onKey(game, 'A');
  const progress = vowels.statusFor(vowels.toSnapshot(game), { difficultyLabel: 'Medium' });
  assert.equal(progress.state, 'progress');
  assert.match(progress.text, /1 of \d+ vowels/);
  assert.equal(progress.action, 'Continue');
});

test('Missing Vowels uses a five-key pad', () => {
  assert.deepEqual(vowels.keyboard.rows, ['AEIOU']);
  assert.equal(vowels.keyboard.del, true);
});

// --- Word Ladder ------------------------------------------------------------

const LADDER = (difficulty = 'medium', dateKey = '2026-08-01') =>
  ladder.createGame({ mode: 'daily', difficulty, dateKey });

test('a generated ladder is solvable in exactly par steps', () => {
  // The whole puzzle rests on this: par is not a guess, it is the length of a
  // path the generator found. Walk it with the game's own hint to prove it.
  for (const [difficulty, steps] of [['easy', 3], ['medium', 4], ['hard', 5]]) {
    for (let d = 1; d <= 12; d++) {
      const dateKey = `2026-08-${String(d).padStart(2, '0')}`;
      const game = LADDER(difficulty, dateKey);

      assert.equal(game.par, steps, `${difficulty} ${dateKey}: par is not ${steps}`);
      assert.notEqual(game.start, game.goal, `${difficulty} ${dateKey}: start is the goal`);
      assert.equal(ladder.isSolved(game), false, `${difficulty} ${dateKey} arrived solved`);

      for (let i = 0; i < steps; i++) ladder.hint(game);
      assert.equal(ladder.isSolved(game), true, `${difficulty} ${dateKey} not solved in par`);
      assert.equal(game.rungs.length, steps, `${difficulty} ${dateKey} took a detour`);
    }
  }
});

test('every step of a hinted ladder is a real word one letter from the last', () => {
  const game = LADDER('hard');
  for (let i = 0; i < game.par; i++) ladder.hint(game);

  let previous = game.start;
  for (const rung of game.rungs) {
    assert.ok(LADDER_WORDS.has(rung), `${rung} is not in the word list`);
    assert.equal(rung.length, 4);
    const diffs = [...rung].filter((ch, i) => ch !== previous[i]).length;
    assert.equal(diffs, 1, `${previous} -> ${rung} changed ${diffs} letters`);
    previous = rung;
  }
});

test('Word Ladder endpoints are drawn from the common pool', () => {
  // Obscure words are fine mid-ladder but not as the two you are shown.
  for (let d = 1; d <= 10; d++) {
    const game = LADDER('medium', `2026-09-${String(d).padStart(2, '0')}`);
    assert.ok(LADDER_COMMON.includes(game.start), `${game.start} is not common`);
    assert.ok(LADDER_COMMON.includes(game.goal), `${game.goal} is not common`);
  }
});

test('Word Ladder rejects a step that is not one letter away', () => {
  const game = LADDER();
  game.current = game.start; // same word, zero letters changed
  assert.match(ladder.commit(game).toast, /already on the ladder/);

  // Two letters at once.
  const twoAway = [...LADDER_WORDS].find((w) => {
    const diffs = [...w].filter((ch, i) => ch !== game.start[i]).length;
    return diffs === 2;
  });
  game.current = twoAway;
  assert.match(ladder.commit(game).toast, /exactly one letter/);
  assert.equal(game.rungs.length, 0);
});

test('Word Ladder rejects a non-word and an unfinished row', () => {
  const game = LADDER();
  game.current = 'zzz';
  assert.match(ladder.commit(game).toast, /Not enough letters/);

  game.current = 'zzzz';
  assert.match(ladder.commit(game).toast, /not in the word list/);
  assert.equal(game.rungs.length, 0);
});

test('Word Ladder refuses to revisit a word already on the ladder', () => {
  // Without this a ladder can oscillate between two words forever and the board
  // reads as broken.
  const game = LADDER();
  ladder.hint(game);
  const used = game.rungs[0];

  ladder.hint(game);
  game.current = used;
  assert.match(ladder.commit(game).toast, /already on the ladder/);
});

test('Word Ladder delete backs out of a row, then off the ladder', () => {
  const game = LADDER();
  ladder.hint(game);
  assert.equal(game.rungs.length, 1);

  game.current = 'ab';
  ladder.onKey(game, 'DEL');
  assert.equal(game.current, 'a', 'should trim the row first');
  ladder.onKey(game, 'DEL');
  assert.equal(game.current, '');

  // Now the row is empty, so delete undoes the step above it.
  assert.match(ladder.deleteLetter(game).toast, /Removed/);
  assert.equal(game.rungs.length, 0);
  assert.deepEqual(ladder.deleteLetter(game), {}, 'nothing left to remove');
});

test('Word Ladder never reports a loss', () => {
  const game = LADDER();
  assert.equal(ladder.isLost(game), false);
  for (let i = 0; i < game.par; i++) ladder.hint(game);
  assert.equal(ladder.isLost(game), false);
});

test('Word Ladder counts hints and reports the chain when solved', () => {
  const game = LADDER('easy');
  for (let i = 0; i < game.par; i++) ladder.hint(game);
  assert.equal(game.hintsUsed, game.par);

  const outcome = ladder.outcomeContent(game);
  assert.match(outcome.title, /Perfect ladder/, 'par exactly should read as par');
  assert.ok(outcome.body.startsWith(game.start.toUpperCase()), 'chain starts at the start word');
  assert.ok(outcome.body.endsWith(game.goal.toUpperCase()), 'chain ends at the goal');
  assert.equal(outcome.body.split(' → ').length, game.par + 1);
});

test('Word Ladder home card counts steps taken', () => {
  assert.equal(ladder.statusFor(null, { difficultyLabel: 'Medium' }).state, 'new');

  const game = LADDER();
  assert.equal(ladder.statusFor(ladder.toSnapshot(game), { difficultyLabel: 'Medium' }).state, 'new');

  ladder.hint(game);
  const progress = ladder.statusFor(ladder.toSnapshot(game), { difficultyLabel: 'Medium' });
  assert.equal(progress.state, 'progress');
  assert.match(progress.text, /1 step\b/);
  assert.equal(progress.action, 'Continue');

  while (!ladder.isSolved(game)) ladder.hint(game);
  const solved = ladder.statusFor(ladder.toSnapshot(game), { difficultyLabel: 'Medium' });
  assert.equal(solved.state, 'solved');
  assert.match(solved.text, /Solved in \d+ steps/);
});

test('a saved ladder restores the same climb', () => {
  const game = LADDER();
  ladder.hint(game);
  ladder.hint(game);
  game.current = 'ab';

  const restored = ladder.hydrate(ladder.toSnapshot(game));
  assert.equal(restored.start, game.start);
  assert.equal(restored.goal, game.goal);
  assert.equal(restored.par, game.par);
  assert.deepEqual(restored.rungs, game.rungs);
  assert.equal(restored.current, 'ab');
});

// --- Word Wheel -------------------------------------------------------------

const WHEEL = (difficulty = 'medium', dateKey = '2026-08-01') =>
  wheel.createGame({ mode: 'daily', difficulty, dateKey });

test('every wheel contains a word using all of its letters', () => {
  // Wheels are built backwards from a source word precisely so this holds. A
  // wheel with no pangram has no best answer, only a longest accident.
  for (const [difficulty, size] of [['easy', 7], ['medium', 8], ['hard', 9]]) {
    for (let d = 1; d <= 6; d++) {
      const game = WHEEL(difficulty, `2026-08-0${d}`);
      assert.equal(game.letters.length, size, `${difficulty}: wrong wheel size`);
      assert.ok(
        game.solutions.some((w) => w.length === size),
        `${difficulty} ${d}: no pangram on ${game.letters}`
      );
      assert.ok(game.solutions.length >= 12, `${difficulty} ${d}: only ${game.solutions.length} words`);
    }
  }
});

test('every wheel solution is legal by the wheel own rules', () => {
  const game = WHEEL('hard');
  const available = {};
  for (const ch of game.letters) available[ch] = (available[ch] ?? 0) + 1;

  for (const word of game.solutions) {
    assert.ok(word.length >= 4, `${word} is too short`);
    assert.ok(word.includes(game.centre), `${word} omits the centre letter`);
    const used = {};
    for (const ch of word) used[ch] = (used[ch] ?? 0) + 1;
    for (const [ch, n] of Object.entries(used)) {
      assert.ok(n <= (available[ch] ?? 0), `${word} uses ${n} x ${ch}, wheel has ${available[ch] ?? 0}`);
    }
  }
});

test('Word Wheel refuses short words, words missing the centre, and repeats', () => {
  const game = WHEEL();
  const good = game.solutions[game.solutions.length - 1];

  game.current = 'ab';
  assert.match(wheel.commit(game).toast, /At least 4 letters/);

  // A real word made of wheel letters but without the compulsory one.
  const without = [...game.letters].filter((c) => c !== game.centre).join('');
  game.current = without.slice(0, 4);
  assert.match(wheel.commit(game).toast, /needs|not in/i);

  game.current = good;
  assert.deepEqual(wheel.commit(game).toast, '');
  assert.ok(game.found.includes(good));

  game.current = good;
  assert.match(wheel.commit(game).toast, /already on your list/);
  assert.equal(game.found.filter((w) => w === good).length, 1);
});

test('Word Wheel tells a non-word from a word not in these letters', () => {
  const game = WHEEL();
  // Has to include the centre letter, or the compulsory-letter check fires
  // first -- which is the right order for the player, less so for this test.
  game.current = `zz${game.centre}z`;
  assert.match(wheel.commit(game).toast, /not in the word list/);

  // A real word that the wheel cannot build.
  const impossible = [...WORDS].find(
    (w) => w.length === 5 && w.includes(game.centre) && ![...w].every((c) => game.letters.includes(c))
  );
  game.current = impossible;
  assert.match(wheel.commit(game).toast, /not in these letters/);
});

test('the target is reachable and always leaves something over', () => {
  assert.equal(targetFor(4), 4, 'a tiny wheel still needs four');
  assert.equal(targetFor(100), 30);
  for (const total of [12, 20, 40, 80]) {
    assert.ok(targetFor(total) <= total, `${total}: target exceeds what exists`);
    assert.ok(targetFor(total) >= 4, `${total}: target too small to be a game`);
  }
});

test('Word Wheel counts as solved at the target but stays playable', () => {
  const game = WHEEL();
  while (game.found.length < game.target) wheel.hint(game);
  assert.equal(wheel.isSolved(game), true);
  assert.equal(wheel.isLost(game), false);

  // The point of this game: reaching the target does not close the board.
  const before = game.found.length;
  const spare = game.solutions.find((w) => !game.found.includes(w));
  game.current = spare;
  wheel.commit(game);
  assert.equal(game.found.length, before + 1, 'should still accept words after solving');
});

test('a tampered wheel save cannot credit words the wheel cannot make', () => {
  const game = WHEEL();
  const snapshot = wheel.toSnapshot(game);
  snapshot.found = ['zzzz', game.solutions[0]];
  const restored = wheel.hydrate(snapshot);
  assert.deepEqual(restored.found, [game.solutions[0]]);
});

test('Word Wheel home card counts words found', () => {
  assert.equal(wheel.statusFor(null, { difficultyLabel: '8 letters' }).state, 'new');

  const game = WHEEL();
  assert.equal(wheel.statusFor(wheel.toSnapshot(game), { difficultyLabel: '8 letters' }).state, 'new');

  wheel.hint(game);
  const progress = wheel.statusFor(wheel.toSnapshot(game), { difficultyLabel: '8 letters' });
  assert.equal(progress.state, 'progress');
  assert.match(progress.text, /1 word\b/);
});

// --- Word Search ------------------------------------------------------------

const SEARCH = (difficulty = 'medium', dateKey = '2026-08-01') =>
  search.createGame({ mode: 'daily', difficulty, dateKey });

test('every hidden word is really in the grid, spelled along its own cells', () => {
  // The one property that matters: a word on the list that is not in the grid is
  // an unwinnable puzzle, and nothing else in the game would notice.
  for (const [difficulty, size, count] of [['easy', 8, 6], ['medium', 10, 8], ['hard', 12, 10]]) {
    for (let d = 1; d <= 8; d++) {
      const game = SEARCH(difficulty, `2026-08-0${d}`);
      assert.equal(game.size, size);
      assert.equal(game.letters.length, size * size, 'grid is not square');
      assert.equal(game.placed.length, count, `${difficulty} ${d}: only ${game.placed.length} words fitted`);

      for (const entry of game.placed) {
        assert.equal(entry.cells.length, entry.word.length, `${entry.word}: wrong cell count`);
        const spelled = entry.cells.map((c) => game.letters[c]).join('');
        assert.equal(spelled, entry.word, `${entry.word} is not at its own cells`);

        // Cells must form a straight line with an even step.
        const dx = (entry.cells[1] % size) - (entry.cells[0] % size);
        const dy = Math.floor(entry.cells[1] / size) - Math.floor(entry.cells[0] / size);
        entry.cells.forEach((cell, i) => {
          assert.equal(cell % size, (entry.cells[0] % size) + dx * i, `${entry.word}: bent line`);
          assert.equal(Math.floor(cell / size), Math.floor(entry.cells[0] / size) + dy * i);
        });
      }
    }
  }
});

test('every cell of the grid gets a letter', () => {
  const game = SEARCH('hard');
  assert.equal(game.letters.filter((ch) => /^[a-z]$/.test(ch)).length, game.size * game.size);
});

test('easy grids never run a word backwards', () => {
  for (let d = 1; d <= 8; d++) {
    const game = SEARCH('easy', `2026-08-0${d}`);
    for (const entry of game.placed) {
      // "Backwards" is about reading direction, not array order: the up-right
      // diagonal reads left to right while stepping negatively through cells.
      const size = game.size;
      const dx = (entry.cells[1] % size) - (entry.cells[0] % size);
      const dy = Math.floor(entry.cells[1] / size) - Math.floor(entry.cells[0] / size);
      assert.ok(dx > 0 || (dx === 0 && dy > 0), `${entry.word} runs backwards on easy`);
    }
  }
});

test('tapping the two ends of a word finds it, and nothing else does', () => {
  const game = SEARCH();
  const entry = game.placed[0];
  const first = entry.cells[0];
  const last = entry.cells[entry.cells.length - 1];

  // A wrong second tap finds nothing, flashes the cell it hit, and KEEPS the
  // start. Clearing it was the old behaviour and it made the board feel like it
  // was cancelling your selection at random -- the tap after the first letter is
  // usually the second letter, not the last.
  search.onSelect(game, first);
  assert.equal(game.anchor, first);
  const wrong = (last + 1) % game.letters.length;
  const miss = search.onSelect(game, wrong);
  assert.equal(game.found.length, 0);
  assert.equal(game.anchor, first, 'a miss must not throw the start away');
  assert.equal(game.missAt, wrong, 'the cell that missed should flash');
  assert.ok(miss.clearAfter > 0, 'the flash needs to clear itself');

  // The flash is transient; the start is not.
  search.clearTransient(game);
  assert.equal(game.missAt, null);
  assert.equal(game.anchor, first);

  // Trying again from the same start works, in either order.
  search.onSelect(game, first);
  assert.equal(game.anchor, null, 'tapping the start again clears it');
  search.onSelect(game, last);
  const result = search.onSelect(game, first);
  assert.equal(result.toast, entry.word.toUpperCase());
  assert.deepEqual(game.found, [entry.word]);

  // Tapping the same cell twice just clears the anchor.
  search.onSelect(game, first);
  search.onSelect(game, first);
  assert.equal(game.anchor, null);
});

test('Word Search is solved only when every word is found', () => {
  const game = SEARCH('easy');
  assert.equal(search.isSolved(game), false);

  for (const entry of game.placed.slice(0, -1)) {
    search.onSelect(game, entry.cells[0]);
    search.onSelect(game, entry.cells[entry.cells.length - 1]);
  }
  assert.equal(search.isSolved(game), false, 'one still hiding');

  const last = game.placed[game.placed.length - 1];
  search.onSelect(game, last.cells[0]);
  search.onSelect(game, last.cells[last.cells.length - 1]);
  assert.equal(search.isSolved(game), true);
  assert.equal(search.isLost(game), false);
});

test('Word Search has no keyboard and ignores typing', () => {
  assert.equal(search.keyboard, null);
  const game = SEARCH();
  assert.deepEqual(search.onKey(game, 'A'), {});
  assert.equal(game.found.length, 0);
});

test('a grid never spells something offensive by accident', () => {
  // Random filler read in eight directions is a lot of accidental words.
  const blocked = ['fuck', 'shit', 'cunt', 'nigger', 'whore', 'bitch', 'rape', 'faggot'];
  for (const difficulty of ['easy', 'medium', 'hard']) {
    for (let d = 1; d <= 6; d++) {
      const game = SEARCH(difficulty, `2026-10-0${d}`);
      const size = game.size;
      const lines = [];
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1], [-1, 0], [0, -1], [-1, -1], [-1, 1]]) {
            let run = '';
            for (let i = 0; i < size; i++) {
              const cx = x + dx * i;
              const cy = y + dy * i;
              if (cx < 0 || cy < 0 || cx >= size || cy >= size) break;
              run += game.letters[cy * size + cx];
            }
            lines.push(run);
          }
        }
      }
      for (const word of blocked) {
        assert.ok(!lines.some((l) => l.includes(word)), `${difficulty} ${d}: grid contains ${word}`);
      }
    }
  }
});

test('no shown pool contains a word the games only accept', () => {
  // The "accept but never show" list in tools/make-words.mjs is about tone, and
  // it applies to the four pools a game draws a board FROM -- never to what it
  // will take from the keyboard.
  //
  // Stems, not exact words, because that was the bug: the tool matched exact
  // forms, so SEXUALITY shipped as a Word Wheel source (the wheel is built from
  // its source, so it was also the guaranteed best find) and SEXUALLY shipped in
  // SEARCH_WORDS, whose word list is printed under the grid.
  const stems = [
    'sex', 'sexual', 'sexy', 'erotic', 'lust', 'nude', 'nudity', 'fetish',
    'kinky', 'thong', 'bosom',
  ];

  // Ordinary English that merely starts with one of those. Kept on purpose: the
  // list is meant to be judgement, not prudishness.
  const allowed = new Set([
    'luster', 'lusters', 'lustre', 'lustres', 'lustrous', 'lustrously',
    'kink', 'kinks', 'kinked', 'kinking', 'sextet', 'sextets', 'sexton',
    'sextons', 'nudge', 'nudged', 'nudges', 'nudging',
  ]);

  for (const [label, pool] of [
    ['ANSWERS', ANSWERS],
    ['LADDER_COMMON', LADDER_COMMON],
    ['WHEEL_SOURCES', WHEEL_SOURCES],
    ['SEARCH_WORDS', SEARCH_WORDS],
  ]) {
    for (const word of pool) {
      if (allowed.has(word)) continue;
      const hit = stems.find((stem) => word.startsWith(stem));
      assert.ok(!hit, `${label} would show ${word.toUpperCase()} (matches ${hit})`);
    }
  }

  // ...and the wide pool still accepts them, which is the whole point.
  for (const word of ['sexual', 'erotic', 'kinky', 'nudity']) {
    assert.ok(WORDS.has(word), `WORDS should still accept ${word.toUpperCase()}`);
  }
});

test('Word Search home card counts words found', () => {
  assert.equal(search.statusFor(null, { difficultyLabel: 'Medium' }).state, 'new');

  const game = SEARCH();
  assert.equal(search.statusFor(search.toSnapshot(game), { difficultyLabel: 'Medium' }).state, 'new');

  search.hint(game);
  const progress = search.statusFor(search.toSnapshot(game), { difficultyLabel: 'Medium' });
  assert.equal(progress.state, 'progress');
  assert.match(progress.text, /1 of 8 found/);
});

test('a saved Word Search restores the same grid and the same finds', () => {
  const game = SEARCH();
  search.hint(game);
  const restored = search.hydrate(search.toSnapshot(game));
  assert.deepEqual(restored.letters, game.letters);
  assert.deepEqual(restored.found, game.found);
  assert.deepEqual(restored.placed.map((p) => p.word), game.placed.map((p) => p.word));
});

// --- Boxed ------------------------------------------------------------------

const BOXED = (difficulty = 'medium', dateKey = '2026-08-01') =>
  boxed.createGame({ mode: 'daily', difficulty, dateKey });

test('every Boxed board deals twelve distinct letters onto four sides of three', () => {
  for (const difficulty of ['easy', 'medium', 'hard']) {
    for (let d = 1; d <= 8; d++) {
      const game = BOXED(difficulty, `2026-08-0${d}`);
      const label = `${difficulty} ${d}`;

      assert.equal(game.sides.length, 4, `${label}: side count`);
      for (const side of game.sides) assert.equal(side.length, 3, `${label}: side "${side}"`);
      assert.equal(game.letters.length, BOX_LETTERS, `${label}: letter count`);
      assert.equal(new Set(game.letters).size, BOX_LETTERS, `${label}: letters repeat`);
      assert.match(game.letters, /^[a-z]+$/, `${label}: letters are not plain lowercase`);
    }
  }
});

test('every Boxed board has a two-word solution its own rules accept', () => {
  // The whole game rests on this. A box dealt from random letters is usually
  // unsolvable and there is no way to tell by looking, so the generator works
  // backwards from a pair of real words and this proves the pair survives.
  for (const difficulty of ['easy', 'medium', 'hard']) {
    for (let d = 1; d <= 8; d++) {
      const game = BOXED(difficulty, `2026-08-0${d}`);
      const [first, second] = game.sources;
      const label = `${difficulty} ${d} (${first}, ${second})`;

      assert.equal(
        rejectionFor(first, { sides: game.sides, words: [] }),
        null,
        `${label}: first word rejected`
      );
      assert.equal(
        rejectionFor(second, { sides: game.sides, words: [first] }),
        null,
        `${label}: second word rejected`
      );
      assert.equal(
        new Set(first + second).size,
        BOX_LETTERS,
        `${label}: the pair does not cover the box`
      );
      // Two words is always within the limit, so every board is winnable at every
      // difficulty rather than only at the generous ones.
      assert.ok(game.limit >= 2, `${label}: limit below par`);
    }
  }
});

test('Boxed refuses two letters from the same side', () => {
  const game = BOXED();
  const [side] = game.sides;
  // Both letters are on the box and the word may well be real; it is the side
  // rule alone that has to reject it.
  const reason = rejectionFor(side[0] + side[1] + side[0] + side[1], game);
  assert.match(reason, /same side/);
});

test('Boxed refuses a letter that is not on the box at all', () => {
  const game = BOXED();
  const absent = 'abcdefghijklmnopqrstuvwxyz'.split('').find((ch) => !game.letters.includes(ch));
  assert.match(rejectionFor(absent.repeat(4), game), /not on the box/);
});

test('Boxed requires each word to start where the last one ended', () => {
  const game = BOXED();
  const [first, second] = game.sources;
  game.current = first;
  boxed.commit(game);

  // The real second word is fine; anything starting elsewhere is not.
  assert.equal(rejectionFor(second, game), null);

  // The substituted letter has to be wrong ONLY about the junction. The side rule
  // is checked first, so a letter that happens to share a side with second[1]
  // reports that instead and the assertion below passes or fails depending on how
  // the box was dealt -- which is how the first version of this test broke as soon
  // as the word pools changed under it.
  const sideOf = (ch) => game.sides.findIndex((side) => side.includes(ch));
  const junction = first[first.length - 1];
  const wrongStart = [...game.letters].find(
    (ch) => ch !== junction && sideOf(ch) !== sideOf(second[1])
  );
  assert.ok(wrongStart, 'no letter available to test the junction rule with');
  assert.match(rejectionFor(wrongStart + second.slice(1), game), /Must start with/);
});

test('Boxed enforces its minimum word length', () => {
  const game = BOXED();
  assert.match(rejectionFor(game.letters.slice(0, BOX_MIN - 1), game), /At least/);
});

test('Boxed is won by covering all twelve letters, not by using every word', () => {
  const game = BOXED();
  const [first, second] = game.sources;

  game.current = first;
  boxed.commit(game);
  assert.equal(boxed.isSolved(game), false, 'one word should not finish it');

  game.current = second;
  boxed.commit(game);
  assert.equal(boxed.isSolved(game), true);
  assert.equal(boxed.isLost(game), false);
  assert.equal(game.words.length, 2);
  assert.ok(game.words.length < game.limit, 'solved with words to spare');
});

test('Boxed is lost once the word limit is spent without covering the box', () => {
  // The rule on its own, without hunting for a chain of stingy words: a board
  // with the limit used up and letters still missing is lost.
  assert.equal(
    boxed.isLost({ words: ['aaaa', 'bbbb', 'cccc', 'dddd'], covered: new Set('abc'), limit: 4 }),
    true
  );
  assert.equal(
    boxed.isLost({ words: ['aaaa'], covered: new Set('abc'), limit: 4 }),
    false,
    'words still in hand'
  );
  // A board finished on the very last word is won, not lost.
  assert.equal(
    boxed.isLost({
      words: ['a', 'b', 'c', 'd'],
      covered: new Set('abcdefghijkl'),
      limit: 4,
    }),
    false
  );
});

test('Boxed rejects a word the same box already accepted once', () => {
  const game = BOXED();
  const [first] = game.sources;

  // The junction rule is checked before this one, on purpose: "must start with E"
  // is more use than "already played" when both are true. So reaching the
  // duplicate rule at all needs a chain whose last word hands back the letter
  // this word starts with -- rejectionFor reads `words` only for those two rules,
  // so the bridging word does not have to be playable itself.
  const bridge = `zz${first[0]}`;
  assert.match(
    rejectionFor(first, { sides: game.sides, words: [first, bridge] }),
    /already played/
  );
});

test('a tampered Boxed save keeps only the words the box allows, in order', () => {
  const game = BOXED();
  const [first, second] = game.sources;
  const snapshot = { ...boxed.toSnapshot(game), words: ['zzzz', first, 'qqqq', second] };

  const restored = boxed.hydrate(snapshot);
  assert.deepEqual(restored.words, [first, second]);
  assert.equal(restored.covered.size, BOX_LETTERS);
});

test('a Boxed hint plays a word the board would have accepted', () => {
  const game = BOXED();
  const before = game.words.length;
  boxed.hint(game);

  assert.equal(game.words.length, before + 1, 'hint played nothing');
  assert.equal(game.hintsUsed, 1);
  // Replaying the hinted word through the rules from scratch has to pass, which
  // is what stops a hint from being the one move the player could not have made.
  assert.equal(rejectionFor(game.words[0], { sides: game.sides, words: [] }), null);
});

test('Boxed regenerating the word list cannot rewrite a box in progress', () => {
  // The sides are stored outright rather than as an index into a capped pool, so
  // a saved board carries its own puzzle and never depends on words.js agreeing.
  const snapshot = boxed.toSnapshot(BOXED());
  assert.ok(Array.isArray(snapshot.sides), 'sides are not in the snapshot');
  assert.equal(snapshot.sides.join('').length, BOX_LETTERS);
  assert.deepEqual(boxed.hydrate(snapshot).sides, snapshot.sides);
});

test('Boxed home card reports letters covered rather than words played', () => {
  assert.equal(boxed.statusFor(null, { difficultyLabel: '5 words' }).state, 'new');

  const game = BOXED();
  assert.equal(boxed.statusFor(boxed.toSnapshot(game), { difficultyLabel: '5 words' }).state, 'new');

  game.current = game.sources[0];
  boxed.commit(game);
  const progress = boxed.statusFor(boxed.toSnapshot(game), { difficultyLabel: '5 words' });
  assert.equal(progress.state, 'progress');
  assert.match(progress.text, new RegExp(`of ${BOX_LETTERS} letters`));
});

// --- Hidden Quote -----------------------------------------------------------

const HIDDEN = (difficulty = 'medium', dateKey = '2026-08-01') =>
  hidden.createGame({ mode: 'daily', difficulty, dateKey });

test('every quote in the pack makes a Hidden Quote board that can be lost', () => {
  // The failure this guards against is silent: a quote using enough of the
  // alphabet leaves fewer wrong letters in existence than the player has lives,
  // so the pips can never all go out and the game quietly cannot be lost.
  QUOTES.forEach((quote, index) => {
    const absent = 26 - lettersIn(quote.text).size;
    assert.ok(absent >= 2, `quote ${index} leaves only ${absent} wrong letters`);

    for (const [difficulty, ceiling] of [['easy', 7], ['medium', 5], ['hard', 4]]) {
      const lives = livesFor(absent, ceiling);
      assert.ok(lives >= 1, `quote ${index} ${difficulty}: no lives`);
      assert.ok(
        lives <= absent - 1,
        `quote ${index} ${difficulty}: ${lives} lives but only ${absent} wrong letters`
      );
    }
  });
});

test('every Hidden Quote board arrives blank and unsolved', () => {
  for (const difficulty of ['easy', 'medium', 'hard']) {
    for (let d = 1; d <= 8; d++) {
      const game = HIDDEN(difficulty, `2026-08-0${d}`);
      const label = `${difficulty} ${d}`;
      assert.equal(game.called.length, 0, `${label}: arrived with calls`);
      assert.equal(hidden.isSolved(game), false, `${label}: arrived solved`);
      assert.equal(hidden.isLost(game), false, `${label}: arrived lost`);
      assert.ok(game.present.size >= 5, `${label}: only ${game.present.size} letters to find`);
      assert.ok(game.lives >= 1, `${label}: no lives`);
    }
  }
});

test('Hidden Quote runs its length bands backwards from Cryptogram', () => {
  // Deliberate, and the reason is in the module: a long quote reveals eight
  // copies of a letter at once and reads itself out to you, so length is easier
  // here and harder there. If someone "fixes" this to match, it should fail.
  const longest = HIDDEN('easy').plain.length;
  const shortest = HIDDEN('hard').plain.length;
  assert.ok(longest > shortest, `easy ${longest} should be longer than hard ${shortest}`);
});

test('a called letter reveals every copy of itself and costs nothing', () => {
  const game = HIDDEN();
  const letter = [...game.present][0];
  hidden.onKey(game, letter);

  assert.ok(game.called.includes(letter));
  assert.equal(game.misses.length, 0);
  assert.equal(hidden.isLost(game), false);
});

test('a letter that is not in the quote costs a life and is remembered', () => {
  const game = HIDDEN();
  const absent = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((ch) => !game.present.has(ch));

  const result = hidden.onKey(game, absent);
  assert.match(result.toast, new RegExp(`No ${absent}`));
  assert.deepEqual(game.misses, [absent]);
  assert.ok(game.called.includes(absent));
});

test('Hidden Quote never charges twice for the same letter', () => {
  const game = HIDDEN();
  const absent = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((ch) => !game.present.has(ch));

  hidden.onKey(game, absent);
  const again = hidden.onKey(game, absent);
  assert.match(again.toast, /already been called/);
  assert.equal(game.misses.length, 1, 'a repeat call spent a second life');
});

test('Hidden Quote is solved by calling every letter it contains', () => {
  const game = HIDDEN();
  for (const ch of game.present) hidden.onKey(game, ch);

  assert.equal(hidden.isSolved(game), true);
  assert.equal(hidden.isLost(game), false);
  assert.equal(game.misses.length, 0);
  assert.equal(hidden.outcomeContent(game).title, 'Not a single miss!');
});

test('Hidden Quote is lost when the pips run out, and gives up the quote', () => {
  const game = HIDDEN();
  const absent = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((ch) => !game.present.has(ch));

  for (let i = 0; i < game.lives; i++) hidden.onKey(game, absent[i]);

  assert.equal(hidden.isLost(game), true);
  assert.equal(hidden.isSolved(game), false);
  assert.equal(hidden.outcomeContent(game).title, 'Out of lives');
  assert.equal(hidden.outcomeContent(game).body, game.original);
});

test('a lost Hidden Quote refuses further calls', () => {
  const game = HIDDEN();
  const absent = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((ch) => !game.present.has(ch));
  for (let i = 0; i < game.lives; i++) hidden.onKey(game, absent[i]);

  // The shell sets the flag it owns; the module has to respect it.
  game.lost = true;
  const before = game.called.length;
  hidden.onKey(game, [...game.present][0]);
  assert.equal(game.called.length, before, 'a lost board accepted another call');
});

test('a Hidden Quote hint reveals the most common letter still missing', () => {
  const game = HIDDEN();
  const countOf = (letter) => [...game.plain].filter((ch) => ch === letter).length;
  const expected = [...game.present].reduce((a, b) => (countOf(a) >= countOf(b) ? a : b));

  hidden.hint(game);
  assert.deepEqual(game.hinted, [expected]);
  assert.equal(game.hintsUsed, 1);
  assert.equal(game.misses.length, 0, 'a hint spent a life');
});

test('a tampered Hidden Quote save cannot spend a life twice or reveal punctuation', () => {
  const game = HIDDEN();
  const snapshot = { ...hidden.toSnapshot(game), called: ['A', 'A', '.', '4', 'b'] };
  const restored = hidden.hydrate(snapshot);

  assert.deepEqual(restored.called, ['A', 'B']);
  assert.equal(restored.misses.length, restored.called.filter((c) => !restored.present.has(c)).length);
});

test('Hidden Quote home card counts letters found', () => {
  assert.equal(hidden.statusFor(null, { difficultyLabel: 'Medium' }).state, 'new');

  const game = HIDDEN();
  const snapshot = hidden.toSnapshot(game);
  assert.equal(hidden.statusFor(snapshot, { difficultyLabel: 'Medium' }).state, 'new');

  hidden.onKey(game, [...game.present][0]);
  const progress = hidden.statusFor(hidden.toSnapshot(game), { difficultyLabel: 'Medium' });
  assert.equal(progress.state, 'progress');
  assert.match(progress.text, /1 of \d+ letters/);
});

test('a saved Hidden Quote restores the same quote and the same calls', () => {
  const game = HIDDEN();
  hidden.onKey(game, [...game.present][0]);
  hidden.hint(game);

  const restored = hidden.hydrate(hidden.toSnapshot(game));
  assert.equal(restored.plain, game.plain);
  assert.deepEqual(restored.called, game.called);
  assert.deepEqual(restored.hinted, game.hinted);
  assert.equal(restored.lives, game.lives);
});

// --- drawing from a pool by content rather than by position ------------------

test('no snapshot stores a position in a word pool', () => {
  // This is the rule that makes regenerating src/words.js safe. A stored index is
  // a position, and positions move when a pool gains or loses a word, so a saved
  // board rebuilt from one silently becomes a different puzzle. Every game either
  // stores the word outright or re-derives it from the seed.
  //
  // quoteIndex is the deliberate exception: the quote pack is append-only by
  // convention, documented in the README, so an index into it cannot go stale.
  for (const mod of GAMES) {
    const difficulty = mod.difficulties ? mod.defaultDifficulty : null;
    const snap = mod.toSnapshot(mod.createGame({ mode: 'daily', difficulty, dateKey: '2026-08-01' }));

    for (const key of Object.keys(snap)) {
      if (key === 'quoteIndex') continue;
      assert.ok(
        !/index$/i.test(key),
        `${mod.id} stores ${key}; store the word or derive it from the seed instead`
      );
    }
  }
});

test('a board is a pure function of its seed and survives a legacy save', () => {
  // Saves written before this change carry only positions. They have to keep
  // opening -- rebuilt from the seed, which is the correct answer for them, since
  // the position they stored has already been invalidated by a regeneration.
  const legacy = [
    [fiver, { mode: 'daily', difficulty: null, dateKey: '2026-08-01', answerIndex: 1234, rows: [] }],
    [wheel, { mode: 'daily', difficulty: 'medium', dateKey: '2026-08-01', sourceIndex: 77, centre: 'x', found: [] }],
    [ladder, { mode: 'daily', difficulty: 'medium', dateKey: '2026-08-01', startIndex: 5, goalIndex: 9, rungs: [] }],
  ];

  for (const [mod, base] of legacy) {
    const difficulty = mod.difficulties ? mod.defaultDifficulty : null;
    const fresh = mod.createGame({ mode: 'daily', difficulty, dateKey: '2026-08-01' });
    const restored = mod.hydrate({ ...base, seed: fresh.seed });

    // Same seed, so a legacy save must land on exactly the board a fresh build
    // would produce rather than on whatever its stale index now points at.
    assert.deepEqual(
      mod.toSnapshot(restored),
      mod.toSnapshot(fresh),
      `${mod.id}: a legacy save did not rebuild the seed's board`
    );
  }
});
