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
import { LADDER_COMMON, LADDER_WORDS, WORDS } from '../src/words.js';
import { QUOTES } from '../src/quotes.js';
import { distinctLetters } from '../src/cipher.js';

const GAMES = [cryptogram, fiver, vowels, ladder, wheel, search];

// --- the shared contract ----------------------------------------------------

test('every game satisfies the module contract', () => {
  const required = [
    'id', 'name', 'blurb', 'category', 'icon', 'howTo', 'tools', 'keyboard',
    'createGame', 'hydrate', 'toSnapshot', 'mount', 'paint', 'paintKeys',
    'onKey', 'onSelect', 'move', 'clearTransient',
    'isSolved', 'isLost', 'caption', 'outcomeContent', 'statusFor',
  ];

  for (const mod of GAMES) {
    for (const key of required) {
      assert.ok(mod[key] !== undefined, `${mod.id} is missing ${key}`);
    }
    assert.ok(Array.isArray(mod.tools), `${mod.id}.tools`);
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
