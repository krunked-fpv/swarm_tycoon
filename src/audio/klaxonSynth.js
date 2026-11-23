/**
 * Industrial Dual-Tone Cleanroom Alert Klaxon Synthesizer
 * - OscillatorNode dual-tone generators + WaveShaperNode soft saturation + resonant bandpass sweep
 * - Distinct acoustic profiles for 'brownout', 'scram', and 'crisis'
 * - Dual-clock per-AudioContext cooldown guard to prevent 10Hz alarm stacking
 */

const KLAXON_COOLDOWN_CACHE = new WeakMap();
const CURVE_CACHE = new Map();

const KLAXON_PROFILES = {
  brownout: {
    cooldownSec: 1.8,
    gain: 0.145,
    filterQ: 2.3,
    waveA: 'sawtooth',
    waveB: 'triangle',
    curveDrive: 2.2,
    fmWobble: null,
    pulses: [
      {
        offset: 0.0,
        dur: 0.24,
        f1Start: 220,
        f1End: 185,
        f2Start: 110,
        f2End: 92.5,
        bpStart: 960,
        bpEnd: 460,
      },
      {
        offset: 0.29,
        dur: 0.28,
        f1Start: 205,
        f1End: 162,
        f2Start: 102.5,
        f2End: 81,
        bpStart: 880,
        bpEnd: 400,
      },
    ],
  },
  scram: {
    cooldownSec: 1.5,
    gain: 0.135,
    filterQ: 3.1,
    waveA: 'sawtooth',
    waveB: 'square',
    curveDrive: 2.6,
    fmWobble: null,
    pulses: [
      {
        offset: 0.0,
        dur: 0.095,
        f1Start: 587.33,
        f1End: 575,
        f2Start: 830.61,
        f2End: 812,
        bpStart: 1200,
        bpEnd: 2300,
      },
      {
        offset: 0.145,
        dur: 0.095,
        f1Start: 587.33,
        f1End: 575,
        f2Start: 830.61,
        f2End: 812,
        bpStart: 1200,
        bpEnd: 2300,
      },
      {
        offset: 0.29,
        dur: 0.155,
        f1Start: 622.25,
        f1End: 554.37,
        f2Start: 880.0,
        f2End: 783.99,
        bpStart: 2200,
        bpEnd: 1250,
      },
    ],
  },
  crisis: {
    cooldownSec: 1.8,
    gain: 0.135,
    filterQ: 2.8,
    waveA: 'sawtooth',
    waveB: 'sawtooth',
    curveDrive: 2.4,
    fmWobble: { rateHz: 11, depthHz: 28 },
    pulses: [
      {
        offset: 0.0,
        dur: 0.22,
        f1Start: 370,
        f1End: 510,
        f2Start: 523.25,
        f2End: 680,
        bpStart: 860,
        bpEnd: 2550,
      },
      {
        offset: 0.25,
        dur: 0.26,
        f1Start: 510,
        f1End: 350,
        f2Start: 680,
        f2End: 493.88,
        bpStart: 2550,
        bpEnd: 920,
      },
    ],
  },
};

function wallClockMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function getSoftClipCurve(drive = 2.4) {
  let curve = CURVE_CACHE.get(drive);
  if (curve) return curve;

  const samples = 512;
  curve = new Float32Array(samples);
  const norm = Math.tanh(drive);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / (samples - 1) - 1;
    curve[i] = Math.tanh(x * drive) / norm;
  }
  CURVE_CACHE.set(drive, curve);
  return curve;
}

function canTriggerKlaxon(ctx, kind, cooldownSec) {
  let map = KLAXON_COOLDOWN_CACHE.get(ctx);
  if (!map) {
    map = new Map();
    KLAXON_COOLDOWN_CACHE.set(ctx, map);
  }
  const audioNow = Math.max(0, Number(ctx.currentTime) || 0);
  const wallNow = wallClockMs();

  // Global minimum spacing (0.7s) across all klaxon types prevents overlapping alarm soup
  const globalPrev = map.get('__any__');
  if (globalPrev) {
    const gAudioDt = audioNow - globalPrev.audioTime;
    const gWallDt = (wallNow - globalPrev.wallMs) * 0.001;
    if (gAudioDt > 0 ? gAudioDt < 0.7 : gWallDt < 0.7) {
      return false;
    }
  }

  const prev = map.get(kind);
  if (prev) {
    const audioDt = audioNow - prev.audioTime;
    const wallDt = (wallNow - prev.wallMs) * 0.001;
    if (audioDt > 0 ? audioDt < cooldownSec : wallDt < cooldownSec) {
      return false;
    }
  }

  const stamp = { audioTime: audioNow, wallMs: wallNow };
  map.set('__any__', stamp);
  map.set(kind, stamp);
  return true;
}

