// The app shell: home screen, game view, timer, dialogs, persistence, wiring.
//
// Knows nothing about any game's rules. Everything game-specific comes from the
// modules in src/games/, via the registry.

import { hashString, localDateKey } from './cipher.js';
import { validateQuotes } from './quotes.js';
import {
  CATEGORIES,
  FILTER_THRESHOLD,
  GAMES,
  GAME_IDS,
  gameById,
} from './games/registry.js';
import { buildKeyboard, burstConfetti } from './render.js';
import { setHapticsEnabled, setSoundEnabled, sfx } from './sound.js';
import {
  clearProgress,
  dailyNumber,
  effectiveStreak,
  formatCountdown,
  formatTime,
  msUntilLocalMidnight,
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
  chips: $('chips'),

  // Today holds the hero card and a row per remaining daily; Games holds every
  // game, always, as a tile grid.
  heroCard: $('hero-card'),
  listToday: $('list-today'),
  listGames: $('list-games'),
  todayDone: $('today-done'),

  puzzle: $('puzzle'),
  caption: $('caption'),
  strip: $('status-strip'),
  stripLabel: $('strip-label'),
  stripFill: $('strip-fill'),
  stripNote: $('strip-note'),
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

/**
 * Home rows, built once and moved in and out of the DOM as state changes.
 *
 * Two pools, because the same game says different things in the two sections: in
 * Today a row is that game's daily (Play / Continue), in Games it is a fresh
 * puzzle (New puzzle).
 */
const todayRowEls = new Map();
const gameRowEls = new Map();

/** Which category the home list is filtered to, or 'all'. Not persisted: this is
    a browsing state, not a preference. */
let filter = 'all';

/** The game whose sheet is open. */
let sheetGame = null;

let runningSince = null;
let tickHandle = null;
let toastTimer = null;
let transientTimer = null;

/** Ticks the "new dailies in ..." countdown while home is on screen. */
let countdownHandle = null;

/** The date the home screen was last painted for, so midnight can roll it over. */
let homeDateKey = null;

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
 * Paint an element with a game's identity hue. Everything downstream reads
 * var(--game); no component ever learns the palette.
 */
function setGameHue(el, mod) {
  el.style.setProperty('--game', `var(--hue-${mod.hue})`);
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

  // A game may declare keyboard: null and play entirely on the board -- Word
  // Search does. The row of keys is then not just empty but gone, handing its
  // height back to the grid.
  if (mod.keyboard) {
    // Rebuild only when moving between games with different layouts.
    if (keyboardOwner !== mod.id) {
      keys = buildKeyboard(dom.keyboard, mod.keyboard);
      keyboardOwner = mod.id;
    }
  } else {
    keys = null;
    keyboardOwner = null;
  }
  dom.keyboard.hidden = !mod.keyboard;

  for (const btn of dom.toolbar.querySelectorAll('[data-tool]')) {
    btn.hidden = !mod.tools.includes(btn.dataset.tool);
  }

  clearTimeout(transientTimer);
  runningSince = null;
  clearInterval(tickHandle);
  tickHandle = null;

  setGameHue(dom.viewGame, mod);
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

// Hints are a budget, not a firehose: the harder the setting, the fewer you
// get. Every hinting game uses the same three difficulty keys, so one table
// covers them all; a game without difficulties is uncapped.
const HINT_LIMITS = { easy: 5, medium: 3, hard: 1 };

/** Hints remaining on the active board, or null when no cap applies. */
function hintsLeft(game, settings) {
  const cap = HINT_LIMITS[settings.difficulty];
  if (cap == null) return null;
  return Math.max(0, cap - (game.hintsUsed ?? 0));
}

function paintGame() {
  if (!active) return;
  const { mod, game, settings } = active;

  mod.paint(game);
  if (keys) mod.paintKeys(game, keys);

  dom.gameLabel.textContent = mod.name;
  const bits = [game.mode === 'daily' ? 'Daily' : 'Free play'];
  if (mod.difficulties) bits.push(mod.difficulties[settings.difficulty].label);
  dom.gameSub.textContent = bits.join(' · ');
  dom.caption.textContent = mod.caption(game);
  paintTimer();

  // The status strip: every game computes a progress line; the strip gives it
  // a fixed home and a bar in the game's colour.
  const progress = mod.progress ? mod.progress(game) : null;
  dom.strip.hidden = !progress;
  if (progress) {
    dom.stripLabel.textContent = progress.label;
    dom.stripNote.textContent = progress.note ?? '';
    const pct = progress.max > 0 ? Math.min(100, (progress.value / progress.max) * 100) : 0;
    dom.stripFill.style.width = `${pct}%`;
  }

  const done = game.solved || game.lost;
  const left = hintsLeft(game, settings);
  for (const btn of dom.toolbar.querySelectorAll('[data-tool]')) {
    btn.disabled =
      (done && btn.dataset.tool !== 'new') ||
      (btn.dataset.tool === 'hint' && left === 0);
    // The label carries the budget, so running low is visible before it bites.
    if (btn.dataset.tool === 'hint') {
      btn.querySelector('.tool-label').textContent = left == null ? 'Hint' : `Hint (${left})`;
    }
  }
}

/**
 * Apply the result of a move: message, repaint, save, then settle the outcome.
 * @param {{toast?: string, clearAfter?: number}} result
 */
function afterMove(result = {}) {
  if (!active) return;
  if (result.toast) toast(result.toast);

  // Every rejection path in every game sets clearAfter (a shake, a miss flash,
  // wrong letters from Check), so it doubles as the wrong-answer cue.
  if (result.clearAfter && !active.game.solved && !active.game.lost) sfx.wrong();

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
  // Read before recording, so the sheet can count the streak up rather than
  // just stating it -- the number rising is the actual reward.
  const streakBefore = effectiveStreak(global);
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

  if (won) sfx.solve(mod.id);
  else sfx.lose();

  paintGame();
  persist();
  showOutcome(won, global, streakBefore);
}

/** The daily the win sheet should point at next, or null once Today is done. */
function nextDaily(excludeId) {
  const today = localDateKey();
  for (const mod of GAMES) {
    if (mod.id === excludeId) continue;
    const status = todayStatus(mod, today);
    if (status.state === 'new' || status.state === 'progress') return mod;
  }
  return null;
}

/** Where the win sheet's primary button goes; null means free-play the same game. */
let winNextTarget = null;

/**
 * The quote is the prize, so it arrives like one: word by word on a short
 * stagger rather than all at once. Reduced motion collapses the delays.
 */
function paintWinBody(text) {
  const body = $('win-body');
  body.textContent = '';
  const words = String(text).split(' ');
  words.forEach((word, n) => {
    const span = document.createElement('span');
    span.className = 'win-word';
    span.textContent = word;
    span.style.animationDelay = `${Math.min(n * 45, 1400)}ms`;
    body.appendChild(span);
    if (n < words.length - 1) body.appendChild(document.createTextNode(' '));
  });
}

/** Count the streak stat up by one, with a tick, when this solve advanced it. */
function paintWinStreak(before, after) {
  const el = $('win-streak');
  el.classList.remove('tick');
  if (after <= before || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = String(after);
    return;
  }
  el.textContent = String(before);
  setTimeout(() => {
    el.textContent = String(after);
    void el.offsetWidth;
    el.classList.add('tick');
    sfx.streak();
  }, 700);
}

/** The spoiler-free share card: a header the shell owns, lines the module owns. */
function shareText() {
  const { mod, game } = active;
  const head =
    game.mode === 'daily'
      ? `${mod.name} #${dailyNumber(game.dateKey)}`
      : `${mod.name} · Free play`;
  return [head, ...mod.shareLines(game)].join('\n');
}

function showOutcome(won, global, streakBefore = 0) {
  const { mod, game, settings } = active;
  const content = mod.outcomeContent(game);
  setGameHue(dom.dlgWin, mod);

  const hints = game.hintsUsed ?? 0;
  const modeLabel = game.mode === 'daily' ? 'Daily' : 'Free play';
  $('win-badge').textContent = won
    ? `${modeLabel} solved · ${hints === 0 ? 'no hints' : `${hints} hint${hints === 1 ? '' : 's'}`}`
    : modeLabel;

  $('win-title').textContent = content.title;
  paintWinBody(content.body);
  $('win-caption').textContent = content.caption ?? '';
  $('win-time').textContent = formatTime(game.elapsedMs);

  const stats = loadStats(mod.id);
  const band = settings.difficulty ?? 'default';
  $('win-best').textContent = bestTime(stats, band);
  paintWinStreak(streakBefore, effectiveStreak(global));

  let note = '';
  if (!won) {
    note = '';
  } else if (game.mode === 'free') {
    // Without this, a run of free-play solves looks like a broken streak counter
    // rather than a counter measuring something else.
    note = 'Free play. Solve a Daily to build your streak.';
  } else if (hints > 0) {
    note = 'Best times only count hint-free solves.';
  } else if (stats.bestTimes[band] === game.elapsedMs) {
    note = mod.difficulties
      ? `New best time for ${mod.difficulties[settings.difficulty].label}!`
      : 'New best time!';
  }
  $('win-note').textContent = note;

  $('share-preview').textContent = shareText();

  // Home is the call to action; the link under it still chains the dailies.
  // After a daily it names the next unplayed one -- "Play again" starts free
  // play, which never advances the streak, so it only appears once Today is
  // empty. A loss gets the same pointer; the player who lost is the one most
  // in need of a next thing.
  winNextTarget = game.mode === 'daily' ? nextDaily(mod.id) : null;
  $('btn-win-next').textContent = winNextTarget ? `Next: ${winNextTarget.name}` : 'Play again';

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
  syncCountdown();
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
// Two sections, because the app is two things.
//
//   Today   the day's challenges: a dot per game, and a row per daily still to
//           play. This section legitimately empties out, and when it does it
//           becomes a completion panel counting down to the next set.
//
//   Games   every game, always, whatever the dailies have done. Tapping a row
//           starts a fresh puzzle.
//
// The earlier build sorted one list by today's state and collapsed the finished
// games into a <details>, so finishing every daily left an empty screen. The
// daily is an event; the library is the app. Keeping them in separate sections is
// what library-first puzzle apps do, and it means a game entry never changes
// meaning under you.
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
function isUntried(mod) {
  return loadStats(mod.id).played === 0;
}

/** A Today row: the whole row plays, the action text says what playing means. */
function buildRow(mod) {
  const row = document.createElement('li');
  row.className = 'game-row';
  row.dataset.game = mod.id;
  setGameHue(row, mod);
  row.innerHTML = `
    <button class="row-main" data-role="open" type="button">
      <span class="row-mark" aria-hidden="true">${mod.icon}</span>
      <span class="row-text">
        <span class="row-name">${mod.name}</span>
        <span class="row-status" data-role="status"></span>
      </span>
      <span class="row-action" data-role="action"></span>
    </button>`;
  return row;
}

/**
 * A library tile: tinted with the game's hue, tap to play, corner button for
 * the sheet. Two columns of these halve the scroll the old rows needed, and the
 * different shape is what makes Today and the library read as two things.
 */
function buildTile(mod) {
  const tile = document.createElement('li');
  tile.className = 'game-tile';
  tile.dataset.game = mod.id;
  setGameHue(tile, mod);
  tile.innerHTML = `
    <button class="tile-main" data-role="open" type="button">
      <span class="row-mark" aria-hidden="true">${mod.icon}</span>
      <span class="tile-name">${mod.name}</span>
      <span class="tile-rec" data-role="status"></span>
    </button>
    <button class="tile-info" data-role="more" type="button" aria-label="${mod.name} rules and record">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.6" fill="none" />
        <path d="M12 11.2v4.6" />
        <path d="M12 8.2v.01" />
      </svg>
    </button>`;
  return tile;
}

/** Build both pools. Adding a game needs no HTML change. */
function buildHome() {
  buildChips();
  todayRowEls.clear();
  gameRowEls.clear();

  for (const mod of GAMES) {
    todayRowEls.set(mod.id, buildRow(mod));
    gameRowEls.set(mod.id, buildTile(mod));
  }
}

/**
 * A Games row's status line: what you have done with this game overall, not
 * today. Best time is read from the difficulty band currently selected, since
 * that is the puzzle the row would start.
 */
function recordLine(mod) {
  const stats = loadStats(mod.id);
  if (stats.played === 0) return 'Not played yet';

  const best = stats.bestTimes[settingsFor(mod).difficulty ?? 'default'];
  const solved = `${stats.solved} solved`;
  return best == null ? solved : `Best ${formatTime(best)} · ${solved}`;
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
  homeDateKey = today;

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

  const entries = GAMES.map((mod) => ({ mod, status: todayStatus(mod, today) }));

  // --- Today: the hero card, then a row per remaining daily ----------------
  // 'lost' counts as finished. Fiver can run out of guesses, and offering it
  // again under "Today" would imply a second attempt that does not exist.
  const pending = entries.filter(({ status }) => status.state === 'new' || status.state === 'progress');
  const solvedToday = entries.filter(({ status }) => status.state === 'solved').length;

  const hero = pickHero(pending, today);
  paintHero(hero);

  dom.listToday.textContent = '';
  for (const { mod, status } of pending) {
    if (hero && mod.id === hero.mod.id) continue; // the hero card IS this row
    const row = todayRowEls.get(mod.id);
    paintRowStatus(row, status.text, status.state);
    row.querySelector('[data-role="action"]').textContent = status.action;
    dom.listToday.appendChild(row);
  }

  paintDots(entries);
  $('today-count').textContent = `${solvedToday} of ${GAMES.length} done`;
  paintTodayDone(pending.length, solvedToday, streak);

  // --- Games: every game, every time, as tiles -----------------------------
  dom.listGames.textContent = '';
  for (const { mod } of entries) {
    if (filter !== 'all' && mod.category !== filter) continue;
    const tile = gameRowEls.get(mod.id);
    paintRowStatus(tile, recordLine(mod), 'record');
    dom.listGames.appendChild(tile);
  }

  paintChips();

  $('home-foot').textContent =
    global.totalSolved === 0
      ? 'No puzzles solved yet'
      : `${global.totalSolved} solved all time · best streak ${global.maxStreak}`;
}

function paintRowStatus(row, text, state) {
  const el = row.querySelector('[data-role="status"]');
  el.textContent = text;
  el.classList.toggle('is-progress', state === 'progress');
  el.classList.toggle('is-solved', state === 'solved');
  el.classList.toggle('is-lost', state === 'lost');
}

/**
 * The day's featured game: rotates by date so the spotlight moves around the
 * library, but always lands on a daily still to play. Null once Today is done.
 */
function pickHero(pending, today) {
  if (pending.length === 0) return null;
  const rot = hashString(`hero|${today}`) % GAMES.length;
  for (let i = 0; i < GAMES.length; i++) {
    const mod = GAMES[(rot + i) % GAMES.length];
    const hit = pending.find((entry) => entry.mod.id === mod.id);
    if (hit) return hit;
  }
  return pending[0];
}

/** The one card the screen leads with. A decorative mark, never a live board. */
function paintHero(entry) {
  dom.heroCard.hidden = !entry;
  if (!entry) return;

  const { mod, status } = entry;
  dom.heroCard.dataset.game = mod.id;
  setGameHue(dom.heroCard, mod);
  dom.heroCard.innerHTML = `
    <button class="hero-main" data-role="open" type="button">
      <span class="hero-kicker">Today's puzzle</span>
      <span class="hero-name">${mod.name}</span>
      <span class="hero-blurb">${mod.blurb}</span>
      <span class="hero-foot">
        <span class="hero-mark" aria-hidden="true">${mod.icon}</span>
        <span class="hero-meta">${status.text}</span>
        <span class="hero-cta">${status.action}</span>
      </span>
    </button>`;
}

/**
 * One pip per game in that game's own colour, whatever the Games list is
 * filtered to: the meter reports the day, not the current view. Hollow, part
 * filled or solid -- a shape difference as well as a fill, because eight hues
 * at eleven pixels is exactly where colour vision stops being enough.
 */
function paintDots(entries) {
  const dots = $('today-dots');
  dots.textContent = '';
  for (const { mod, status } of entries) {
    const dot = document.createElement('li');
    if (status.state !== 'new') dot.className = `is-${status.state}`;
    setGameHue(dot, mod);
    dots.appendChild(dot);
  }
}

/**
 * Swap between the nudge shown while dailies are outstanding and the completion
 * panel shown once none are left.
 */
function paintTodayDone(pending, solvedToday, streak) {
  const done = pending === 0;
  dom.todayDone.hidden = !done;

  // The nudge only earns its place when there is a streak to lose today.
  $('today-note').textContent =
    !done && solvedToday === 0 && streak > 0
      ? `Solve any daily to keep your ${streak}-day streak going.`
      : '';

  if (!done) return;

  // "All caught up" would be a lie on a day something was lost rather than
  // solved, and the streak claim only holds if at least one daily was solved.
  $('today-done-line').textContent =
    solvedToday === GAMES.length
      ? 'All caught up. Streak is safe.'
      : solvedToday > 0
        ? 'Done for today. Streak is safe.'
        : 'Nothing more today.';

  paintCountdown();
}

function paintCountdown() {
  $('today-countdown').textContent = `New dailies in ${formatCountdown(msUntilLocalMidnight())}`;
}

/** Keep the countdown live, and roll the whole screen over at midnight. */
function tickCountdown() {
  if (localDateKey() !== homeDateKey) {
    paintHome();
    return;
  }
  paintCountdown();
}

function syncCountdown() {
  const wanted =
    view === 'home' && document.visibilityState === 'visible' && !dom.todayDone.hidden;

  if (wanted && countdownHandle === null) {
    // Twice a minute, so the displayed minute is never more than 30s stale.
    countdownHandle = setInterval(tickCountdown, 30_000);
  } else if (!wanted && countdownHandle !== null) {
    clearInterval(countdownHandle);
    countdownHandle = null;
  }
}

function paintChips() {
  for (const chip of dom.chips.querySelectorAll('.chip')) {
    chip.setAttribute('aria-pressed', String(chip.dataset.filter === filter));
  }
}

// --- per-game sheet ---------------------------------------------------------

function openGameSheet(mod) {
  sheetGame = mod;
  setGameHue(dom.dlgGame, mod);
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
  for (const btn of $('seg-sound').querySelectorAll('.seg')) {
    btn.setAttribute('aria-pressed', String((btn.dataset.sound === 'on') === appSettings.sound));
  }
  for (const btn of $('seg-haptics').querySelectorAll('.seg')) {
    btn.setAttribute('aria-pressed', String((btn.dataset.haptics === 'on') === appSettings.haptics));
  }
}

/** Push the persisted feedback switches into the sound module. */
function applyFeedbackSettings() {
  setSoundEnabled(appSettings.sound);
  setHapticsEnabled(appSettings.haptics);
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
    // Any element carrying data-index is playable, not just .cell: Word Search
    // draws a grid rather than the quote-shaped cells the other games use.
    const cell = event.target.closest('[data-index]');
    if (!cell || !active || active.game.solved || active.game.lost) return;

    sfx.tap();
    const result = active.mod.onSelect(active.game, Number(cell.dataset.index));

    // Selecting a cell can finish a board -- in Word Search the second tap of a
    // pair completes a word, and the last word wins. A module says so by
    // returning a move result; the games where a tap only moves a cursor return
    // nothing and are repainted without a save or an outcome check.
    if (result) {
      // A toast with no clearAfter from a board tap is a success -- in Word
      // Search, a found word -- and earns the two-note chime.
      if (result.toast && !result.clearAfter) sfx.word();
      afterMove(result);
    } else {
      paintGame();
    }
  });

  dom.keyboard.addEventListener('click', (event) => {
    const key = event.target.closest('.key');
    if (!key || !active) return;
    sfx.tap();
    afterMove(active.mod.onKey(active.game, key.dataset.key));
  });

  dom.toolbar.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-tool]');
    if (!btn || !active) return;
    const { mod, game, settings } = active;

    if (btn.dataset.tool === 'new') {
      // Daily is one puzzle a day by definition, so New moves into free play.
      startFresh(mod, 'free');
      return;
    }
    if (btn.dataset.tool === 'hint') {
      // The button disables at zero; this guard covers any other route in.
      if (hintsLeft(game, settings) === 0) {
        toast('No hints left on this one');
        return;
      }
      afterMove(mod.hint(game));
    }
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
    if (winNextTarget) {
      // An untried game still shows its rules first, even from here.
      if (isUntried(winNextTarget)) openGameSheet(winNextTarget);
      else openGame(winNextTarget, { mode: 'daily' });
    } else {
      startFresh(active.mod, 'free');
    }
  });

  $('btn-win-share').addEventListener('click', async () => {
    const text = $('share-preview').textContent;
    // navigator.share needs a user gesture and https; the clipboard is the
    // fallback everywhere else, including desktop.
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
    } catch {
      return; // the user closed the share tray; not an error
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard');
    } catch {
      toast('Could not copy');
    }
  });

  // Home: the hero card, a Today row and a library tile all carry data-game.
  // The main surface plays; a tile's corner button opens the game's sheet.
  // Which section the element sits in decides what "plays" means.
  dom.viewHome.addEventListener('click', (event) => {
    const row = event.target.closest('[data-game]');
    if (!row) return;
    const mod = gameById(row.dataset.game);
    if (!mod) return;

    if (event.target.closest('[data-role="more"]')) {
      openGameSheet(mod);
      return;
    }
    if (!event.target.closest('[data-role="open"]')) return;

    // A game you have never opened shows its rules first, from either section.
    if (isUntried(mod)) {
      openGameSheet(mod);
      return;
    }

    const list = row.closest('[data-list]')?.dataset.list;
    if (list === 'today') openGame(mod, { mode: 'daily' });
    else startFresh(mod, 'free');
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

  $('seg-sound').addEventListener('click', (event) => {
    const btn = event.target.closest('.seg');
    if (!btn) return;
    appSettings.sound = btn.dataset.sound === 'on';
    saveAppSettings(appSettings);
    applyFeedbackSettings();
    paintSettings();
    // Confirmation you can hear, inside the enabling gesture.
    if (appSettings.sound) sfx.word();
  });

  $('seg-haptics').addEventListener('click', (event) => {
    const btn = event.target.closest('.seg');
    if (!btn) return;
    appSettings.haptics = btn.dataset.haptics === 'on';
    saveAppSettings(appSettings);
    applyFeedbackSettings();
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
      else if (event.target.closest('[data-close]')) dialog.close();
    });
    dialog.addEventListener('close', () => {
      syncTimer();
      syncCountdown();
    });
  }

  // Physical keyboard, mostly for desktop play and testing.
  document.addEventListener('keydown', (event) => {
    if (view !== 'game' || !active || anyDialogOpen()) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const { mod, game } = active;

    if (/^[a-zA-Z]$/.test(event.key)) {
      event.preventDefault();
      sfx.tap();
      afterMove(mod.onKey(game, event.key.toUpperCase()));
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      sfx.tap();
      afterMove(mod.onKey(game, 'DEL'));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      sfx.tap();
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
    else if (view === 'home') paintHome(); // may have been backgrounded past midnight
    syncTimer();
    syncCountdown();
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
  applyFeedbackSettings();
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
