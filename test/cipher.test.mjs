import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALPHABET,
  buildPuzzle,
  distinctLetters,
  encrypt,
  hashString,
  invertMapping,
  isSolved,
  letterFrequency,
  localDateKey,
  makeDerangement,
  mulberry32,
  pickPrefillLetters,
} from '../src/cipher.js';

test('mulberry32 is deterministic and stays in range', () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  for (let i = 0; i < 100; i++) {
    const value = a();
    assert.equal(value, b());
    assert.ok(value >= 0 && value < 1, `out of range: ${value}`);
  }
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

test('hashString is stable and varies with input', () => {
  assert.equal(hashString('2026-07-25'), hashString('2026-07-25'));
  assert.notEqual(hashString('2026-07-25'), hashString('2026-07-26'));
});

test('localDateKey uses local calendar parts, not UTC', () => {
  // Late-evening local time is already the next day in UTC; we must not shift.
  const date = new Date(2026, 6, 25, 23, 30);
  assert.equal(localDateKey(date), '2026-07-25');
  assert.equal(localDateKey(new Date(2026, 0, 5, 0, 1)), '2026-01-05');
});

test('makeDerangement is a bijection with no fixed points, over many seeds', () => {
  for (let seed = 0; seed < 1000; seed++) {
    const mapping = makeDerangement(mulberry32(seed));
    const keys = Object.keys(mapping);
    const values = Object.values(mapping);

    assert.equal(keys.length, 26, `seed ${seed}: wrong key count`);
    assert.equal(new Set(values).size, 26, `seed ${seed}: not injective`);

    for (const letter of ALPHABET) {
      assert.ok(mapping[letter], `seed ${seed}: missing ${letter}`);
      assert.ok(ALPHABET.includes(mapping[letter]), `seed ${seed}: bad target`);
      assert.notEqual(mapping[letter], letter, `seed ${seed}: ${letter} maps to itself`);
    }
  }
});

test('makeDerangement is reproducible for a given seed', () => {
  assert.deepEqual(makeDerangement(mulberry32(99)), makeDerangement(mulberry32(99)));
});

test('invertMapping round-trips', () => {
  const mapping = makeDerangement(mulberry32(7));
  const inverse = invertMapping(mapping);
  for (const letter of ALPHABET) assert.equal(inverse[mapping[letter]], letter);
});

test('encrypt preserves length and all non-letters', () => {
  const mapping = makeDerangement(mulberry32(42));
  const plain = "IT'S 42 DEGREES -- REALLY?";
  const cipher = encrypt(plain, mapping);

  assert.equal(cipher.length, plain.length);
  for (let i = 0; i < plain.length; i++) {
    const ch = plain[i];
    if (ch >= 'A' && ch <= 'Z') {
      assert.notEqual(cipher[i], ch, `letter at ${i} was left unchanged`);
    } else {
      assert.equal(cipher[i], ch, `non-letter at ${i} was altered`);
    }
  }
});

test('encrypt then decrypt round-trips to uppercase source', () => {
  const mapping = makeDerangement(mulberry32(2024));
  const plain = 'The quick brown fox jumps over the lazy dog.';
  const cipher = encrypt(plain, mapping);
  assert.equal(encrypt(cipher, invertMapping(mapping)), plain.toUpperCase());
});

test('encrypt maps each letter consistently', () => {
  const mapping = makeDerangement(mulberry32(3));
  const cipher = encrypt('AAA BBB AAA', mapping);
  assert.equal(cipher[0], cipher[1]);
  assert.equal(cipher[1], cipher[2]);
  assert.equal(cipher[0], cipher[8]);
  assert.notEqual(cipher[0], cipher[4]);
});

test('letterFrequency counts letters only, most frequent first', () => {
  const freq = letterFrequency('AAB B!! CCCC');
  assert.deepEqual(freq, [
    { letter: 'C', count: 4 },
    { letter: 'A', count: 2 },
    { letter: 'B', count: 2 },
  ]);
});

test('pickPrefillLetters stays within bounds and returns no duplicates', () => {
  const cipher = encrypt('THE QUICK BROWN FOX JUMPS', makeDerangement(mulberry32(11)));
  const available = distinctLetters(cipher).length;

  for (const requested of [0, 1, 3, available, available + 10]) {
    const picked = pickPrefillLetters(cipher, requested, mulberry32(5));
    assert.equal(picked.length, Math.min(Math.max(requested, 0), available));
    assert.equal(new Set(picked).size, picked.length, 'returned a duplicate');
    for (const letter of picked) assert.ok(cipher.includes(letter));
  }

  assert.deepEqual(pickPrefillLetters(cipher, -5, mulberry32(5)), []);
  assert.deepEqual(pickPrefillLetters('!!! ???', 3, mulberry32(5)), []);
});

test('pickPrefillLetters leans toward frequent letters', () => {
  // E dominates; over many seeds it should be picked far more often than not.
  const text = 'EEEEEEEEEEEEEEEEEEEE A B C D F G';
  let hits = 0;
  for (let seed = 0; seed < 200; seed++) {
    if (pickPrefillLetters(text, 1, mulberry32(seed)).includes('E')) hits++;
  }
  assert.ok(hits > 120, `expected E to dominate, got ${hits}/200`);
});

test('buildPuzzle is reproducible and internally consistent', () => {
  const quote = { text: 'Nothing is impossible.', author: 'Audrey Hepburn' };
  const puzzle = buildPuzzle(quote, hashString('2026-07-25'), 2);

  assert.deepEqual(puzzle, buildPuzzle(quote, hashString('2026-07-25'), 2));
  assert.equal(puzzle.plain, 'NOTHING IS IMPOSSIBLE.');
  assert.equal(puzzle.cipher.length, puzzle.plain.length);
  assert.equal(puzzle.author, 'Audrey Hepburn');
  assert.equal(puzzle.prefilled.length, 2);

  // solution decodes the cipher back to the plaintext
  assert.equal(encrypt(puzzle.cipher, puzzle.solution), puzzle.plain);
});

test('isSolved only accepts a fully correct assignment', () => {
  const puzzle = buildPuzzle({ text: 'Be kind.', author: 'Anon' }, 1234, 0);
  const letters = distinctLetters(puzzle.cipher);

  assert.equal(isSolved(puzzle.cipher, {}, puzzle.solution), false);
  assert.equal(isSolved(puzzle.cipher, puzzle.solution, puzzle.solution), true);

  const partial = { ...puzzle.solution };
  delete partial[letters[0]];
  assert.equal(isSolved(puzzle.cipher, partial, puzzle.solution), false);

  const wrong = { ...puzzle.solution, [letters[0]]: 'Z' };
  assert.equal(isSolved(puzzle.cipher, wrong, puzzle.solution), false);
});
