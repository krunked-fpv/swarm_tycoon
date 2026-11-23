/**
 * Cleanroom Procedural Machine & UI Foley Synthesizers
 * - Zero external audio assets; zero 8-bit arcade beeps
 * - Cached noise buffers and dual-clock cooldown guards per AudioContext
 * - Automatic node disconnection via onended for leak-free 10Hz operation
 */

const NOISE_BUFFER_CACHE = new WeakMap();
const COOLDOWN_CACHE = new WeakMap();
const WAFER_STEP_CACHE = new WeakMap();

const WAFER_PENTATONIC_HZ = [1046.5, 1174.66, 1318.51, 1567.98, 1318.51, 1174.66];
const CELEBRATION_ARPEGGIO_HZ = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];

const COOLDOWN_SEC = {
  click: 0.025,
  place: 0.045,
  wafer: 0.135,
  euv: 0.16,
  shuttle: 0.14,
  prestige: 0.9,
  celebration: 0.35,
  whoosh: 0.12,
  nodePop: 0.03,
};

function wallClockMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function isPlayableContext(ctx) {
  return Boolean(
    ctx &&
      ctx.state !== 'closed' &&
      typeof ctx.createOscillator === 'function' &&
      typeof ctx.createGain === 'function' &&
      typeof ctx.createBiquadFilter === 'function'
  );
}

function getOutputNode(ctx, dest) {
  return dest || ctx.destination || null;
}

function canTriggerFoley(ctx, key, cooldownSec) {
  let map = COOLDOWN_CACHE.get(ctx);
  if (!map) {
    map = new Map();
    COOLDOWN_CACHE.set(ctx, map);
  }
  const audioNow = Math.max(0, Number(ctx.currentTime) || 0);
  const wallNow = wallClockMs();
  const prev = map.get(key);

  if (prev) {
    const audioDt = audioNow - prev.audioTime;
    const wallDtSec = (wallNow - prev.wallMs) * 0.001;
    if (audioDt > 0 ? audioDt < cooldownSec : wallDtSec < cooldownSec) {
      return false;
    }
  }

  map.set(key, { audioTime: audioNow, wallMs: wallNow });
  return true;
}

function getWhiteNoiseBuffer(ctx) {
  if (typeof ctx.createBuffer !== 'function' || typeof ctx.createBufferSource !== 'function') {
    return null;
  }
  const cached = NOISE_BUFFER_CACHE.get(ctx);
  if (cached) return cached;

  const sampleRate = Number.isFinite(ctx.sampleRate) && ctx.sampleRate > 0 ? ctx.sampleRate : 44100;
  const length = Math.max(1024, Math.floor(sampleRate * 1.0));
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  NOISE_BUFFER_CACHE.set(ctx, buffer);
  return buffer;
}

function disconnectNodes(nodes) {
  for (const node of nodes) {
    if (!node) continue;
    try {
      node.disconnect();
    } catch {
      // Node already disconnected
    }
  }
}

function scheduleAutoDisconnect(triggerSource, nodes) {
  if (!triggerSource) return;
  triggerSource.onended = () => disconnectNodes(nodes);
}

function scheduleNoiseBurst(ctx, out, { start, duration, filterType, freqStart, freqEnd, q, peakGain, offsetSec = 0 }) {
  const buf = getWhiteNoiseBuffer(ctx);
  if (!buf) return null;

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.Q.setValueAtTime(q, start);
  filter.frequency.setValueAtTime(freqStart, start);
  if (freqEnd && freqEnd !== freqStart) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), start + duration);
  }

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(peakGain, start + Math.min(0.004, duration * 0.25));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(out);

  src.start(start, offsetSec % 0.6);
  src.stop(start + duration + 0.012);
  scheduleAutoDisconnect(src, [src, filter, gain]);
  return src;
}

/**
 * Crisp micro-relay tactile transient for command-deck UI controls.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} [dest]
 * @returns {boolean}
 */
