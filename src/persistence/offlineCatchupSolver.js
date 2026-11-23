/**
 * @fileoverview Anti-tamper analytical steady-state offline catch-up solver.
 * Computes deterministic progression across <= 28 macro-slices clamped to [0ms, 7 days].
 * Pure ES Module with zero dependencies on sim/economy/render/ui.
 */

export const MIN_OFFLINE_MS = 0;
export const MAX_OFFLINE_MS = 604800000; // 7 days
export const MAX_MACRO_SLICES = 28;

const SLICE_SPAN_MS = MAX_OFFLINE_MS / MAX_MACRO_SLICES; // 21,600,000ms (6 hours)
const MAX_TIER = 6;
const MAX_FLEET_LEVEL = 500;
const MAX_PRESTIGE_LEVEL = 1000;
const MAX_PRESTIGE_SLOTS = 9;
const MAX_AGENT_SLOTS = 4;

/**
 * Default theoretical throughput ceiling (dies/sec) per cleanroom tier.
 * @param {number} tier
 * @returns {number}
 */
export function defaultCapByTier(tier) {
  const clampedTier = Number.isInteger(tier) ? Math.min(MAX_TIER, Math.max(1, tier)) : 1;
  return 250 * Math.pow(10, clampedTier - 1);
}

function nowPerfMs() {
  if (typeof globalThis.performance?.now === 'function') {
    return globalThis.performance.now();
  }
  return Date.now();
}

/**
 * Normalizes a `{ m, e }` BigSilicon value to canonical wire form.
 * @param {number} m
 * @param {number} e
 * @returns {{ m: number, e: number }}
 */
function bsNormalize(m, e) {
  if (!Number.isFinite(m) || !Number.isFinite(e) || m === 0) {
    return { m: 0, e: 0 };
  }
  let mant = m;
  let exp = Math.trunc(e);
  const abs = Math.abs(mant);
  let shift = Math.floor(Math.log10(abs));
  if (Number.isFinite(shift) && shift !== 0) {
    // Two-step scaling avoids Math.pow(10, +-310) underflow/overflow at IEEE-754 bounds.
    while (shift >= 300) {
      mant /= 1e150;
      exp += 150;
      shift -= 150;
    }
    while (shift <= -300) {
      mant *= 1e150;
      exp -= 150;
      shift += 150;
    }
    if (shift !== 0) {
      mant /= Math.pow(10, shift);
      exp += shift;
    }
  }
  while (Math.abs(mant) >= 10) {
    mant /= 10;
    exp += 1;
  }
  while (Math.abs(mant) > 0 && Math.abs(mant) < 1) {
    mant *= 10;
    exp -= 1;
  }
  if (!Number.isFinite(mant) || !Number.isSafeInteger(exp) || mant === 0) {
    return { m: 0, e: 0 };
  }
  return { m: mant, e: exp };
}

function bsFromNumber(val) {
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val <= 0) return { m: 0, e: 0 };
    return bsNormalize(val, 0);
  }
  if (val && typeof val === 'object' && Number.isFinite(val.m) && Number.isFinite(val.e)) {
    if (val.m <= 0) return { m: 0, e: 0 };
    return bsNormalize(val.m, val.e);
  }
  return { m: 0, e: 0 };
}

function bsCmp(a, b) {
  if (a.m === 0 && b.m === 0) return 0;
  if (a.m === 0) return b.m > 0 ? -1 : 1;
  if (b.m === 0) return a.m > 0 ? 1 : -1;
  if (a.m > 0 && b.m < 0) return 1;
  if (a.m < 0 && b.m > 0) return -1;
  const sign = a.m > 0 ? 1 : -1;
  if (a.e !== b.e) return (a.e > b.e ? 1 : -1) * sign;
  if (a.m === b.m) return 0;
  return (a.m > b.m ? 1 : -1) * sign;
}

function bsAdd(a, b) {
  if (a.m === 0) return b;
  if (b.m === 0) return a;
  const hi = a.e >= b.e ? a : b;
  const lo = a.e >= b.e ? b : a;
  const diff = hi.e - lo.e;
  if (diff > 16) return hi;
  return bsNormalize(hi.m + lo.m * Math.pow(10, -diff), hi.e);
}

function bsMul(a, b) {
  if (a.m === 0 || b.m === 0) return { m: 0, e: 0 };
  return bsNormalize(a.m * b.m, a.e + b.e);
}

