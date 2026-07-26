// Generates src/words.js from the system dictionary, for Fiver (five letters)
// and Word Ladder (four).
//
// Run: node tools/make-words.mjs
//
// The output is committed, so the app never depends on this machine's
// dictionaries. Re-run only when changing the filters or the blocklists.
//
// Inputs (Debian: wamerican, cracklib-runtime):
//   /usr/share/dict/american-english   SCOWL-derived, ~104k words
//   /usr/share/dict/cracklib-small     used purely as a "commonness" proxy
//
// Four lists come out, two per game, and the same split is behind both:
//   GUESSES / LADDER_WORDS    every word of that length -- what will be accepted
//   ANSWERS / LADDER_COMMON   a common subset -- what the game itself will show
//
// The split matters: accepting only common words makes the game feel broken when
// a real word is rejected, while drawing puzzles from the full list produces
// miserable ones like CALKS or CLIPT.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DICT = '/usr/share/dict/american-english';
const COMMON = '/usr/share/dict/cracklib-small';

// SCOWL's licence requires this notice to travel with any redistribution of the
// word lists or of output derived from them.
const SCOWL_NOTICE = `The word lists below are derived from SCOWL (Spell Checker Oriented Word
 * Lists), by Kevin Atkinson, as shipped in Debian's "wamerican" package.
 *
 *   Copyright 2000-2011 by Kevin Atkinson
 *
 *   Permission to use, copy, modify, distribute and sell these word lists,
 *   the associated scripts, the output created from the scripts, and its
 *   documentation for any purpose is hereby granted without fee, provided
 *   that the above copyright notice appears in all copies and that both that
 *   copyright notice and this permission notice appear in supporting
 *   documentation. Kevin Atkinson makes no representations about the
 *   suitability of this array for any purpose. It is provided "as is"
 *   without express or implied warranty.`;

// Words that pass the filters but make poor answers: too obscure, archaic, or
// regional. Extend this as bad ones surface in play.
const BLOCKLIST = new Set([
  'pewee', 'bosun', 'loamy', 'briar', 'maria', 'hydra', 'liven', 'gismo',
  'calks', 'mavin', 'boink', 'clipt', 'anise', 'coven', 'jells', 'grads',
  'stoke', 'skimp', 'abyss', 'adieu', 'amino', 'sleds', 'wharf', 'pikes',
  'skied', 'piped', 'slang', 'lathe', 'louse', 'macho', 'brash', 'navel',
  'briers', 'aphid', 'bilge', 'cadre', 'demur', 'dross', 'egret', 'fetid',
  'gamut', 'hoary', 'ingot', 'knurl', 'lemur', 'mirth', 'natty', 'offal',
  'pique', 'quire', 'rusks', 'sepia', 'tepid', 'unlit', 'vixen', 'welts',
  'xylem', 'yokel', 'zebus', 'tromp', 'twain', 'unhip', 'vends', 'wonts',
]);

// Vulgarity and slurs, stripped from every list at both lengths.
//
// The dictionaries are a spellchecker corpus and a password cracker's corpus,
// so both carry the lot. Without this, Fiver will hand you WHORE as the daily --
// it was in the shipped answer pool -- and four letters is where most of the
// rest lives, so Word Ladder would be far worse.
//
// Filtered from the accepted lists too, not just the shown ones. Rejecting a
// real word normally "feels like a bug", which is why GUESSES is deliberately
// wide, but that argument does not survive contact with a slur appearing on a
// board someone's kid is looking at. These are rare enough in play that nobody
// will notice the refusal.
//
// Deliberately NOT here: ordinary vocabulary that merely sounds rude out of
// context -- BALLS, NAKED, SCREW, RANDY, LUSTY, KILL, DEAD, DUMB, HELL, DAMN,
// BUTT, KNOB. Over-filtering makes the word lists worse and the game prudish.
const PROFANITY = new Set([
  'anus', 'bimbo', 'bitch', 'boner', 'boob', 'boobs', 'chink', 'clit', 'cock',
  'coon', 'coons', 'crap', 'craps', 'cunt', 'cunts', 'dick', 'dyke', 'dykes',
  'fags', 'fanny', 'fart', 'farts', 'fuck', 'fucks', 'gook', 'gooks', 'hoes',
  'horny', 'muff', 'nigga', 'nudes', 'orgy', 'penis', 'pimp', 'piss', 'poop',
  'poops', 'porn', 'porno', 'prick', 'pussy', 'queer', 'rape', 'semen', 'shag',
  'shit', 'shits', 'slag', 'slut', 'smut', 'tits', 'turd', 'turds', 'wank',
  'wanks', 'whore',
]);