export function playUiClick(ctx, dest) {
  if (!isPlayableContext(ctx)) return false;
  const out = getOutputNode(ctx, dest);
  if (!out || !canTriggerFoley(ctx, 'click', COOLDOWN_SEC.click)) return false;

  const t = Math.max(0, Number(ctx.currentTime) || 0);

  // Tactile chassis impulse
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1420, t);
  osc.frequency.exponentialRampToValueAtTime(360, t + 0.014);

  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.0001, t);
  oscGain.gain.linearRampToValueAtTime(0.11, t + 0.0015);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);

  osc.connect(oscGain);
  oscGain.connect(out);
  osc.start(t);
  osc.stop(t + 0.022);
  scheduleAutoDisconnect(osc, [osc, oscGain]);

  // Micro-switch contact snap
  scheduleNoiseBurst(ctx, out, {
    start: t,
    duration: 0.012,
    filterType: 'bandpass',
    freqStart: 3100,
    freqEnd: 2100,
    q: 2.5,
    peakGain: 0.14,
    offsetSec: Math.random() * 0.4,
  });

  return true;
}

/**
 * Solid cleanroom aluminum-frame mechanical latch + damped pedestal thud.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} [dest]
 * @returns {boolean}
 */
export function playPlace(ctx, dest) {
  if (!isPlayableContext(ctx)) return false;
  const out = getOutputNode(ctx, dest);
  if (!out || !canTriggerFoley(ctx, 'place', COOLDOWN_SEC.place)) return false;

  const t = Math.max(0, Number(ctx.currentTime) || 0);

  // Layer 1: Damped subfloor chassis thud
  const bodyOsc = ctx.createOscillator();
  bodyOsc.type = 'sine';
  bodyOsc.frequency.setValueAtTime(168, t);
  bodyOsc.frequency.exponentialRampToValueAtTime(56, t + 0.095);

  const bodyFilter = ctx.createBiquadFilter();
  bodyFilter.type = 'lowpass';
  bodyFilter.frequency.setValueAtTime(340, t);

  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(0.0001, t);
  bodyGain.gain.linearRampToValueAtTime(0.24, t + 0.004);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.125);

  bodyOsc.connect(bodyFilter);
  bodyFilter.connect(bodyGain);
  bodyGain.connect(out);
  bodyOsc.start(t);
  bodyOsc.stop(t + 0.13);
  scheduleAutoDisconnect(bodyOsc, [bodyOsc, bodyFilter, bodyGain]);

  // Layer 2: Precision anodized aluminum rail latch (+18ms double-detent)
  const latchStart = t + 0.018;
  const ringOsc = ctx.createOscillator();
  ringOsc.type = 'triangle';
  ringOsc.frequency.setValueAtTime(640, latchStart);
  ringOsc.frequency.exponentialRampToValueAtTime(490, latchStart + 0.045);

  const ringFilter = ctx.createBiquadFilter();
  ringFilter.type = 'bandpass';
  ringFilter.frequency.setValueAtTime(1350, latchStart);
  ringFilter.Q.setValueAtTime(2.8, latchStart);

  const ringGain = ctx.createGain();
  ringGain.gain.setValueAtTime(0.0001, latchStart);
  ringGain.gain.linearRampToValueAtTime(0.08, latchStart + 0.002);
  ringGain.gain.exponentialRampToValueAtTime(0.0001, latchStart + 0.055);

  ringOsc.connect(ringFilter);
  ringFilter.connect(ringGain);
  ringGain.connect(out);
  ringOsc.start(latchStart);
  ringOsc.stop(latchStart + 0.06);
  scheduleAutoDisconnect(ringOsc, [ringOsc, ringFilter, ringGain]);

  scheduleNoiseBurst(ctx, out, {
    start: latchStart,
    duration: 0.024,
    filterType: 'bandpass',
    freqStart: 2200,
    freqEnd: 1500,
    q: 3.1,
    peakGain: 0.11,
    offsetSec: 0.15,
  });

  return true;
}

