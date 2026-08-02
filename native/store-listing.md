# Store listing copy

The console fields for both stores, versioned here so the listings and the app
stay in step. Character limits are noted per field; a checker is at the bottom.

## App Store (App Store Connect)

### Name — 30 chars max

> Plouffe Word Games

### Subtitle — 30 chars max, indexed for search

> Eight daily word puzzles

### Promotional text — 170 chars max, editable without a new build

> Eight word games, one daily streak. Cryptograms, ladders, hidden quotes and more — all offline, no ads, no account, nothing tracked. Just you and the words.

### Keywords — 100 chars max, comma-separated, no spaces

Don't repeat words from the name/subtitle ("word", "games", "daily", "puzzles"
are already indexed from there; Apple combines fields, so `search` below still
matches "word search").

> cryptogram,cryptoquote,puzzle,quote,ladder,anagram,brain,offline,streak,search,decode,vowels,letters

### Description — 4000 chars max, not indexed, written for humans

> Eight word games. One daily streak. Nothing else asking for your attention.
>
> Every day brings a fresh daily of every game:
>
> • CRYPTOGRAM — a quote encrypted letter for letter. Crack the code and watch it read itself back to you.
> • FIVER — find the five-letter word in six guesses.
> • MISSING VOWELS — every A, E, I, O and U stripped from a quote. Put them back.
> • HIDDEN QUOTE — the quote starts blank. Call letters to reveal it, but a wrong call costs a life.
> • WORD LADDER — get from COLD to WARM changing one letter at a time.
> • WORD WHEEL — seven to nine letters, one compulsory. How many words can you find?
> • BOXED — twelve letters around a square. Chain words to use them all, but two letters in a row can never come from the same side.
> • WORD SEARCH — the classic. Tap the first letter, tap the last.
>
> Solve any daily to keep your streak alive. Miss a day and it resets — that is what makes it a streak.
>
> MADE TO RESPECT YOU
>
> • Completely offline. Play in a tunnel, on a plane, anywhere.
> • No ads, no account, no tracking. Nothing is ever sent anywhere — your streaks and stats live on your phone and nowhere else.
> • Free. All eight games, every difficulty, nothing locked.
>
> THE DETAILS DONE RIGHT
>
> • Three difficulty levels per game
> • A custom keyboard that never autocorrects and never covers the board
> • Stats, best times and per-game streaks
> • Share a solve as a spoiler-free card
> • Dark and light themes, haptics, optional sound
>
> Five minutes with your coffee or an hour down the rabbit hole — the words are waiting.

## Google Play (Play Console)

### App name — 30 chars max

> Plouffe Word Games

### Short description — 80 chars max

> Eight daily word puzzles, one streak. Offline, no ads, no account, no tracking.

### Full description — 4000 chars max

Reuse the App Store description above verbatim.

## Checking the limits

```sh
node native/check-listing.mjs   # fails if any field is over its limit
```
