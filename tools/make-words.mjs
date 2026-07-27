// Generates src/words.js from the system dictionary, for all four games that
// need words: Fiver (five letters), Word Ladder (four), Word Wheel (four to
// nine) and Word Search.
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
// The same split is behind every game: a wide pool of what will be ACCEPTED, and
// a narrower common pool of what the game will SHOW. Accepting only common words
// makes a game feel broken when a real word is rejected; drawing puzzles from the
// full list produces miserable ones like CALKS or CLIPT.
//
// WORDS is the one wide pool, four to nine letters. Fiver's GUESSES and Word
// Ladder's LADDER_WORDS are sliced out of it by length at load rather than
// shipped again, so no word is stored twice.
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

// --- vulgarity and slurs ----------------------------------------------------
//
// Stripped from every list at every length. The dictionaries are a spellchecker
// corpus and a password cracker's corpus, so both carry the lot -- Fiver's
// answer pool shipped with WHORE in it until this was added -- and widening to
// four-to-nine letters pulls in every inflection besides.
//
// Stems are expanded by suffix and then intersected with the dictionary, so
// nothing invented survives. Substring matching is NOT an option: 'cunt' sits
// inside Scunthorpe and 'ass' inside class, pass, brass and assassin.
//
// Filtered from the accepted lists too, not just the shown ones. Rejecting a
// real word normally "feels like a bug", which is why the wide pools exist, but
// that argument does not survive contact with a slur on a board someone's kid is
// looking at. These are rare enough in play that nobody will notice.
const PROFANE_STEMS = [
  'fuck', 'shit', 'bullshit', 'cunt', 'wank', 'bugger', 'bollock', 'twat',
  'whore', 'slut', 'turd', 'fart', 'poop', 'piss', 'bitch', 'bastard',
  'asshole', 'arsehole', 'asswipe', 'dipshit', 'jackass', 'dumbass',
  'shithead', 'fuckwit', 'wanker', 'tosser', 'skank', 'slag', 'hooker',
  'hooters', 'pimp', 'porn', 'penis', 'vagina', 'testicle', 'scrotum',
  'nipple', 'orgasm', 'ejaculate', 'masturbate', 'erection', 'boner', 'semen',
  'sperm', 'anus', 'rectum', 'buttock', 'brothel', 'prostitute', 'incest',
  'molest', 'rape', 'rapist', 'nigger', 'nigga', 'chink', 'gook', 'wetback',
  'kike', 'honky', 'dago', 'paki', 'coon', 'darkie', 'raghead', 'towelhead',
  'redneck', 'faggot', 'fag', 'dyke', 'tranny', 'queer', 'retard', 'spastic',
  'mongoloid', 'cripple', 'midget', 'crap',
];

// Not worth a stem, because inflecting them would sweep up ordinary words.
// PRICK is the clearest case: pricked, pricking and prickly are all innocent.
const PROFANE_EXTRA = new Set([
  'bimbo', 'boob', 'boobs', 'clit', 'cock', 'cocks', 'dick', 'dicks', 'fanny',
  'hoes', 'horny', 'muff', 'nudes', 'orgy', 'porno', 'prick', 'pricks',
  'pussy', 'shag', 'smut', 'tits',
]);

// Innocent words the stem expansion catches by accident. Every one of these is
// ordinary English and filtering it would make the word lists worse.
const PROFANE_ALLOW = new Set([
  'cracker', 'crackers', 'crapes', 'dicker', 'dickers', 'dickies', 'dicky',
  'spiced', 'spices', 'spicing', 'spicy', 'damn', 'damned', 'damning', 'damns',
]);