/**
 * Crystalline harmonic FM chime on wafer vault completion (rate-limited for 10Hz safety).
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} [dest]
 * @returns {boolean}
 */
export function playWaferComplete(ctx, dest) {
  if (!isPlayableContext(ctx)) return false;
  const out = getOutputNode(ctx, dest);
  if (!out || !canTriggerFoley(ctx, 'wafer', COOLDOWN_SEC.wafer)) return false;

  const t = Math.max(0, Number(ctx.currentTime) || 0);
  const step = WAFER_STEP_CACHE.get(ctx) || 0;
  WAFER_STEP_CACHE.set(ctx, (step + 1) % WAFER_PENTATONIC_HZ.length);

  const f0 = WAFER_PENTATONIC_HZ[step];

  // FM operator pair: glassy transient index collapsing into pure silicon sine resonance
  const modulator = ctx.createOscillator();
  modulator.type = 'sine';
  modulator.frequency.setValueAtTime(f0 * 3.0, t);

  const modIndex = ctx.createGain();
  modIndex.gain.setValueAtTime(f0 * 0.85, t);
  modIndex.gain.exponentialRampToValueAtTime(10, t + 0.065);

  const carrier = ctx.createOscillator();
  carrier.type = 'sine';
  carrier.frequency.setValueAtTime(f0, t);

  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.setValueAtTime(380, t);

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.linearRampToValueAtTime(0.105, t + 0.004);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);

  modulator.connect(modIndex);
  modIndex.connect(carrier.frequency);
  carrier.connect(highpass);
  highpass.connect(amp);
  amp.connect(out);

  modulator.start(t);
  carrier.start(t);
  modulator.stop(t + 0.37);
  carrier.stop(t + 0.37);
  scheduleAutoDisconnect(carrier, [modulator, modIndex, carrier, highpass, amp]);

  // Subtle harmonic fifth shimmer tail
  const shimmer = ctx.createOscillator();
  shimmer.type = 'sine';
  shimmer.frequency.setValueAtTime(f0 * 1.5, t + 0.01);

  const shimmerGain = ctx.createGain();
  shimmerGain.gain.setValueAtTime(0.0001, t + 0.01);
  shimmerGain.gain.linearRampToValueAtTime(0.032, t + 0.02);
  shimmerGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);

  shimmer.connect(shimmerGain);
  shimmerGain.connect(out);
  shimmer.start(t + 0.01);
  shimmer.stop(t + 0.26);
  scheduleAutoDisconnect(shimmer, [shimmer, shimmerGain]);

  return true;
}

/**
 * Short 13.5nm EUV plasma discharge crackle + high-frequency filtered zap (rate-limited).
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} [dest]
 * @returns {boolean}
 */
