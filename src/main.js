// Wiring: input handling, timer, game flow.

import { isSolved, localDateKey } from './cipher.js';
import { validateQuotes } from './quotes.js';
import {
  DIFFICULTIES,
  clearProgress,
  createGame,
  effectiveStreak,
  formatTime,
  hydrateGame,
  loadProgress,
  loadSettings,
  loadStats,
  pruneOldProgress,
  recordSolve,
  recordStart,
  resetStats,
  resumeOrCreate,
  saveProgress,
  saveSettings,
  storageAvailable,
} from './state.js';
import {
  buildKeyboard,
  buildPuzzle,
  burstConfetti,
  updateKeyboard,
  updatePuzzle,
} from './render.js';

const $ = (id) => document.getElementById(id);

const dom = {
  viewHome: $('view-home'),
  viewGame: $('view-game'),
  homeDate: $('home-date'),

  puzzle: $('puzzle'),
  author: $('author'),
  stage: document.querySelector('.stage'),
  keyboard: $('keyboard'),
  timer: $('timer'),
  modeLabel: $('mode-label'),
  difficultyLabel: $('difficulty-label'),
  toast: $('toast'),

  btnHint: $('btn-hint'),
  btnCheck: $('btn-check'),
  btnClear: $('btn-clear'),
  btnNew: $('btn-new'),
  btnHome: $('btn-home'),
  btnStats: $('btn-stats'),

  dlgWin: $('dlg-win'),
  dlgStats: $('dlg-stats'),
};

const DIFFICULTY_NOTES = {
  easy: 'Shorter quotes, with about a third of the letters filled in for you.',
  medium: 'Medium-length quotes with a couple of letters to start you off.',
  hard: 'The longest quotes, and nothing given away. Just you and the cipher.',
};

let settings = loadSettings();
let stats = loadStats();
let game = null;
let cells = [];
let keys = null;

let view = 'home';
let selectedIndex = null;
let letterIndices = [];
let wrongLetters = new Set();
let wrongTimer = null;
let toastTimer = null;

// Timer: elapsedMs is the committed total; runningSince marks an open interval.
let runningSince = null;
let tickHandle = null;

// --- timer ------------------------------------------------------------------

function currentElapsed() {
  if (!game) return 0;
  return game.elapsedMs + (runningSince === null ? 0 : Date.now() - runningSince);
}

function startTimer() {
  if (!game || game.solved || runningSince !== null) return;
  runningSince = Date.now();
  tickHandle = setInterval(paintTimer, 250);
}

