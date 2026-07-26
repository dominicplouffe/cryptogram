// Cryptogram and Missing Vowels: construction, rules, persistence, and the
// contract every game module has to satisfy.

import test from 'node:test';
import assert from 'node:assert/strict';

import { cryptogram } from '../src/games/cryptogram.js';
import { vowels, stripVowels, vowelSlots, VOWELS } from '../src/games/vowels.js';
import { fiver } from '../src/games/fiver.js';
import { ladder } from '../src/games/ladder.js';
import { LADDER_COMMON, LADDER_WORDS } from '../src/words.js';
import { QUOTES } from '../src/quotes.js';
import { distinctLetters } from '../src/cipher.js';

const GAMES = [cryptogram, fiver, vowels, ladder];

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
    assert.ok(Array.isArray(mod.keyboard.rows), `${mod.id}.keyboard.rows`);
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
