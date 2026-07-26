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

110 tests over the cipher engine, storage and migration, the shared game
contract, and each game's rules — including the duplicate-letter cases that make
Fiver's scoring easy to get wrong.

## Home screen

A hub showing your daily streak, lifetime solves, and how many of today's dailies
you have finished. Each game gets a card reporting its own state — not started, in
progress with a count, solved with a time, or out of guesses — and a button that
follows suit (Play / Continue / View).

No board is built until you tap one, which keeps the played count honest: opening
the app is not playing. The phone's back gesture returns here rather than leaving.

**The daily streak counts consecutive days you finish at least one daily, any
game.** Free play never advances it, and the win sheet says so after a free-play
solve. Each game also keeps its own streak, visible in the stats sheet.

Best times only count hint-free solves, so the record stays meaningful.

## Layout

```
index.html              home + a game shell shared by all three games
styles.css              mobile-first, dark + light
manifest.json           PWA metadata
sw.js                   offline cache, network-first
src/main.js             the shell: views, timer, dialogs, wiring
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

Write a module in `src/games/` satisfying the same contract as the existing three
— `createGame`, `hydrate`, `toSnapshot`, `mount`, `paint`, `onKey`, `isSolved`,
`statusFor`, and so on — then add it to `src/games/registry.js`. The home card,
stats section, "Today n/n" figure, and progress pruning all follow from that list;
there is no HTML to edit.

Two rules worth knowing:

- **A snapshot stores an identifier, never the puzzle.** Boards are rebuilt from a
  quote index or answer index plus a seed, so a saved game can never disagree with
  its own puzzle. There is a test that enforces this.
- **The shell owns `solved` and `lost`.** A module reports via `isSolved` and
  `isLost` and must not set the flags itself; the shell uses them to tell a board
  that has just finished from one that was already finished when opened.

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