function pauseTimer() {
  if (runningSince === null) return;
  game.elapsedMs += Date.now() - runningSince;
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

function syncTimerToVisibility() {
  const shouldPause =
    document.visibilityState === 'hidden' ||
    anyDialogOpen() ||
    view !== 'game' ||
    !game ||
    game.solved;
  if (shouldPause) pauseTimer();
  else startTimer();
}

// --- persistence ------------------------------------------------------------

function persist() {
  if (!game) return;
  const wasRunning = runningSince !== null;
  if (wasRunning) {
    // Commit the open interval so the saved elapsed time is accurate.
    game.elapsedMs += Date.now() - runningSince;
    runningSince = Date.now();
  }
  saveProgress(game);
}

// --- selection --------------------------------------------------------------

function isPlayable(index) {
  const ch = game.cipher[index];
  return ch >= 'A' && ch <= 'Z';
}

/** Index of the next cell whose coded letter still needs an answer. */
function nextOpenIndex(afterIndex) {
  const start = letterIndices.indexOf(afterIndex);
  for (let step = 1; step <= letterIndices.length; step++) {
    const index = letterIndices[(start + step) % letterIndices.length];
    const code = game.cipher[index];
    if (!game.locked.has(code) && !game.guesses[code]) return index;
  }
  return null;
}

function selectIndex(index) {
  if (index === null || !isPlayable(index)) return;
  selectedIndex = index;
  refresh();
}

function moveSelection(direction) {
  if (selectedIndex === null) return;
  const at = letterIndices.indexOf(selectedIndex);
  const next = (at + direction + letterIndices.length) % letterIndices.length;
  selectIndex(letterIndices[next]);
}

// --- moves ------------------------------------------------------------------

function assignLetter(letter) {
  if (!game || game.solved || selectedIndex === null) return;
  const code = game.cipher[selectedIndex];

  if (game.locked.has(code)) {
    toast('That letter is already revealed');
    selectIndex(nextOpenIndex(selectedIndex) ?? selectedIndex);
    return;
  }

  game.guesses[code] = letter;
  wrongLetters.delete(code);

  const advanceTo = nextOpenIndex(selectedIndex);
  if (advanceTo !== null) selectedIndex = advanceTo;

  refresh();
  persist();
  checkForWin();
}

function deleteLetter() {
  if (!game || game.solved || selectedIndex === null) return;
  const code = game.cipher[selectedIndex];

  if (game.locked.has(code)) {
    toast('Revealed letters cannot be cleared');
    return;
  }
  if (!game.guesses[code]) {
    // Nothing here: step back so repeated taps walk backwards, like a real
    // keyboard's backspace.
    moveSelection(-1);
    return;
  }

  delete game.guesses[code];
  wrongLetters.delete(code);
  refresh();
  persist();
}

function useHint() {
  if (!game || game.solved) return;

  const openLetters = game.letters.filter((code) => !game.locked.has(code));
  if (openLetters.length === 0) {
    toast('Nothing left to reveal');
    return;
  }

  // Prefer the selected cell, so a hint answers the question you were asking.
  const selectedCode = selectedIndex === null ? null : game.cipher[selectedIndex];
  const code =
    selectedCode && !game.locked.has(selectedCode)
      ? selectedCode
      : openLetters[Math.floor(Math.random() * openLetters.length)];

  game.guesses[code] = game.solution[code];
  game.locked.add(code);
  game.hintsUsed += 1;
  wrongLetters.delete(code);

  const advanceTo = nextOpenIndex(selectedIndex ?? letterIndices[0]);
  if (advanceTo !== null) selectedIndex = advanceTo;

  refresh();
  persist();
  toast(`Revealed ${code} = ${game.solution[code]}`);
  checkForWin();
}

function checkMistakes() {
  if (!game || game.solved) return;

  const wrong = game.letters.filter(
    (code) => game.guesses[code] && game.guesses[code] !== game.solution[code]
  );

  game.checksUsed += 1;
  persist();

  if (wrong.length === 0) {
    const filled = game.letters.filter((code) => game.guesses[code]).length;
    toast(filled === 0 ? 'Nothing to check yet' : 'All correct so far');
    return;
  }

  wrongLetters = new Set(wrong);
  refresh();
  toast(wrong.length === 1 ? '1 letter is wrong' : `${wrong.length} letters are wrong`);

  clearTimeout(wrongTimer);
  wrongTimer = setTimeout(() => {
    wrongLetters = new Set();
    refresh();
  }, 2200);
}

function resetBoard() {
  if (!game || game.solved) return;

  const filled = game.letters.filter(
    (code) => game.guesses[code] && !game.locked.has(code)
  );
  if (filled.length === 0) {
    toast('Board is already empty');
    return;
  }
  if (!window.confirm(`Clear ${filled.length} letter${filled.length === 1 ? '' : 's'}?`)) {
    return;
  }

  for (const code of filled) delete game.guesses[code];
  wrongLetters = new Set();
  selectedIndex = nextOpenIndex(letterIndices[letterIndices.length - 1]) ?? letterIndices[0];
  refresh();
  persist();
}

// --- win --------------------------------------------------------------------

function checkForWin() {
  if (!game || game.solved) return;
  if (!isSolved(game.cipher, game.guesses, game.solution)) return;

  pauseTimer();
  game.solved = true;
  selectedIndex = null;
  wrongLetters = new Set();

  stats = recordSolve(stats, {
    mode: game.mode,
    difficulty: game.difficulty,
    elapsedMs: game.elapsedMs,
    hintsUsed: game.hintsUsed,
    dateKey: game.dateKey,
  });

  refresh();
  persist();
  showWin();
}

function showWin() {
  $('win-quote').textContent = game.original ?? game.plain;
  $('win-author').textContent = game.author ? `— ${game.author}` : '';
  $('win-time').textContent = formatTime(game.elapsedMs);
  $('win-hints').textContent = String(game.hintsUsed);
  $('win-streak').textContent = String(effectiveStreak(stats));

  const best = stats.bestTimes[game.difficulty];
  let note = '';
  if (game.hintsUsed > 0) {
    note = 'Best times only count hint-free solves.';
  } else if (best === game.elapsedMs) {
    note = `New best time for ${DIFFICULTIES[game.difficulty].label}!`;
  }
  $('win-note').textContent = note;

  openDialog(dom.dlgWin);
  burstConfetti($('confetti'));
}

// --- game lifecycle ---------------------------------------------------------

function loadGame({ fresh = false, mode = settings.mode } = {}) {
  const dateKey = localDateKey();

  if (settings.mode !== mode) {
    settings.mode = mode;
    saveSettings(settings);
  }

  if (fresh) {
    game = createGame({ mode, difficulty: settings.difficulty, dateKey });
    stats = recordStart(stats);
  } else {
    const { game: loaded, restored } = resumeOrCreate({
      mode,
      difficulty: settings.difficulty,
      dateKey,
    });
    game = loaded;
    // Only a genuinely new board counts as a play, so returning to an
    // in-progress puzzle never inflates the count.
    if (!restored) stats = recordStart(stats);
  }

  letterIndices = [];
  for (let i = 0; i < game.cipher.length; i++) {
    if (isPlayable(i)) letterIndices.push(i);
  }

  wrongLetters = new Set();
  clearTimeout(wrongTimer);
  runningSince = null;
  clearInterval(tickHandle);
  tickHandle = null;

  selectedIndex = game.solved ? null : nextOpenIndex(letterIndices[letterIndices.length - 1]);

  cells = buildPuzzle(dom.puzzle, game);
  // A history entry per game entry makes the phone's back gesture return to
  // home rather than leaving the app entirely.
  if (view !== 'game') history.pushState({ view: 'game' }, '');
  showView('game');
  dom.stage.scrollTop = 0;

  refresh();
  persist();
  syncTimerToVisibility();

  if (game.solved) {
    toast(
      game.mode === 'daily'
        ? "Today's puzzle is already solved"
        : 'This puzzle is already solved'
    );
  }
}

/** Start a fresh free-play puzzle, discarding any unfinished free-play board. */
function startFreePuzzle() {
  clearProgress('free', localDateKey());
  loadGame({ fresh: true, mode: 'free' });
}

/** The in-game "New" button. Daily is one puzzle a day, so it moves to free play. */
function startNewPuzzle() {
  startFreePuzzle();
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
  syncTimerToVisibility();
}

function goHome() {
  // Unwind the history entry pushed on entering the game so the back gesture
  // and this button stay in step; popstate performs the actual switch.
  if (history.state?.view === 'game') {
    history.back();
    return;
  }
  // Committing progress before leaving means a hard close from the home screen
  // still comes back to the right board.
  persist();
  showView('home');
}

/**
 * State of today's daily puzzle, read straight from storage so the home screen
 * never has to build a game (which would inflate the "played" count).
 * @returns {{state: 'new'|'progress'|'solved', filled?: number, total?: number, elapsedMs?: number}}
 */
function dailyStatus() {
  const saved = loadProgress('daily', localDateKey());
  // The daily is seeded per difficulty, so a save from another difficulty is
  // not today's puzzle as currently configured.
  if (!saved || saved.difficulty !== settings.difficulty) return { state: 'new' };
  if (saved.solved) return { state: 'solved', elapsedMs: saved.elapsedMs };

  const restored = hydrateGame(saved);
  const filled = restored.letters.filter((code) => restored.guesses[code]).length;
  if (filled === restored.locked.size) return { state: 'new' };
  return { state: 'progress', filled, total: restored.letters.length };
}

function paintHome() {
  const label = DIFFICULTIES[settings.difficulty].label;

  dom.homeDate.textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  $('home-streak').textContent = String(effectiveStreak(stats));
  $('home-solved').textContent = String(stats.solved);
  $('home-best-label').textContent = `Best · ${label}`;
  const best = stats.bestTimes[settings.difficulty];
  $('home-best').textContent = best === null ? '—' : formatTime(best);

  const status = dailyStatus();
  const statusEl = $('daily-status');
  statusEl.classList.remove('is-progress', 'is-solved');

  if (status.state === 'solved') {
    statusEl.textContent = `Solved in ${formatTime(status.elapsedMs)}`;
    statusEl.classList.add('is-solved');
    $('btn-play-daily').textContent = 'View';
  } else if (status.state === 'progress') {
    statusEl.textContent = `In progress · ${status.filled} of ${status.total} letters`;
    statusEl.classList.add('is-progress');
    $('btn-play-daily').textContent = 'Continue';
  } else {
    statusEl.textContent = `Not started · ${label}`;
    $('btn-play-daily').textContent = 'Play';
  }

  for (const btn of document.querySelectorAll('#home-difficulty .seg')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.difficulty === settings.difficulty));
  }
  for (const btn of document.querySelectorAll('#seg-theme .seg')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.theme === settings.theme));
  }
  $('difficulty-note').textContent = DIFFICULTY_NOTES[settings.difficulty] ?? '';
}

