// Cipher engine: seeded RNG, derangements, substitution encryption.
// Kept free of DOM references so it can run under `node --test`.

export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Mulberry32 PRNG. Small, fast, and deterministic for a given seed, which is
 * what makes the daily puzzle identical across reloads and devices.
 * @param {number} seed
 * @returns {() => number} generator producing floats in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * FNV-1a style hash of an arbitrary string down to a 32-bit seed.
 * @param {string} str
 * @returns {number}
 */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Local calendar date as YYYY-MM-DD. Deliberately local rather than UTC so the
 * daily puzzle rolls over at the player's midnight.
 * @param {Date} [date]
 * @returns {string}
 */
export function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Random A-Z permutation with no fixed points. A letter that maps to itself is
 * a giveaway and reads as a bug, so offenders are swapped out until none remain.
 * @param {() => number} rng
 * @returns {Record<string, string>} plaintext letter -> cipher letter
 */
export function makeDerangement(rng) {
  const letters = ALPHABET.split('');
  const perm = letters.slice();

  for (let i = perm.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }

  // Repair fixed points. Swapping with a random other index can introduce a new
  // fixed point at the partner, so loop until a full clean pass.
  let clean = false;
  while (!clean) {
    clean = true;
    for (let i = 0; i < perm.length; i++) {
      if (perm[i] !== letters[i]) continue;
      clean = false;
      let j = Math.floor(rng() * perm.length);
      if (j === i) j = (i + 1) % perm.length;
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
  }

  const mapping = {};
  letters.forEach((letter, i) => {
    mapping[letter] = perm[i];
  });
  return mapping;
}

/**
 * Invert a letter mapping.
 * @param {Record<string, string>} mapping
 * @returns {Record<string, string>}
 */
export function invertMapping(mapping) {
  const out = {};
  for (const [from, to] of Object.entries(mapping)) out[to] = from;
  return out;
}

/**
 * Apply a substitution. Spaces, punctuation and digits pass through untouched
 * so the shape of the sentence survives, which is what makes it solvable.
 * @param {string} text
 * @param {Record<string, string>} mapping
 * @returns {string}
 */
export function encrypt(text, mapping) {
  let out = '';
  const upper = text.toUpperCase();
  for (const ch of upper) out += mapping[ch] ?? ch;
  return out;
}

/**
 * Count occurrences of each cipher letter, most frequent first.
 * @param {string} cipherText
 * @returns {Array<{ letter: string, count: number }>}
 */
export function letterFrequency(cipherText) {
  const counts = new Map();
  for (const ch of cipherText.toUpperCase()) {
    if (ch < 'A' || ch > 'Z') continue;
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([letter, count]) => ({ letter, count }))
    .sort((a, b) => b.count - a.count || a.letter.localeCompare(b.letter));
}

/**
 * Choose cipher letters to reveal for free.
 *
 * Selection is weighted toward frequent letters: revealing a lone Z opens
 * nothing, while revealing the most common letter cracks the puzzle open. Some
 * randomness is kept so the same difficulty doesn't always gift the same rank.
 *
 * @param {string} cipherText
 * @param {number} count how many distinct cipher letters to reveal
 * @param {() => number} rng
 * @returns {string[]} cipher letters
 */
export function pickPrefillLetters(cipherText, count, rng) {
  const freq = letterFrequency(cipherText);
  if (count <= 0 || freq.length === 0) return [];

  const pool = freq.slice();
  const chosen = [];
  const target = Math.min(count, pool.length);

  while (chosen.length < target && pool.length > 0) {
    // Weight by count so frequent letters win more often without being certain.
    const total = pool.reduce((sum, entry) => sum + entry.count, 0);
    let roll = rng() * total;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      roll -= pool[i].count;
      if (roll <= 0) {
        index = i;
        break;
      }
    }
    chosen.push(pool[index].letter);
    pool.splice(index, 1);
  }

  return chosen;
}

/**
 * Build a complete puzzle from a quote.
 * @param {{ text: string, author: string }} quote
 * @param {number} seed
 * @param {number} prefillCount distinct cipher letters given away at the start
 * @returns {{
 *   plain: string, cipher: string, author: string,
 *   mapping: Record<string,string>, solution: Record<string,string>,
 *   prefilled: string[]
 * }}
 */
export function buildPuzzle(quote, seed, prefillCount) {
  const rng = mulberry32(seed);
  const mapping = makeDerangement(rng);
  const plain = quote.text.toUpperCase();
  const cipher = encrypt(plain, mapping);
  return {
    plain,
    cipher,
    author: quote.author,
    mapping,
    // cipher letter -> the plaintext letter it stands for
    solution: invertMapping(mapping),
    prefilled: pickPrefillLetters(cipher, prefillCount, rng),
  };
}

/**
 * Distinct cipher letters appearing in a puzzle.
 * @param {string} cipherText
 * @returns {string[]}
 */
export function distinctLetters(cipherText) {
  return letterFrequency(cipherText).map((entry) => entry.letter);
}

/**
 * True when every letter position has been assigned its correct plaintext letter.
 * @param {string} cipherText
 * @param {Record<string, string>} guesses cipher letter -> guessed letter
 * @param {Record<string, string>} solution cipher letter -> correct letter
 * @returns {boolean}
 */
export function isSolved(cipherText, guesses, solution) {
  for (const letter of distinctLetters(cipherText)) {
    if (guesses[letter] !== solution[letter]) return false;
  }
  return true;
}
