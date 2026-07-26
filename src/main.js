// The app shell: home screen, game view, timer, dialogs, persistence, wiring.
//
// Knows nothing about any game's rules. Everything game-specific comes from the
// modules in src/games/, via the registry.

import { localDateKey } from './cipher.js';
import { validateQuotes } from './quotes.js';
import { GAMES, GAME_IDS, gameById } from './games/registry.js';
import { buildKeyboard, burstConfetti } from './render.js';
import {
  clearProgress,
  dailiesSolvedToday,
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
};

let appSettings = loadAppSettings();
let view = 'home';

/** The board on screen: the module, its live state, and its settings. */
let active = null;
let keys = null;
let keyboardOwner = null; // which game's layout is currently built

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

/** Build one card per registered game. Adding a game needs no HTML change. */
function buildHome() {
  dom.games.textContent = '';

  for (const mod of GAMES) {
    const card = document.createElement('li');
    card.className = 'game-card';
    card.dataset.game = mod.id;

    const difficultyControl = mod.difficulties
      ? `<div class="segmented segmented-sm" data-role="difficulty" role="group" aria-label="${mod.name} difficulty">
           ${Object.entries(mod.difficulties)
             .map(([key, d]) => `<button class="seg" type="button" data-difficulty="${key}">${d.label}</button>`)
             .join('')}
         </div>
         <p class="hint-text" data-role="note"></p>`
      : '';

    card.innerHTML = `
      <div class="game-head">
        <span class="game-mark" aria-hidden="true">${mod.icon}</span>
        <div class="game-titles">
          <h3 class="game-name">${mod.name}</h3>
          <p class="game-blurb">${mod.blurb}</p>
        </div>
      </div>

      <div class="card-row">
        <div class="card-row-text">
          <span class="row-label">Daily puzzle</span>
          <span class="row-status" data-role="status">Not started</span>
        </div>
        <button class="btn btn-primary btn-compact" data-role="play-daily" type="button">Play</button>
      </div>

      <div class="card-row card-row-stack">
        <div class="card-row-text">
          <span class="row-label">Free play</span>
          <span class="row-status">A fresh puzzle any time</span>
        </div>
        ${difficultyControl}
        <button class="btn btn-compact btn-block" data-role="play-free" type="button">New puzzle</button>
      </div>`;

    dom.games.appendChild(card);
  }
}

function paintHome() {
  const today = localDateKey();
  const global = loadGlobal();

  dom.homeDate.textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  $('home-streak').textContent = String(effectiveStreak(global, today));
  $('home-solved').textContent = String(global.totalSolved);
  $('home-today').textContent = `${dailiesSolvedToday(GAME_IDS, today)}/${GAMES.length}`;

  for (const mod of GAMES) {
    const card = dom.games.querySelector(`[data-game="${mod.id}"]`);
    const settings = settingsFor(mod);
    const label = mod.difficulties ? mod.difficulties[settings.difficulty].label : '';

    const snapshot = loadProgress(mod.id, 'daily', today);
    // A board saved at another difficulty is not today's puzzle as configured.
    const usable = snapshot && (snapshot.difficulty ?? null) === (settings.difficulty ?? null);
    const status = mod.statusFor(usable ? snapshot : null, { difficultyLabel: label });

    const statusEl = card.querySelector('[data-role="status"]');
    statusEl.textContent = status.text;
    statusEl.classList.toggle('is-progress', status.state === 'progress');
    statusEl.classList.toggle('is-solved', status.state === 'solved');
    statusEl.classList.toggle('is-lost', status.state === 'lost');
    card.querySelector('[data-role="play-daily"]').textContent = status.action;

    if (mod.difficulties) {
      for (const btn of card.querySelectorAll('[data-role="difficulty"] .seg')) {
        btn.setAttribute('aria-pressed', String(btn.dataset.difficulty === settings.difficulty));
      }
      card.querySelector('[data-role="note"]').textContent =
        mod.difficultyNotes?.[settings.difficulty] ?? '';
    }
  }

  for (const btn of document.querySelectorAll('#seg-theme .seg')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.theme === appSettings.theme));
  }
}

// --- stats sheet ------------------------------------------------------------

function paintStats() {
  const global = loadGlobal();
  $('stat-streak').textContent = String(effectiveStreak(global));
  $('stat-maxstreak').textContent = String(global.maxStreak);
  $('stat-total').textContent = String(global.totalSolved);

  const host = $('stats-games');
  host.textContent = '';

  for (const mod of GAMES) {
    const stats = loadStats(mod.id);
    const rate = stats.played === 0 ? 0 : Math.round((stats.solved / stats.played) * 100);

    const bands = mod.difficulties
      ? Object.entries(mod.difficulties).map(([key, d]) => [d.label, stats.bestTimes[key]])
      : [['Best', stats.bestTimes.default]];

    const section = document.createElement('section');
    section.className = 'stats-game';
    section.innerHTML = `
      <h3 class="sheet-subtitle">${mod.name}</h3>
      <dl class="stat-grid">
        <div><dt>Played</dt><dd>${stats.played}</dd></div>
        <div><dt>Solved</dt><dd>${stats.solved}</dd></div>
        <div><dt>Win rate</dt><dd>${rate}%</dd></div>
      </dl>
      <dl class="stat-grid stat-grid-sm">
        <div><dt>Streak</dt><dd>${effectiveStreak(stats)}</dd></div>
        ${bands
          .map(([label, ms]) => `<div><dt>${label}</dt><dd>${ms == null ? '—' : formatTime(ms)}</dd></div>`)
          .join('')}
      </dl>`;
    host.appendChild(section);
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
  $('btn-home-stats').addEventListener('click', openStats);

  $('btn-stats-close').addEventListener('click', () => dom.dlgStats.close());
  $('btn-win-home').addEventListener('click', () => {
    dom.dlgWin.close();
    goHome();
  });
  $('btn-win-next').addEventListener('click', () => {
    dom.dlgWin.close();
    startFresh(active.mod, 'free');
  });

  $('btn-reset-stats').addEventListener('click', () => {
    if (!window.confirm('Reset all statistics for every game? This cannot be undone.')) return;
    resetAllStats(GAME_IDS);
    paintStats();
    toast('Statistics reset');
  });

  // Home cards: play, and per-game difficulty.
  dom.games.addEventListener('click', (event) => {
    const card = event.target.closest('.game-card');
    if (!card) return;
    const mod = gameById(card.dataset.game);
    if (!mod) return;

    if (event.target.closest('[data-role="play-daily"]')) {
      openGame(mod, { mode: 'daily' });
      return;
    }
    if (event.target.closest('[data-role="play-free"]')) {
      startFresh(mod, 'free');
      return;
    }

    const seg = event.target.closest('[data-role="difficulty"] .seg');
    if (seg) {
      const settings = settingsFor(mod);
      if (seg.dataset.difficulty === settings.difficulty) return;
      settings.difficulty = seg.dataset.difficulty;
      saveGameSettings(mod.id, settings);
      // Difficulty reseeds that game's daily, so its card has to be re-read.
      paintHome();
    }
  });

  $('seg-theme').addEventListener('click', (event) => {
    const btn = event.target.closest('.seg');
    if (!btn) return;
    appSettings.theme = btn.dataset.theme;
    saveAppSettings(appSettings);
    applyTheme();
    paintHome();
  });

  for (const dialog of [dom.dlgWin, dom.dlgStats]) {
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
