# Plouffe Word Games

Word puzzles for the phone. Static site: no dependencies, no build step, no
backend.

- **Cryptogram** — a quote encrypted with a one-to-one letter substitution. Tap a
  coded letter, tap what you think it stands for, and every copy updates at once.
- **Fiver** — find a five-letter word in six guesses. Green is the right place,
  amber is in the word but elsewhere, grey is not in the word.
- **Missing Vowels** — every A, E, I, O and U taken out of a quote. Put them back.
  Y is left alone.
- **Hidden Quote** — the quote starts completely blank. Call a letter and every
  copy of it appears at once; call one that is not in there and it costs a life.
  The only quote game you can lose, and so the only one where being wrong has a
  price rather than just costing time. Its length tiers run **backwards** from
  Cryptogram: a long quote hands you eight copies of a letter at a stroke and then
  more or less reads itself out, so length is the easy tier here and the short
  quotes are the cruel ones.
- **Word Ladder** — get from one four-letter word to another by changing a single
  letter at a time: COLD, CORD, CARD, WARD, WARM. Four letters and not five
  because the "one letter apart" graph is far denser there, which is what makes
  ladders exist at all. Par is the shortest route through familiar words, and
  there is no way to lose.
- **Word Wheel** — seven to nine letters, one of them compulsory, find as many
  words as you can. The only game here that is not a single right answer: reaching
  the target counts as solved, and the board stays open afterwards so you can keep
  hunting. Every wheel is built backwards from a word using all its letters, so
  there is always a best find.
- **Boxed** — twelve letters, three to a side of a square. Chain words end to
  start, using all twelve to win, and two letters in a row may never come from the
  same side. The constraint is the whole difficulty: the letters are common and the
  word list is wide, but the side rule rules out most of what you would otherwise
  type. Every box is built backwards from a two-word solution, so one always
  exists — almost nobody finds it. Words are at least four letters because that is
  where `WORDS` starts, which makes it harder than the usual version of this
  puzzle: three-letter words are exactly what you reach for at an awkward junction.
- **Word Search** — the hidden words are in there somewhere, in a straight line,
  in any direction. Tap the first letter then the last. The only game with no
  keyboard, and the only one that asks nothing of you but scanning.

## Play locally

```sh
npm start          # python3 -m http.server 8000
```

Then open <http://localhost:8000>. A plain file open (`file://`) will not work,
because ES modules require HTTP.

## Test

```sh
npm test           # node --test, no dependencies
```

