# Plouffe Word Games

Word puzzles for the phone. Static site: no dependencies, no build step, no
backend.

- **Cryptogram** — a quote encrypted with a one-to-one letter substitution. Tap a
  coded letter, tap what you think it stands for, and every copy updates at once.
- **Fiver** — find a five-letter word in six guesses. Green is the right place,
  amber is in the word but elsewhere, grey is not in the word.
- **Missing Vowels** — every A, E, I, O and U taken out of a quote. Put them back.
  Y is left alone.
- **Word Ladder** — get from one four-letter word to another by changing a single
  letter at a time: COLD, CORD, CARD, WARD, WARM. Four letters and not five
  because the "one letter apart" graph is far denser there, which is what makes
  ladders exist at all. Par is the shortest route through familiar words, and
  there is no way to lose.

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

129 tests over the cipher engine, storage and migration, the shared game
contract, each game's rules — including the duplicate-letter cases that make
Fiver's scoring easy to get wrong, and proof that every generated ladder is
solvable in exactly par — and the two lists that have to stay in step with the
registry (the offline precache and the shell's element ids).

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
  games (six), and filter the Games list only.
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
src/cipher.js           seeded RNG, derangements, substitution
src/quotes.js           the quote pack (shared by Cryptogram and Missing Vowels)
src/words.js            GENERATED word lists for Fiver and Word Ladder
src/games/registry.js   the list of games that drives everything
src/games/*.js          one module per game
test/                   node --test suites
tools/make-icons.mjs    regenerates the PNG app icons
tools/make-words.mjs    regenerates src/words.js
```

## Adding a game

1. Write a module in `src/games/` satisfying the same contract as the existing
   four — `createGame`, `hydrate`, `toSnapshot`, `mount`, `paint`, `onKey`,
   `isSolved`, `statusFor`, and so on. Alongside the rules it declares its own
   presentation: `name`, `blurb`, `icon`, a `category` for the filter chips, and
   `howTo`, the lines of plain prose its sheet shows.
2. Add it to `src/games/registry.js`.
3. Add its file to `SHELL` in `sw.js`, or it will be missing on a cold offline
   start. There is a test that fails if you forget.

The home row, its sheet, the stats row, the dot meter and progress pruning all
follow from the registry; there is no HTML to edit.

Three rules worth knowing:

- **A snapshot stores an identifier, never the puzzle.** Boards are rebuilt from a
  quote index or answer index plus a seed, so a saved game can never disagree with
  its own puzzle. There is a test that enforces this.
- **The shell owns `solved` and `lost`.** A module reports via `isSolved` and
  `isLost` and must not set the flags itself; the shell uses them to tell a board
  that has just finished from one that was already finished when opened.
- **`howTo` is prose, not markup.** It is rendered with `textContent`, and a test
  rejects angle brackets.

## Adding your own quotes

Append to the array in `src/quotes.js`:

```js
{ text: 'Something worth decoding.', author: 'Someone' },
```

Keep it between 20 and 160 characters and ASCII-only — curly quotes, accents and
em-dashes break cell alignment and have no key on the on-screen keyboard. Running
on localhost logs a console warning for anything that breaks those rules.

## Word lists

`node tools/make-words.mjs` regenerates `src/words.js` from the system dictionary
(`wamerican` and `cracklib-runtime` on Debian/Ubuntu). The output is committed, so
the app never depends on those files being installed.

It produces four lists, two per game, and the same split is behind both: a common
pool for what the game **shows** you, and a wider pool for what it **accepts**.
Drawing puzzles from the full list gives miserable ones like `CALKS`; accepting
only common words makes the game feel broken when a real word is rejected.

| | shown | accepted |
|---|---|---|
| Fiver, five letters | `ANSWERS` 2,258 | `GUESSES` 4,640 |
| Word Ladder, four letters | `LADDER_COMMON` 1,439 | `LADDER_WORDS` 2,413 |

Two filters run over all four:

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

The lists derive from SCOWL, whose licence permits redistribution provided its
copyright notice travels along — it is reproduced at the top of `src/words.js`.

## Icons

`node tools/make-icons.mjs` regenerates `icons/icon-192.png` and
`icons/icon-512.png`. It rasterizes the mark and encodes the PNG with Node's
built-in `zlib`, so it needs no image tooling installed. Keep `icons/icon.svg` in
sync if you change the geometry.
