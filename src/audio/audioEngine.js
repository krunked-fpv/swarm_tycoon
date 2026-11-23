/**
 * Cleanroom Procedural Web Audio DSP Engine
 * - Zero external media assets, zero DOM UI coupling, headless Node ESM safe
 * - Unlocks cleanly on first user gesture with iOS Safari silent-frame wake-up
 * - Smooth gain ramping on volume/mute changes and document visibilitychange events
 * - Reactive telemetry modulation for laminar airflow hum and throttled alert klaxons
 */

import { CleanroomAmbience } from './cleanroomAmbience.js';
import {
  playUiClick,
  playPlace,
  playWaferComplete,
  playEuvFlash,
  playShuttleLaunch,
  playPrestigeSwell,
} from './machineFoley.js';
import { playKlaxon } from './klaxonSynth.js';

const AUTO_KLAXON_THROTTLE_MS = {
  scram: 4000,
  crisis: 5500,
  brownout: 4500,
};

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function extractCrisisKey(activeCrisis) {
  if (!activeCrisis) return null;
  if (typeof activeCrisis === 'object') {
    return activeCrisis.id || activeCrisis.type || 'active';
  }
  return String(activeCrisis);
}

function setParamSmooth(param, target, ctx, tau = 0.025) {
  if (!param || !ctx || ctx.state === 'closed') return;
  const now = Math.max(0, Number(ctx.currentTime) || 0);
  if (typeof param.setTargetAtTime === 'function') {
    param.setTargetAtTime(target, now, tau);
  } else {
    param.value = target;
  }
}

export class AudioEngine {
  /**
   * @param {{ vol?: number, mute?: boolean }} [initialPrefs]
   */
  constructor(initialPrefs = { vol: 0.6, mute: false }) {
    const prefs = initialPrefs && typeof initialPrefs === 'object' ? initialPrefs : {};
    const parsedVol = Number(prefs.vol);

    this._vol = Number.isFinite(parsedVol) ? clamp(parsedVol, 0, 1) : 0.6;
    this._mute = Boolean(prefs.mute);
    this._destroyed = false;

    this._ctx = null;
    this._submix = null;
    this._compressor = null;
    this._masterGain = null;
    this._visibilityGain = null;
    this._ambience = null;

    this._visibilityBound = false;
    this._visibilityHandler = null;
    this._isHidden = typeof document !== 'undefined' ? Boolean(document.hidden) : false;

    this._telemetry = {
      totalMw: 0,
      brownoutLevel: 0,
      activeCrisis: null,
      crisisKey: null,
      scramCount: 0,
    };

    this._lastAutoKlaxonMs = {
      brownout: -Infinity,
      scram: -Infinity,
      crisis: -Infinity,
    };
  }

  /**
   * Creates or resumes the Web Audio context cleanly on the first user gesture.
   * Safe no-op returning false when Web Audio is unavailable (e.g., Node).
   * @returns {boolean}
   */
  unlock() {
    if (this._destroyed) return false;

    const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (typeof AudioCtx !== 'function') {
      return false;
    }

    this._bindVisibilityListener();

    if (!this._ctx || this._ctx.state === 'closed') {
      try {
        this._ctx = new AudioCtx({ latencyHint: 'interactive' });
      } catch {
        this._ctx = new AudioCtx();
      }
      this._buildAudioGraph(this._ctx);
    }

    const ctx = this._ctx;
    if (!ctx) return false;

    // Silent 1-sample buffer wake-up for strict mobile WebKit gesture unlock
    if (ctx.state === 'suspended' && typeof ctx.createBuffer === 'function' && typeof ctx.createBufferSource === 'function') {
      try {
        const silentBuf = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
        const src = ctx.createBufferSource();
        src.buffer = silentBuf;
        src.connect(this._visibilityGain || ctx.destination);
        src.start(0);
        src.onended = () => {
          try {
            src.disconnect();
          } catch {
            // Ignore
          }
        };
      } catch {
        // Ignore silent unlock fallback errors
      }
    }

    if (typeof ctx.resume === 'function' && ctx.state !== 'running') {
      try {
        const maybePromise = ctx.resume();
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise
            .then(() => {
              if (!this._destroyed && this._ctx === ctx) {
                this._syncMasterGain(0.03);
                this._syncVisibilityGain(0.04);
              }
            })
            .catch(() => {});
        }
      } catch {
        // Ignore resume errors outside gesture
      }
    }

