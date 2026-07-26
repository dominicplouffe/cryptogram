// The app shell: home screen, game view, timer, dialogs, persistence, wiring.
//
// Knows nothing about any game's rules. Everything game-specific comes from the
// modules in src/games/, via the registry.

import { localDateKey } from './cipher.js';
import { validateQuotes } from './quotes.js';
import {
  CATEGORIES,
  FILTER_THRESHOLD,
  GAMES,
  GAME_IDS,
  gameById,
} from './games/registry.js';
import { buildKeyboard, burstConfetti } from './render.js';
import {
  clearProgress,
  effectiveStreak,
  formatTime,
  loadAppSettings,
  loadGameSettings,
  loadGlobal,
  loadProgress,
  loadStats,
  migrateLegacy,
  pruneOldProgress,
  recordLoss,
  recordSolve,
  recordStart,
  resetAllStats,
  saveAppSettings,
  saveGameSettings,
  saveProgress,
  storageAvailable,
} from './store.js';

const $ = (id) => document.getElementById(id);

const dom = {
  viewHome: $('view-home'),
  viewGame: $('view-game'),
  homeDate: $('home-date'),
  games: $('games'),
  chips: $('chips'),

  // The three groups a game row can sit in, keyed by bucket name.
  lists: { resume: $('list-resume'), open: $('list-open'), done: $('list-done') },
  sections: { resume: $('sec-resume'), open: $('sec-open'), done: $('sec-done') },

  puzzle: $('puzzle'),
  caption: $('caption'),
  stage: document.querySelector('.stage'),
  keyboard: $('keyboard'),
  toolbar: $('toolbar'),
  timer: $('timer'),
  gameLabel: $('game-label'),
  gameSub: $('game-sub'),
  toast: $('toast'),

  btnHome: $('btn-home'),
  btnStats: $('btn-stats'),

  dlgWin: $('dlg-win'),
  dlgStats: $('dlg-stats'),
  dlgGame: $('dlg-game'),
  dlgSettings: $('dlg-settings'),
};

let appSettings = loadAppSettings();
let view = 'home';

/** The board on screen: the module, its live state, and its settings. */
let active = null;
let keys = null;
let keyboardOwner = null; // which game's layout is currently built

/** Home rows, built once and moved between groups as their state changes. */
const rowEls = new Map();

/** Which category the home list is filtered to, or 'all'. Not persisted: this is
    a browsing state, not a preference. */
let filter = 'all';

/** The game whose sheet is open. */
let sheetGame = null;

let runningSince = null;
let tickHandle = null;
let toastTimer = null;
let transientTimer = null;

// --- timer ------------------------------------------------------------------

function currentElapsed() {
  if (!active) return 0;
  return active.game.elapsedMs + (runningSince === null ? 0 : Date.now() - runningSince);
}

function startTimer() {
  if (!active || active.game.solved || active.game.lost || runningSince !== null) return;
  runningSince = Date.now();
  tickHandle = setInterval(paintTimer, 250);
}

function pauseTimer() {
  if (runningSince === null) return;
  active.game.elapsedMs += Date.now() - runningSince;
  runningSince = null;
  clearInterval(tickHandle);
  tickHandle = null;
  paintTimer();
}

function paintTimer() {
  dom.timer.textContent = formatTime(currentElapsed());
}

/** True while any sheet is open; time spent reading stats should not count. */
function anyDialogOpen() {
  return Boolean(document.querySelector('dialog[open]'));
}

function syncTimer() {
  const stop =
    document.visibilityState === 'hidden' ||
    anyDialogOpen() ||
    view !== 'game' ||
    !active ||
    active.game.solved ||
    active.game.lost;
  if (stop) pauseTimer();
  else startTimer();
}

// --- persistence ------------------------------------------------------------

function persist() {
  if (!active) return;
  if (runningSince !== null) {
    // Commit the open interval so the saved elapsed time is accurate.
    active.game.elapsedMs += Date.now() - runningSince;
    runningSince = Date.now();
  }
  saveProgress(active.mod.id, active.mod.toSnapshot(active.game));
}

// --- launching a game -------------------------------------------------------

