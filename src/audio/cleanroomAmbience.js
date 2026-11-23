/**
 * ISO-1 Cleanroom Laminar Airflow & Sub-Bass Turbine DSP Synthesizer
 * - Procedural stereo pink-noise loop with equal-power loop splice (zero external assets)
 * - Dual-band laminar HEPA/ULPA airflow filtering with slow HVAC breathing LFO
 * - Sub-bass ISO-1 chiller/turbine oscillator pitch-shifting smoothly with fab megawatts
 */

const BUFFER_DURATION_SEC = 3.5;
const WARMUP_SAMPLES = 1024;
const SPLICE_SAMPLES = 2048;

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function rampParam(param, value, now, tau = 0.35) {
  if (!param || !Number.isFinite(value)) return;
  if (typeof param.setTargetAtTime === 'function') {
    param.setTargetAtTime(value, now, tau);
  } else {
    param.value = value;
  }
}

/**
 * Normalizes fab megawatts across Tiers 1..6 (0.015 MW .. 1500+ MW) onto [0, 1].
 * @param {number} totalMw
 * @returns {number}
 */
export function normalizeMegawatts(totalMw) {
  const mw = Number.isFinite(totalMw) ? Math.max(0, totalMw) : 0;
  return clamp(Math.log10(1 + mw * 20) / Math.log10(1 + 2000 * 20), 0, 1);
}

/**
 * Generates a seamless stereo pink-noise AudioBuffer using Paul Kellet's filter
 * and an equal-power loop crossfade at the boundary.
 * @param {BaseAudioContext} ctx
 * @returns {AudioBuffer | null}
 */
export function createPinkNoiseLoopBuffer(ctx) {
  if (!ctx || typeof ctx.createBuffer !== 'function') return null;

  const sampleRate = Number.isFinite(ctx.sampleRate) && ctx.sampleRate > 0 ? ctx.sampleRate : 44100;
  const length = Math.max(SPLICE_SAMPLES * 2, Math.floor(sampleRate * BUFFER_DURATION_SEC));
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const extra = new Float32Array(SPLICE_SAMPLES);

  for (let ch = 0; ch < 2; ch++) {
    const out = buffer.getChannelData(ch);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;

    const nextPink = () => {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.045;
      b6 = white * 0.115926;
      return clamp(pink, -0.95, 0.95);
    };

    for (let i = 0; i < WARMUP_SAMPLES; i++) {
      nextPink();
    }
    for (let i = 0; i < length; i++) {
      out[i] = nextPink();
    }
    for (let i = 0; i < SPLICE_SAMPLES; i++) {
      extra[i] = nextPink();
    }
    for (let i = 0; i < SPLICE_SAMPLES; i++) {
      const theta = (i / SPLICE_SAMPLES) * Math.PI * 0.5;
      out[i] = out[i] * Math.sin(theta) + extra[i] * Math.cos(theta);
    }
  }

  return buffer;
}

/**
 * Continuous procedural ambience bed representing ISO-1 laminar airflow and turbine hum.
 */
export class CleanroomAmbience {
  /**
   * @param {BaseAudioContext} ctx
   * @param {AudioNode} [dest]
   */
  constructor(ctx, dest = null) {
    this._ctx = ctx || null;
    this._dest = dest || (ctx ? ctx.destination : null);
    this._running = false;
    this._nodes = null;
    this._lastMw = 0;
    this._lastBrownout = 0;
  }