// Ordinary vocabulary that is fine to ACCEPT but awkward to SHOW. The games
// never put these on a board, and never refuse them either -- the same
// shown-versus-accepted split as everywhere else, applied to tone rather than to
// obscurity.
//
// Kept deliberately short. BREAST, THIGH, GROIN, DRUNK and OPIUM are all
// ordinary English that crosswords use without comment, and filtering them would
// be prudishness rather than judgement.
const NOT_SHOWN = new Set([
  'sexual', 'sexy', 'erotic', 'lust', 'lusty', 'nude', 'fetish', 'kinky',
  'thong', 'bosom',
]);

const PROFANE = (() => {
  const out = new Set(PROFANE_EXTRA);
  const suffixes = ['', 's', 'es', 'ed', 'd', 'ing', 'er', 'ers', 'y', 'ies', 'ish'];
  for (const stem of PROFANE_STEMS) {
    for (const suffix of suffixes) {
      out.add(stem + suffix);
      // hit -> hitting, and rape -> raping.
      if (/[bdgklmnprt]$/.test(stem)) out.add(stem + stem.slice(-1) + suffix);
      if (stem.endsWith('e')) out.add(stem.slice(0, -1) + suffix);
    }
  }
  for (const allowed of PROFANE_ALLOW) out.delete(allowed);
  return out;
})();

