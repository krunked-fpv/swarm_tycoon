/**
 * @fileoverview Bidirectional self-healing persistence vault (`krunked-cookie-vault-v1`)
 * mirroring Primary LocalStorage + IndexedDB state with an FNV-1a signed, Base64URL
 * shadow cookie, plus isolated Daily Challenge storage.
 * Pure ES Module with zero dependencies on sim/economy/render/ui.
 */

import {
  fnv1aHex,
  utf8ToBase64Url,
  base64UrlToUtf8,
  encodeBlueprint,
  decodeBlueprint,
  MIN_GRID_DIM,
  MAX_GRID_DIM,
  MIN_TIER,
  MAX_TIER,
} from './blueprintCodec.js';

export const PRIMARY_SAVE_KEY = 'swarm_tycoon_save_v1';
export const DAILY_SAVE_KEY = 'swarm_tycoon_daily_v1';
export const COOKIE_VAULT_NAME = 'krunked-cookie-vault-v1';
export const IDB_NAME = 'swarm_tycoon_idb_v1';
export const IDB_STORE = 'vault';
export const IDB_KEY = 'campaign';

export const MAX_COOKIE_BYTES = 3800;
const FUTURE_SKEW_TOLERANCE_MS = 60000;
const MAX_FLEET_LEVEL = 500;
const MAX_PRESTIGE_LEVEL = 1000;
const PRESTIGE_SLOTS = 9;
const AGENT_SLOTS = 4;
const MAX_EXPEDITION_MASK = 0xffffff;
const DEFAULT_EXPEDITION = Object.freeze({
  clearedMask: 0,
  bagMask: 0,
  secretUnlocked: false,
  secretBest: 0,
});

const textEncoder = new TextEncoder();

function isPlainObject(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Normalizes a BigSilicon `{ m, e }` pair into canonical wire form.
 * @param {number} m
 * @param {number} e
 * @returns {{ m: number, e: number }}
 */
export function bsNormalize(m, e) {
  if (!Number.isFinite(m) || !Number.isFinite(e) || m === 0) {
    return { m: 0, e: 0 };
  }
  let mant = m;
  let exp = Math.trunc(e);
  const abs = Math.abs(mant);
  let shift = Math.floor(Math.log10(abs));
  if (Number.isFinite(shift) && shift !== 0) {
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

/**
 * Validates whether a BigSilicon object is finite and non-negative.
 * @param {any} v
 * @returns {boolean}
 */
export function bsIsValid(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (typeof v.m !== 'number' || typeof v.e !== 'number') return false;
  if (!Number.isFinite(v.m) || !Number.isSafeInteger(v.e)) return false;
  if (v.m < 0) return false;
  if (v.m === 0) return v.e === 0;
  return v.m >= 1 && v.m < 10;
}

/**
 * Sanitizes a BigSilicon-like input into a valid non-negative `{ m, e }`.
 * @param {any} v
 * @param {{ m: number, e: number }} [fallback]
 * @returns {{ m: number, e: number }}
 */
export function bsSanitize(v, fallback = { m: 0, e: 0 }) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return { ...fallback };
    return bsNormalize(v, 0);
  }
  if (v && typeof v === 'object' && Number.isFinite(v.m) && Number.isFinite(v.e)) {
    if (v.m < 0) return { ...fallback };
    return bsNormalize(v.m, v.e);
  }
  return { ...fallback };
}

/**
 * Compares two normalized BigSilicon values (`-1 | 0 | 1`).
 * @param {{ m: number, e: number }} a
 * @param {{ m: number, e: number }} b
 * @returns {-1 | 0 | 1}
 */
export function bsCmp(a, b) {
  if (a.m === 0 && b.m === 0) return 0;
  if (a.m === 0) return b.m > 0 ? -1 : 1;
  if (b.m === 0) return a.m > 0 ? 1 : -1;
  if (a.e !== b.e) return a.e > b.e ? 1 : -1;
  if (a.m === b.m) return 0;
  return a.m > b.m ? 1 : -1;
}

/**
 * Deterministic canonical JSON serialization with sorted keys.
 * Strips top-level `sig` when `omitTopSig` is true.
 * @param {any} value
 * @param {boolean} [omitTopSig=true]
 * @returns {string}
 */
export function canonicalStringify(value, omitTopSig = true) {
  function serializeNode(node, isTopLevel) {
    if (node === null) return 'null';
    const type = typeof node;
    if (type === 'boolean') return node ? 'true' : 'false';
    if (type === 'number') {
      if (!Number.isFinite(node)) return 'null';
      return JSON.stringify(Object.is(node, -0) ? 0 : node);
    }
    if (type === 'string') return JSON.stringify(node);
    if (Array.isArray(node)) {
      const parts = new Array(node.length);
      for (let i = 0; i < node.length; i++) {
        const el = node[i];
        parts[i] = el === undefined || typeof el === 'function' || typeof el === 'symbol'
          ? 'null'
          : serializeNode(el, false);
      }
      return '[' + parts.join(',') + ']';
    }
    if (type === 'object') {
      const keys = Object.keys(node).sort();
      const entries = [];
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (isTopLevel && omitTopSig && k === 'sig') continue;
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        const val = node[k];
        if (val === undefined || typeof val === 'function' || typeof val === 'symbol') continue;
        entries.push(JSON.stringify(k) + ':' + serializeNode(val, false));
      }
      return '{' + entries.join(',') + '}';
    }
    return 'null';
  }
  return serializeNode(value, true);
}

