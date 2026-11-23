/**
 * Deterministic Daily Challenge Seed Generator (`IDEA00438-YYYY-MM-DD`).
 * Uses SplitMix32 PRNG and FNV-1a string hashing with BFS flood-fill
 * connectivity verification on a 12x12 cleanroom grid.
 *
 * Pure ES Module: zero DOM, Phaser, storage, or Node-runtime dependencies.
 */

const DAILY_GRID_SIZE = 12;
const DAILY_CELLS = DAILY_GRID_SIZE * DAILY_GRID_SIZE;
const DAILY_DURATION_SEC = 900;

// Pre-allocated scratch buffers for flood-fill connectivity verification
const _blocked = new Uint8Array(DAILY_CELLS);
const _visited = new Uint8Array(DAILY_CELLS);
const _bfsQueue = new Uint16Array(DAILY_CELLS);
const _dx = [0, 1, 0, -1];
const _dy = [-1, 0, 1, 0];

/**
 * Deterministic 32-bit SplitMix PRNG returning uniform floats in [0, 1).
 * @param {number} seedInt
 * @returns {() => number}
 */
export function splitMix32(seedInt) {
  let state = seedInt >>> 0;
  return function nextRandom() {
    state = (state + 0x9e3779b9) | 0;
    let z = state ^ (state >>> 16);
    z = Math.imul(z, 0x21f0aaad);
    z = z ^ (z >>> 15);
    z = Math.imul(z, 0x735a2d97);
    z = z ^ (z >>> 15);
    return (z >>> 0) / 4294967296;
  };
}

/**
 * Deterministic 32-bit FNV-1a hash of an arbitrary string.
 * @param {string} str
 * @returns {number} Unsigned 32-bit integer
 */
export function hashSeedString(str) {
  const s = String(str);
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Returns today's UTC date string formatted as `YYYY-MM-DD`.
 * @returns {string}
 */
export function todayUtcStr() {
  return new Date().toISOString().slice(0, 10);
}

/** Alias matching SPEC 3.4 signature. */
export const todayUtc = todayUtcStr;

/**
 * Verifies via BFS from (0, 0) that all non-pillar open floor tiles
 * (including (11, 11)) form a single connected region.
 * @param {number} pillarCount
 * @returns {boolean}
 */
function isFloorFullyConnected(pillarCount) {
  if (_blocked[0] !== 0 || _blocked[DAILY_CELLS - 1] !== 0) {
    return false;
  }

  _visited.fill(0);
  let head = 0;
  let tail = 0;
  _visited[0] = 1;
  _bfsQueue[tail++] = 0;

  while (head < tail) {
    const curr = _bfsQueue[head++];
    const cx = curr % DAILY_GRID_SIZE;
    const cy = (curr / DAILY_GRID_SIZE) | 0;

    for (let d = 0; d < 4; d++) {
      const nx = cx + _dx[d];
      const ny = cy + _dy[d];
      if (nx < 0 || nx >= DAILY_GRID_SIZE || ny < 0 || ny >= DAILY_GRID_SIZE) {
        continue;
      }
      const nIdx = ny * DAILY_GRID_SIZE + nx;
      if (_blocked[nIdx] === 0 && _visited[nIdx] === 0) {
        _visited[nIdx] = 1;
        _bfsQueue[tail++] = nIdx;
      }
    }
  }

  return tail === DAILY_CELLS - pillarCount && _visited[DAILY_CELLS - 1] === 1;
}

/**
 * Generates a deterministic daily cleanroom challenge from a UTC date string.
 * @param {string} [utcDateStr]
 */
export function generateDailyChallenge(utcDateStr = todayUtcStr()) {
  const dateStr = String(utcDateStr || todayUtcStr()).slice(0, 10);
  const seedId = `IDEA00438-${dateStr}`;
  const rng = splitMix32(hashSeedString(seedId));

  const targetPillars = 6 + Math.floor(rng() * 5); // 6..10 pillars
  const pillars = [];
  _blocked.fill(0);

  let attempts = 0;
  while (pillars.length < targetPillars && attempts < 400) {
    attempts++;
    const x = Math.floor(rng() * DAILY_GRID_SIZE);
    const y = Math.floor(rng() * DAILY_GRID_SIZE);
    // Keep substation anchor (0,0), (1,0), (0,1) and far corner (11,11) open
    if ((x === 0 && y === 0) || (x === 1 && y === 0) || (x === 0 && y === 1) || (x === 11 && y === 11)) {
      continue;
    }
    const idx = y * DAILY_GRID_SIZE + x;
    if (_blocked[idx] !== 0) {
      continue;
    }

    _blocked[idx] = 1;
    if (isFloorFullyConnected(pillars.length + 1)) {
      pillars.push({ x, y });
    } else {
      _blocked[idx] = 0;
    }
  }

  const powerMult = Number((0.85 + Math.floor(rng() * 31) * 0.01).toFixed(2));
  const ambientK = 290 + Math.floor(rng() * 26); // 290..315 K
  const defectBias = Number((Math.floor(rng() * 9) * 0.01).toFixed(2)); // 0.00..0.08
  const targetScore = 1200 + Math.floor(rng() * 1200); // 1200..2399

  return {
    seedId,
    dateStr,
    gridSize: DAILY_GRID_SIZE,
    pillars,
    modifiers: {
      powerMult,
      ambientK,
      defectBias,
      targetScore,
    },
    durationSec: DAILY_DURATION_SEC,
  };
}

/**
 * Computes deterministic efficiency score for a daily challenge run.
 * @param {{ vaultedGood?: number, avgKelvin?: number, brownoutTicks?: number, elapsedSec?: number, totalBackpressure?: number }} metrics
 * @returns {number}
 */
export function computeDailyEfficiencyScore(metrics = {}) {
  const vaultedGood = Math.max(0, Number(metrics.vaultedGood) || 0);
  const avgKelvin = Number.isFinite(metrics.avgKelvin) ? metrics.avgKelvin : 295;
  const brownoutTicks = Math.max(0, Number(metrics.brownoutTicks) || 0);
  const elapsedSec = Math.max(0, Number(metrics.elapsedSec) || 0);
  const totalBackpressure = Math.max(0, Number(metrics.totalBackpressure) || 0);

  if (vaultedGood === 0) {
    return 0;
  }

  const yieldScore = vaultedGood * 50;
  const cryoBonus = avgKelvin < 285 ? Math.round((285 - avgKelvin) * 2) : 0;
  const thermalPenalty = avgKelvin > 335 ? Math.round((avgKelvin - 335) * 5) : 0;
  const brownoutPenalty = brownoutTicks * 5;
  const backpressurePenalty = Math.floor(totalBackpressure * 0.5);
  const paceBonus = Math.round((vaultedGood / Math.max(10, elapsedSec)) * 500);

  const rawScore =
    yieldScore + cryoBonus + paceBonus - thermalPenalty - brownoutPenalty - backpressurePenalty;

  return Math.max(0, Math.round(rawScore));
}
