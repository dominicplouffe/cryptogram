// The games the app offers, in the order they appear on the home screen.
//
// Adding a game means writing a module that satisfies the contract in
// games/cryptogram.js and listing it here. The home screen, the filter chips,
// the per-game sheet, the stats sheet, the "Today" meter and progress pruning
// all derive from this list.

import { cryptogram } from './cryptogram.js';
import { fiver } from './fiver.js';
import { ladder } from './ladder.js';
import { vowels } from './vowels.js';

export const GAMES = [cryptogram, fiver, vowels, ladder];

export const GAME_IDS = GAMES.map((g) => g.id);

/**
 * Distinct categories, in the order the games first mention them. The home
 * screen offers these as filter chips once the library is large enough to need
 * them; below that threshold they are noise.
 */
export const CATEGORIES = [...new Set(GAMES.map((g) => g.category))];

/**
 * How many games it takes before the home screen starts filtering. Three games
 * fit on one screen; a dozen do not.
 */
export const FILTER_THRESHOLD = 6;

export function gameById(id) {
  return GAMES.find((g) => g.id === id) ?? null;
}