175 tests over the cipher engine, storage and migration, the shared game
contract, each game's rules, and the two lists that have to stay in step with the
registry (the offline precache and the shell's element ids).

The ones worth knowing about are the generator proofs, because a bad puzzle is
invisible until someone cannot solve it: every ladder is walked with the game's
own hint and has to land in exactly par; every Word Search word has to actually
be in its grid, spelled along its own cells in a straight line; every wheel has
to contain a word using all of its letters; every Boxed board has its two-word
solution replayed through the game's own rules, junction and side checks
included; and no grid may spell anything offensive in any of eight directions.

Three guard the kind of failure that is silent rather than wrong. No shown word
pool may contain anything from the tone list, matched by stem so an inflection
cannot slip through. Every quote in the pack has to leave enough letters *out* of
itself that Hidden Quote can still be lost — a quote using twenty-four letters of
the alphabet would draw a row of pips that can never all go out. And no snapshot
may store a position in a word pool, which is what keeps `words.js` safe to
regenerate.

## Home screen

**The app is two things, so the home screen is two sections.**

**Today** is the day's challenges: a dot per game, and a row per daily still to
play. This section legitimately empties out. When it does it becomes a completion
panel counting down to the next set, rather than nothing.

**Games** is every game, always, whatever the dailies have done. Tapping a row
starts a fresh puzzle. It is never empty, never filtered by progress, and a row
here never changes meaning under you.

That split is deliberate, and an earlier version got it wrong: it sorted one list
by today's state and collapsed the finished games into a `<details>`, so finishing
every daily left an empty screen. This app generates its puzzles from seeded RNG
over a quote pack and a word list, so supply is infinite — structurally it is a
library with a daily attached, not a daily paper. **The daily is an event; the
library is the app.**

Details that matter:

- The **dot meter** covers every game whatever the Games list is filtered to: it
  reports the day, not the current view. A meter rather than a tally, because
  "0 of 14" reads as failure where a row of empty dots reads as an invitation.
- A **lost** daily counts as finished. Fiver can run out of guesses, and offering
  it again under Today would imply a second attempt that does not exist.
- The completion panel does not claim more than it knows. "All caught up" only
  when every daily was *solved*; "Done for today" when one was lost; and the
  streak is only called safe if at least one daily was solved.
- **Everything about one game lives in its own sheet** — rules, difficulty, free
  play, its record. A new game costs two rows, not another card's worth of
  controls. A game you have never opened shows that sheet before the board, from
  either section, so its rules arrive before its first puzzle.
- **Category filter chips** appear once the library passes `FILTER_THRESHOLD`
  games (six), and filter the Games list only. Eight games is where we are, so they
  are on. `Quotes` and `Letters` hold three each; `Guessing` and `Grids` are still
  one apiece, which is honest — a game is filed by what it is, not to balance the
  row.
- The sheets carry a **sticky close button**. At `92dvh` tall there is almost no
  backdrop left to tap, so without it the only way out of a long sheet is to
  scroll to the end of the rules.

No board is built until you tap one, which keeps the played count honest: opening
the app is not playing. The phone's back gesture returns here rather than leaving.

**The daily streak counts consecutive days you finish at least one daily, any
game.** It sits in the header, where it does not scroll away. Free play never
advances it, and the win sheet says so after a free-play solve. Each game also
keeps its own streak, in the stats sheet.

Best times only count hint-free solves, so the record stays meaningful.

## Layout

```
index.html              home, the shared game shell, and four sheets
styles.css              mobile-first, dark + light
manifest.json           PWA metadata
sw.js                   offline cache, network-first
src/main.js             the shell: views, timer, sheets, wiring
src/store.js            namespaced storage, per-game stats, streaks, migration
src/render.js           quote grid + configurable keyboard
src/cipher.js           seeded RNG, derangements, substitution, pool draws
src/quotes.js           the quote pack (Cryptogram, Missing Vowels, Hidden Quote)
src/words.js            GENERATED word lists for Fiver and Word Ladder
src/games/registry.js   the list of games that drives everything
src/games/*.js          one module per game
test/                   node --test suites
tools/make-icons.mjs    regenerates the PNG app icons
tools/make-words.mjs    regenerates src/words.js
```

## Adding a game

1. Write a module in `src/games/` satisfying the same contract as the existing
   eight — `createGame`, `hydrate`, `toSnapshot`, `mount`, `paint`, `onKey`,
   `isSolved`, `statusFor`, and so on. Alongside the rules it declares its own
   presentation: `name`, `blurb`, `icon`, a `category` for the filter chips, a
   `hue` naming one of the `--hue-*` tokens in `styles.css` (the shell paints
   the game's row, tile, board and sheets with it), `howTo`, the lines of plain
   prose its sheet shows, `progress`, the status strip's label / value / max /
   note, and `shareLines`, the spoiler-free lines of its share card -- a test
   fails if a card leaks an answer, a quote or a hidden word.
2. Add it to `src/games/registry.js`.
3. Add its file to `SHELL` in `sw.js`, or it will be missing on a cold offline
   start. There is a test that fails if you forget.

The home row, the library tile, its sheet, the stats row, the dot meter and
progress pruning all follow from the registry; there is no HTML to edit.

Three rules worth knowing:

- **A snapshot stores an identifier, never the puzzle.** Boards are rebuilt from a
  quote index or answer index plus a seed, so a saved game can never disagree with
  its own puzzle. There is a test that enforces this.
- **The shell owns `solved` and `lost`.** A module reports via `isSolved` and
  `isLost` and must not set the flags itself; the shell uses them to tell a board
  that has just finished from one that was already finished when opened.
- **`howTo` is prose, not markup.** It is rendered with `textContent`, and a test
  rejects angle brackets.
- **A game may declare `keyboard: null`** and play entirely on the board, as Word
  Search does. The shell then hides the key row and hands its height back. If a
  tap on the board can *finish* the puzzle, `onSelect` must return a move result;
  return nothing and the shell only repaints, so the win never fires.

## Adding your own quotes

Append to the array in `src/quotes.js`:

```js
{ text: 'Something worth decoding.', author: 'Someone' },
```

Keep it between 20 and 160 characters and ASCII-only — curly quotes, accents and
em-dashes break cell alignment and have no key on the on-screen keyboard. Running
on localhost logs a console warning for anything that breaks those rules.

The pack is 805 quotes across 303 authors. Two conventions the validator does not
enforce but the whole pack follows:

- **No apostrophes**, and in fact nothing outside `.` `,` `:` `?`. There is no
  apostrophe key on the on-screen keyboard, so prefer a quote that does not need
  one — `do not` for `don't` is fine, but rewriting someone's sentence to dodge a
  possessive is not. Pick a different quote instead.
- **Append, never insert.** A snapshot stores an index into the whole pack, so
  adding to the end keeps every saved game pointing at the quote it was playing.
  This is the cheap counterpart to regenerating `words.js`: appending does move
  which quote each *unplayed* daily will draw, because the pick is taken modulo a
  length-filtered slice, but it cannot disturb a board someone is midway through.

## Word lists

`node tools/make-words.mjs` regenerates `src/words.js` from the system dictionary
(`wamerican` and `cracklib-runtime` on Debian/Ubuntu). The output is committed, so
the app never depends on those files being installed.

The same split is behind every game: a common pool for what a game **shows** you,
and a wider pool for what it **accepts**. Drawing puzzles from the full list gives
miserable ones like `CALKS`; accepting only common words makes a game feel broken
when a real word is rejected.

`WORDS` is the one wide pool — every four-to-nine letter word. Fiver's `GUESSES`
and Word Ladder's `LADDER_WORDS` are sliced out of it by length at load rather
than shipped again, so no word is stored twice.

| shown pool | | drawn from |
|---|---|---|
| `ANSWERS` 2,253 | five letters | Fiver's puzzles |
| `LADDER_COMMON` 1,436 | four letters | ladder endpoints and path graph |
| `WHEEL_SOURCES` 3,600 | seven to nine | the word a wheel is built from |
| `SEARCH_WORDS` 1,800 | four to eight | what gets hidden in a grid |

Boxed adds no pool of its own. It builds from `WHEEL_SOURCES` and `SEARCH_WORDS`
together and checks typed words against `WORDS`, which is deliberate now that
regenerating is known to be expensive — see below. There are about 124,000 word
pairs in those two pools that cover exactly twelve distinct letters and admit a
legal dealing onto four sides, so the supply was never the reason to ship more
data.

`words.js` is 443KB raw, 150KB gzipped, and is by far the largest thing the app
ships. Word Wheel is what needs the wide pool: in a find-as-many-as-you-can game
you type rejected words constantly, so a narrow list would feel broken several
times a minute.

Three filters run over the lot:

- **Vulgarity and slurs.** The inputs are a spellchecker corpus and a password
  cracker's corpus, so both carry the lot — Fiver's answer pool shipped with
  `WHORE` in it until this was added. Stripped from the accepted lists too, not
  just the shown ones: a refused word is a far smaller cost than one appearing on
  a board. Ordinary vocabulary that merely sounds rude out of context is
  deliberately kept.
- **A hand-curated four-letter blocklist.** `cracklib-small` is a decent
  commonness proxy at five letters and a poor one at four, where it happily
  contains `LOGE`, `SLOE`, `LASE` and `WALE`, plus `BLVD`, `IBID` and `VIII`.
  There is no frequency list to do better with, so this is curated by hand and
  grows as bad ones surface in play.
- **A short "accept but never show" list.** `SEXUAL`, `EROTIC`, `KINKY` and a few
  others are ordinary English that the games will happily take if you type them,
  but will not put on a board. Deliberately short: `BREAST`, `THIGH`, `GROIN`,
  `DRUNK` and `OPIUM` are all ordinary words crosswords use without comment, and
  filtering those would be prudishness rather than judgement. Suffix-expanded like
  the profanity stems, and for the same reason — as an exact-match list it leaked
  inflections, and `SEXUALITY` shipped as a Word Wheel source while `SEXUALLY`
  shipped in `SEARCH_WORDS`. `LUSTROUS` and `KINK` are allowed back by hand.

**Regenerating used to be ruinous, and is now cheap.** This is worth
understanding before touching a blocklist, because the four-letter one is expected
to keep growing.

Two things both worked by position. `spread()` thinned a capped pool by striding
the filtered list, so removing one word shifted every index after it and resampled
the whole pool. And every game drew its puzzle with `pool[rand() * pool.length]`,
so a shifted pool re-rolled essentially every board. Measured on a single
four-letter blocklist addition: **99.9% of a year of Word Search dailies moved.**
Worse, three games stored a *position* in their snapshot — `answerIndex`,
`sourceIndex`, `startIndex`/`goalIndex` — so a regeneration silently repointed
saved games at other puzzles. `words.js` was effectively part of the save format.

Both are now content-addressed:

- `spread()` keeps the lowest-ranked words by a hash of each word, so a pool that
  loses one entry loses exactly that entry.
- `orderBySeed` and `pickBySeed` in `cipher.js` rank candidates by a hash of the
  seed and the word. A board is a pure function of its seed and the pool's
  membership, and depends on no word's position.
- No snapshot stores a pool position. Word Ladder and Boxed store the words —
  both are shown to the player anyway — and Fiver and Word Wheel re-derive from
  the seed. There is a test enforcing it, and legacy saves carrying an old index
  rebuild from their seed rather than opening the wrong puzzle.

The same one-word blocklist addition now moves 1.55% of Word Search dailies, 0.09%
of Word Ladder, and none at all of Word Wheel or Fiver — and the boards that do
move are exactly the ones that contained the word you removed. Regenerating is
still not *nothing*, but it is now proportionate to the edit.

The lists derive from SCOWL, whose licence permits redistribution provided its
copyright notice travels along — it is reproduced at the top of `src/words.js`.

## Icons

`node tools/make-icons.mjs` regenerates `icons/icon-192.png` and
`icons/icon-512.png`, plus the store-asset sources in `native/assets/` (the
1024 App Store icon, the Android adaptive-icon pair, and the splash squares).
It rasterizes the mark and encodes the PNG with Node's built-in `zlib`, so it
needs no image tooling installed. Keep `icons/icon.svg` in sync if you change
the geometry.

## Native apps

`native/` holds Capacitor shells that package this same app for the App Store
and Google Play — see `native/README.md`. The web app is unaffected: the only
web-side file involved is `src/native.js`, which detects the injected Capacitor
runtime and no-ops in a browser. All npm tooling is quarantined inside
`native/`; the root stays dependency-free.