function settingsFor(mod) {
  return loadGameSettings(mod.id, {
    difficulties: mod.difficulties,
    defaultDifficulty: mod.defaultDifficulty,
  });
}

/**
 * Open a game, resuming a saved board when one matches the current settings.
 * @param {object} mod
 * @param {{fresh?: boolean, mode?: string}} options
 */
function openGame(mod, { fresh = false, mode } = {}) {
  const dateKey = localDateKey();
  const settings = settingsFor(mod);
  const resolvedMode = mode ?? settings.mode;

  if (settings.mode !== resolvedMode) {
    settings.mode = resolvedMode;
    saveGameSettings(mod.id, settings);
  }

  let game;
  if (fresh) {
    game = mod.createGame({ mode: resolvedMode, difficulty: settings.difficulty, dateKey });
    recordStart(mod.id);
  } else {
    const saved = loadProgress(mod.id, resolvedMode, dateKey);
    // A saved board at a different difficulty is stale once the player switches.
    const usable = saved && (saved.difficulty ?? null) === (settings.difficulty ?? null);
    if (usable) {
      game = mod.hydrate(saved);
    } else {
      game = mod.createGame({ mode: resolvedMode, difficulty: settings.difficulty, dateKey });
      // Only a genuinely new board counts as a play, so returning to one in
      // progress never inflates the count.
      recordStart(mod.id);
    }
  }

  active = { mod, game, settings };

  // Rebuild the keyboard only when moving between games with different layouts.
  if (keyboardOwner !== mod.id) {
    keys = buildKeyboard(dom.keyboard, mod.keyboard);
    keyboardOwner = mod.id;
  }

  for (const btn of dom.toolbar.querySelectorAll('[data-tool]')) {
    btn.hidden = !mod.tools.includes(btn.dataset.tool);
  }

  clearTimeout(transientTimer);
  runningSince = null;
  clearInterval(tickHandle);
  tickHandle = null;

  mod.mount(dom.puzzle, game);

  // A history entry per game entry makes the phone's back gesture return to home
  // rather than leaving the app entirely.
  if (view !== 'game') history.pushState({ view: 'game' }, '');
  showView('game');
  dom.stage.scrollTop = 0;

  paintGame();
  persist();
  syncTimer();

  if (game.solved) toast('Already solved — here it is');
  else if (game.lost) toast('Out of guesses on this one');
}

function startFresh(mod, mode) {
  clearProgress(mod.id, mode, localDateKey());
  openGame(mod, { fresh: true, mode });
}

// --- painting the game view -------------------------------------------------

function paintGame() {
  if (!active) return;
  const { mod, game, settings } = active;

  mod.paint(game);
  mod.paintKeys(game, keys);

  dom.gameLabel.textContent = mod.name;
  const bits = [game.mode === 'daily' ? 'Daily' : 'Free play'];
  if (mod.difficulties) bits.push(mod.difficulties[settings.difficulty].label);
  dom.gameSub.textContent = bits.join(' · ');
  dom.caption.textContent = mod.caption(game);
  paintTimer();

  const done = game.solved || game.lost;
  for (const btn of dom.toolbar.querySelectorAll('[data-tool]')) {
    btn.disabled = done && btn.dataset.tool !== 'new';
  }
}

/**
 * Apply the result of a move: message, repaint, save, then settle the outcome.
 * @param {{toast?: string, clearAfter?: number}} result
 */
function afterMove(result = {}) {
  if (!active) return;
  if (result.toast) toast(result.toast);

  paintGame();
  persist();

  if (result.clearAfter) {
    clearTimeout(transientTimer);
    transientTimer = setTimeout(() => {
      active.mod.clearTransient(active.game);
      paintGame();
    }, result.clearAfter);
  }

  settleOutcome();
}

function settleOutcome() {
  const { mod, game, settings } = active;
  if (game.solved || game.lost) return;

  const won = mod.isSolved(game);
  const lost = !won && mod.isLost(game);
  if (!won && !lost) return;

  pauseTimer();
  mod.clearTransient(game);
  game.selectedIndex = null;

  let global = loadGlobal();
  if (won) {
    game.solved = true;
    ({ global } = recordSolve(mod.id, {
      mode: game.mode,
      difficulty: settings.difficulty ?? null,
      elapsedMs: game.elapsedMs,
      hintsUsed: game.hintsUsed ?? 0,
      dateKey: game.dateKey,
    }));
  } else {
    game.lost = true;
    recordLoss(mod.id);
  }

  paintGame();
  persist();
  showOutcome(won, global);
}

