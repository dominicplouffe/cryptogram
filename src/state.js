// Game state, difficulty configuration, and localStorage persistence.

import {
  buildPuzzle,
  distinctLetters,
  hashString,
  localDateKey,
  mulberry32,
} from './cipher.js';
import { QUOTES, quotesForDifficulty } from './quotes.js';

const NS = 'cryptogram.v1.';
const PROGRESS_PREFIX = `${NS}progress.`;

export const DIFFICULTIES = {
  easy: { label: 'Easy', prefillRatio: 0.3 },
  medium: { label: 'Medium', prefillRatio: 0.15 },
  hard: { label: 'Hard', prefillRatio: 0 },
};

export const DEFAULT_DIFFICULTY = 'medium';

// --- storage primitives -----------------------------------------------------
// Every access is guarded. Safari in private mode throws on write, and a
// storage failure must degrade to "plays fine, just doesn't remember" rather
// than taking the whole game down.

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeKey(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing sensible to do */
  }
}

/** @returns {boolean} whether persistence is actually working */
export function storageAvailable() {
  try {
    const probe = `${NS}probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

// --- settings ---------------------------------------------------------------

const DEFAULT_SETTINGS = { difficulty: DEFAULT_DIFFICULTY, theme: 'auto', mode: 'daily' };

export function loadSettings() {
  const stored = readJSON(`${NS}settings`, {});
  const settings = { ...DEFAULT_SETTINGS, ...stored };
  if (!DIFFICULTIES[settings.difficulty]) settings.difficulty = DEFAULT_DIFFICULTY;
  if (settings.mode !== 'daily' && settings.mode !== 'free') settings.mode = 'daily';
  if (!['auto', 'dark', 'light'].includes(settings.theme)) settings.theme = 'auto';
  return settings;
}

export function saveSettings(settings) {
  writeJSON(`${NS}settings`, settings);
}

// --- stats ------------------------------------------------------------------

const DEFAULT_STATS = {
  played: 0,
  solved: 0,
  currentStreak: 0,
  maxStreak: 0,
  lastDailySolved: null,
  totalHints: 0,
  // Best times only count hint-free solves, so the record stays meaningful.
  bestTimes: { easy: null, medium: null, hard: null },
};

export function loadStats() {
  const stored = readJSON(`${NS}stats`, {});
  return {
    ...DEFAULT_STATS,
    ...stored,
    bestTimes: { ...DEFAULT_STATS.bestTimes, ...(stored.bestTimes ?? {}) },
  };
}

export function saveStats(stats) {
  writeJSON(`${NS}stats`, stats);
}

export function resetStats() {
  removeKey(`${NS}stats`);
  return loadStats();
}

/**
 * Previous calendar day for a YYYY-MM-DD key, computed in local time so it
 * matches how the daily puzzle rolls over.
 * @param {string} dateKey
 * @returns {string}
 */
export function previousDateKey(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - 1);
  return localDateKey(date);
}

/**
 * Fold a completed puzzle into lifetime stats.
 * @param {object} stats
 * @param {{mode: string, difficulty: string, elapsedMs: number, hintsUsed: number, dateKey: string}} result
 * @returns {object} updated stats (also persisted)
 */
export function recordSolve(stats, result) {
  const next = {
    ...stats,
    bestTimes: { ...stats.bestTimes },
    solved: stats.solved + 1,
    totalHints: stats.totalHints + result.hintsUsed,
  };

  if (result.hintsUsed === 0) {
    const best = next.bestTimes[result.difficulty];
    if (best === null || result.elapsedMs < best) {
      next.bestTimes[result.difficulty] = result.elapsedMs;
    }
  }

  if (result.mode === 'daily' && next.lastDailySolved !== result.dateKey) {
    next.currentStreak =
      next.lastDailySolved === previousDateKey(result.dateKey) ? next.currentStreak + 1 : 1;
    next.lastDailySolved = result.dateKey;
    next.maxStreak = Math.max(next.maxStreak, next.currentStreak);
  }

  saveStats(next);
  return next;
}

export function recordStart(stats) {
  const next = { ...stats, played: stats.played + 1 };
  saveStats(next);
  return next;
}

/**
 * A streak is only current if the last daily solve was today or yesterday;
 * otherwise it has lapsed and should display as zero.
 * @param {object} stats
 * @param {string} [today]
 * @returns {number}
 */
export function effectiveStreak(stats, today = localDateKey()) {
  if (!stats.lastDailySolved) return 0;
  if (stats.lastDailySolved === today) return stats.currentStreak;
  if (stats.lastDailySolved === previousDateKey(today)) return stats.currentStreak;
  return 0;
}

// --- in-flight puzzle progress ----------------------------------------------

/**
 * Storage key for a puzzle slot. Daily puzzles are keyed by date so yesterday's
 * unfinished attempt never bleeds into today's.
 */
export function progressKey(mode, dateKey) {
  return mode === 'daily' ? `${PROGRESS_PREFIX}daily.${dateKey}` : `${PROGRESS_PREFIX}free`;
}

export function saveProgress(game) {
  writeJSON(progressKey(game.mode, game.dateKey), {
    v: 1,
    mode: game.mode,
    difficulty: game.difficulty,
    dateKey: game.dateKey,
    quoteIndex: game.quoteIndex,
    seed: game.seed,
    guesses: game.guesses,
    locked: [...game.locked],
    hintsUsed: game.hintsUsed,
    checksUsed: game.checksUsed,
    elapsedMs: game.elapsedMs,
    solved: game.solved,
  });
}

export function loadProgress(mode, dateKey) {
  const saved = readJSON(progressKey(mode, dateKey), null);
  if (!saved || saved.v !== 1) return null;
  if (typeof saved.quoteIndex !== 'number' || typeof saved.seed !== 'number') return null;
  if (!QUOTES[saved.quoteIndex]) return null;
  return saved;
}

export function clearProgress(mode, dateKey) {
  removeKey(progressKey(mode, dateKey));
}

/**
 * Drop daily progress entries older than today. Without this, a year of play
 * quietly accumulates 365 dead keys.
 */
export function pruneOldProgress(today = localDateKey()) {
  let keys;
  try {
    keys = Object.keys(localStorage);
  } catch {
    return;
  }
  const dailyPrefix = `${PROGRESS_PREFIX}daily.`;
  for (const key of keys) {
    if (!key.startsWith(dailyPrefix)) continue;
    if (key.slice(dailyPrefix.length) < today) removeKey(key);
  }
}

// --- game construction ------------------------------------------------------

/**
 * How many distinct cipher letters to give away, given the difficulty.
 * Always leaves at least two letters for the player to actually deduce,
 * otherwise an easy short quote can arrive nearly solved.
 */
function prefillCountFor(difficulty, distinctCount) {
  const ratio = DIFFICULTIES[difficulty]?.prefillRatio ?? 0;
  if (ratio === 0) return 0;
  return Math.min(Math.round(distinctCount * ratio), Math.max(distinctCount - 2, 0));
}

/**
 * Build a fresh game object.
 *
 * The daily puzzle derives both its quote and its cipher from the date alone,
 * so it is identical on every device and stable across reloads.
 *
 * @param {{mode: 'daily'|'free', difficulty: string, dateKey?: string, seed?: number}} options
 */
export function createGame({ mode, difficulty, dateKey = localDateKey(), seed }) {
  const resolvedSeed =
    seed ??
    (mode === 'daily'
      ? hashString(`${dateKey}|${difficulty}`)
      : Math.floor(Math.random() * 0xffffffff));

  const pool = quotesForDifficulty(difficulty);
  const pick = mulberry32(resolvedSeed);
  const quote = pool[Math.floor(pick() * pool.length)];
  const quoteIndex = QUOTES.indexOf(quote);

  return hydrateGame({
    mode,
    difficulty,
    dateKey,
    seed: resolvedSeed,
    quoteIndex,
    guesses: {},
    locked: null, // filled in from prefill below
    hintsUsed: 0,
    checksUsed: 0,
    elapsedMs: 0,
    solved: false,
  });
}

/**
 * Turn a plain snapshot (fresh or restored from storage) into a live game.
 * Puzzle text is always recomputed from quoteIndex + seed rather than stored,
 * so a saved game can never disagree with its own cipher.
 * @param {object} snapshot
 */
export function hydrateGame(snapshot) {
  const quote = QUOTES[snapshot.quoteIndex];
  const distinct = distinctLetters(
    buildPuzzle(quote, snapshot.seed, 0).cipher
  ).length;
  const puzzle = buildPuzzle(
    quote,
    snapshot.seed,
    prefillCountFor(snapshot.difficulty, distinct)
  );

  const guesses = { ...(snapshot.guesses ?? {}) };
  const locked = new Set(snapshot.locked ?? puzzle.prefilled);

  // Locked letters are authoritative: they are always the correct answer.
  for (const letter of locked) guesses[letter] = puzzle.solution[letter];

  return {
    mode: snapshot.mode,
    difficulty: snapshot.difficulty,
    dateKey: snapshot.dateKey,
    seed: snapshot.seed,
    quoteIndex: snapshot.quoteIndex,
    author: puzzle.author,
    plain: puzzle.plain,
    // The quote as written. The board needs uppercase, but the win sheet reads
    // far better in the original casing than in block capitals.
    original: quote.text,
    cipher: puzzle.cipher,
    solution: puzzle.solution,
    letters: distinctLetters(puzzle.cipher),
    guesses,
    locked,
    hintsUsed: snapshot.hintsUsed ?? 0,
    checksUsed: snapshot.checksUsed ?? 0,
    elapsedMs: snapshot.elapsedMs ?? 0,
    solved: snapshot.solved ?? false,
  };
}

/**
 * Restore a saved game, or start a new one if there is nothing usable.
 * @returns {{game: object, restored: boolean}}
 */
export function resumeOrCreate({ mode, difficulty, dateKey = localDateKey() }) {
  const saved = loadProgress(mode, dateKey);
  // A saved game at a different difficulty is stale once the player switches.
  if (saved && saved.difficulty === difficulty) {
    return { game: hydrateGame(saved), restored: true };
  }
  return { game: createGame({ mode, difficulty, dateKey }), restored: false };
}

/**
 * Format milliseconds as M:SS, or H:MM:SS past an hour.
 * @param {number} ms
 * @returns {string}
 */
export function formatTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