/**
 * Computes and attaches canonical 8-char FNV-1a signature (`sig`) to a shallow clone.
 * @template {Record<string, any>} T
 * @param {T} obj
 * @returns {T & { sig: string }}
 */
export function signPayload(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new TypeError('signPayload expects a plain object');
  }
  const canonical = canonicalStringify(obj, true);
  const sig = fnv1aHex(canonical);
  const copy = {};
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k === 'sig' || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    copy[k] = obj[k];
  }
  copy.sig = sig;
  return copy;
}

/**
 * Verifies canonical 8-char FNV-1a signature (`sig`) on an object.
 * @param {any} obj
 * @returns {boolean}
 */
export function verifyPayload(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (typeof obj.sig !== 'string' || !/^[0-9a-f]{8}$/.test(obj.sig)) return false;
  const expected = fnv1aHex(canonicalStringify(obj, true));
  return obj.sig === expected;
}

function clampInt(val, min, max, fallback) {
  if (typeof val !== 'number' || !Number.isFinite(val)) return fallback;
  const n = Math.trunc(val);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function clampFloat(val, min, max, fallback) {
  if (typeof val !== 'number' || !Number.isFinite(val)) return fallback;
  if (val < min) return min;
  if (val > max) return max;
  return val;
}

function createEmptyCells(gridSize) {
  const total = gridSize * gridSize;
  const cells = new Array(total);
  for (let i = 0; i < total; i++) {
    cells[i] = {
      machineType: 0,
      machineDir: 0,
      machineSub: 0,
      ln2Mask: 0,
      powerMask: 0,
      shuttleWaypoint: 0,
    };
  }
  return cells;
}

function sanitizeCell(c) {
  if (!c || typeof c !== 'object') {
    return {
      machineType: 0,
      machineDir: 0,
      machineSub: 0,
      ln2Mask: 0,
      powerMask: 0,
      shuttleWaypoint: 0,
    };
  }
  return {
    machineType: clampInt(c.machineType ?? c.type, 0, 31, 0),
    machineDir: clampInt(c.machineDir ?? c.dir, 0, 3, 0),
    machineSub: clampInt(c.machineSub ?? c.sub, 0, 3, 0),
    ln2Mask: clampInt(c.ln2Mask, 0, 31, 0),
    powerMask: clampInt(c.powerMask, 0, 31, 0),
    shuttleWaypoint: clampInt(c.shuttleWaypoint, 0, 3, 0),
  };
}

function sanitizeAgentsArray(arr) {
  const out = [-1, -1, -1, -1];
  if (!Array.isArray(arr) && !ArrayBuffer.isView(arr)) return out;
  for (let i = 0; i < AGENT_SLOTS; i++) {
    out[i] = clampInt(arr[i], -1, 5, -1);
  }
  return out;
}

function sanitizePrestigeArray(arr) {
  const out = new Array(PRESTIGE_SLOTS).fill(0);
  if (!Array.isArray(arr)) return out;
  for (let i = 0; i < PRESTIGE_SLOTS; i++) {
    out[i] = clampInt(arr[i], 0, MAX_PRESTIGE_LEVEL, 0);
  }
  return out;
}

function sanitizeEntropiesArray(arr) {
  const out = [0, 0, 0, 0];
  if (!Array.isArray(arr)) return out;
  for (let i = 0; i < AGENT_SLOTS; i++) {
    out[i] = clampFloat(arr[i], 0, 1e6, 0);
  }
  return out;
}

function sanitizeExpedition(exp) {
  if (!exp || typeof exp !== 'object') {
    return { ...DEFAULT_EXPEDITION };
  }
  return {
    clearedMask: clampInt(exp.clearedMask, 0, MAX_EXPEDITION_MASK, 0),
    bagMask: clampInt(exp.bagMask, 0, MAX_EXPEDITION_MASK, 0),
    secretUnlocked: Boolean(exp.secretUnlocked),
    secretBest: clampInt(exp.secretBest, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

function inferTierFromGridSize(gridSize) {
  if (gridSize <= 8) return 1;
  if (gridSize <= 12) return 2;
  if (gridSize <= 16) return 3;
  if (gridSize <= 20) return 4;
  if (gridSize <= 24) return 5;
  return 6;
}

/**
 * Builds a sanitized canonical campaign record (without `sig`) from arbitrary caller state.
 * @param {Record<string, any>} inputState
 * @param {number} [nowMs]
 * @returns {Record<string, any>}
 */
export function buildCanonicalCampaignRecord(inputState, nowMs = Date.now()) {
  const src = inputState && typeof inputState === 'object' ? inputState : {};
  const safeNow = typeof nowMs === 'number' && Number.isFinite(nowMs) && nowMs >= 0
    ? Math.trunc(nowMs)
    : Date.now();

  let layout = null;
  if (src.layout && typeof src.layout === 'object' && Array.isArray(src.layout.cells)) {
    const gridSize = clampInt(src.layout.gridSize ?? Math.sqrt(src.layout.cells.length), MIN_GRID_DIM, MAX_GRID_DIM, MIN_GRID_DIM);
    const expected = gridSize * gridSize;
    if (src.layout.cells.length === expected) {
      const agents = sanitizeAgentsArray(src.agents ?? src.layout.agents);
      const tier = clampInt(src.tier ?? src.layout.tier, MIN_TIER, MAX_TIER, inferTierFromGridSize(gridSize));
      const cells = new Array(expected);
      for (let i = 0; i < expected; i++) {
        cells[i] = sanitizeCell(src.layout.cells[i]);
      }
      layout = { gridSize, tier, agents, cells };
    }
  }

  if (!layout && typeof src.bp === 'string') {
    const decoded = decodeBlueprint(src.bp);
    if (decoded.ok) {
      const agents = sanitizeAgentsArray(src.agents ?? decoded.agents);
      const tier = clampInt(src.tier, MIN_TIER, MAX_TIER, decoded.tier);
      layout = {
        gridSize: decoded.gridSize,
        tier,
        agents,
        cells: decoded.cells,
      };
    }
  }

  if (!layout) {
    const gridSize = MIN_GRID_DIM;
    const tier = clampInt(src.tier, MIN_TIER, MAX_TIER, 1);
    const agents = sanitizeAgentsArray(src.agents);
    layout = {
      gridSize,
      tier,
      agents,
      cells: createEmptyCells(gridSize),
    };
  }

  const bp = encodeBlueprint(layout);
  const audioSrc = src.audio && typeof src.audio === 'object' ? src.audio : src;

  return {
    v: 1,
    tClose: safeNow,
    tier: layout.tier,
    dies: bsSanitize(src.dies),
    flops: bsSanitize(src.flops),
    lifetimeFlops: bsSanitize(src.lifetimeFlops),
    shards: clampFloat(src.shards, 0, Number.MAX_SAFE_INTEGER, 0),
    hwmDiesPerMin: clampFloat(src.hwmDiesPerMin ?? src.hwm, 0, Number.MAX_VALUE, 0),
    fleetLevel: clampInt(src.fleetLevel ?? src.fleetLvl, 0, MAX_FLEET_LEVEL, 1),
    prestige: sanitizePrestigeArray(src.prestige ?? src.prestigeLevels),
    agents: [...layout.agents],
    entropies: sanitizeEntropiesArray(src.entropies),
    paperclips: clampFloat(src.paperclips, 0, Number.MAX_SAFE_INTEGER, 0),
    audio: {
      vol: clampFloat(audioSrc.vol, 0, 1, 0.6),
      mute: Boolean(audioSrc.mute),
    },
    expedition: sanitizeExpedition(src.expedition),
    layout,
    bp,
  };
}

/**
 * Strictly validates a parsed primary campaign JSON object (signature + full schema).
 * @param {any} raw
 * @returns {{ ok: true, state: Record<string, any> } | { ok: false, error: string }}
 */
export function validatePrimarySaveRecord(raw) {
  if (!isPlainObject(raw)) {
    return { ok: false, error: 'Save root must be a plain object' };
  }
  if (raw.v !== 1) {
    return { ok: false, error: `Unsupported save version: ${String(raw.v)}` };
  }
  if (!verifyPayload(raw)) {
    return { ok: false, error: 'Invalid or tampered save signature' };
  }

  if (typeof raw.tClose !== 'number' || !Number.isFinite(raw.tClose) || raw.tClose < 0) {
    return { ok: false, error: 'Invalid tClose timestamp' };
  }
  if (!Number.isInteger(raw.tier) || raw.tier < MIN_TIER || raw.tier > MAX_TIER) {
    return { ok: false, error: 'Invalid tier' };
  }
  if (!bsIsValid(raw.dies) || !bsIsValid(raw.flops) || !bsIsValid(raw.lifetimeFlops)) {
    return { ok: false, error: 'Invalid BigSilicon currency fields' };
  }
  if (typeof raw.shards !== 'number' || !Number.isFinite(raw.shards) || raw.shards < 0) {
    return { ok: false, error: 'Invalid shards count' };
  }
  if (typeof raw.hwmDiesPerMin !== 'number' || !Number.isFinite(raw.hwmDiesPerMin) || raw.hwmDiesPerMin < 0) {
    return { ok: false, error: 'Invalid hwmDiesPerMin' };
  }
  if (!Number.isInteger(raw.fleetLevel) || raw.fleetLevel < 0 || raw.fleetLevel > MAX_FLEET_LEVEL) {
    return { ok: false, error: 'Invalid fleetLevel' };
  }

  if (!Array.isArray(raw.prestige) || raw.prestige.length !== PRESTIGE_SLOTS) {
    return { ok: false, error: 'Invalid prestige array' };
  }
  for (let i = 0; i < PRESTIGE_SLOTS; i++) {
    const p = raw.prestige[i];
    if (!Number.isInteger(p) || p < 0 || p > MAX_PRESTIGE_LEVEL) {
      return { ok: false, error: `Invalid prestige node level at ${i}` };
    }
  }

  if (!Array.isArray(raw.agents) || raw.agents.length !== AGENT_SLOTS) {
    return { ok: false, error: 'Invalid agents array' };
  }
  for (let i = 0; i < AGENT_SLOTS; i++) {
    const a = raw.agents[i];
    if (!Number.isInteger(a) || a < -1 || a > 5) {
      return { ok: false, error: `Invalid agent at slot ${i}` };
    }
  }

  if (!Array.isArray(raw.entropies) || raw.entropies.length !== AGENT_SLOTS) {
    return { ok: false, error: 'Invalid entropies array' };
  }
  for (let i = 0; i < AGENT_SLOTS; i++) {
    const en = raw.entropies[i];
    if (typeof en !== 'number' || !Number.isFinite(en) || en < 0) {
      return { ok: false, error: `Invalid entropy at slot ${i}` };
    }
  }

  if (typeof raw.paperclips !== 'number' || !Number.isFinite(raw.paperclips) || raw.paperclips < 0) {
    return { ok: false, error: 'Invalid paperclips count' };
  }

  if (!isPlainObject(raw.audio) || typeof raw.audio.vol !== 'number' || !Number.isFinite(raw.audio.vol) || raw.audio.vol < 0 || raw.audio.vol > 1 || typeof raw.audio.mute !== 'boolean') {
    return { ok: false, error: 'Invalid audio state' };
  }

  let expedition = { ...DEFAULT_EXPEDITION };
  if (raw.expedition !== undefined) {
    if (!isPlainObject(raw.expedition)) {
      return { ok: false, error: 'Invalid expedition object' };
    }
    const { clearedMask, bagMask, secretUnlocked, secretBest } = raw.expedition;
    if (!Number.isInteger(clearedMask) || clearedMask < 0 || clearedMask > MAX_EXPEDITION_MASK) {
      return { ok: false, error: 'Invalid expedition.clearedMask' };
    }
    if (!Number.isInteger(bagMask) || bagMask < 0 || bagMask > MAX_EXPEDITION_MASK) {
      return { ok: false, error: 'Invalid expedition.bagMask' };
    }
    if (typeof secretUnlocked !== 'boolean') {
      return { ok: false, error: 'Invalid expedition.secretUnlocked' };
    }
    if (!Number.isSafeInteger(secretBest) || secretBest < 0) {
      return { ok: false, error: 'Invalid expedition.secretBest' };
    }
    expedition = { clearedMask, bagMask, secretUnlocked, secretBest };
  }

  if (typeof raw.bp !== 'string') {
    return { ok: false, error: 'Missing blueprint string' };
  }
  const decoded = decodeBlueprint(raw.bp);
  if (!decoded.ok) {
    return { ok: false, error: `Invalid blueprint: ${decoded.error}` };
  }
  if (decoded.tier !== raw.tier) {
    return { ok: false, error: 'Blueprint tier does not match save tier' };
  }
  for (let i = 0; i < AGENT_SLOTS; i++) {
    if (decoded.agents[i] !== raw.agents[i]) {
      return { ok: false, error: 'Blueprint agents do not match save agents' };
    }
  }

  if (raw.layout !== undefined) {
    if (!isPlainObject(raw.layout)) {
      return { ok: false, error: 'Invalid layout object' };
    }
    if (raw.layout.gridSize !== decoded.gridSize || raw.layout.tier !== decoded.tier) {
      return { ok: false, error: 'Layout metadata diverges from blueprint' };
    }
    if (raw.layout.agents !== undefined) {
      if (!Array.isArray(raw.layout.agents) || raw.layout.agents.length !== AGENT_SLOTS) {
        return { ok: false, error: 'Invalid layout.agents array' };
      }
      for (let i = 0; i < AGENT_SLOTS; i++) {
        if (raw.layout.agents[i] !== decoded.agents[i]) {
          return { ok: false, error: 'Layout agents diverge from blueprint' };
        }
      }
    }
    if (!Array.isArray(raw.layout.cells) || raw.layout.cells.length !== decoded.gridSize * decoded.gridSize) {
      return { ok: false, error: 'Layout cells length mismatch' };
    }
    for (let i = 0; i < raw.layout.cells.length; i++) {
      const rc = raw.layout.cells[i];
      const dc = decoded.cells[i];
      if (!rc || typeof rc !== 'object') {
        return { ok: false, error: `Invalid cell at index ${i}` };
      }
      const rt = rc.machineType ?? rc.type;
      const rd = rc.machineDir ?? rc.dir ?? 0;
      const rs = rc.machineSub ?? rc.sub ?? 0;
      if (
        rt !== dc.machineType ||
        rd !== dc.machineDir ||
        rs !== dc.machineSub ||
        (rc.ln2Mask ?? 0) !== dc.ln2Mask ||
        (rc.powerMask ?? 0) !== dc.powerMask ||
        (rc.shuttleWaypoint ?? 0) !== dc.shuttleWaypoint
      ) {
        return { ok: false, error: `Layout cell ${i} diverges from blueprint` };
      }
    }
  }

  const sanitized = {
    v: 1,
    tClose: raw.tClose,
    tier: raw.tier,
    dies: { m: raw.dies.m, e: raw.dies.e },
    flops: { m: raw.flops.m, e: raw.flops.e },
    lifetimeFlops: { m: raw.lifetimeFlops.m, e: raw.lifetimeFlops.e },
    shards: raw.shards,
    hwmDiesPerMin: raw.hwmDiesPerMin,
    fleetLevel: raw.fleetLevel,
    prestige: [...raw.prestige],
    agents: [...raw.agents],
    entropies: [...raw.entropies],
    paperclips: raw.paperclips,
    audio: { vol: raw.audio.vol, mute: raw.audio.mute },
    expedition,
    layout: {
      gridSize: decoded.gridSize,
      tier: decoded.tier,
      agents: [...decoded.agents],
      cells: decoded.cells,
    },
    bp: raw.bp,
    sig: raw.sig,
  };

  return { ok: true, state: sanitized };
}

function validateAndDecodeCookie(rawCookieVal) {
  if (typeof rawCookieVal !== 'string' || rawCookieVal.length === 0) {
    return null;
  }
  let parsed;
  try {
    const jsonStr = base64UrlToUtf8(rawCookieVal);
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed) || parsed.v !== 1 || !verifyPayload(parsed)) {
    return null;
  }

  if (typeof parsed.tClose !== 'number' || !Number.isFinite(parsed.tClose) || parsed.tClose < 0) {
    return null;
  }
  if (!Number.isInteger(parsed.tier) || parsed.tier < MIN_TIER || parsed.tier > MAX_TIER) {
    return null;
  }
  if (!bsIsValid(parsed.dies) || !bsIsValid(parsed.flops) || !bsIsValid(parsed.lifetimeFlops)) {
    return null;
  }
  if (typeof parsed.shards !== 'number' || !Number.isFinite(parsed.shards) || parsed.shards < 0) {
    return null;
  }
  if (typeof parsed.hwm !== 'number' || !Number.isFinite(parsed.hwm) || parsed.hwm < 0) {
    return null;
  }
  if (!Number.isInteger(parsed.fleetLvl) || parsed.fleetLvl < 0 || parsed.fleetLvl > MAX_FLEET_LEVEL) {
    return null;
  }
  if (!Array.isArray(parsed.prestige) || parsed.prestige.length !== PRESTIGE_SLOTS) {
    return null;
  }
  for (let i = 0; i < PRESTIGE_SLOTS; i++) {
    if (!Number.isInteger(parsed.prestige[i]) || parsed.prestige[i] < 0 || parsed.prestige[i] > MAX_PRESTIGE_LEVEL) {
      return null;
    }
  }
  if (!Array.isArray(parsed.agents) || parsed.agents.length !== AGENT_SLOTS) {
    return null;
  }
  for (let i = 0; i < AGENT_SLOTS; i++) {
    if (!Number.isInteger(parsed.agents[i]) || parsed.agents[i] < -1 || parsed.agents[i] > 5) {
      return null;
    }
  }
  if (typeof parsed.vol !== 'number' || !Number.isFinite(parsed.vol) || parsed.vol < 0 || parsed.vol > 1) {
    return null;
  }
  if (typeof parsed.mute !== 'boolean') {
    return null;
  }

  let expedition = { ...DEFAULT_EXPEDITION };
  if (parsed.xp !== undefined) {
    if (!Array.isArray(parsed.xp) || parsed.xp.length !== 4) {
      return null;
    }
    const [clearedMask, bagMask, secretFlag, secretBest] = parsed.xp;
    if (!Number.isInteger(clearedMask) || clearedMask < 0 || clearedMask > MAX_EXPEDITION_MASK) {
      return null;
    }
    if (!Number.isInteger(bagMask) || bagMask < 0 || bagMask > MAX_EXPEDITION_MASK) {
      return null;
    }
    if (secretFlag !== 0 && secretFlag !== 1) {
      return null;
    }
    if (!Number.isSafeInteger(secretBest) || secretBest < 0) {
      return null;
    }
    expedition = {
      clearedMask,
      bagMask,
      secretUnlocked: secretFlag === 1,
      secretBest,
    };
  }

  if (typeof parsed.bp !== 'string') {
    return null;
  }

  const decoded = decodeBlueprint(parsed.bp);
  if (!decoded.ok || decoded.tier !== parsed.tier) {
    return null;
  }
  for (let i = 0; i < AGENT_SLOTS; i++) {
    if (decoded.agents[i] !== parsed.agents[i]) {
      return null;
    }
  }

  const reconstructed = {
    v: 1,
    tClose: parsed.tClose,
    tier: parsed.tier,
    dies: { m: parsed.dies.m, e: parsed.dies.e },
    flops: { m: parsed.flops.m, e: parsed.flops.e },
    lifetimeFlops: { m: parsed.lifetimeFlops.m, e: parsed.lifetimeFlops.e },
    shards: parsed.shards,
    hwmDiesPerMin: parsed.hwm,
    fleetLevel: parsed.fleetLvl,
    prestige: [...parsed.prestige],
    agents: [...decoded.agents],
    entropies: [0, 0, 0, 0],
    paperclips: 0,
    audio: { vol: parsed.vol, mute: parsed.mute },
    expedition,
    layout: {
      gridSize: decoded.gridSize,
      tier: decoded.tier,
      agents: [...decoded.agents],
      cells: decoded.cells,
    },
    bp: parsed.bp,
  };

  return signPayload(reconstructed);
}

function buildEncodedCookieString(primaryState) {
  const exp = sanitizeExpedition(primaryState.expedition);
  const cookieRecord = {
    v: 1,
    tClose: primaryState.tClose,
    tier: primaryState.tier,
    dies: primaryState.dies,
    flops: primaryState.flops,
    lifetimeFlops: primaryState.lifetimeFlops,
    shards: primaryState.shards,
    hwm: primaryState.hwmDiesPerMin,
    fleetLvl: primaryState.fleetLevel,
    prestige: primaryState.prestige,
    agents: primaryState.agents,
    vol: Math.round(primaryState.audio.vol * 1000) / 1000,
    mute: primaryState.audio.mute,
    xp: [exp.clearedMask, exp.bagMask, exp.secretUnlocked ? 1 : 0, exp.secretBest],
    bp: primaryState.bp,
  };
  const signed = signPayload(cookieRecord);
  return utf8ToBase64Url(JSON.stringify(signed));
}

function parseCookieHeader(cookieHeader, targetName) {
  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0) return null;
  const parts = cookieHeader.split(';');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (name !== targetName) continue;
    const rawVal = part.slice(eq + 1).trim();
    if (!rawVal) return null;
    try {
      return decodeURIComponent(rawVal);
    } catch {
      return rawVal;
    }
  }
  return null;
}

function resolveLocalStorageAdapter(adapter) {
  if (adapter && 'localStorage' in adapter) {
    return adapter.localStorage ?? null;
  }
  try {
    return globalThis.window?.localStorage ?? globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function resolveCookieStoreAdapter(adapter) {
  const raw = (adapter && 'cookieStore' in adapter)
    ? adapter.cookieStore
    : (typeof globalThis.document === 'object' && globalThis.document !== null ? globalThis.document : null);

  if (!raw) return null;

  if (typeof raw.getCookie === 'function' && typeof raw.setCookie === 'function') {
    return {
      get: (name) => {
        try { return raw.getCookie(name) ?? null; } catch { return null; }
      },
      set: (name, value) => {
        try { raw.setCookie(name, value, 31536000); return true; } catch { return false; }
      },
      remove: (name) => {
        try {
          if (typeof raw.removeCookie === 'function') raw.removeCookie(name);
          else if (typeof raw.deleteCookie === 'function') raw.deleteCookie(name);
          else raw.setCookie(name, '', 0);
        } catch {
          // ignore
        }
      },
    };
  }

  if (typeof raw.getItem === 'function' && typeof raw.setItem === 'function') {
    return {
      get: (name) => {
        try { return raw.getItem(name) ?? null; } catch { return null; }
      },
      set: (name, value) => {
        try { raw.setItem(name, value); return true; } catch { return false; }
      },
      remove: (name) => {
        try {
          if (typeof raw.removeItem === 'function') raw.removeItem(name);
          else raw.setItem(name, '');
        } catch {
          // ignore
        }
      },
    };
  }

  if (typeof raw.get === 'function' && typeof raw.set === 'function') {
    return {
      get: (name) => {
        try { return raw.get(name) ?? null; } catch { return null; }
      },
      set: (name, value) => {
        try { raw.set(name, value); return true; } catch { return false; }
      },
      remove: (name) => {
        try {
          if (typeof raw.delete === 'function') raw.delete(name);
          else if (typeof raw.remove === 'function') raw.remove(name);
          else raw.set(name, '');
        } catch {
          // ignore
        }
      },
    };
  }

  if ('cookie' in raw) {
    return {
      get: (name) => {
        try { return parseCookieHeader(raw.cookie, name); } catch { return null; }
      },
      set: (name, value) => {
        try {
          raw.cookie = `${name}=${value}; max-age=31536000; path=/; SameSite=Lax`;
          return true;
        } catch {
          return false;
        }
      },
      remove: (name) => {
        try {
          raw.cookie = `${name}=; max-age=0; path=/; SameSite=Lax`;
        } catch {
          // ignore
        }
      },
    };
  }

  return null;
}

function resolveIndexedDbAdapter(adapter) {
  if (adapter && ('indexedDb' in adapter || 'indexedDB' in adapter)) {
    return adapter.indexedDb ?? adapter.indexedDB ?? null;
  }
  try {
    return globalThis.indexedDB ?? null;
  } catch {
    return null;
  }
}

function writeIndexedDbBestEffort(idb, key, value) {
  if (!idb) return;
  try {
    if (typeof idb.put === 'function') {
      Promise.resolve(idb.put(key, value)).catch(() => {});
      return;
    }
    if (typeof idb.setItem === 'function') {
      Promise.resolve(idb.setItem(key, value)).catch(() => {});
      return;
    }
    if (typeof idb.set === 'function') {
      Promise.resolve(idb.set(key, value)).catch(() => {});
      return;
    }
    if (typeof idb.open === 'function') {
      const req = idb.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => {
        try {
          const db = req.result;
          const tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put(value, key);
          tx.oncomplete = () => db.close?.();
        } catch {
          // ignore best-effort mirror failure
        }
      };
      req.onerror = () => {};
    }
  } catch {
    // ignore best-effort mirror failure
  }
}

function statesEquivalent(primaryState, cookieState) {
  const pe = primaryState.expedition ?? DEFAULT_EXPEDITION;
  const ce = cookieState.expedition ?? DEFAULT_EXPEDITION;
  return (
    bsCmp(primaryState.lifetimeFlops, cookieState.lifetimeFlops) === 0 &&
    primaryState.tClose === cookieState.tClose &&
    primaryState.bp === cookieState.bp &&
    bsCmp(primaryState.dies, cookieState.dies) === 0 &&
    primaryState.shards === cookieState.shards &&
    pe.clearedMask === ce.clearedMask &&
    pe.bagMask === ce.bagMask &&
    Boolean(pe.secretUnlocked) === Boolean(ce.secretUnlocked) &&
    pe.secretBest === ce.secretBest
  );
}

/**
 * Bidirectional self-healing persistence engine across LocalStorage, IndexedDB,
 * and `krunked-cookie-vault-v1` shadow cookie.
 */
export class CookieVault {
  /**
   * @param {{ localStorage?: any, cookieStore?: any, indexedDb?: any, indexedDB?: any }} [adapter]
   */
  constructor(adapter = {}) {
    this._ls = resolveLocalStorageAdapter(adapter);
    this._cookie = resolveCookieStoreAdapter(adapter);
    this._idb = resolveIndexedDbAdapter(adapter);
  }

  _readPrimaryRaw() {
    if (!this._ls) return null;
    try {
      return this._ls.getItem(PRIMARY_SAVE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  _writePrimary(signedState) {
    const json = JSON.stringify(signedState);
    const primaryBytes = textEncoder.encode(json).length;
    let written = false;
    if (this._ls) {
      try {
        this._ls.setItem(PRIMARY_SAVE_KEY, json);
        written = true;
      } catch {
        written = false;
      }
    }
    writeIndexedDbBestEffort(this._idb, IDB_KEY, json);
    return { written, primaryBytes };
  }

  _writeCookie(signedState) {
    const encoded = buildEncodedCookieString(signedState);
    const cookieBytes = textEncoder.encode(`${COOKIE_VAULT_NAME}=${encoded}`).length;
    let written = false;
    if (this._cookie && cookieBytes <= 4096) {
      written = this._cookie.set(COOKIE_VAULT_NAME, encoded);
    }
    return { written, cookieBytes };
  }

  /**
   * Signs and saves full campaign state to primary LocalStorage, IndexedDB mirror,
   * and the compact `krunked-cookie-vault-v1` shadow cookie.
   * @param {Record<string, any>} fullState
   * @param {number} [nowMs]
   * @returns {{ ok: boolean, cookieBytes: number, primaryBytes: number }}
   */
  saveCampaign(fullState, nowMs = Date.now()) {
    const canonical = buildCanonicalCampaignRecord(fullState, nowMs);
    const signedPrimary = signPayload(canonical);

    const { written: primaryOk, primaryBytes } = this._writePrimary(signedPrimary);
    const { written: cookieOk, cookieBytes } = this._writeCookie(signedPrimary);

    return {
      ok: Boolean(primaryOk || cookieOk),
      cookieBytes,
      primaryBytes,
    };
  }

  /**
   * Reads & verifies primary LocalStorage and shadow cookie, performing
   * bidirectional self-healing and anti-tamper arbitration automatically.
   * @param {number} [nowMs]
   * @returns {{
   *   state: Record<string, any> | null,
   *   source: 'localStorage' | 'cookie' | 'fresh',
   *   selfHealed: boolean,
   *   healedFrom?: 'cookie' | 'localStorage',
   *   cookieRegenerated: boolean
   * }}
   */
  hydrateCampaign(nowMs = Date.now()) {
    const safeNow = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();

    let primaryState = null;
    const rawPrimaryJson = this._readPrimaryRaw();
    if (typeof rawPrimaryJson === 'string' && rawPrimaryJson.length > 0) {
      try {
        const parsed = JSON.parse(rawPrimaryJson);
        const check = validatePrimarySaveRecord(parsed);
        if (check.ok) {
          primaryState = check.state;
        }
      } catch {
        primaryState = null;
      }
    }

    const rawCookieVal = this._cookie ? this._cookie.get(COOKIE_VAULT_NAME) : null;
    const cookieState = validateAndDecodeCookie(rawCookieVal);

    if (!primaryState && !cookieState) {
      return {
        state: null,
        source: 'fresh',
        selfHealed: false,
        cookieRegenerated: false,
      };
    }

    if (!primaryState && cookieState) {
      this._writePrimary(cookieState);
      return {
        state: cookieState,
        source: 'cookie',
        selfHealed: true,
        healedFrom: 'cookie',
        cookieRegenerated: false,
      };
    }

    if (primaryState && !cookieState) {
      this._writeCookie(primaryState);
      return {
        state: primaryState,
        source: 'localStorage',
        selfHealed: false,
        healedFrom: 'localStorage',
        cookieRegenerated: true,
      };
    }

    // Both valid: reject forged future timestamps (> nowMs + 60s), else higher lifetimeFlops, else latest tClose.
    const futureLimit = safeNow + FUTURE_SKEW_TOLERANCE_MS;
    const primaryFuture = primaryState.tClose > futureLimit;
    const cookieFuture = cookieState.tClose > futureLimit;

    let winner = 'localStorage';
    if (primaryFuture && !cookieFuture) {
      winner = 'cookie';
    } else if (!primaryFuture && cookieFuture) {
      winner = 'localStorage';
    } else {
      const flopsCmp = bsCmp(primaryState.lifetimeFlops, cookieState.lifetimeFlops);
      if (flopsCmp < 0) {
        winner = 'cookie';
      } else if (flopsCmp > 0) {
        winner = 'localStorage';
      } else if (cookieState.tClose > primaryState.tClose) {
        winner = 'cookie';
      } else {
        winner = 'localStorage';
      }
    }

    if (winner === 'cookie') {
      this._writePrimary(cookieState);
      return {
        state: cookieState,
        source: 'cookie',
        selfHealed: true,
        healedFrom: 'cookie',
        cookieRegenerated: false,
      };
    }

    if (!statesEquivalent(primaryState, cookieState) || cookieFuture) {
      this._writeCookie(primaryState);
      return {
        state: primaryState,
        source: 'localStorage',
        selfHealed: false,
        healedFrom: 'localStorage',
        cookieRegenerated: true,
      };
    }

    return {
      state: primaryState,
      source: 'localStorage',
      selfHealed: false,
      cookieRegenerated: false,
    };
  }

  /**
   * Saves Daily Challenge state strictly under `DAILY_SAVE_KEY` without touching
   * campaign LocalStorage, IndexedDB, or `krunked-cookie-vault-v1`.
   * @param {Record<string, any>} dailyObj
   * @returns {boolean}
   */
  saveDailyState(dailyObj) {
    if (!this._ls || !dailyObj || typeof dailyObj !== 'object' || Array.isArray(dailyObj)) {
      return false;
    }
    try {
      const signed = signPayload({ ...dailyObj, v: 1 });
      this._ls.setItem(DAILY_SAVE_KEY, JSON.stringify(signed));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Loads and verifies Daily Challenge state strictly from `DAILY_SAVE_KEY`.
   * @returns {Record<string, any> | null}
   */
  loadDailyState() {
    if (!this._ls) return null;
    try {
      const raw = this._ls.getItem(DAILY_SAVE_KEY);
      if (typeof raw !== 'string' || raw.length === 0) return null;
      const parsed = JSON.parse(raw);
      if (!isPlainObject(parsed) || !verifyPayload(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Clears only the isolated Daily Challenge key.
   */
  clearDailyState() {
    if (!this._ls) return;
    try {
      this._ls.removeItem(DAILY_SAVE_KEY);
    } catch {
      // ignore
    }
  }

  /**
   * Clears campaign primary storage and shadow cookie.
   */
  clearCampaign() {
    if (this._ls) {
      try {
        this._ls.removeItem(PRIMARY_SAVE_KEY);
      } catch {
        // ignore
      }
    }
    if (this._cookie) {
      this._cookie.remove(COOKIE_VAULT_NAME);
    }
  }
}
