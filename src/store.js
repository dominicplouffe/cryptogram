// Persistence for all games: namespaced storage, per-game stats, the site-wide
// daily streak, and the one-time migration off the single-game layout.
//
// Key layout:
//   pwg.v1.settings                        theme (applies to the whole app)
//   pwg.v1.global                          site-wide streak + totals
//   pwg.v1.<id>.settings                   difficulty, mode
//   pwg.v1.<id>.stats                      per-game counters and best times
//   pwg.v1.<id>.progress.daily.<date>      in-flight board
//   pwg.v1.<id>.progress.free

import { localDateKey } from './cipher.js';

const NS = 'pwg.v1.';
const LEGACY_NS = 'cryptogram.v1.';
const MIGRATED_KEY = `${NS}migrated`;

// --- storage primitives -----------------------------------------------------
// Every access is guarded. Safari in private mode throws on write, and a storage
// failure must degrade to "plays fine, just doesn't remember" rather than taking
// the whole game down.

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

function allKeys() {
  try {
    return Object.keys(localStorage);
  } catch {
    return [];
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

// --- dates ------------------------------------------------------------------

/**
 * Previous calendar day for a YYYY-MM-DD key, computed in local time so it
 * matches how the daily puzzles roll over.
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
 * Milliseconds until the next local midnight, when every daily rolls over.
 *
 * Built from the local calendar date rather than by adding 24 hours, so the
 * answer stays correct across a daylight-saving change, where a local day is 23
 * or 25 hours long.
 *
 * @param {Date} [now]
 * @returns {number}
 */
/** The date the first daily shipped; #1. Shared by every game's share card. */
const DAILY_EPOCH = '2026-07-21';

/**
 * The daily's number, for share cards: "#8" travels better than a date, and it
 * is the same for every player on the same day.
 * @param {string} dateKey YYYY-MM-DD
 */
export function dailyNumber(dateKey) {
  const ms = new Date(`${dateKey}T00:00:00`) - new Date(`${DAILY_EPOCH}T00:00:00`);
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

export function msUntilLocalMidnight(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

/**
 * A coarse time-remaining string for the countdown to tomorrow's puzzles.
 *
 * Deliberately not M:SS like formatTime: a bare "6:12" reads as six minutes
 * twelve seconds just as easily as six hours twelve minutes, and this number is
 * only ever glanced at.
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatCountdown(ms) {
  if (ms <= 60_000) return 'under a minute';
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
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

// --- app settings -----------------------------------------------------------

// Sound is opt-in: an app that makes noise uninvited gets muted at the OS
// level and never turned back on. Haptics are opt-out: silent, light, and only
// firing on hardware that supports them at all.
const DEFAULT_APP_SETTINGS = { theme: 'auto', sound: false, haptics: true };

export function loadAppSettings() {
  const stored = readJSON(`${NS}settings`, {});
  const settings = { ...DEFAULT_APP_SETTINGS, ...stored };
  if (!['auto', 'dark', 'light'].includes(settings.theme)) settings.theme = 'auto';
  settings.sound = Boolean(settings.sound);
  settings.haptics = Boolean(settings.haptics);
  return settings;
}

export function saveAppSettings(settings) {
  writeJSON(`${NS}settings`, settings);
}

// --- per-game settings ------------------------------------------------------

/**
 * @param {string} gameId
 * @param {{difficulties?: object, defaultDifficulty?: string}} spec
 */
export function loadGameSettings(gameId, spec = {}) {
  const stored = readJSON(`${NS}${gameId}.settings`, {});
  const settings = { difficulty: spec.defaultDifficulty ?? null, mode: 'daily', ...stored };

  if (spec.difficulties) {
    if (!spec.difficulties[settings.difficulty]) {
      settings.difficulty = spec.defaultDifficulty ?? Object.keys(spec.difficulties)[0];
    }
  } else {
    // A game without difficulty levels must not carry a stale one around.
    settings.difficulty = null;
  }
  if (settings.mode !== 'daily' && settings.mode !== 'free') settings.mode = 'daily';
  return settings;
}

export function saveGameSettings(gameId, settings) {
  writeJSON(`${NS}${gameId}.settings`, settings);
}

// --- per-game stats ---------------------------------------------------------

const DEFAULT_STATS = {
  played: 0,
  solved: 0,
  lost: 0,
  currentStreak: 0,
  maxStreak: 0,
  lastDailySolved: null,
  totalHints: 0,
  // Best times only count hint-free solves, so the record stays meaningful.
  bestTimes: {},
};

export function loadStats(gameId) {
  const stored = readJSON(`${NS}${gameId}.stats`, {});
  return {
    ...DEFAULT_STATS,
    ...stored,
    bestTimes: { ...(stored.bestTimes ?? {}) },
  };
}

export function saveStats(gameId, stats) {
  writeJSON(`${NS}${gameId}.stats`, stats);
}

// --- site-wide totals -------------------------------------------------------

const DEFAULT_GLOBAL = {
  streak: 0,
  maxStreak: 0,
  lastSolvedDate: null,
  totalSolved: 0,
};

export function loadGlobal() {
  return { ...DEFAULT_GLOBAL, ...readJSON(`${NS}global`, {}) };
}

export function saveGlobal(global) {
  writeJSON(`${NS}global`, global);
}

/**
 * A streak is only current if the last qualifying day was today or yesterday;
 * otherwise it has lapsed and should read as zero without being erased.
 * @param {{streak: number, lastSolvedDate: string|null}} record
 * @param {string} [today]
 * @returns {number}
 */
export function effectiveStreak(record, today = localDateKey()) {
  const last = record.lastSolvedDate ?? record.lastDailySolved ?? null;
  if (!last) return 0;
  if (last === today || last === previousDateKey(today)) return record.streak ?? record.currentStreak ?? 0;
  return 0;
}

// --- recording results ------------------------------------------------------

export function recordStart(gameId) {
  const stats = loadStats(gameId);
  const next = { ...stats, played: stats.played + 1 };
  saveStats(gameId, next);
  return next;
}

/**
 * Fold a completed puzzle into per-game stats and the site-wide streak.
 * @param {string} gameId
 * @param {{mode: string, difficulty?: string|null, elapsedMs: number, hintsUsed: number, dateKey: string}} result
 * @returns {{stats: object, global: object}}
 */
export function recordSolve(gameId, result) {
  const stats = loadStats(gameId);
  const next = {
    ...stats,
    bestTimes: { ...stats.bestTimes },
    solved: stats.solved + 1,
    totalHints: stats.totalHints + (result.hintsUsed ?? 0),
  };

  if ((result.hintsUsed ?? 0) === 0) {
    const band = result.difficulty ?? 'default';
    const best = next.bestTimes[band] ?? null;
    if (best === null || result.elapsedMs < best) next.bestTimes[band] = result.elapsedMs;
  }

  // Per-game daily streak.
  if (result.mode === 'daily' && next.lastDailySolved !== result.dateKey) {
    next.currentStreak =
      next.lastDailySolved === previousDateKey(result.dateKey) ? next.currentStreak + 1 : 1;
    next.lastDailySolved = result.dateKey;
    next.maxStreak = Math.max(next.maxStreak, next.currentStreak);
  }
  saveStats(gameId, next);

  // Site-wide: one day counts once no matter how many games were solved on it.
  const global = loadGlobal();
  const nextGlobal = { ...global, totalSolved: global.totalSolved + 1 };
  if (result.mode === 'daily' && nextGlobal.lastSolvedDate !== result.dateKey) {
    nextGlobal.streak =
      nextGlobal.lastSolvedDate === previousDateKey(result.dateKey) ? nextGlobal.streak + 1 : 1;
    nextGlobal.lastSolvedDate = result.dateKey;
    nextGlobal.maxStreak = Math.max(nextGlobal.maxStreak, nextGlobal.streak);
  }
  saveGlobal(nextGlobal);

  return { stats: next, global: nextGlobal };
}

/**
 * A board that ended without being solved. Fiver is the only game that can be
 * lost; it does not touch any streak, but it must not look like a win either.
 */
export function recordLoss(gameId) {
  const stats = loadStats(gameId);
  const next = { ...stats, lost: stats.lost + 1 };
  saveStats(gameId, next);
  return next;
}

// --- in-flight progress -----------------------------------------------------

export function progressKey(gameId, mode, dateKey) {
  return mode === 'daily'
    ? `${NS}${gameId}.progress.daily.${dateKey}`
    : `${NS}${gameId}.progress.free`;
}

export function saveProgress(gameId, snapshot) {
  writeJSON(progressKey(gameId, snapshot.mode, snapshot.dateKey), { v: 1, ...snapshot });
}

export function loadProgress(gameId, mode, dateKey) {
  const saved = readJSON(progressKey(gameId, mode, dateKey), null);
  if (!saved || saved.v !== 1) return null;
  return saved;
}

export function clearProgress(gameId, mode, dateKey) {
  removeKey(progressKey(gameId, mode, dateKey));
}

/**
 * Drop daily progress from previous days. Without this, a year of play quietly
 * accumulates 365 dead keys per game.
 */
export function pruneOldProgress(today = localDateKey()) {
  for (const key of allKeys()) {
    if (!key.startsWith(NS)) continue;
    const marker = '.progress.daily.';
    const at = key.indexOf(marker);
    if (at === -1) continue;
    if (key.slice(at + marker.length) < today) removeKey(key);
  }
}

export function resetAllStats(gameIds) {
  for (const id of gameIds) removeKey(`${NS}${id}.stats`);
  removeKey(`${NS}global`);
}

// --- migration --------------------------------------------------------------

/**
 * One-time move from the single-game `cryptogram.v1.*` layout.
 *
 * Copies rather than moves: the legacy keys are about a kilobyte and are left in
 * place for one release as a fallback. Guarded by a marker so it runs once, and
 * written to be idempotent regardless.
 *
 * The site-wide streak is seeded from the migrated Cryptogram streak so the
 * headline number continues instead of resetting to zero.
 *
 * @returns {boolean} whether anything was migrated
 */
export function migrateLegacy() {
  if (readJSON(MIGRATED_KEY, null) !== null) return false;

  const legacyStats = readJSON(`${LEGACY_NS}stats`, null);
  const legacySettings = readJSON(`${LEGACY_NS}settings`, null);
  const legacyProgress = allKeys().filter((k) => k.startsWith(`${LEGACY_NS}progress.`));

  if (!legacyStats && !legacySettings && legacyProgress.length === 0) {
    // Nothing to carry over; mark done so we never scan again.
    writeJSON(MIGRATED_KEY, { at: null, migrated: false });
    return false;
  }

  if (legacyStats) {
    // The old shape had bestTimes keyed by difficulty, which still applies.
    writeJSON(`${NS}cryptogram.stats`, {
      ...DEFAULT_STATS,
      ...legacyStats,
      bestTimes: { ...(legacyStats.bestTimes ?? {}) },
    });

    writeJSON(`${NS}global`, {
      ...DEFAULT_GLOBAL,
      streak: legacyStats.currentStreak ?? 0,
      maxStreak: legacyStats.maxStreak ?? 0,
      lastSolvedDate: legacyStats.lastDailySolved ?? null,
      totalSolved: legacyStats.solved ?? 0,
    });
  }

  if (legacySettings) {
    if (legacySettings.theme) writeJSON(`${NS}settings`, { theme: legacySettings.theme });
    writeJSON(`${NS}cryptogram.settings`, {
      difficulty: legacySettings.difficulty ?? 'medium',
      mode: legacySettings.mode === 'free' ? 'free' : 'daily',
    });
  }

  for (const oldKey of legacyProgress) {
    const suffix = oldKey.slice(`${LEGACY_NS}progress.`.length);
    const snapshot = readJSON(oldKey, null);
    if (snapshot) writeJSON(`${NS}cryptogram.progress.${suffix}`, snapshot);
  }

  writeJSON(MIGRATED_KEY, { migrated: true, keys: legacyProgress.length });
  return true;
}

/** Exposed for tests: the namespace prefix in use. */
export const NAMESPACE = NS;
export const LEGACY_NAMESPACE = LEGACY_NS;