function showOutcome(won, global) {
  const { mod, game, settings } = active;
  const content = mod.outcomeContent(game);

  $('win-title').textContent = content.title;
  $('win-body').textContent = content.body;
  $('win-caption').textContent = content.caption ?? '';
  $('win-time').textContent = formatTime(game.elapsedMs);
  $('win-hints').textContent = String(game.hintsUsed ?? 0);
  $('win-streak').textContent = String(effectiveStreak(global));

  const stats = loadStats(mod.id);
  const band = settings.difficulty ?? 'default';
  let note = '';
  if (!won) {
    note = '';
  } else if (game.mode === 'free') {
    // Without this, a run of free-play solves looks like a broken streak counter
    // rather than a counter measuring something else.
    note = 'Free play. Solve a Daily to build your streak.';
  } else if ((game.hintsUsed ?? 0) > 0) {
    note = 'Best times only count hint-free solves.';
  } else if (stats.bestTimes[band] === game.elapsedMs) {
    note = mod.difficulties
      ? `New best time for ${mod.difficulties[settings.difficulty].label}!`
      : 'New best time!';
  }
  $('win-note').textContent = note;

  dom.dlgWin.classList.toggle('sheet-loss', !won);
  openDialog(dom.dlgWin);
  if (won) burstConfetti($('confetti'));
  else $('confetti').textContent = '';
}

// --- views ------------------------------------------------------------------

function showView(next) {
  view = next;
  dom.viewHome.hidden = next !== 'home';
  dom.viewGame.hidden = next !== 'game';

  if (next === 'home') {
    persist();
    paintHome();
    window.scrollTo(0, 0);
  }
  syncTimer();
}

function goHome() {
  // Unwind the history entry pushed on entering a game so the back gesture and
  // this button stay in step; popstate performs the actual switch.
  if (history.state?.view === 'game') {
    history.back();
    return;
  }
  persist();
  showView('home');
}

// --- home screen ------------------------------------------------------------
//
// The home screen is a list of compact rows, one per game, sorted into three
// groups by today's state: in progress, not started, finished. The groups
// reorder themselves as you play, so the top of the list is always what to do
// next and the list shortens as the day goes on.
//
// Everything else about a game -- its rules, its difficulty, free play, its
// record -- lives in a per-game sheet. That is what lets the library grow: N
// games cost N rows here, not N cards' worth of controls.

/** Today's daily state for a game, as the home row and the game sheet show it. */
function todayStatus(mod, today = localDateKey()) {
  const settings = settingsFor(mod);
  const label = mod.difficulties ? mod.difficulties[settings.difficulty].label : '';
  const snapshot = loadProgress(mod.id, 'daily', today);
  // A board saved at another difficulty is not today's puzzle as configured.
  const usable = snapshot && (snapshot.difficulty ?? null) === (settings.difficulty ?? null);
  return { ...mod.statusFor(usable ? snapshot : null, { difficultyLabel: label }), settings };
}

/**
 * A game the player has never opened. Tapping it shows the rules before the
 * board -- worth a tap for something you have never seen, and skipped entirely
 * for a game you already know.
 */
function isUntried(mod, status) {
  return loadStats(mod.id).played === 0 && status.state === 'new';
}

/**
 * Whether New badges would mean anything.
 *
 * A badge marks an exception, so it only earns its place when untried games are
 * a minority: on a fresh install everything is new, and a batch of nine added at
 * once is a wall of blue that says nothing about any one of them.
 *
 * @param {number} untried
 * @param {number} total
 */
function badgesAreMeaningful(untried, total) {
  return untried > 0 && untried < total && untried <= Math.max(1, Math.floor(total / 3));
}

