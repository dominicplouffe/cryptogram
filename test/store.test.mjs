// Storage, stats, streaks and migration.
//
// Needs a working localStorage, so it installs a minimal in-memory stand-in.
// Data is held as own enumerable properties because that is how a real Storage
// object behaves, and store.js relies on Object.keys(localStorage) to enumerate.

import test from 'node:test';
import assert from 'node:assert/strict';

function fakeStorage({ throwOnWrite = false } = {}) {
  const s = {};
  const define = (name, value) => Object.defineProperty(s, name, { value, enumerable: false });
  define('getItem', (k) => (Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null));
  define('setItem', (k, v) => {
    if (throwOnWrite) throw new DOMExceptionish();
    s[k] = String(v);
  });
  define('removeItem', (k) => {
    delete s[k];
  });
  define('clear', () => {
    for (const k of Object.keys(s)) delete s[k];
  });
  return s;
}

class DOMExceptionish extends Error {
  constructor() {
    super('QuotaExceededError');
    this.name = 'QuotaExceededError';
  }
}

globalThis.localStorage = fakeStorage();

const store = await import('../src/store.js');
const { NAMESPACE: NS, LEGACY_NAMESPACE: LEGACY } = store;

function reset() {
  localStorage.clear();
}

const RESULT = (over = {}) => ({
  mode: 'daily',
  difficulty: 'medium',
  elapsedMs: 60000,
  hintsUsed: 0,
  dateKey: '2026-08-01',
  ...over,
});

// --- primitives -------------------------------------------------------------

test('storageAvailable reports whether writes actually work', () => {
  reset();
  assert.equal(store.storageAvailable(), true);

  const original = globalThis.localStorage;
  globalThis.localStorage = fakeStorage({ throwOnWrite: true });
  assert.equal(store.storageAvailable(), false);
  globalThis.localStorage = original;
});

test('a throwing storage degrades instead of crashing', () => {
  const original = globalThis.localStorage;
  globalThis.localStorage = fakeStorage({ throwOnWrite: true });

  // Safari private mode: everything must still return sane values.
  assert.doesNotThrow(() => store.saveAppSettings({ theme: 'dark' }));
  assert.doesNotThrow(() => store.recordStart('cryptogram'));
  assert.deepEqual(store.loadAppSettings(), { theme: 'auto' });
  assert.equal(store.loadStats('cryptogram').solved, 0);

  globalThis.localStorage = original;
});

test('formatTime renders M:SS and rolls into hours', () => {
  assert.equal(store.formatTime(0), '0:00');
  assert.equal(store.formatTime(65000), '1:05');
  assert.equal(store.formatTime(3661000), '1:01:01');
  assert.equal(store.formatTime(-500), '0:00');
});

test('previousDateKey crosses month, year and leap boundaries', () => {
  assert.equal(store.previousDateKey('2026-08-01'), '2026-07-31');
  assert.equal(store.previousDateKey('2026-01-01'), '2025-12-31');
  assert.equal(store.previousDateKey('2024-03-01'), '2024-02-29');
});

// --- settings ---------------------------------------------------------------

test('app settings round-trip and reject unknown themes', () => {
  reset();
  assert.deepEqual(store.loadAppSettings(), { theme: 'auto' });
  store.saveAppSettings({ theme: 'dark' });
  assert.equal(store.loadAppSettings().theme, 'dark');

  localStorage.setItem(`${NS}settings`, JSON.stringify({ theme: 'neon' }));
  assert.equal(store.loadAppSettings().theme, 'auto', 'unknown theme falls back');
});

test('game settings validate difficulty against the game that owns them', () => {
  reset();
  const spec = { difficulties: { easy: {}, medium: {}, hard: {} }, defaultDifficulty: 'medium' };

  assert.equal(store.loadGameSettings('cryptogram', spec).difficulty, 'medium');

  store.saveGameSettings('cryptogram', { difficulty: 'hard', mode: 'free' });
  assert.equal(store.loadGameSettings('cryptogram', spec).difficulty, 'hard');
  assert.equal(store.loadGameSettings('cryptogram', spec).mode, 'free');

  store.saveGameSettings('cryptogram', { difficulty: 'impossible', mode: 'daily' });
  assert.equal(
    store.loadGameSettings('cryptogram', spec).difficulty,
    'medium',
    'a difficulty the game does not offer falls back to its default'
  );

  store.saveGameSettings('cryptogram', { difficulty: 'hard', mode: 'sideways' });
  assert.equal(store.loadGameSettings('cryptogram', spec).mode, 'daily');
});