export function playEuvFlash(ctx, dest) {
  if (!isPlayableContext(ctx)) return false;
  const out = getOutputNode(ctx, dest);
  if (!out || !canTriggerFoley(ctx, 'euv', COOLDOWN_SEC.euv)) return false;

  const t = Math.max(0, Number(ctx.currentTime) || 0);

  // Laser droplet zap
  const zapOsc = ctx.createOscillator();
  zapOsc.type = 'triangle';
  zapOsc.frequency.setValueAtTime(3900, t);
  zapOsc.frequency.exponentialRampToValueAtTime(340, t + 0.032);

  const zapFilter = ctx.createBiquadFilter();
  zapFilter.type = 'bandpass';
  zapFilter.frequency.setValueAtTime(2600, t);
  zapFilter.frequency.exponentialRampToValueAtTime(880, t + 0.035);
  zapFilter.Q.setValueAtTime(1.9, t);

  const zapGain = ctx.createGain();
  zapGain.gain.setValueAtTime(0.0001, t);
  zapGain.gain.linearRampToValueAtTime(0.095, t + 0.002);
  zapGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.042);

  zapOsc.connect(zapFilter);
  zapFilter.connect(zapGain);
  zapGain.connect(out);
  zapOsc.start(t);
  zapOsc.stop(t + 0.046);
  scheduleAutoDisconnect(zapOsc, [zapOsc, zapFilter, zapGain]);

  // Dual micro-burst plasma crackle inside vacuum chamber
  scheduleNoiseBurst(ctx, out, {
    start: t,
    duration: 0.034,
    filterType: 'bandpass',
    freqStart: 6400,
    freqEnd: 2900,
    q: 1.5,
    peakGain: 0.09,
    offsetSec: 0.05,
  });

  scheduleNoiseBurst(ctx, out, {
    start: t + 0.016,
    duration: 0.026,
    filterType: 'highpass',
    freqStart: 4200,
    freqEnd: 4200,
    q: 0.9,
    peakGain: 0.05,
    offsetSec: 0.37,
  });

  return true;
}

/**
 * High-precision overhead FOUP stepper-servo pitch sweep on shuttle dispatch.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} [dest]
 * @returns {boolean}
 */
export function playShuttleLaunch(ctx, dest) {
  if (!isPlayableContext(ctx)) return false;
  const out = getOutputNode(ctx, dest);
  if (!out || !canTriggerFoley(ctx, 'shuttle', COOLDOWN_SEC.shuttle)) return false;

  const t = Math.max(0, Number(ctx.currentTime) || 0);

  // Stepper-servo harmonic pair
  const servoPrimary = ctx.createOscillator();
  servoPrimary.type = 'triangle';
  servoPrimary.frequency.setValueAtTime(185, t);
  servoPrimary.frequency.linearRampToValueAtTime(675, t + 0.17);
  servoPrimary.frequency.linearRampToValueAtTime(510, t + 0.28);

  const servoHarm = ctx.createOscillator();
  servoHarm.type = 'sawtooth';
  servoHarm.frequency.setValueAtTime(370, t);
  servoHarm.frequency.linearRampToValueAtTime(1350, t + 0.17);
  servoHarm.frequency.linearRampToValueAtTime(1020, t + 0.28);

  const harmScale = ctx.createGain();
  harmScale.gain.setValueAtTime(0.32, t);

  const resonantBp = ctx.createBiquadFilter();
  resonantBp.type = 'bandpass';
  resonantBp.Q.setValueAtTime(3.4, t);
  resonantBp.frequency.setValueAtTime(420, t);
  resonantBp.frequency.linearRampToValueAtTime(1650, t + 0.17);
  resonantBp.frequency.linearRampToValueAtTime(1180, t + 0.28);

  const servoGain = ctx.createGain();
  servoGain.gain.setValueAtTime(0.0001, t);
  servoGain.gain.linearRampToValueAtTime(0.095, t + 0.035);
  servoGain.gain.setValueAtTime(0.085, t + 0.16);
  servoGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);

  servoPrimary.connect(resonantBp);
  servoHarm.connect(harmScale);
  harmScale.connect(resonantBp);
  resonantBp.connect(servoGain);
  servoGain.connect(out);

  servoPrimary.start(t);
  servoHarm.start(t);
  servoPrimary.stop(t + 0.31);
  servoHarm.stop(t + 0.31);
  scheduleAutoDisconnect(servoPrimary, [
    servoPrimary,
    servoHarm,
    harmScale,
    resonantBp,
    servoGain,
  ]);

  // Cleanroom air-bearing rail glide
  scheduleNoiseBurst(ctx, out, {
    start: t + 0.015,
    duration: 0.22,
    filterType: 'bandpass',
    freqStart: 620,
    freqEnd: 2150,
    q: 1.6,
    peakGain: 0.048,
    offsetSec: 0.22,
  });

  return true;
}

