// The Capacitor seam. Everything the app wants from a native shell goes through
// here, and on the plain web every function is a cheap no-op, so this module
// costs the PWA nothing.
//
// There is deliberately no import of any @capacitor package: the native shell
// injects its runtime into the WebView before our code runs, and every plugin
// installed in the Android/iOS project self-registers on
// window.Capacitor.Plugins. Reading that global keeps the web codebase
// dependency-free and build-free.
//
// globalThis rather than window throughout, so the module also imports cleanly
// under Node for tests.

import { NS, setStorageMirror } from './store.js';

const cap = () => globalThis.Capacitor;

/** @returns {boolean} true when running inside the Capacitor shell */
export function isNative() {
  return Boolean(cap()?.isNativePlatform?.());
}

/** @returns {object|null} a plugin proxy, or null when absent (web, or not installed) */
function plugin(name) {
  return cap()?.Plugins?.[name] ?? null;
}

// --- durable storage mirror -------------------------------------------------
// WebViews can evict localStorage under storage pressure or a "clear cache",
// and the streak is the whole reason to come back, so the pwg.v1.* namespace is
// mirrored into one native Preferences key. localStorage stays primary and
// synchronous; the mirror is a debounced snapshot, flushed hard on app pause,
// and restored at boot only when localStorage comes up empty.

const MIRROR_KEY = 'pwg.mirror.v1';
const FLUSH_DELAY_MS = 1500;

let flushHandle = null;

function snapshot() {
  const data = {};
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(NS)) data[key] = localStorage.getItem(key);
    }
  } catch {
    return null;
  }
  return data;
}

function flushMirror() {
  clearTimeout(flushHandle);
  flushHandle = null;
  const prefs = plugin('Preferences');
  const data = snapshot();
  if (!prefs || !data) return;
  prefs.set({ key: MIRROR_KEY, value: JSON.stringify(data) }).catch(() => {
    /* a missed snapshot is repaired by the next one */
  });
}

function scheduleFlush() {
  if (flushHandle !== null) return;
  flushHandle = setTimeout(flushMirror, FLUSH_DELAY_MS);
}

/** Copy the mirror back into localStorage after an eviction wiped it. */
async function restoreFromMirror() {
  const prefs = plugin('Preferences');
  if (!prefs) return;
  try {
    if (Object.keys(localStorage).some((key) => key.startsWith(NS))) return;
    const { value } = await prefs.get({ key: MIRROR_KEY });
    if (!value) return;
    for (const [key, raw] of Object.entries(JSON.parse(value))) {
      if (key.startsWith(NS) && typeof raw === 'string') localStorage.setItem(key, raw);
    }
  } catch {
    /* an unreadable mirror must not stop the app from booting */
  }
}

// --- lifecycle --------------------------------------------------------------

/**
 * Wire the native shell. Resolves immediately on the web; on native it restores
 * the storage mirror BEFORE resolving, so callers can await it and then read
 * settings/stats knowing an evicted localStorage has been repaired.
 *
 * @param {object} hooks
 * @param {() => void} hooks.onPause app going to background: save now
 * @param {() => void} hooks.onResume app back on screen: repaint, resume audio
 * @param {() => 'exit'|void} hooks.onBack Android back gesture; return 'exit'
 *   to hand the event back to the OS (minimize, never kill)
 */
export async function initNative({ onPause, onResume, onBack }) {
  if (!isNative()) return;

  await restoreFromMirror();
  setStorageMirror({ onChange: scheduleFlush });

  const app = plugin('App');
  if (app) {
    app.addListener('pause', () => {
      onPause?.();
      // The debounce must not still be pending when the OS suspends us; bridge
      // calls queued during pause do land.
      flushMirror();
    });
    app.addListener('resume', () => onResume?.());
    // Registering any backButton listener disables Capacitor's default
    // exit-the-app behavior, which would otherwise kill a game mid-puzzle.
    app.addListener('backButton', () => {
      if (onBack?.() === 'exit') app.minimizeApp?.();
    });
  }
}

// --- plugin fronts ----------------------------------------------------------

/**
 * Native share sheet. Neither WKWebView nor Android WebView implements
 * navigator.share, so this is the only working share path in the shell.
 * @returns {Promise<boolean>} true when the native sheet handled it (a
 *   dismissed sheet counts as handled, matching the web behavior)
 */
export async function nativeShare(text) {
  const share = plugin('Share');
  if (!share) return false;
  try {
    await share.share({ text });
  } catch {
    /* dismissed the tray; not an error */
  }
  return true;
}

/** @returns {Promise<boolean>} true when the native clipboard took the text */
export async function nativeCopy(text) {
  const clipboard = plugin('Clipboard');
  if (!clipboard) return false;
  try {
    await clipboard.write({ string: text });
    return true;
  } catch {
    return false;
  }
}

/**
 * Haptics through the native engine, which unlike navigator.vibrate exists on
 * iOS. Patterns are the ones sound.js already speaks: a small number is a tap,
 * a bigger one a thump, an array a buzz-pause-buzz.
 * @param {number|number[]} pattern
 * @returns {boolean} true when native haptics fired (skip navigator.vibrate)
 */
export function nativeHaptic(pattern) {
  const haptics = plugin('Haptics');
  if (!haptics) return false;
  const swallow = () => {};
  if (Array.isArray(pattern)) {
    haptics.vibrate({ duration: pattern.reduce((sum, ms) => sum + ms, 0) }).catch(swallow);
  } else {
    haptics.impact({ style: pattern <= 10 ? 'LIGHT' : 'MEDIUM' }).catch(swallow);
  }
  return true;
}

/**
 * Keep the OS status bar in step with the app theme. On Android the bar is
 * solid and colored to match the page background -- overlay mode would need
 * WindowInsets wiring before env(safe-area-inset-*) reports anything.
 * @param {boolean} isDark whether the effective theme is dark
 */
export function setStatusBarTheme(isDark) {
  const statusBar = plugin('StatusBar');
  if (!statusBar) return;
  const swallow = () => {};
  // 'DARK' is the style FOR dark backgrounds, i.e. light text.
  statusBar.setStyle({ style: isDark ? 'DARK' : 'LIGHT' }).catch(swallow);
  if (cap()?.getPlatform?.() === 'android') {
    statusBar.setBackgroundColor({ color: isDark ? '#150f26' : '#f3f1fa' }).catch(swallow);
  }
}