test('a game without difficulties never carries one', () => {
  reset();
  store.saveGameSettings('fiver', { difficulty: 'hard', mode: 'daily' });
  assert.equal(store.loadGameSettings('fiver', {}).difficulty, null);
});

test('settings are kept separate per game', () => {
  reset();
  const spec = { difficulties: { easy: {}, medium: {}, hard: {} }, defaultDifficulty: 'medium' };
  store.saveGameSettings('cryptogram', { difficulty: 'hard', mode: 'daily' });
  store.saveGameSettings('vowels', { difficulty: 'easy', mode: 'free' });

  assert.equal(store.loadGameSettings('cryptogram', spec).difficulty, 'hard');
  assert.equal(store.loadGameSettings('vowels', spec).difficulty, 'easy');
  assert.equal(store.loadGameSettings('vowels', spec).mode, 'free');
});

// --- stats ------------------------------------------------------------------

test('recordStart counts a new board, per game', () => {
  reset();
  assert.equal(store.recordStart('fiver').played, 1);
  assert.equal(store.recordStart('fiver').played, 2);
  assert.equal(store.loadStats('cryptogram').played, 0, 'games do not share counters');
});

test('best times record only hint-free solves, and only improvements', () => {
  reset();
  store.recordSolve('cryptogram', RESULT({ elapsedMs: 90000, hintsUsed: 2 }));
  assert.equal(store.loadStats('cryptogram').bestTimes.medium, undefined, 'a hinted solve sets no record');

  store.recordSolve('cryptogram', RESULT({ elapsedMs: 80000 }));
  assert.equal(store.loadStats('cryptogram').bestTimes.medium, 80000);

  store.recordSolve('cryptogram', RESULT({ elapsedMs: 95000 }));
  assert.equal(store.loadStats('cryptogram').bestTimes.medium, 80000, 'slower does not overwrite');

  store.recordSolve('cryptogram', RESULT({ elapsedMs: 50000 }));
  assert.equal(store.loadStats('cryptogram').bestTimes.medium, 50000);

  store.recordSolve('cryptogram', RESULT({ difficulty: 'hard', elapsedMs: 70000 }));
  assert.equal(store.loadStats('cryptogram').bestTimes.hard, 70000, 'difficulties track separately');
  assert.equal(store.loadStats('cryptogram').bestTimes.medium, 50000);
});

test('a game with no difficulty stores its best time under one band', () => {
  reset();
  store.recordSolve('fiver', RESULT({ difficulty: null, elapsedMs: 42000 }));
  assert.equal(store.loadStats('fiver').bestTimes.default, 42000);
});

test('recordLoss counts a loss and touches nothing else', () => {
  reset();
  store.recordSolve('fiver', RESULT({ dateKey: '2026-08-01' }));
  const before = store.loadGlobal();

  const stats = store.recordLoss('fiver');
  assert.equal(stats.lost, 1);
  assert.equal(stats.solved, 1, 'a loss is not a win');
  assert.deepEqual(store.loadGlobal(), before, 'a loss never moves the site-wide streak');
});

// --- per-game streaks -------------------------------------------------------

test('a per-game streak advances on consecutive days and resets after a gap', () => {
  reset();
  let s = store.recordSolve('cryptogram', RESULT({ dateKey: '2026-08-01' })).stats;
  assert.equal(s.currentStreak, 1);

  s = store.recordSolve('cryptogram', RESULT({ dateKey: '2026-08-02' })).stats;
  assert.equal(s.currentStreak, 2);

  s = store.recordSolve('cryptogram', RESULT({ dateKey: '2026-08-04' })).stats;
  assert.equal(s.currentStreak, 1, 'a missed day breaks it');
  assert.equal(s.maxStreak, 2, 'the best is remembered');
});

test('free play never advances a streak', () => {
  reset();
  const { stats, global } = store.recordSolve('cryptogram', RESULT({ mode: 'free' }));
  assert.equal(stats.currentStreak, 0);
  assert.equal(stats.solved, 1, 'but it still counts as solved');
  assert.equal(global.streak, 0);
  assert.equal(global.totalSolved, 1);
});