  /**
   * Starts the laminar airflow and turbine oscillators (idempotent).
   * @returns {boolean}
   */
  start() {
    if (this._running) return true;
    const ctx = this._ctx;
    const dest = this._dest;
    if (
      !ctx ||
      !dest ||
      ctx.state === 'closed' ||
      typeof ctx.createBufferSource !== 'function' ||
      typeof ctx.createOscillator !== 'function' ||
      typeof ctx.createBiquadFilter !== 'function' ||
      typeof ctx.createGain !== 'function'
    ) {
      return false;
    }

    const noiseBuffer = createPinkNoiseLoopBuffer(ctx);
    if (!noiseBuffer) return false;

    const now = Math.max(0, Number(ctx.currentTime) || 0);

    // Bed envelope bus (smooth fade-in to eliminate startup click)
    const bedGain = ctx.createGain();
    bedGain.gain.setValueAtTime(0.0001, now);
    bedGain.connect(dest);

    // 1. Laminar HEPA canopy noise source -> parallel warm lowpass + diffuser bandpass
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuffer;
    noiseSrc.loop = true;

    const airLowpass = ctx.createBiquadFilter();
    airLowpass.type = 'lowpass';
    airLowpass.frequency.setValueAtTime(380, now);
    airLowpass.Q.setValueAtTime(0.7, now);

    const airResonance = ctx.createBiquadFilter();
    airResonance.type = 'bandpass';
    airResonance.frequency.setValueAtTime(210, now);
    airResonance.Q.setValueAtTime(1.15, now);

    const airGain = ctx.createGain();
    airGain.gain.setValueAtTime(0.14, now);

    const whisperBand = ctx.createBiquadFilter();
    whisperBand.type = 'bandpass';
    whisperBand.frequency.setValueAtTime(1050, now);
    whisperBand.Q.setValueAtTime(0.85, now);

    const whisperGain = ctx.createGain();
    whisperGain.gain.setValueAtTime(0.022, now);

    noiseSrc.connect(airLowpass);
    airLowpass.connect(airResonance);
    airResonance.connect(airGain);
    airGain.connect(bedGain);

    noiseSrc.connect(whisperBand);
    whisperBand.connect(whisperGain);
    whisperGain.connect(bedGain);

    // Subtle slow HVAC breathing LFO modulating the diffuser cutoff
    const hvacLfo = ctx.createOscillator();
    hvacLfo.type = 'sine';
    hvacLfo.frequency.setValueAtTime(0.14, now);
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.setValueAtTime(22, now);
    hvacLfo.connect(lfoDepth);
    lfoDepth.connect(airLowpass.frequency);

    // 2. ISO-1 sub-bass turbine fundamental + 2nd harmonic presence
    const subOsc = ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(42, now);

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.07, now);

    const harmOsc = ctx.createOscillator();
    harmOsc.type = 'triangle';
    harmOsc.frequency.setValueAtTime(84, now);

    const harmLowpass = ctx.createBiquadFilter();
    harmLowpass.type = 'lowpass';
    harmLowpass.frequency.setValueAtTime(150, now);
    harmLowpass.Q.setValueAtTime(0.9, now);

    const harmGain = ctx.createGain();
    harmGain.gain.setValueAtTime(0.018, now);

    // Subtle fifth overtone drone for cleanroom depth at higher MW
    const fifthOsc = ctx.createOscillator();
    fifthOsc.type = 'sine';
    fifthOsc.frequency.setValueAtTime(63, now);

    const fifthGain = ctx.createGain();
    fifthGain.gain.setValueAtTime(0.008, now);

    subOsc.connect(subGain);
    subGain.connect(bedGain);

    harmOsc.connect(harmLowpass);
    harmLowpass.connect(harmGain);
    harmGain.connect(bedGain);

    fifthOsc.connect(fifthGain);
    fifthGain.connect(bedGain);

    noiseSrc.start(now);
    hvacLfo.start(now);
    subOsc.start(now);
    harmOsc.start(now);
    fifthOsc.start(now);

    rampParam(bedGain.gain, 1.0, now, 0.45);

    this._nodes = {
      bedGain,
      noiseSrc,
      airLowpass,
      airResonance,
      airGain,
      whisperBand,
      whisperGain,
      hvacLfo,
      lfoDepth,
      subOsc,
      subGain,
      harmOsc,
      harmLowpass,
      harmGain,
      fifthOsc,
      fifthGain,
    };
    this._running = true;