/**
 * Resonant multi-voice detuned chord swell + shimmering harmonic wash for Architecture Rewrite prestige.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} [dest]
 * @returns {boolean}
 */
export function playPrestigeSwell(ctx, dest) {
  if (!isPlayableContext(ctx)) return false;
  const out = getOutputNode(ctx, dest);
  if (!out || !canTriggerFoley(ctx, 'prestige', COOLDOWN_SEC.prestige)) return false;

  const t = Math.max(0, Number(ctx.currentTime) || 0);
  const swellPeak = t + 0.55;
  const totalDur = 2.45;

  // Dmaj9 cleanroom resonance voicing: D3, A3, E4, F#4, A4, C#5
  const chordHz = [146.83, 220.0, 329.63, 369.99, 440.0, 554.37];

  const busFilter = ctx.createBiquadFilter();
  busFilter.type = 'lowpass';
  busFilter.Q.setValueAtTime(1.25, t);
  busFilter.frequency.setValueAtTime(260, t);
  busFilter.frequency.exponentialRampToValueAtTime(4200, t + 0.95);
  busFilter.frequency.exponentialRampToValueAtTime(860, t + totalDur);

  const busGain = ctx.createGain();
  busGain.gain.setValueAtTime(0.0001, t);
  busGain.gain.linearRampToValueAtTime(0.22, swellPeak);
  busGain.gain.exponentialRampToValueAtTime(0.0001, t + totalDur);

  busFilter.connect(busGain);
  busGain.connect(out);

  const createdNodes = [busFilter, busGain];
  let anchorOsc = null;

  for (let i = 0; i < chordHz.length; i++) {
    const baseHz = chordHz[i];
    const detunePair = [-6.5, 6.5];

    for (let j = 0; j < detunePair.length; j++) {
      const osc = ctx.createOscillator();
      osc.type = i < 2 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(baseHz, t);
      if (osc.detune) {
        osc.detune.setValueAtTime(detunePair[j], t);
      }

      const voiceGain = ctx.createGain();
      voiceGain.gain.setValueAtTime(i < 2 ? 0.14 : 0.11, t);

      osc.connect(voiceGain);
      voiceGain.connect(busFilter);

      osc.start(t);
      osc.stop(t + totalDur + 0.04);

      createdNodes.push(osc, voiceGain);
      if (!anchorOsc) anchorOsc = osc;
    }
  }

  // High crystal overtone shimmer (D6) rising during the swell peak
  const shimmerOsc = ctx.createOscillator();
  shimmerOsc.type = 'sine';
  shimmerOsc.frequency.setValueAtTime(1174.66, t + 0.18);

  const shimmerGain = ctx.createGain();
  shimmerGain.gain.setValueAtTime(0.0001, t + 0.18);
  shimmerGain.gain.linearRampToValueAtTime(0.036, t + 0.72);
  shimmerGain.gain.exponentialRampToValueAtTime(0.0001, t + 2.15);

  shimmerOsc.connect(shimmerGain);
  shimmerGain.connect(out);
  shimmerOsc.start(t + 0.18);
  shimmerOsc.stop(t + 2.2);
  createdNodes.push(shimmerOsc, shimmerGain);

  scheduleAutoDisconnect(anchorOsc, createdNodes);

  // Shimmering harmonic air wash
  scheduleNoiseBurst(ctx, out, {
    start: t + 0.08,
    duration: 1.55,
    filterType: 'bandpass',
    freqStart: 900,
    freqEnd: 3400,
    q: 1.8,
    peakGain: 0.04,
    offsetSec: 0.11,
  });

  return true;
}

/**
 * Triumphant cleanroom arpeggio with warm triangle/sine shimmer + crisp highpass spark burst.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} [dest]
 * @param {number} [intensity=1]
 * @returns {boolean}
 */