test('solving the same daily twice does not double count', () => {
  reset();
  store.recordSolve('cryptogram', RESULT({ dateKey: '2026-08-01' }));
  const { stats, global } = store.recordSolve('cryptogram', RESULT({ dateKey: '2026-08-01' }));
  assert.equal(stats.currentStreak, 1);
  assert.equal(global.streak, 1);
});

// --- site-wide streak -------------------------------------------------------

test('the site-wide streak counts a day once, however many games were solved', () => {
  reset();
  let g = store.recordSolve('cryptogram', RESULT({ dateKey: '2026-08-01' })).global;
  assert.equal(g.streak, 1);

  g = store.recordSolve('fiver', RESULT({ dateKey: '2026-08-01', difficulty: null })).global;
  assert.equal(g.streak, 1, 'a second game on the same day must not bump it');

  g = store.recordSolve('vowels', RESULT({ dateKey: '2026-08-01', difficulty: 'easy' })).global;
  assert.equal(g.streak, 1);
  assert.equal(g.totalSolved, 3, 'but every solve counts toward the total');
});

test('the site-wide streak survives when a different game covers the next day', () => {
  reset();
  store.recordSolve('cryptogram', RESULT({ dateKey: '2026-08-01' }));
  // Day two is covered by Fiver alone: solving *any* daily keeps the run alive.
  const g = store.recordSolve('fiver', RESULT({ dateKey: '2026-08-02', difficulty: null })).global;
  assert.equal(g.streak, 2);
  assert.equal(store.loadStats('cryptogram').currentStreak, 1, 'the per-game streak did not move');
});

test('the site-wide streak resets after a missed day and keeps its best', () => {
  reset();
  store.recordSolve('fiver', RESULT({ dateKey: '2026-08-01', difficulty: null }));
  store.recordSolve('fiver', RESULT({ dateKey: '2026-08-02', difficulty: null }));
  store.recordSolve('fiver', RESULT({ dateKey: '2026-08-03', difficulty: null }));
  let g = store.loadGlobal();
  assert.equal(g.streak, 3);

  g = store.recordSolve('fiver', RESULT({ dateKey: '2026-08-05', difficulty: null })).global;
  assert.equal(g.streak, 1);
  assert.equal(g.maxStreak, 3);
});

test('effectiveStreak lapses once a day is missed, for both record shapes', () => {
  const global = { streak: 5, lastSolvedDate: '2026-08-01' };
  assert.equal(store.effectiveStreak(global, '2026-08-01'), 5);
  assert.equal(store.effectiveStreak(global, '2026-08-02'), 5, 'still alive the next day');
  assert.equal(store.effectiveStreak(global, '2026-08-03'), 0, 'lapsed');

  const perGame = { currentStreak: 4, lastDailySolved: '2026-08-01' };
  assert.equal(store.effectiveStreak(perGame, '2026-08-02'), 4);
  assert.equal(store.effectiveStreak(perGame, '2026-08-03'), 0);

  assert.equal(store.effectiveStreak({ streak: 0, lastSolvedDate: null }, '2026-08-01'), 0);
});

// --- progress ---------------------------------------------------------------

test('progress keys are namespaced per game and per day', () => {
  assert.equal(
    store.progressKey('fiver', 'daily', '2026-08-01'),
    `${NS}fiver.progress.daily.2026-08-01`
  );
  assert.equal(store.progressKey('fiver', 'free', '2026-08-01'), `${NS}fiver.progress.free`);
});

test('progress round-trips and clears', () => {
  reset();
  const snap = { mode: 'daily', dateKey: '2026-08-01', seed: 7, guesses: { A: 'B' }, solved: false };
  store.saveProgress('vowels', snap);

  const back = store.loadProgress('vowels', 'daily', '2026-08-01');
  assert.equal(back.seed, 7);
  assert.deepEqual(back.guesses, { A: 'B' });
  assert.equal(store.loadProgress('cryptogram', 'daily', '2026-08-01'), null, 'games are isolated');

  store.clearProgress('vowels', 'daily', '2026-08-01');
  assert.equal(store.loadProgress('vowels', 'daily', '2026-08-01'), null);
});

test('progress from an unknown schema version is ignored', () => {
  reset();
  localStorage.setItem(
    store.progressKey('fiver', 'free', '2026-08-01'),
    JSON.stringify({ v: 99, mode: 'free' })
  );
  assert.equal(store.loadProgress('fiver', 'free', '2026-08-01'), null);
});