// Four-letter words that survive the "commonness" intersection but should never
// be a ladder rung or endpoint.
//
// cracklib-small is a password cracker's corpus, which makes it a decent
// commonness proxy at five letters and a poor one at four: it happily contains
// LOGE, SLOE, LASE, WALE and FINK, and the machine has no frequency list to do
// better with (aspell's "en-common" means common to all English *variants*, not
// common by usage -- it has 120k entries). So this is curated by hand, the same
// way Fiver's BLOCKLIST is, and grows as bad ones surface in play.
//
// Grouped by why they are out: archaic or literary, technical, dialect, Latin,
// abbreviations, and roman numerals -- BLVD, IBID, CORP, SITU and VIII were all
// in the pool and would have made nonsense ladders.
const LADDER_BLOCKLIST = new Set([
  'abed', 'agar', 'agog', 'ague', 'alga', 'anal', 'anon', 'apse', 'ashy', 'aver',
  'axon', 'bade', 'bate', 'baud', 'beck', 'berg', 'bevy', 'bide', 'bier', 'bilk',
  'blat', 'blvd', 'bogy', 'bole', 'boll', 'bong', 'boor', 'brad', 'brig', 'burg',
  'burr', 'cant', 'chad', 'chit', 'cloy', 'coda', 'coed', 'coot', 'corp', 'craw',
  'dale', 'daub', 'dell', 'dewy', 'dike', 'dint', 'doff', 'dolt', 'dour', 'dram',
  'drub', 'duff', 'dyer', 'eave', 'eddy', 'eked', 'ergo', 'espy', 'fain', 'faun',
  'fest', 'fief', 'fife', 'fink', 'flub', 'flue', 'foci', 'fogy', 'furl', 'gaff',
  'gage', 'geld', 'gibe', 'gild', 'gilt', 'gird', 'girt', 'hale', 'hank', 'hart',
  'hasp', 'hath', 'heft', 'hewn', 'hick', 'hock', 'hove', 'hued', 'ibex', 'ibid',
  'jibe', 'jilt', 'john', 'jowl', 'jute', 'lain', 'lank', 'lase', 'lath', 'laud',
  'laze', 'lien', 'lilt', 'loam', 'loci', 'loge', 'loll', 'lope', 'lyre', 'mart',
  'mead', 'meld', 'mesa', 'mete', 'mica', 'mien', 'miff', 'mike', 'moll', 'molt',
  'morn', 'mung', 'murk', 'nape', 'nary', 'nave', 'nigh', 'pate', 'peal', 'peed',
  'pend', 'pent', 'pica', 'pith', 'pixy', 'pooh', 'posy', 'prig', 'prow', 'purl',
  'quay', 'rend', 'rhea', 'rick', 'rill', 'rime', 'roil', 'rood', 'rout', 'rove',
  'rube', 'ruff', 'rusk', 'sago', 'sate', 'scat', 'scow', 'scud', 'sera', 'shad',
  'shim', 'shod', 'situ', 'sloe', 'soya', 'spec', 'tabu', 'tamp', 'teat', 'tern',
  'tine', 'tong', 'tony', 'trig', 'troy', 'vale', 'viii', 'vise', 'viva', 'wack',
  'wadi', 'wale', 'weal', 'weir', 'whir', 'whit', 'wile', 'wino', 'wive', 'wont',
  'yawl', 'yore',
]);

function readWords(path) {
  try {
    return readFileSync(path, 'utf8').split('\n');
  } catch (err) {
    console.error(`Cannot read ${path}: ${err.message}`);
    console.error('On Debian/Ubuntu: sudo apt install wamerican cracklib-runtime');
    process.exit(1);
  }
}

// Test the word as written, without lowercasing first: the dictionary holds
// proper nouns and possessives too, and folding case would let Aaron and Wales
// through as ordinary words.
const ofLength = (words, n) =>
  new Set(
    words
      .map((w) => w.trim())
      .filter((w) => new RegExp(`^[a-z]{${n}}$`).test(w))
      .filter((w) => !PROFANITY.has(w))
  );

const dictWords = readWords(DICT);
const commonWords = readWords(COMMON);

