# Plouffe Word Games

Word puzzles for the phone. Static site: no dependencies, no build step, no
backend.

- **Cryptogram** — a quote encrypted with a one-to-one letter substitution. Tap a
  coded letter, tap what you think it stands for, and every copy updates at once.
- **Fiver** — find a five-letter word in six guesses. Green is the right place,
  amber is in the word but elsewhere, grey is not in the word.
- **Missing Vowels** — every A, E, I, O and U taken out of a quote. Put them back.
  Y is left alone.

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

114 tests over the cipher engine, storage and migration, the shared game
contract, each game's rules — including the duplicate-letter cases that make
Fiver's scoring easy to get wrong — and the two lists that have to stay in step
with the registry (the offline precache and the shell's element ids).

## Home screen

The home screen is built for a library that keeps growing, so it is a **list of
compact rows, one per game, sorted into groups by today's state**:

- **Pick up where you left off** — dailies in progress
- **Today's puzzles** — not started yet
- **Finished today** — solved or out of guesses, dimmed and collapsible

Rows move between groups as you play, so the top of the list is always what to do
next and the list shortens as the day goes on. Tapping a row plays that game's
daily; the `⋯` button opens its sheet.

Above the list, a **dot per game** fills in as each daily is finished — a meter
rather than a tally, because "0 of 14" reads as failure where a row of empty dots
reads as an invitation. The dots always cover every game, whatever the list is
filtered to: they report the day, not the current view.

Two things scale the design past a handful of games:

- **Everything about one game lives in its own sheet** — rules, difficulty, free
  play, its record. A new game costs one row on the home screen, not another
  card's worth of controls. A game you have never opened shows that sheet before
  the board, so its rules arrive before its first puzzle.
- **Category filter chips** appear once the library passes `FILTER_THRESHOLD`
  games (six). Below that the whole list fits on a screen and a filter is one
  more thing to read past.

A **New** badge marks a game you have not tried, but only while untried games are
a minority — on a fresh install everything is new, so the badge would mark
nothing.

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
src/words.js            GENERATED word lists for Fiver
src/games/registry.js   the list of games that drives everything
src/games/*.js          one module per game
test/                   node --test suites
tools/make-icons.mjs    regenerates the PNG app icons
tools/make-words.mjs    regenerates src/words.js
```

## Adding a game

1. Write a module in `src/games/` satisfying the same contract as the existing
   three — `createGame`, `hydrate`, `toSnapshot`, `mount`, `paint`, `onKey`,
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

It produces two lists, and the split matters: **2,267 common words** are the pool
Fiver draws answers from, while **all 4,667 five-letter words** are accepted as
guesses. Drawing answers from the full list gives miserable puzzles like `CALKS`;
accepting only common words makes the game feel broken when a real word is
rejected. Obscure answers that slip through go in the blocklist in that script.

The lists derive from SCOWL, whose licence permits redistribution provided its
copyright notice travels along — it is reproduced at the top of `src/words.js`.

## Icons

`node tools/make-icons.mjs` regenerates `icons/icon-192.png` and
`icons/icon-512.png`. It rasterizes the mark and encodes the PNG with Node's
built-in `zlib`, so it needs no image tooling installed. Keep `icons/icon.svg` in
sync if you change the geometry.