test('pruneOldProgress drops previous days across every game but keeps today and free play', () => {
  reset();
  for (const id of ['cryptogram', 'fiver', 'vowels']) {
    store.saveProgress(id, { mode: 'daily', dateKey: '2026-07-30', solved: true });
    store.saveProgress(id, { mode: 'daily', dateKey: '2026-08-01', solved: false });
    store.saveProgress(id, { mode: 'free', dateKey: '2026-08-01', solved: false });
  }

  store.pruneOldProgress('2026-08-01');

  for (const id of ['cryptogram', 'fiver', 'vowels']) {
    assert.equal(store.loadProgress(id, 'daily', '2026-07-30'), null, `${id}: stale day kept`);
    assert.ok(store.loadProgress(id, 'daily', '2026-08-01'), `${id}: today was dropped`);
    assert.ok(store.loadProgress(id, 'free', '2026-08-01'), `${id}: free play was dropped`);
  }
});

// --- countdown to the next dailies -----------------------------------------

test('msUntilLocalMidnight measures to the next local midnight', () => {
  const at = (y, m, d, h, min, s = 0) => store.msUntilLocalMidnight(new Date(y, m - 1, d, h, min, s));

  assert.equal(at(2026, 8, 1, 23, 30), 30 * 60 * 1000);
  assert.equal(at(2026, 8, 1, 0, 0), 24 * 60 * 60 * 1000, 'midnight itself is a full day out');
  assert.equal(at(2026, 8, 1, 12, 0), 12 * 60 * 60 * 1000);

  // Rolls over month and year boundaries, since it is built from the calendar
  // date rather than by adding a fixed 24 hours.
  assert.equal(at(2026, 8, 31, 23, 59), 60 * 1000);
  assert.equal(at(2026, 12, 31, 23, 0), 60 * 60 * 1000);
});

test('msUntilLocalMidnight is always positive and at most a long day', () => {
  for (const hour of [0, 1, 5, 12, 18, 23]) {
    const ms = store.msUntilLocalMidnight(new Date(2026, 7, 15, hour, 17, 42));
    assert.ok(ms > 0, `hour ${hour} produced ${ms}`);
    // 25 hours, so a day that gains an hour to daylight saving still passes.
    assert.ok(ms <= 25 * 60 * 60 * 1000, `hour ${hour} produced ${ms}`);
  }
});

test('formatCountdown reads as a duration, not as a clock time', () => {
  assert.equal(store.formatCountdown(6 * 3600e3 + 12 * 60e3), '6h 12m');
  assert.equal(store.formatCountdown(3600e3), '1h 0m');
  assert.equal(store.formatCountdown(43 * 60e3), '43m');
  assert.equal(store.formatCountdown(61e3), '1m');

  // A bare "6:12" would be unreadable here -- six hours twelve, or six minutes
  // twelve? Every result carries its units.
  assert.match(store.formatCountdown(2 * 3600e3), /h /);
  assert.match(store.formatCountdown(5 * 60e3), /m$/);
});

test('formatCountdown does not count down to zero', () => {
  // Reaching "0m" would sit there looking broken for a whole minute.
  assert.equal(store.formatCountdown(60e3), 'under a minute');
  assert.equal(store.formatCountdown(1), 'under a minute');
  assert.equal(store.formatCountdown(0), 'under a minute');
});

test('resetAllStats clears every game and the site-wide record', () => {
  reset();
  store.recordSolve('cryptogram', RESULT());
  store.recordSolve('fiver', RESULT({ difficulty: null }));

  store.resetAllStats(['cryptogram', 'fiver']);
  assert.equal(store.loadStats('cryptogram').solved, 0);
  assert.equal(store.loadStats('fiver').solved, 0);
  assert.equal(store.loadGlobal().streak, 0);
});

// --- migration --------------------------------------------------------------

const LEGACY_PAYLOAD = {
  stats: {
    played: 12,
    solved: 9,
    currentStreak: 4,
    maxStreak: 6,
    lastDailySolved: '2026-07-26',
    totalHints: 3,
    bestTimes: { easy: 40000, medium: 61000, hard: null },
  },
  settings: { difficulty: 'hard', theme: 'dark', mode: 'free' },
};