/**
 * Synthesizes an industrial dual-tone alert klaxon through soft saturation and bandpass sweep.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} [dest]
 * @param {'brownout' | 'scram' | 'crisis'} [kind='brownout']
 * @returns {boolean}
 */
export function playKlaxon(ctx, dest, kind = 'brownout') {
  if (
    !ctx ||
    ctx.state === 'closed' ||
    typeof ctx.createOscillator !== 'function' ||
    typeof ctx.createGain !== 'function' ||
    typeof ctx.createBiquadFilter !== 'function'
  ) {
    return false;
  }

  const out = dest || ctx.destination;
  if (!out) return false;

  const resolvedKind = Object.prototype.hasOwnProperty.call(KLAXON_PROFILES, kind) ? kind : 'brownout';
  const profile = KLAXON_PROFILES[resolvedKind];
  if (!canTriggerKlaxon(ctx, resolvedKind, profile.cooldownSec)) {
    return false;
  }

  const t = Math.max(0, Number(ctx.currentTime) || 0);
  const lastPulse = profile.pulses[profile.pulses.length - 1];
  const totalEnd = t + lastPulse.offset + lastPulse.dur + 0.025;

  const oscA = ctx.createOscillator();
  oscA.type = profile.waveA;

  const oscB = ctx.createOscillator();
  oscB.type = profile.waveB;

  const mixB = ctx.createGain();
  mixB.gain.setValueAtTime(0.75, t);

  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.Q.setValueAtTime(profile.filterQ, t);

  const envGain = ctx.createGain();
  envGain.gain.setValueAtTime(0.0001, t);

  const nodes = [oscA, oscB, mixB, bandpass, envGain];

  let shaper = null;
  if (typeof ctx.createWaveShaper === 'function') {
    shaper = ctx.createWaveShaper();
    shaper.curve = getSoftClipCurve(profile.curveDrive);
    shaper.oversample = '2x';
    nodes.push(shaper);
  }

  let lfoOsc = null;
  let lfoGain = null;
  if (profile.fmWobble) {
    lfoOsc = ctx.createOscillator();
    lfoOsc.type = 'sine';
    lfoOsc.frequency.setValueAtTime(profile.fmWobble.rateHz, t);

    lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(profile.fmWobble.depthHz, t);

    lfoOsc.connect(lfoGain);
    lfoGain.connect(oscA.frequency);
    lfoGain.connect(oscB.frequency);
    nodes.push(lfoOsc, lfoGain);
  }

  oscA.connect(shaper || bandpass);
  oscB.connect(mixB);
  mixB.connect(shaper || bandpass);
  if (shaper) {
    shaper.connect(bandpass);
  }
  bandpass.connect(envGain);
  envGain.connect(out);

  for (const p of profile.pulses) {
    const pStart = t + p.offset;
    const pEnd = pStart + p.dur;
    const attack = pStart + Math.min(0.012, p.dur * 0.18);
    const hold = Math.max(attack + 0.002, pEnd - Math.min(0.024, p.dur * 0.25));

    oscA.frequency.setValueAtTime(p.f1Start, pStart);
    oscA.frequency.exponentialRampToValueAtTime(Math.max(30, p.f1End), pEnd);

    oscB.frequency.setValueAtTime(p.f2Start, pStart);
    oscB.frequency.exponentialRampToValueAtTime(Math.max(30, p.f2End), pEnd);

    bandpass.frequency.setValueAtTime(p.bpStart, pStart);
    bandpass.frequency.exponentialRampToValueAtTime(Math.max(80, p.bpEnd), pEnd);

    envGain.gain.setValueAtTime(0.0001, pStart);
    envGain.gain.linearRampToValueAtTime(profile.gain, attack);
    envGain.gain.setValueAtTime(profile.gain, hold);
    envGain.gain.exponentialRampToValueAtTime(0.0001, pEnd);
  }

  oscA.start(t);
  oscB.start(t);
  oscA.stop(totalEnd);
  oscB.stop(totalEnd);

  if (lfoOsc) {
    lfoOsc.start(t);
    lfoOsc.stop(totalEnd);
  }

  oscA.onended = () => {
    for (const node of nodes) {
      try {
        node.disconnect();
      } catch {
        // Ignore disconnected node
      }
    }
  };

  return true;
}