// --- Fiver: five letters ----------------------------------------------------

const guesses = ofLength(dictWords, 5);
const common = ofLength(commonWords, 5);

const answers = [...guesses]
  .filter((w) => common.has(w))
  // Plurals and past tenses are legal guesses but tedious answers, and a five
  // letter word ending in S is nearly always the plural of a four letter one.
  .filter((w) => !/(s|ed)$/.test(w))
  .filter((w) => !BLOCKLIST.has(w))
  .sort();

const sortedGuesses = [...guesses].sort();

// --- Word Ladder: four letters ----------------------------------------------
//
// LADDER_COMMON is both the endpoint pool and the graph the generator walks, so
// the guaranteed shortest path only ever runs through words a player knows.
// LADDER_WORDS is wider and is what a typed rung is checked against, so taking
// your own route through a legal-but-uncommon word is never refused.
//
// Plurals are dropped from the common pool because a ladder that is really
// "add an S" is not a puzzle.

const ladderWords = ofLength(dictWords, 4);
const ladderCommonSet = ofLength(commonWords, 4);

const ladderCommon = [...ladderWords]
  .filter((w) => ladderCommonSet.has(w))
  .filter((w) => !/s$/.test(w))
  .filter((w) => !LADDER_BLOCKLIST.has(w))
  .sort();

const sortedLadderWords = [...ladderWords].sort();

// Every shown word must also be an accepted one, or a game could refuse its own
// solution. Cheap to assert here rather than discover in play.
for (const [label, shown, accepted] of [
  ['answers', answers, guesses],
  ['ladder endpoints', ladderCommon, ladderWords],
]) {
  const orphans = shown.filter((w) => !accepted.has(w));
  if (orphans.length) {
    console.error(`${label} missing from the accepted list: ${orphans.join(', ')}`);
    process.exit(1);
  }
}

const chunk = (words) =>
  words
    .reduce((lines, w, i) => {
      if (i % 10 === 0) lines.push([]);
      lines[lines.length - 1].push(w);
      return lines;
    }, [])
    .map((line) => `  '${line.join(" ")}',`)
    .join('\n');

const out = `// Word lists. GENERATED by tools/make-words.mjs -- do not edit by hand.
//
// Fiver, five letters:
//   ANSWERS (${answers.length}) is the pool it draws puzzles from: common words only.
//   GUESSES (${sortedGuesses.length}) is everything it accepts you typing, which is much wider,
//   because rejecting a real word feels like a bug even when the word is obscure.
//
// Word Ladder, four letters:
//   LADDER_COMMON (${ladderCommon.length}) is the endpoint pool and the graph the generator
//   walks, so the guaranteed shortest path only runs through familiar words.
//   LADDER_WORDS (${sortedLadderWords.length}) is what a typed rung is checked against.
//
// Vulgarity and slurs are stripped from all four; see PROFANITY in the script.
//
// Stored as space-joined strings to keep the file readable and the payload small.
//
/* ${SCOWL_NOTICE}
 */

const ANSWER_DATA = [
${chunk(answers)}
].join(' ');

const GUESS_DATA = [
${chunk(sortedGuesses)}
].join(' ');

const LADDER_COMMON_DATA = [
${chunk(ladderCommon)}
].join(' ');

const LADDER_WORD_DATA = [
${chunk(sortedLadderWords)}
].join(' ');

/** @type {string[]} common five-letter words, the Fiver puzzle pool */
export const ANSWERS = ANSWER_DATA.split(' ');

/** @type {Set<string>} every five-letter word Fiver accepts as a guess */
export const GUESSES = new Set(GUESS_DATA.split(' '));

/** @type {string[]} common four-letter words: ladder endpoints and path graph */
export const LADDER_COMMON = LADDER_COMMON_DATA.split(' ');

/** @type {Set<string>} every four-letter word Word Ladder accepts as a rung */
export const LADDER_WORDS = new Set(LADDER_WORD_DATA.split(' '));
`;

const target = join(ROOT, 'src', 'words.js');
writeFileSync(target, out);
console.log(`wrote ${target}`);
console.log(`  answers:       ${answers.length}`);
console.log(`  guesses:       ${sortedGuesses.length}`);
console.log(`  ladder common: ${ladderCommon.length}`);
console.log(`  ladder words:  ${sortedLadderWords.length}`);
console.log(`  size:          ${(out.length / 1024).toFixed(1)}KB raw`);