export function playCelebrationFanfare(ctx, dest, intensity = 1) {
  if (!isPlayableContext(ctx)) return false;
  const out = getOutputNode(ctx, dest);
  if (!out || !canTriggerFoley(ctx, 'celebration', COOLDOWN_SEC.celebration)) return false;

  const t = Math.max(0, Number(ctx.currentTime) || 0);
  const rawInt = Number.isFinite(Number(intensity)) ? Number(intensity) : 1;
  const k = Math.max(0.5, Math.min(2.0, rawInt));
  const ampScale = 0.85 + 0.15 * k;

  const busFilter = ctx.createBiquadFilter();
  busFilter.type = 'lowpass';
  busFilter.Q.setValueAtTime(1.1, t);
  busFilter.frequency.setValueAtTime(4800, t);
  busFilter.frequency.exponentialRampToValueAtTime(2200, t + 0.95);

  const busGain = ctx.createGain();
  busGain.gain.setValueAtTime(1.0, t);

  busFilter.connect(busGain);
  busGain.connect(out);

  for (let i = 0; i < CELEBRATION_ARPEGGIO_HZ.length; i++) {
    const freq = CELEBRATION_ARPEGGIO_HZ[i];
    const noteStart = t + i * 0.055;
    const isLast = i === CELEBRATION_ARPEGGIO_HZ.length - 1;
    const dur = isLast ? 0.68 : 0.34;

    const tri = ctx.createOscillator();
    tri.type = 'triangle';
    tri.frequency.setValueAtTime(freq, noteStart);

    const triGain = ctx.createGain();
    triGain.gain.setValueAtTime(0.0001, noteStart);
    triGain.gain.linearRampToValueAtTime(0.08 * ampScale, noteStart + 0.008);
    triGain.gain.exponentialRampToValueAtTime(0.0001, noteStart + dur);

    tri.connect(triGain);
    triGain.connect(busFilter);
    tri.start(noteStart);
    tri.stop(noteStart + dur + 0.015);
    scheduleAutoDisconnect(
      tri,
      isLast ? [tri, triGain, busFilter, busGain] : [tri, triGain]
    );

    const shim = ctx.createOscillator();
    shim.type = 'sine';
    shim.frequency.setValueAtTime(freq * 2.0, noteStart + 0.004);

    const shimGain = ctx.createGain();
    shimGain.gain.setValueAtTime(0.0001, noteStart + 0.004);
    shimGain.gain.linearRampToValueAtTime(0.032 * ampScale, noteStart + 0.015);
    shimGain.gain.exponentialRampToValueAtTime(0.0001, noteStart + dur * 0.88);

    shim.connect(shimGain);
    shimGain.connect(busFilter);
    shim.start(noteStart + 0.004);
    shim.stop(noteStart + dur);
    scheduleAutoDisconnect(shim, [shim, shimGain]);
  }

  scheduleNoiseBurst(ctx, out, {
    start: t + 0.02,
    duration: 0.18,
    filterType: 'highpass',
    freqStart: 4200,
    freqEnd: 6800,
    q: 1.1,
    peakGain: 0.058 * Math.min(1.35, k),
    offsetSec: 0.08,
  });

  scheduleNoiseBurst(ctx, out, {
    start: t + 0.275,
    duration: 0.24,
    filterType: 'highpass',
    freqStart: 5400,
    freqEnd: 8200,
    q: 1.3,
    peakGain: 0.072 * Math.min(1.35, k),
    offsetSec: 0.31,
  });

  return true;
}

/**
 * Smooth pneumatic cleanroom airlock sweep (220Hz -> 2600Hz -> 280Hz) + gentle sub-bass thump.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} [dest]
 * @returns {boolean}
 */