/** Build one row per registered game. Adding a game needs no HTML change. */
function buildHome() {
  buildChips();
  rowEls.clear();

  for (const mod of GAMES) {
    const row = document.createElement('li');
    row.className = 'game-row';
    row.dataset.game = mod.id;
    row.innerHTML = `
      <button class="row-main" data-role="open" type="button">
        <span class="row-mark" aria-hidden="true">${mod.icon}</span>
        <span class="row-text">
          <span class="row-name">
            ${mod.name}<span class="pill-new" data-role="new" hidden>New</span>
          </span>
          <span class="row-status" data-role="status"></span>
        </span>
        <span class="row-action" data-role="action"></span>
      </button>
      <button class="row-more" data-role="more" type="button" aria-label="${mod.name} details">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.9" />
          <circle cx="12" cy="12" r="1.9" />
          <circle cx="19" cy="12" r="1.9" />
        </svg>
      </button>`;
    rowEls.set(mod.id, row);
  }
}

/**
 * Category filters, but only once there are enough games to need them. Below the
 * threshold the whole library fits on a screen and a filter is one more thing to
 * read past.
 */
function buildChips() {
  const wanted = GAMES.length >= FILTER_THRESHOLD && CATEGORIES.length > 1;
  dom.chips.hidden = !wanted;
  if (!wanted) return;

  dom.chips.innerHTML = ['all', ...CATEGORIES]
    .map(
      (key) =>
        `<button class="chip" type="button" data-filter="${key}">${key === 'all' ? 'All' : key}</button>`
    )
    .join('');
}

function paintHome() {
  const today = localDateKey();
  const global = loadGlobal();
  const streak = effectiveStreak(global, today);

  dom.homeDate.textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const pill = $('btn-streak');
  $('home-streak').textContent = String(streak);
  pill.classList.toggle('is-cold', streak === 0);
  pill.setAttribute(
    'aria-label',
    streak === 0 ? 'Statistics. No current streak' : `Statistics. ${streak} day streak`
  );

  // Read every game's state first: whether a New badge means anything depends on
  // how many of them are untried.
  const entries = GAMES.map((mod) => ({ mod, status: todayStatus(mod, today) }));
  const untried = entries.filter(({ mod, status }) => isUntried(mod, status)).length;
  const badges = badgesAreMeaningful(untried, entries.length);

  const buckets = { resume: [], open: [], done: [] };
  const states = [];
  let solvedToday = 0;

  for (const { mod, status } of entries) {
    paintRow(mod, status, badges);

    states.push(status.state);
    if (status.state === 'solved') solvedToday += 1;

    const bucket =
      status.state === 'progress' ? 'resume' : status.state === 'new' ? 'open' : 'done';
    if (filter === 'all' || mod.category === filter) buckets[bucket].push(mod.id);
  }

  // Rows are moved rather than rebuilt, so nothing is thrown away on a repaint.
  for (const [name, ids] of Object.entries(buckets)) {
    const list = dom.lists[name];
    list.textContent = '';
    for (const id of ids) list.appendChild(rowEls.get(id));
    dom.sections[name].hidden = ids.length === 0;
  }

  // With nothing in progress, "Today's puzzles" is the only heading that makes
  // sense; with something in progress, the two headings divide the list.
  $('open-head').textContent = buckets.resume.length ? 'Also today' : "Today's puzzles";
  $('done-head').textContent = `Finished today · ${buckets.done.length}`;

  paintTodayMeter(states, solvedToday, streak);
  paintChips();

  $('home-foot').textContent =
    global.totalSolved === 0
      ? 'No puzzles solved yet'
      : `${global.totalSolved} solved all time · best streak ${global.maxStreak}`;
}

function paintRow(mod, status, badges) {
  const row = rowEls.get(mod.id);

  const statusEl = row.querySelector('[data-role="status"]');
  statusEl.textContent = status.text;
  statusEl.classList.toggle('is-progress', status.state === 'progress');
  statusEl.classList.toggle('is-solved', status.state === 'solved');
  statusEl.classList.toggle('is-lost', status.state === 'lost');

  row.querySelector('[data-role="action"]').textContent = status.action;
  row.querySelector('[data-role="new"]').hidden = !badges || !isUntried(mod, status);
}

/**
 * The dot meter always covers every game, whatever the list is filtered to:
 * it reports the day, not the current view.
 */
