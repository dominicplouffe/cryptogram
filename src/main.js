// Wiring: input handling, timer, game flow.

import { isSolved, localDateKey } from './cipher.js';
import { validateQuotes } from './quotes.js';
import {
  DIFFICULTIES,
  clearProgress,
  createGame,
  effectiveStreak,
  formatTime,
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
  btnMenu: $('btn-menu'),
  btnStats: $('btn-stats'),

  dlgWin: $('dlg-win'),
  dlgStats: $('dlg-stats'),
  dlgMenu: $('dlg-menu'),
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
  if (document.visibilityState === 'hidden' || anyDialogOpen() || game?.solved) {
    pauseTimer();
  } else {
    startTimer();
  }
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

function loadGame({ fresh = false } = {}) {
  const dateKey = localDateKey();

  if (fresh) {
    game = createGame({ mode: settings.mode, difficulty: settings.difficulty, dateKey });
    stats = recordStart(stats);
  } else {
    const { game: loaded, restored } = resumeOrCreate({
      mode: settings.mode,
      difficulty: settings.difficulty,
      dateKey,
    });
    game = loaded;
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

function startNewPuzzle() {
  // Daily is one puzzle per day by definition, so "New" moves into free play.
  if (settings.mode === 'daily') {
    settings.mode = 'free';
    saveSettings(settings);
    syncMenuButtons();
  } else {
    clearProgress('free', localDateKey());
  }
  loadGame({ fresh: true });
}

// --- painting ---------------------------------------------------------------

function refresh() {
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

// --- menu -------------------------------------------------------------------

function syncMenuButtons() {
  for (const btn of document.querySelectorAll('#seg-mode .seg')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === settings.mode));
  }
  for (const btn of document.querySelectorAll('#seg-difficulty .seg')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.difficulty === settings.difficulty));
  }
  for (const btn of document.querySelectorAll('#seg-theme .seg')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.theme === settings.theme));
  }
  $('difficulty-note').textContent = DIFFICULTY_NOTES[settings.difficulty] ?? '';
}

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

  dom.btnMenu.addEventListener('click', () => {
    syncMenuButtons();
    openDialog(dom.dlgMenu);
  });
  dom.btnStats.addEventListener('click', () => {
    paintStats();
    openDialog(dom.dlgStats);
  });

  $('btn-menu-close').addEventListener('click', () => closeDialog(dom.dlgMenu));
  $('btn-stats-close').addEventListener('click', () => closeDialog(dom.dlgStats));
  $('btn-win-close').addEventListener('click', () => closeDialog(dom.dlgWin));
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

  $('seg-mode').addEventListener('click', (event) => {
    const btn = event.target.closest('.seg');
    if (!btn || btn.dataset.mode === settings.mode) return;
    settings.mode = btn.dataset.mode;
    saveSettings(settings);
    syncMenuButtons();
    loadGame();
  });

  $('seg-difficulty').addEventListener('click', (event) => {
    const btn = event.target.closest('.seg');
    if (!btn || btn.dataset.difficulty === settings.difficulty) return;
    settings.difficulty = btn.dataset.difficulty;
    saveSettings(settings);
    syncMenuButtons();
    loadGame();
  });

  $('seg-theme').addEventListener('click', (event) => {
    const btn = event.target.closest('.seg');
    if (!btn) return;
    settings.theme = btn.dataset.theme;
    saveSettings(settings);
    applyTheme();
    syncMenuButtons();
  });

  [dom.dlgWin, dom.dlgStats, dom.dlgMenu].forEach(wireDialog);

  // Physical keyboard, mostly for desktop play and testing.
  document.addEventListener('keydown', (event) => {
    if (anyDialogOpen() || event.metaKey || event.ctrlKey || event.altKey) return;

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
}

// --- boot -------------------------------------------------------------------

function boot() {
  applyTheme();
  pruneOldProgress();

  keys = buildKeyboard(dom.keyboard);
  wireEvents();
  loadGame();
  syncMenuButtons();

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