export function playTransitionWhoosh(ctx, dest) {
  if (!isPlayableContext(ctx)) return false;
  const out = getOutputNode(ctx, dest);
  if (!out || !canTriggerFoley(ctx, 'whoosh', COOLDOWN_SEC.whoosh)) return false;

  const t = Math.max(0, Number(ctx.currentTime) || 0);

  const buf = getWhiteNoiseBuffer(ctx);
  if (buf) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.setValueAtTime(1.8, t);
    filter.frequency.setValueAtTime(220, t);
    filter.frequency.exponentialRampToValueAtTime(2600, t + 0.13);
    filter.frequency.exponentialRampToValueAtTime(280, t + 0.34);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, t);
    noiseGain.gain.linearRampToValueAtTime(0.145, t + 0.12);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);

    src.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(out);
    src.start(t, 0.12);
    src.stop(t + 0.355);
    scheduleAutoDisconnect(src, [src, filter, noiseGain]);
  }

  const subOsc = ctx.createOscillator();
  subOsc.type = 'sine';
  subOsc.frequency.setValueAtTime(118, t);
  subOsc.frequency.exponentialRampToValueAtTime(44, t + 0.14);

  const subFilter = ctx.createBiquadFilter();
  subFilter.type = 'lowpass';
  subFilter.frequency.setValueAtTime(220, t);

  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(0.0001, t);
  subGain.gain.linearRampToValueAtTime(0.15, t + 0.006);
  subGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);

  subOsc.connect(subFilter);
  subFilter.connect(subGain);
  subGain.connect(out);
  subOsc.start(t);
  subOsc.stop(t + 0.17);
  scheduleAutoDisconnect(subOsc, [subOsc, subFilter, subGain]);

  return true;
}

/**
 * Escalating harmonic bubble chime (440 * 1.12246^(step % 12) Hz) for node taps & arcade hits.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} [dest]
 * @param {number} [step=0]
 * @returns {boolean}
 */
export function playNodeUnlockPop(ctx, dest, step = 0) {
  if (!isPlayableContext(ctx)) return false;
  const out = getOutputNode(ctx, dest);
  if (!out || !canTriggerFoley(ctx, 'nodePop', COOLDOWN_SEC.nodePop)) return false;

  const t = Math.max(0, Number(ctx.currentTime) || 0);
  const safeStep = Number.isFinite(Number(step)) ? Math.max(0, Math.floor(Number(step))) : 0;
  const baseHz = 440 * Math.pow(1.12246, safeStep % 12);

  const popOsc = ctx.createOscillator();
  popOsc.type = 'sine';
  popOsc.frequency.setValueAtTime(baseHz * 0.72, t);
  popOsc.frequency.exponentialRampToValueAtTime(baseHz, t + 0.022);

  const popGain = ctx.createGain();
  popGain.gain.setValueAtTime(0.0001, t);
  popGain.gain.linearRampToValueAtTime(0.13, t + 0.004);
  popGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);

  popOsc.connect(popGain);
  popGain.connect(out);
  popOsc.start(t);
  popOsc.stop(t + 0.15);
  scheduleAutoDisconnect(popOsc, [popOsc, popGain]);

  const harmOsc = ctx.createOscillator();
  harmOsc.type = 'triangle';
  harmOsc.frequency.setValueAtTime(baseHz * 2.0, t + 0.008);

  const harmFilter = ctx.createBiquadFilter();
  harmFilter.type = 'bandpass';
  harmFilter.frequency.setValueAtTime(baseHz * 2.0, t + 0.008);
  harmFilter.Q.setValueAtTime(1.6, t + 0.008);

  const harmGain = ctx.createGain();
  harmGain.gain.setValueAtTime(0.0001, t + 0.008);
  harmGain.gain.linearRampToValueAtTime(0.048, t + 0.016);
  harmGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.165);

  harmOsc.connect(harmFilter);
  harmFilter.connect(harmGain);
  harmGain.connect(out);
  harmOsc.start(t + 0.008);
  harmOsc.stop(t + 0.175);
  scheduleAutoDisconnect(harmOsc, [harmOsc, harmFilter, harmGain]);

  return true;
}