function paintTodayMeter(states, solvedToday, streak) {
  const dots = $('today-dots');
  dots.textContent = '';
  for (const state of states) {
    const dot = document.createElement('li');
    if (state !== 'new') dot.className = `is-${state}`;
    dots.appendChild(dot);
  }

  $('today-count').textContent = `${solvedToday} of ${GAMES.length} done`;

  let note = '';
  if (solvedToday === 0) {
    note =
      streak > 0
        ? `Solve any daily to keep your ${streak}-day streak going.`
        : 'Solve any daily to start a streak.';
  } else if (solvedToday === GAMES.length) {
    note = 'Every daily done. Free play is still open.';
  }
  $('today-note').textContent = note;
}

function paintChips() {
  for (const chip of dom.chips.querySelectorAll('.chip')) {
    chip.setAttribute('aria-pressed', String(chip.dataset.filter === filter));
  }
}

// --- per-game sheet ---------------------------------------------------------

function openGameSheet(mod) {
  sheetGame = mod;
  paintGameSheet();
  openDialog(dom.dlgGame);
}

function paintGameSheet() {
  const mod = sheetGame;
  if (!mod) return;

  const status = todayStatus(mod);

  $('gs-mark').innerHTML = mod.icon;
  $('gs-name').textContent = mod.name;
  $('gs-blurb').textContent = mod.blurb;

  const statusEl = $('gs-status');
  statusEl.textContent = status.text;
  statusEl.classList.toggle('is-progress', status.state === 'progress');
  statusEl.classList.toggle('is-solved', status.state === 'solved');
  statusEl.classList.toggle('is-lost', status.state === 'lost');
  $('gs-play').textContent = status.action;

  $('gs-diff-row').hidden = !mod.difficulties;
  if (mod.difficulties) {
    $('gs-difficulty').innerHTML = Object.entries(mod.difficulties)
      .map(
        ([key, d]) =>
          `<button class="seg" type="button" data-difficulty="${key}"
             aria-pressed="${key === status.settings.difficulty}">${d.label}</button>`
      )
      .join('');
    $('gs-note').textContent = mod.difficultyNotes?.[status.settings.difficulty] ?? '';
  }

  // textContent per line: the rules are plain prose, never markup.
  const howTo = $('gs-howto');
  howTo.textContent = '';
  for (const line of mod.howTo ?? []) {
    const p = document.createElement('p');
    p.textContent = line;
    howTo.appendChild(p);
  }

  $('gs-record').innerHTML = recordMarkup(mod);
}

/** A best time, or an em dash when nothing hint-free has been recorded yet. */
function bestTime(stats, band) {
  const ms = stats.bestTimes[band];
  return ms == null ? '—' : formatTime(ms);
}

/** One game's full record: counters, then a best time per difficulty band. */
function recordMarkup(mod) {
  const stats = loadStats(mod.id);
  const rate = stats.played === 0 ? 0 : Math.round((stats.solved / stats.played) * 100);
  const bands = mod.difficulties
    ? Object.entries(mod.difficulties).map(([key, d]) => [d.label, key])
    : [['Best time', 'default']];

  return `
    <dl class="stat-grid">
      <div><dt>Played</dt><dd>${stats.played}</dd></div>
      <div><dt>Solved</dt><dd>${stats.solved}</dd></div>
      <div><dt>Streak</dt><dd>${effectiveStreak(stats)}</dd></div>
    </dl>
    <dl class="stat-grid stat-grid-sm">
      <div><dt>Win rate</dt><dd>${rate}%</dd></div>
      ${bands
        .map(([label, band]) => `<div><dt>${label}</dt><dd>${bestTime(stats, band)}</dd></div>`)
        .join('')}
    </dl>`;
}

// --- stats sheet ------------------------------------------------------------