// --- painting ---------------------------------------------------------------

function refresh() {
  if (!game) return;

  updatePuzzle(cells, game, { selectedIndex, wrongLetters });
  updateKeyboard(keys, game);

  dom.modeLabel.textContent = game.mode === 'daily' ? 'Daily' : 'Free play';
  dom.difficultyLabel.textContent = DIFFICULTIES[game.difficulty].label;
  dom.author.textContent = game.solved && game.author ? `— ${game.author}` : '';
  paintTimer();

  const done = game.solved;
  dom.btnHint.disabled = done;
  dom.btnCheck.disabled = done;
  dom.btnClear.disabled = done;
}

function toast(message) {
  dom.toast.textContent = message;
  dom.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.toast.hidden = true;
  }, 1800);
}

// --- dialogs ----------------------------------------------------------------

function openDialog(dialog) {
  pauseTimer();
  dialog.showModal();
}

function closeDialog(dialog) {
  dialog.close();
}

function wireDialog(dialog) {
  // Tapping the backdrop closes. The dialog element itself fills the sheet, so
  // a click landing directly on it means the backdrop was hit.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', syncTimerToVisibility);
}

// --- settings ---------------------------------------------------------------

function applyTheme() {
  if (settings.theme === 'auto') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', settings.theme);
  }
}

