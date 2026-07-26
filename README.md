# Plouffe Word Games

Word puzzles for the phone. Static site: no dependencies, no build step, no
backend.

**Cryptogram** — every letter in a quote has been swapped for another one,
consistently, all the way through. Tap a coded letter, tap what you think it
stands for, and every copy updates at once.

The home screen is a games list, so a second game is a second entry rather than
a redesign.

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

Covers the cipher engine (derangements, determinism, round-tripping) and the
game state (streaks, best times, difficulty prefill, save/restore).

## Home screen

Opens to a hub showing your streak, puzzles solved, and best time, plus a card
per game. The daily card reports today's state — not started, in progress with a
letter count, or solved with the time — and its button follows suit (Play /
Continue / View). No puzzle is built until you tap one, which keeps the "played"
count honest: opening the app is not playing.

The phone's back gesture returns to the home screen instead of leaving the app.

## How it plays

- **Tap a cell** to select it. Every cell sharing that coded letter lights up.
- **Tap a letter** to assign it everywhere at once; the selection auto-advances.
- **Amber** means you have used one letter for two different codes. The cipher is
  one-to-one, so one of them is wrong. Revealed letters are never flagged.
- **Hint** reveals the selected letter and locks it. **Check** flags wrong guesses.
- **Daily** is seeded from the local calendar date and the chosen difficulty: the
  same puzzle all day, on every device, rolling over at your midnight.
- **Best times** count only hint-free solves, so the record stays meaningful.

Difficulty controls both quote length and how many letters are given away:
Easy prefills about a third, Medium about a sixth, Hard gives you nothing.

## Layout

```
index.html          home + game views
styles.css          mobile-first, dark + light
manifest.json       PWA metadata
sw.js               offline cache
src/cipher.js       seeded RNG, derangements, substitution
src/quotes.js       the quote pack
src/state.js        game state, difficulty, localStorage
src/render.js       grid + keyboard DOM
src/main.js         views, input handling, timer, game flow
test/               node --test suites
tools/make-icons.mjs regenerates the PNG icons
```

## Adding your own quotes

Append to the array in `src/quotes.js`:

```js
{ text: 'Something worth decoding.', author: 'Someone' },
```

Keep it between 20 and 160 characters and ASCII-only — curly quotes, accents and
em-dashes break cell alignment and have no key on the on-screen keyboard. Running
on localhost logs a console warning for anything that breaks those rules.

## Icons

`node tools/make-icons.mjs` regenerates `icons/icon-192.png` and
`icons/icon-512.png`. It rasterizes the mark and encodes the PNG with Node's
built-in `zlib`, so it needs no image tooling installed. Keep `icons/icon.svg` in
sync if you change the geometry.