    this.update({ totalMw: this._lastMw, brownoutLevel: this._lastBrownout });
    return true;
  }

  /**
   * Smoothly pitch-shifts turbine hum and modulates laminar airflow with fab megawatts.
   * @param {{ totalMw?: number, brownoutLevel?: number }} [telemetry]
   */
  update(telemetry = {}) {
    const totalMw = Number.isFinite(telemetry.totalMw) ? Math.max(0, telemetry.totalMw) : this._lastMw;
    const brownoutLevel = Number.isFinite(telemetry.brownoutLevel)
      ? clamp(telemetry.brownoutLevel, 0, 3)
      : this._lastBrownout;

    this._lastMw = totalMw;
    this._lastBrownout = brownoutLevel;

    if (!this._running || !this._nodes || !this._ctx || this._ctx.state === 'closed') return;

    const now = Math.max(0, Number(this._ctx.currentTime) || 0);
    const mwNorm = normalizeMegawatts(totalMw);
    const sagFactor = 1 - brownoutLevel * 0.045; // Subtle turbine RPM droop during grid brownout
    const airDim = 1 - brownoutLevel * 0.14;

    const baseHz = (42 + mwNorm * 32) * sagFactor;
    const airCutoff = (360 + mwNorm * 520) * (1 - brownoutLevel * 0.08);
    const canopyCenter = 185 + mwNorm * 165;
    const whisperCenter = 960 + mwNorm * 680;

    const n = this._nodes;
    rampParam(n.subOsc.frequency, baseHz, now, 0.4);
    rampParam(n.harmOsc.frequency, baseHz * 2, now, 0.4);
    rampParam(n.fifthOsc.frequency, baseHz * 1.5, now, 0.4);

    rampParam(n.harmLowpass.frequency, 145 + mwNorm * 230, now, 0.4);
    rampParam(n.harmGain.gain, (0.018 + mwNorm * 0.052) * airDim, now, 0.4);
    rampParam(n.fifthGain.gain, (0.008 + mwNorm * 0.024) * airDim, now, 0.45);
    rampParam(n.subGain.gain, 0.068 + mwNorm * 0.042, now, 0.4);

    rampParam(n.airLowpass.frequency, airCutoff, now, 0.35);
    rampParam(n.airResonance.frequency, canopyCenter, now, 0.35);
    rampParam(n.airGain.gain, (0.14 + mwNorm * 0.11) * airDim, now, 0.35);

    rampParam(n.whisperBand.frequency, whisperCenter, now, 0.35);
    rampParam(n.whisperGain.gain, (0.02 + mwNorm * 0.036) * airDim, now, 0.35);
  }

  /**
   * Alias for updating fab megawatt load directly.
   * @param {number} totalMw
   */
  setMegawatts(totalMw) {
    this.update({ totalMw });
  }

  /**
   * @returns {boolean}
   */
  isRunning() {
    return this._running;
  }

  /**
   * Gracefully stops and disconnects all ambience DSP nodes.
   */
  stop() {
    if (!this._nodes) {
      this._running = false;
      return;
    }

    const n = this._nodes;
    const ctx = this._ctx;
    const now = ctx && ctx.state !== 'closed' ? Math.max(0, Number(ctx.currentTime) || 0) : 0;

    try {
      if (ctx && ctx.state !== 'closed') {
        rampParam(n.bedGain.gain, 0.0001, now, 0.04);
      }
    } catch {
      // Ignore teardown automation errors on closed contexts
    }

    const sources = [n.noiseSrc, n.hvacLfo, n.subOsc, n.harmOsc, n.fifthOsc];
    const disconnectAll = () => {
      for (const node of Object.values(n)) {
        try {
          node.disconnect();
        } catch {
          // Ignore already disconnected nodes
        }
      }
    };

    if (!ctx || ctx.state !== 'running') {
      for (const src of sources) {
        try {
          src.stop();
        } catch {
          // Already stopped
        }
      }
      disconnectAll();
    } else {
      n.noiseSrc.onended = disconnectAll;
      for (const src of sources) {
        try {
          src.stop(now + 0.12);
        } catch {
          // Already stopped or context closed
        }
      }
    }

    this._nodes = null;
    this._running = false;
  }
}