function paintStats() {
  const global = loadGlobal();
  $('stat-streak').textContent = String(effectiveStreak(global));
  $('stat-maxstreak').textContent = String(global.maxStreak);
  $('stat-total').textContent = String(global.totalSolved);

  const host = $('stats-games');
  host.textContent = '';

  // Two lines per game rather than a block each: this has to stay readable at a
  // dozen games, and the per-game sheet is where the detail lives.
  for (const mod of GAMES) {
    const stats = loadStats(mod.id);
    const rate = stats.played === 0 ? 0 : Math.round((stats.solved / stats.played) * 100);

    const counts =
      stats.played === 0
        ? 'Not played yet'
        : `${stats.solved} of ${stats.played} solved · ${rate}% · streak ${effectiveStreak(stats)}`;

    // A game with difficulty bands needs them named; one without would otherwise
    // read "Best: Best —".
    const best = mod.difficulties
      ? `Best: ${Object.entries(mod.difficulties)
          .map(([key, d]) => `${d.label} ${bestTime(stats, key)}`)
          .join(' · ')}`
      : `Best time: ${bestTime(stats, 'default')}`;

    const item = document.createElement('li');
    item.className = 'stat-row';
    item.innerHTML =
      `<span class="stat-row-name">${mod.name}</span>` +
      `<span class="stat-row-line">${counts}</span>` +
      `<span class="stat-row-line stat-row-best">${best}</span>`;
    host.appendChild(item);
  }
}

// --- settings sheet ---------------------------------------------------------

function paintSettings() {
  for (const btn of $('seg-theme').querySelectorAll('.seg')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.theme === appSettings.theme));
  }
}

// --- misc shell -------------------------------------------------------------

function toast(message) {
  dom.toast.textContent = message;
  dom.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.toast.hidden = true;
  }, 1800);
}

function openDialog(dialog) {
  pauseTimer();
  dialog.showModal();
}