function seedLegacy() {
  reset();
  localStorage.setItem(`${LEGACY}stats`, JSON.stringify(LEGACY_PAYLOAD.stats));
  localStorage.setItem(`${LEGACY}settings`, JSON.stringify(LEGACY_PAYLOAD.settings));
  localStorage.setItem(
    `${LEGACY}progress.daily.2026-07-26`,
    JSON.stringify({ v: 1, mode: 'daily', dateKey: '2026-07-26', seed: 99, quoteIndex: 5, solved: true })
  );
  localStorage.setItem(
    `${LEGACY}progress.free`,
    JSON.stringify({ v: 1, mode: 'free', dateKey: '2026-07-26', seed: 12, quoteIndex: 7, solved: false })
  );
}

test('migration carries Cryptogram stats across', () => {
  seedLegacy();
  assert.equal(store.migrateLegacy(), true);

  const stats = store.loadStats('cryptogram');
  assert.equal(stats.played, 12);
  assert.equal(stats.solved, 9);
  assert.equal(stats.currentStreak, 4);
  assert.equal(stats.maxStreak, 6);
  assert.equal(stats.lastDailySolved, '2026-07-26');
  assert.equal(stats.totalHints, 3);
  assert.equal(stats.bestTimes.easy, 40000);
  assert.equal(stats.bestTimes.medium, 61000);
});

test('migration seeds the site-wide streak so the headline number continues', () => {
  seedLegacy();
  store.migrateLegacy();

  const g = store.loadGlobal();
  assert.equal(g.streak, 4, 'the existing streak must not reset to zero');
  assert.equal(g.maxStreak, 6);
  assert.equal(g.lastSolvedDate, '2026-07-26');
  assert.equal(g.totalSolved, 9);

  // And it keeps counting from there rather than starting over.
  const next = store.recordSolve('cryptogram', RESULT({ dateKey: '2026-07-27' })).global;
  assert.equal(next.streak, 5);
});

test('migration splits settings into app-wide theme and per-game options', () => {
  seedLegacy();
  store.migrateLegacy();

  assert.equal(store.loadAppSettings().theme, 'dark');
  const gameSettings = store.loadGameSettings('cryptogram', {
    difficulties: { easy: {}, medium: {}, hard: {} },
    defaultDifficulty: 'medium',
  });
  assert.equal(gameSettings.difficulty, 'hard');
  assert.equal(gameSettings.mode, 'free');
});

test('migration carries in-flight boards, daily and free', () => {
  seedLegacy();
  store.migrateLegacy();

  const daily = store.loadProgress('cryptogram', 'daily', '2026-07-26');
  assert.ok(daily, 'the unfinished daily was lost');
  assert.equal(daily.seed, 99);
  assert.equal(daily.solved, true);

  const free = store.loadProgress('cryptogram', 'free', '2026-07-26');
  assert.ok(free);
  assert.equal(free.quoteIndex, 7);
});

test('migration leaves the legacy keys in place as a fallback', () => {
  seedLegacy();
  store.migrateLegacy();
  assert.ok(localStorage.getItem(`${LEGACY}stats`), 'legacy stats were destroyed');
  assert.ok(localStorage.getItem(`${LEGACY}progress.daily.2026-07-26`));
});

test('migration runs once and is idempotent', () => {
  seedLegacy();
  assert.equal(store.migrateLegacy(), true);

  // Play after migrating, then re-run: the newer data must survive.
  store.recordSolve('cryptogram', RESULT({ dateKey: '2026-07-27' }));
  const afterPlay = store.loadStats('cryptogram').solved;

  assert.equal(store.migrateLegacy(), false, 'migration ran a second time');
  assert.equal(store.loadStats('cryptogram').solved, afterPlay, 'migration clobbered newer data');
});

test('a first-time player migrates nothing and is marked done', () => {
  reset();
  assert.equal(store.migrateLegacy(), false);
  assert.equal(store.loadStats('cryptogram').solved, 0);
  assert.equal(store.loadGlobal().streak, 0);
  assert.equal(store.migrateLegacy(), false, 'the marker was not set');
});

test('migration copes with partial legacy data', () => {
  reset();
  // Settings but no stats: someone who changed the theme and never finished.
  localStorage.setItem(`${LEGACY}settings`, JSON.stringify({ theme: 'light' }));
  assert.equal(store.migrateLegacy(), true);
  assert.equal(store.loadAppSettings().theme, 'light');
  assert.equal(store.loadStats('cryptogram').solved, 0);
  assert.equal(store.loadGlobal().streak, 0);
});