    return ctx.state === 'running';
  }

  _buildAudioGraph(ctx) {
    const now = Math.max(0, Number(ctx.currentTime) || 0);

    const submix = ctx.createGain();
    submix.gain.setValueAtTime(1.0, now);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(this._mute ? 0 : this._vol, now);

    const visibilityGain = ctx.createGain();
    visibilityGain.gain.setValueAtTime(this._isHidden ? 0 : 1, now);

    let compressor = null;
    if (typeof ctx.createDynamicsCompressor === 'function') {
      compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-14, now);
      compressor.knee.setValueAtTime(18, now);
      compressor.ratio.setValueAtTime(6, now);
      compressor.attack.setValueAtTime(0.004, now);
      compressor.release.setValueAtTime(0.14, now);
      submix.connect(compressor);
      compressor.connect(masterGain);
    } else {
      submix.connect(masterGain);
    }

    masterGain.connect(visibilityGain);
    visibilityGain.connect(ctx.destination);

    this._submix = submix;
    this._compressor = compressor;
    this._masterGain = masterGain;
    this._visibilityGain = visibilityGain;

    this._ambience = new CleanroomAmbience(ctx, submix);
    this._ambience.update({
      totalMw: this._telemetry.totalMw,
      brownoutLevel: this._telemetry.brownoutLevel,
    });
    this._ambience.start();
  }

  _bindVisibilityListener() {
    if (
      this._visibilityBound ||
      typeof document === 'undefined' ||
      typeof document.addEventListener !== 'function'
    ) {
      return;
    }

    this._visibilityHandler = () => {
      const hidden = Boolean(document.hidden);
      this._isHidden = hidden;

      if (!hidden && this._ctx && this._ctx.state === 'suspended' && typeof this._ctx.resume === 'function') {
        try {
          const p = this._ctx.resume();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch {
          // Ignore
        }
      }

      this._syncVisibilityGain(0.06);
    };

    document.addEventListener('visibilitychange', this._visibilityHandler);
    this._visibilityBound = true;
  }

  _syncMasterGain(tau = 0.025) {
    if (!this._masterGain || !this._ctx) return;
    setParamSmooth(this._masterGain.gain, this._mute ? 0 : this._vol, this._ctx, tau);
  }

  _syncVisibilityGain(tau = 0.06) {
    if (!this._visibilityGain || !this._ctx) return;
    setParamSmooth(this._visibilityGain.gain, this._isHidden ? 0 : 1, this._ctx, tau);
  }

  _canPlay() {
    return Boolean(!this._destroyed && this._ctx && this._ctx.state !== 'closed' && !this._mute && !this._isHidden);
  }

  /**
   * Smoothly ramps master output volume within [0, 1].
   * @param {number} v
   */
  setMasterVolume(v) {
    const parsed = Number(v);
    if (!Number.isFinite(parsed)) return;
    this._vol = clamp(parsed, 0, 1);
    this._syncMasterGain(0.025);
  }

  /**
   * Smoothly mutes or unmutes master output.
   * @param {boolean} muted
   */
  setMuted(muted) {
    this._mute = Boolean(muted);
    this._syncMasterGain(0.02);
  }

  /**
   * Returns current audio engine state snapshot.
   * @returns {{ unlocked: boolean, vol: number, mute: boolean, volume: number, muted: boolean, contextState: string }}
   */
  getState() {
    const ctx = this._ctx;
    return {
      unlocked: Boolean(!this._destroyed && ctx && ctx.state === 'running'),
      vol: this._vol,
      mute: this._mute,
      volume: this._vol,
      muted: this._mute,
      contextState: ctx ? String(ctx.state) : 'unavailable',
    };
  }

  /**
   * Modulates ambience DSP with fab power and auto-triggers throttled klaxons on hazard spikes.
   * @param {{ totalMw?: number, brownoutLevel?: number, activeCrisis?: object | string | null, scramCount?: number }} [telemetry]
   */
  updateTelemetry(telemetry = {}) {
    if (this._destroyed || !telemetry || typeof telemetry !== 'object') return;

    const prev = this._telemetry;
    const nextMw =
      telemetry.totalMw !== undefined && Number.isFinite(Number(telemetry.totalMw))
        ? Math.max(0, Number(telemetry.totalMw))
        : prev.totalMw;
    const nextBrownout =
      telemetry.brownoutLevel !== undefined && Number.isFinite(Number(telemetry.brownoutLevel))
        ? clamp(Number(telemetry.brownoutLevel), 0, 3)
        : prev.brownoutLevel;
    const nextScram =
      telemetry.scramCount !== undefined && Number.isFinite(Number(telemetry.scramCount))
        ? Math.max(0, Number(telemetry.scramCount))
        : prev.scramCount;
    const nextCrisis = telemetry.activeCrisis !== undefined ? telemetry.activeCrisis : prev.activeCrisis;
    const nextCrisisKey = extractCrisisKey(nextCrisis);

    const scramSpiked = nextScram > prev.scramCount;
    const crisisSpiked = Boolean(nextCrisisKey && nextCrisisKey !== prev.crisisKey);
    const brownoutSpiked = nextBrownout > prev.brownoutLevel && nextBrownout > 0;

    this._telemetry = {
      totalMw: nextMw,
      brownoutLevel: nextBrownout,
      activeCrisis: nextCrisis,
      crisisKey: nextCrisisKey,
      scramCount: nextScram,
    };

    if (this._ambience) {
      this._ambience.update({ totalMw: nextMw, brownoutLevel: nextBrownout });
    }

    const tMs = nowMs();
    if (scramSpiked && tMs - this._lastAutoKlaxonMs.scram >= AUTO_KLAXON_THROTTLE_MS.scram) {
      this._lastAutoKlaxonMs.scram = tMs;
      this.playKlaxon('scram');
    } else if (crisisSpiked && tMs - this._lastAutoKlaxonMs.crisis >= AUTO_KLAXON_THROTTLE_MS.crisis) {
      this._lastAutoKlaxonMs.crisis = tMs;
      this.playKlaxon('crisis');
    } else if (brownoutSpiked && tMs - this._lastAutoKlaxonMs.brownout >= AUTO_KLAXON_THROTTLE_MS.brownout) {
      this._lastAutoKlaxonMs.brownout = tMs;
      this.playKlaxon('brownout');
    }
  }

  /** @returns {boolean} */
  playClick() {
    return this._canPlay() ? playUiClick(this._ctx, this._submix) : false;
  }

  /** @returns {boolean} */
  playPlace() {
    return this._canPlay() ? playPlace(this._ctx, this._submix) : false;
  }

  /** @returns {boolean} */
  playWaferComplete() {
    return this._canPlay() ? playWaferComplete(this._ctx, this._submix) : false;
  }

  /** @returns {boolean} */
  playEuvFlash() {
    return this._canPlay() ? playEuvFlash(this._ctx, this._submix) : false;
  }

  /** @returns {boolean} */
  playShuttleLaunch() {
    return this._canPlay() ? playShuttleLaunch(this._ctx, this._submix) : false;
  }

  /** @returns {boolean} */
  playPrestigeSwell() {
    return this._canPlay() ? playPrestigeSwell(this._ctx, this._submix) : false;
  }

  /**
   * @param {'brownout' | 'scram' | 'crisis'} [kind='brownout']
   * @returns {boolean}
   */
  playKlaxon(kind = 'brownout') {
    return this._canPlay() ? playKlaxon(this._ctx, this._submix, kind) : false;
  }

  /**
   * Stops ambience, unbinds DOM visibility listeners, and releases Web Audio resources.
   */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;

    if (
      this._visibilityBound &&
      this._visibilityHandler &&
      typeof document !== 'undefined' &&
      typeof document.removeEventListener === 'function'
    ) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
    }
    this._visibilityBound = false;
    this._visibilityHandler = null;

    if (this._ambience) {
      this._ambience.stop();
      this._ambience = null;
    }

    for (const node of [this._submix, this._compressor, this._masterGain, this._visibilityGain]) {
      if (!node) continue;
      try {
        node.disconnect();
      } catch {
        // Ignore disconnected node
      }
    }

    const ctx = this._ctx;
    this._submix = null;
    this._compressor = null;
    this._masterGain = null;
    this._visibilityGain = null;
    this._ctx = null;

    if (ctx && ctx.state !== 'closed' && typeof ctx.close === 'function') {
      try {
        const p = ctx.close();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {
        // Ignore close errors
      }
    }
  }
}
