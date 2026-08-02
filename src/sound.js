// Sound and touch feedback. Six synthesised tones from one AudioContext and an
// oscillator per event -- no asset files, nothing added to the download.
//
// Sound is OFF by default and lives behind a toggle in Settings: a puzzle app
// that makes noise uninvited gets muted at the OS level and never turned back
// on. Haptics default on -- they only fire on hardware that supports the
// vibration API (in practice Android), they are silent, and they are light.
//
// The context is created lazily on the first play() call, which only ever
// happens inside a user-gesture handler -- creating it at load time would leave
// it permanently 'suspended' under autoplay policy.

import { nativeHaptic } from './native.js';

let ctx = null;
let soundOn = false;
let hapticsOn = true;

export function setSoundEnabled(on) {
  soundOn = Boolean(on);
  // A context created mid-gesture can start suspended; nudge it when enabling.
  if (soundOn && ctx?.state === 'suspended') ctx.resume().catch(() => {});
}

export function setHapticsEnabled(on) {
  hapticsOn = Boolean(on);
}

function context() {
  if (!ctx) {
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** WKWebView suspends the context when the app backgrounds and does not always
    bring it back; the shell calls this on every resume. */
export function resumeAudio() {
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
}

/**
 * One enveloped oscillator.
 * @param {object} spec
 * @param {number} spec.freq start frequency, Hz
 * @param {number} [spec.to] end frequency for a sweep
 * @param {OscillatorType} [spec.type]
 * @param {number} [spec.dur] seconds
 * @param {number} [spec.gain] peak, 0..1
 * @param {number} [spec.at] start offset, seconds from now
 */
function tone({ freq, to, type = 'sine', dur = 0.08, gain = 0.08, at = 0 }) {
  const audio = context();
  if (!audio) return;

  const start = audio.currentTime + at;
  const osc = audio.createOscillator();
  const amp = audio.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, start + dur);

  // A short attack keeps the click out; an exponential release keeps the thud out.
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);

  osc.connect(amp).connect(audio.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function buzz(pattern) {
  if (!hapticsOn) return;
  // The native engine first -- it is the only path that works on iOS, where
  // navigator.vibrate does not exist.
  if (nativeHaptic(pattern)) return;
  navigator.vibrate?.(pattern);
}

/**
 * Each game solves in its own key, so eight games are audibly distinct. Root
 * frequencies for the solve arpeggio, by game id; anything unlisted gets C5.
 */
const SOLVE_ROOTS = {
  cryptogram: 523.25, // C5
  fiver: 587.33, // D5
  vowels: 659.25, // E5
  hidden: 493.88, // B4
  ladder: 440.0, // A4
  wheel: 698.46, // F5
  boxed: 554.37, // C#5
  search: 587.33, // D5
};

export const sfx = {
  /** A key press. Barely there: four hundred a session. */
  tap() {
    buzz(8);
    if (!soundOn) return;
    tone({ freq: 520, type: 'sine', dur: 0.03, gain: 0.04 });
  },

  /** Something went in: a letter placed, a word accepted. Rising. */
  place() {
    if (!soundOn) return;
    tone({ freq: 660, to: 880, type: 'triangle', dur: 0.09, gain: 0.06 });
  },

  /** The small win inside the big one: a word found, a row completed. */
  word() {
    buzz(12);
    if (!soundOn) return;
    tone({ freq: 660, type: 'triangle', dur: 0.12, gain: 0.06 });
    tone({ freq: 990, type: 'triangle', dur: 0.12, gain: 0.05, at: 0.02 });
  },

  /** Wrong. Dull and low: discouraging without being punishing. */
  wrong() {
    buzz([10, 40, 10]);
    if (!soundOn) return;
    tone({ freq: 180, type: 'square', dur: 0.07, gain: 0.05 });
  },

  /** Solved: a four-note arpeggio in the game's own key. */
  solve(gameId) {
    buzz([14, 60, 14, 60, 30]);
    if (!soundOn) return;
    const root = SOLVE_ROOTS[gameId] ?? 523.25;
    [1, 1.25, 1.5, 2].forEach((ratio, i) => {
      tone({ freq: root * ratio, type: 'triangle', dur: 0.16, gain: 0.07, at: i * 0.09 });
    });
  },

  /** Lost: two falling notes. Sympathy, not a punishment sting. */
  lose() {
    buzz([10, 40, 10]);
    if (!soundOn) return;
    tone({ freq: 392, to: 330, type: 'triangle', dur: 0.18, gain: 0.06 });
    tone({ freq: 294, to: 247, type: 'triangle', dur: 0.22, gain: 0.06, at: 0.14 });
  },

  /** The streak ticking up: a rising sweep under the count-up. */
  streak() {
    if (!soundOn) return;
    tone({ freq: 400, to: 1200, type: 'sine', dur: 0.3, gain: 0.05 });
  },
};