function bsPow10(expFloat) {
  if (!Number.isFinite(expFloat)) return { m: 0, e: 0 };
  const e = Math.floor(expFloat);
  const frac = expFloat - e;
  return bsNormalize(Math.pow(10, frac), e);
}

function bsLog10(a) {
  if (!a || a.m <= 0) return -Infinity;
  return a.e + Math.log10(a.m);
}

function sanitizeHwm(rawHwm, ceilingPerMin) {
  if (rawHwm && typeof rawHwm === 'object' && 'm' in rawHwm && 'e' in rawHwm) {
    if (!Number.isFinite(rawHwm.m) || !Number.isFinite(rawHwm.e) || rawHwm.m < 0) {
      return { hwmBs: { m: 0, e: 0 }, clamped: true };
    }
    if (rawHwm.e > 308) {
      return { hwmBs: ceilingPerMin, clamped: true };
    }
    const candidate = bsNormalize(rawHwm.m, rawHwm.e);
    if (bsCmp(candidate, ceilingPerMin) > 0) {
      return { hwmBs: ceilingPerMin, clamped: true };
    }
    return { hwmBs: candidate, clamped: false };
  }

  if (typeof rawHwm !== 'number' || Number.isNaN(rawHwm) || rawHwm < 0) {
    return { hwmBs: { m: 0, e: 0 }, clamped: rawHwm !== 0 && rawHwm !== undefined };
  }
  if (!Number.isFinite(rawHwm)) {
    return { hwmBs: ceilingPerMin, clamped: true };
  }
  const candidate = bsFromNumber(rawHwm);
  if (bsCmp(candidate, ceilingPerMin) > 0) {
    return { hwmBs: ceilingPerMin, clamped: true };
  }
  return { hwmBs: candidate, clamped: false };
}

function sanitizePrestigeLevels(levels) {
  const out = new Array(MAX_PRESTIGE_SLOTS).fill(0);
  let clamped = false;
  if (!Array.isArray(levels)) return { levels: out, clamped };
  for (let i = 0; i < MAX_PRESTIGE_SLOTS; i++) {
    const v = levels[i];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      clamped = true;
      continue;
    }
    const flo = Math.floor(v);
    if (flo > MAX_PRESTIGE_LEVEL) {
      out[i] = MAX_PRESTIGE_LEVEL;
      clamped = true;
    } else {
      out[i] = flo;
    }
  }
  return { levels: out, clamped };
}

function sanitizeAgents(agents) {
  const out = new Array(MAX_AGENT_SLOTS).fill(-1);
  if (!Array.isArray(agents) && !ArrayBuffer.isView(agents)) return out;
  for (let i = 0; i < MAX_AGENT_SLOTS; i++) {
    const v = agents[i];
    if (Number.isInteger(v) && v >= 0 && v <= 5) {
      out[i] = v;
    }
  }
  return out;
}

/**
 * Computes deterministic steady-state offline yield across <= 28 macro-slices.
 * Rejects clock rollbacks and clamps deltas > 7 days and tampered rate/level inputs.
 * @param {Record<string, any>} params
 * @returns {{
 *   validDeltaMs: number,
 *   clockRollback: boolean,
 *   capped: boolean,
 *   slicesSimulated: number,
 *   diesEarned: { m: number, e: number },
 *   flopsEarned: { m: number, e: number },
 *   shardsHint: number,
 *   tamperClamped: boolean,
 *   elapsedMs: number
 * }}
 */