// Four-letter words that survive the "commonness" intersection but should never
// be a Word Ladder rung or endpoint.
//
// cracklib-small is a password cracker's corpus, which makes it a decent
// commonness proxy at five letters and a poor one at four: it happily contains
// LOGE, SLOE, LASE, WALE and FINK, and the machine has no frequency list to do
// better with (aspell's "en-common" means common to all English *variants*, not
// common by usage -- it has 120k entries). So this is curated by hand and grows
// as bad ones surface in play.
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
const ofLength = (list, n) =>
  new Set(
    list
      .map((w) => w.trim())
      .filter((w) => new RegExp(`^[a-z]{${n}}$`).test(w))
      .filter((w) => !PROFANE.has(w))
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
  .filter((w) => !NOT_SHOWN.has(w))
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
  .filter((w) => !NOT_SHOWN.has(w))
  .sort();

const sortedLadderWords = [...ladderWords].sort();

// --- Word Wheel and Word Search ---------------------------------------------
//
// WORDS is the wide pool both share, four to nine letters. Word Wheel checks
// every word you type against it, and that is the one place a permissive list
// matters most: in a find-as-many-as-you-can game you type rejected words
// constantly, so a narrow list would feel broken several times a minute.
//
// WHEEL_SOURCES are the words a wheel is built from -- its letters become the
// wheel and it is guaranteed findable. Capped per length, because a few thousand
// distinct puzzles is already more than anyone will see, and every extra word is
// payload.
//
// SEARCH_WORDS are what gets hidden in a Word Search grid. Short and common on
// purpose: you are scanning for these, not deducing them.

const WHEEL_LENGTHS = [7, 8, 9];
const SOURCES_PER_LENGTH = 1200;
const SEARCH_CAP = 1800;

const words = ofLength(dictWords, '4,9');
const commonAll = ofLength(commonWords, '4,9');

const sortedWords = [...words].sort();

// Deterministic thinning rather than the alphabetical head, so a capped pool is
// not all A words.
function spread(list, cap) {
  if (list.length <= cap) return list;
  const step = list.length / cap;
  const out = [];
  for (let i = 0; i < cap; i++) out.push(list[Math.floor(i * step)]);
  return out;
}

const wheelSources = WHEEL_LENGTHS.flatMap((n) =>
  spread(
    sortedWords
      .filter((w) => w.length === n)
      .filter((w) => commonAll.has(w))
      // A source with too few distinct letters makes a wheel with nothing on it.
      .filter((w) => new Set(w).size >= n - 2)
      .filter((w) => !NOT_SHOWN.has(w)),
    SOURCES_PER_LENGTH
  )
).sort();

// At four and five letters the curated pools already exist, so reuse them
// rather than going back to the raw cracklib intersection: those two lengths
// have been through a hand blocklist that the intersection has not.
const searchWords = spread(
  [
    ...ladderCommon,
    ...answers,
    ...sortedWords
      .filter((w) => w.length >= 6 && w.length <= 8)
      .filter((w) => commonAll.has(w))
      .filter((w) => !/(s|ed)$/.test(w)),
  ]
    .filter((w) => !NOT_SHOWN.has(w))
    .sort(),
  SEARCH_CAP
);

// Everything a game shows has to be something it also accepts.
for (const [label, shown] of [
  ['wheel sources', wheelSources],
  ['search words', searchWords],
]) {
  const orphans = shown.filter((w) => !words.has(w));
  if (orphans.length) {
    console.error(`${label} missing from WORDS: ${orphans.slice(0, 5).join(', ')}`);
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
// WORDS (${sortedWords.length}) is the wide pool: every four-to-nine letter word, and what a
// typed word is checked against. Fiver's GUESSES and Word Ladder's LADDER_WORDS
// are sliced out of it by length at load rather than stored again.
//
// The narrower pools are what each game will actually show you:
//   ANSWERS (${answers.length})        five letters, Fiver's puzzles
//   LADDER_COMMON (${ladderCommon.length})  four letters, ladder endpoints and path graph
//   WHEEL_SOURCES (${wheelSources.length})   the words a Word Wheel is built from
//   SEARCH_WORDS (${searchWords.length})    what gets hidden in a Word Search grid
//
// Vulgarity and slurs are stripped from every one of them; see PROFANE_STEMS in
// the script. Obscure four-letter words are stripped too; see LADDER_BLOCKLIST.
//
// Stored as space-joined strings to keep the file readable and the payload small.
//
/* ${SCOWL_NOTICE}
 */

const WORD_DATA = [
${chunk(sortedWords)}
].join(' ');

const ANSWER_DATA = [
${chunk(answers)}
].join(' ');

const LADDER_COMMON_DATA = [
${chunk(ladderCommon)}
].join(' ');

const WHEEL_SOURCE_DATA = [
${chunk(wheelSources)}
].join(' ');

const SEARCH_DATA = [
${chunk(searchWords)}
].join(' ');

const ALL = WORD_DATA.split(' ');

/** @type {Set<string>} every four-to-nine letter word, the widest pool */
export const WORDS = new Set(ALL);

/** @type {Set<string>} every five-letter word Fiver accepts as a guess */
export const GUESSES = new Set(ALL.filter((w) => w.length === 5));

/** @type {Set<string>} every four-letter word Word Ladder accepts as a rung */
export const LADDER_WORDS = new Set(ALL.filter((w) => w.length === 4));

/** @type {string[]} common five-letter words, the Fiver puzzle pool */
export const ANSWERS = ANSWER_DATA.split(' ');

/** @type {string[]} common four-letter words: ladder endpoints and path graph */
export const LADDER_COMMON = LADDER_COMMON_DATA.split(' ');

/** @type {string[]} seven to nine letters, the words a Word Wheel is built from */
export const WHEEL_SOURCES = WHEEL_SOURCE_DATA.split(' ');

/** @type {string[]} short common words, hidden in a Word Search grid */
export const SEARCH_WORDS = SEARCH_DATA.split(' ');
`;

const target = join(ROOT, 'src', 'words.js');
writeFileSync(target, out);
console.log(`wrote ${target}`);
console.log(`  words 4-9:     ${sortedWords.length}`);
console.log(`    of which 5:  ${sortedGuesses.length}  (Fiver GUESSES)`);
console.log(`    of which 4:  ${sortedLadderWords.length}  (LADDER_WORDS)`);
console.log(`  answers:       ${answers.length}`);
console.log(`  ladder common: ${ladderCommon.length}`);
console.log(`  wheel sources: ${wheelSources.length}`);
console.log(`  search words:  ${searchWords.length}`);
console.log(`  size:          ${(out.length / 1024).toFixed(1)}KB raw`);