function applyTheme() {
  if (appSettings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', appSettings.theme);
}

// --- events -----------------------------------------------------------------

function wireEvents() {
  dom.puzzle.addEventListener('click', (event) => {
    const cell = event.target.closest('.cell');
    if (!cell || !active || active.game.solved || active.game.lost) return;
    active.mod.onSelect(active.game, Number(cell.dataset.index));
    paintGame();
  });

  dom.keyboard.addEventListener('click', (event) => {
    const key = event.target.closest('.key');
    if (!key || !active) return;
    afterMove(active.mod.onKey(active.game, key.dataset.key));
  });

  dom.toolbar.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-tool]');
    if (!btn || !active) return;
    const { mod, game } = active;

    if (btn.dataset.tool === 'new') {
      // Daily is one puzzle a day by definition, so New moves into free play.
      startFresh(mod, 'free');
      return;
    }
    if (btn.dataset.tool === 'hint') afterMove(mod.hint(game));
    else if (btn.dataset.tool === 'check') afterMove(mod.check(game));
    else if (btn.dataset.tool === 'reset') afterMove(mod.reset(game));
  });

  dom.btnHome.addEventListener('click', goHome);

  const openStats = () => {
    paintStats();
    openDialog(dom.dlgStats);
  };
  dom.btnStats.addEventListener('click', openStats);
  $('btn-streak').addEventListener('click', openStats);
  $('home-foot').addEventListener('click', openStats);

  $('btn-stats-close').addEventListener('click', () => dom.dlgStats.close());
  $('btn-win-home').addEventListener('click', () => {
    dom.dlgWin.close();
    goHome();
  });
  $('btn-win-next').addEventListener('click', () => {
    dom.dlgWin.close();
    startFresh(active.mod, 'free');
  });

  // Home rows: the row plays, the dots button opens the game's sheet.
  dom.games.addEventListener('click', (event) => {
    const row = event.target.closest('.game-row');
    if (!row) return;
    const mod = gameById(row.dataset.game);
    if (!mod) return;

    if (event.target.closest('[data-role="more"]')) {
      openGameSheet(mod);
      return;
    }
    if (event.target.closest('[data-role="open"]')) {
      if (isUntried(mod, todayStatus(mod))) openGameSheet(mod);
      else openGame(mod, { mode: 'daily' });
    }
  });

  dom.chips.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip || chip.dataset.filter === filter) return;
    filter = chip.dataset.filter;
    paintHome();
  });

  // --- per-game sheet ---
  $('gs-play').addEventListener('click', () => {
    const mod = sheetGame;
    dom.dlgGame.close();
    openGame(mod, { mode: 'daily' });
  });

  $('gs-free').addEventListener('click', () => {
    const mod = sheetGame;
    dom.dlgGame.close();
    startFresh(mod, 'free');
  });

  $('gs-difficulty').addEventListener('click', (event) => {
    const seg = event.target.closest('.seg');
    if (!seg || !sheetGame) return;

    const settings = settingsFor(sheetGame);
    if (seg.dataset.difficulty === settings.difficulty) return;
    settings.difficulty = seg.dataset.difficulty;
    saveGameSettings(sheetGame.id, settings);
    // Difficulty reseeds this game's daily, so both the sheet and the row behind
    // it have to be re-read.
    paintGameSheet();
    paintHome();
  });

  $('gs-close').addEventListener('click', () => dom.dlgGame.close());

  // --- settings sheet ---
  $('btn-settings').addEventListener('click', () => {
    paintSettings();
    openDialog(dom.dlgSettings);
  });

  $('btn-settings-close').addEventListener('click', () => dom.dlgSettings.close());

  $('seg-theme').addEventListener('click', (event) => {
    const btn = event.target.closest('.seg');
    if (!btn) return;
    appSettings.theme = btn.dataset.theme;
    saveAppSettings(appSettings);
    applyTheme();
    paintSettings();
  });

  $('btn-reset-stats').addEventListener('click', () => {
    if (!window.confirm('Reset all statistics for every game? This cannot be undone.')) return;
    resetAllStats(GAME_IDS);
    paintHome();
    toast('Statistics reset');
  });

  for (const dialog of [dom.dlgWin, dom.dlgStats, dom.dlgGame, dom.dlgSettings]) {
    // Tapping the backdrop closes. The dialog fills the sheet, so a click landing
    // directly on it means the backdrop was hit.
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', syncTimer);
  }

  // Physical keyboard, mostly for desktop play and testing.
  document.addEventListener('keydown', (event) => {
    if (view !== 'game' || !active || anyDialogOpen()) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const { mod, game } = active;

    if (/^[a-zA-Z]$/.test(event.key)) {
      event.preventDefault();
      afterMove(mod.onKey(game, event.key.toUpperCase()));
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      afterMove(mod.onKey(game, 'DEL'));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      afterMove(mod.onKey(game, 'ENTER'));
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      mod.move(game, 1);
      paintGame();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      mod.move(game, -1);
      paintGame();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist();
    syncTimer();
  });

  // pagehide is the reliable "app is going away" signal on iOS, where
  // beforeunload frequently never fires.
  window.addEventListener('pagehide', persist);

  window.addEventListener('popstate', () => {
    if (view !== 'game') return;
    persist();
    showView('home');
  });
}

// --- boot -------------------------------------------------------------------

function boot() {
  migrateLegacy();
  appSettings = loadAppSettings();
  applyTheme();
  pruneOldProgress();

  buildHome();
  wireEvents();

  // history.state survives a reload, so refreshing inside a game would leave a
  // stale {view:'game'} entry behind and make the back button navigate off the
  // site. Boot always starts at home, so the entry must say so.
  if (history.state?.view === 'game') history.replaceState({ view: 'home' }, '');

  // Land on home. No board is built until a card is tapped, which also keeps the
  // played count honest -- opening the app is not playing a puzzle.
  showView('home');

  if (!storageAvailable()) toast('Private mode: progress will not be saved');

  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    const problems = validateQuotes();
    if (problems.length) console.warn('Quote pack issues:\n' + problems.join('\n'));
  }

  // isSecureContext covers https and localhost, which is where service workers
  // are permitted to register at all.
  if ('serviceWorker' in navigator && window.isSecureContext) {
    // The load that discovers a new worker is still served by the old one, so on
    // an upgrade this page is showing stale assets. Reload once when the new
    // worker takes control. Guarded two ways: only when a controller already
    // existed (a first install must not reload), and only once per page.
    const wasControlled = Boolean(navigator.serviceWorker.controller);
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!wasControlled || reloading) return;
      reloading = true;
      location.reload();
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {
        /* offline support is a bonus, not a requirement */
      });
    });
  }
}

boot();