export function solveOfflineCatchup(params = {}) {
  const tStart = nowPerfMs();
  const input = params && typeof params === 'object' ? params : {};

  const tClose = input.tClose;
  const tOpen = input.tOpen;
  const rawDelta = (typeof tOpen === 'number' && typeof tClose === 'number')
    ? tOpen - tClose
    : NaN;

  if (!Number.isFinite(tClose) || !Number.isFinite(tOpen) || !Number.isFinite(rawDelta) || rawDelta < MIN_OFFLINE_MS) {
    return {
      validDeltaMs: 0,
      clockRollback: true,
      capped: false,
      slicesSimulated: 0,
      diesEarned: { m: 0, e: 0 },
      flopsEarned: { m: 0, e: 0 },
      shardsHint: 0,
      tamperClamped: false,
      elapsedMs: Math.max(0, nowPerfMs() - tStart),
    };
  }

  const capped = rawDelta > MAX_OFFLINE_MS;
  const validDeltaMs = Math.min(rawDelta, MAX_OFFLINE_MS);

  const safeTier = Number.isInteger(input.tier)
    ? Math.min(MAX_TIER, Math.max(1, input.tier))
    : 1;
  const rawFleet = input.fleetLevel;
  const fleetClamped = typeof rawFleet === 'number' && (!Number.isFinite(rawFleet) || rawFleet < 1 || rawFleet > MAX_FLEET_LEVEL);
  const safeFleet = Number.isFinite(rawFleet)
    ? Math.min(MAX_FLEET_LEVEL, Math.max(1, Math.floor(rawFleet)))
    : 1;
  const { levels: safePrestige, clamped: prestigeClamped } = sanitizePrestigeLevels(input.prestigeLevels);
  const safeAgents = sanitizeAgents(input.agents);

  const rawMaxRate = input.maxTheoreticalDiesPerSec;
  let capPerSecBs;
  if (typeof rawMaxRate === 'number' && Number.isFinite(rawMaxRate) && rawMaxRate >= 0) {
    capPerSecBs = bsFromNumber(rawMaxRate);
  } else if (rawMaxRate && typeof rawMaxRate === 'object' && Number.isFinite(rawMaxRate.m) && Number.isFinite(rawMaxRate.e) && rawMaxRate.m >= 0) {
    capPerSecBs = bsNormalize(rawMaxRate.m, rawMaxRate.e);
  } else {
    capPerSecBs = bsFromNumber(defaultCapByTier(safeTier));
  }
  const ceilingPerMinBs = bsMul(capPerSecBs, bsFromNumber(60));
  const { hwmBs, clamped: hwmClamped } = sanitizeHwm(input.hwmDiesPerMin ?? 0, ceilingPerMinBs);
  const tamperClamped = Boolean(hwmClamped || fleetClamped || prestigeClamped);

  if (validDeltaMs === 0 || hwmBs.m === 0) {
    return {
      validDeltaMs,
      clockRollback: false,
      capped,
      slicesSimulated: 0,
      diesEarned: { m: 0, e: 0 },
      flopsEarned: { m: 0, e: 0 },
      shardsHint: 0,
      tamperClamped,
      elapsedMs: Math.max(0, nowPerfMs() - tStart),
    };
  }

  const slicesSimulated = Math.min(
    MAX_MACRO_SLICES,
    Math.max(1, Math.ceil(validDeltaMs / SLICE_SPAN_MS))
  );
  const sliceSec = (validDeltaMs / 1000) / slicesSimulated;
  const sliceMin = sliceSec / 60;

  let assignedAgents = 0;
  for (let i = 0; i < MAX_AGENT_SLOTS; i++) {
    if (safeAgents[i] >= 0) assignedAgents++;
  }

  let prestigeSum = 0;
  for (let i = 0; i < MAX_PRESTIGE_SLOTS; i++) {
    prestigeSum += safePrestige[i];
  }

  const baseOfflineEfficiency = 0.65;
  const fleetMult = 1 + (safeFleet - 1) * 0.1;
  const agentMult = 1 + assignedAgents * 0.15;
  const prestigeMult = bsPow10(Math.min(180, prestigeSum * 0.02));
  const flopsPerDie = 16 * Math.pow(3, safeTier - 1) * (1 + assignedAgents * 0.25);

  const baseSliceDies = bsMul(hwmBs, bsFromNumber(sliceMin * fleetMult * agentMult));
  const prestigeSliceDies = bsMul(baseSliceDies, prestigeMult);
  const flopsPerDieBs = bsFromNumber(flopsPerDie);

  let diesEarned = { m: 0, e: 0 };
  let flopsEarned = { m: 0, e: 0 };

  for (let s = 0; s < slicesSimulated; s++) {
    const progress = (s + 1) / slicesSimulated;
    const steadyFactor = baseOfflineEfficiency * (0.9 + 0.1 * progress);
    const sliceDies = bsMul(prestigeSliceDies, bsFromNumber(steadyFactor));
    const sliceFlops = bsMul(sliceDies, flopsPerDieBs);
    diesEarned = bsAdd(diesEarned, sliceDies);
    flopsEarned = bsAdd(flopsEarned, sliceFlops);
  }

  const logFlops = bsLog10(flopsEarned);
  const shardsHint = Number.isFinite(logFlops) && logFlops > 6
    ? Math.floor(logFlops - 6)
    : 0;

  return {
    validDeltaMs,
    clockRollback: false,
    capped,
    slicesSimulated,
    diesEarned,
    flopsEarned,
    shardsHint,
    tamperClamped,
    elapsedMs: Math.max(0, nowPerfMs() - tStart),
  };
}