function paintStats() {
  const rate = stats.played === 0 ? 0 : Math.round((stats.solved / stats.played) * 100);
  $('stat-played').textContent = String(stats.played);
  $('stat-solved').textContent = String(stats.solved);
  $('stat-rate').textContent = `${rate}%`;
  $('stat-streak').textContent = String(effectiveStreak(stats));
  $('stat-maxstreak').textContent = String(stats.maxStreak);
  $('stat-hints').textContent = String(stats.totalHints);

  for (const level of ['easy', 'medium', 'hard']) {
    const best = stats.bestTimes[level];
    $(`stat-best-${level}`).textContent = best === null ? '—' : formatTime(best);
  }
}

// --- events -----------------------------------------------------------------

function wireEvents() {
  dom.puzzle.addEventListener('click', (event) => {
    const cell = event.target.closest('.cell');
    if (!cell || !cell.dataset.code || game.solved) return;
    selectIndex(Number(cell.dataset.index));
  });

  dom.keyboard.addEventListener('click', (event) => {
    const key = event.target.closest('.key');
    if (!key) return;
    if (key.dataset.key === 'DEL') deleteLetter();
    else assignLetter(key.dataset.key);
  });

  dom.btnHint.addEventListener('click', useHint);
  dom.btnCheck.addEventListener('click', checkMistakes);
  dom.btnClear.addEventListener('click', resetBoard);
  dom.btnNew.addEventListener('click', startNewPuzzle);

  dom.btnHome.addEventListener('click', goHome);

  const openStats = () => {
    paintStats();
    openDialog(dom.dlgStats);
  };
  dom.btnStats.addEventListener('click', openStats);
  $('btn-home-stats').addEventListener('click', openStats);

  $('btn-stats-close').addEventListener('click', () => closeDialog(dom.dlgStats));
  $('btn-win-home').addEventListener('click', () => {
    closeDialog(dom.dlgWin);
    goHome();
  });
  $('btn-win-next').addEventListener('click', () => {
    closeDialog(dom.dlgWin);
    startNewPuzzle();
  });

  $('btn-reset-stats').addEventListener('click', () => {
    if (!window.confirm('Reset all statistics? This cannot be undone.')) return;
    stats = resetStats();
    paintStats();
    refresh();
    toast('Statistics reset');
  });

  // --- home controls ---
  $('btn-play-daily').addEventListener('click', () => loadGame({ mode: 'daily' }));
  $('btn-play-free').addEventListener('click', startFreePuzzle);

  $('home-difficulty').addEventListener('click', (event) => {
    const btn = event.target.closest('.seg');
    if (!btn || btn.dataset.difficulty === settings.difficulty) return;
    settings.difficulty = btn.dataset.difficulty;
    saveSettings(settings);
    // Difficulty reseeds the daily, so the card's status has to be re-read.
    paintHome();
  });

  $('seg-theme').addEventListener('click', (event) => {
    const btn = event.target.closest('.seg');
    if (!btn) return;
    settings.theme = btn.dataset.theme;
    saveSettings(settings);
    applyTheme();
    paintHome();
  });

  [dom.dlgWin, dom.dlgStats].forEach(wireDialog);

  // Physical keyboard, mostly for desktop play and testing.
  document.addEventListener('keydown', (event) => {
    if (view !== 'game' || anyDialogOpen() || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    if (/^[a-zA-Z]$/.test(event.key)) {
      event.preventDefault();
      assignLetter(event.key.toUpperCase());
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      deleteLetter();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(-1);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist();
    syncTimerToVisibility();
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
  applyTheme();
  pruneOldProgress();

  keys = buildKeyboard(dom.keyboard);
  wireEvents();

  // Land on home. No game is built until a card is tapped, which also keeps the
  // "played" count honest -- opening the app is not playing a puzzle.
  showView('home');

  if (!storageAvailable()) {
    toast('Private mode: progress will not be saved');
  }

  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    const problems = validateQuotes();
    if (problems.length) console.warn('Quote pack issues:\n' + problems.join('\n'));
  }

  // isSecureContext covers https and localhost, which is where service workers
  // are permitted to register at all.
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {
        /* offline support is a bonus, not a requirement */
      });
    });
  }
}

boot();
