// The games the app offers, in the order they appear on the home screen.
//
// Adding a game means writing a module that satisfies the contract in
// games/cryptogram.js and listing it here. The home screen, the stats sheet, the
// "Today n/n" figure and progress pruning all derive from this list.

import { cryptogram } from './cryptogram.js';
import { fiver } from './fiver.js';
import { vowels } from './vowels.js';

export const GAMES = [cryptogram, fiver, vowels];

export const GAME_IDS = GAMES.map((g) => g.id);

export function gameById(id) {
  return GAMES.find((g) => g.id === id) ?? null;
}
