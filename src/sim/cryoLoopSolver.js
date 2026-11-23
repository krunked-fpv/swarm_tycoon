/**
 * Closed-Loop 77K LN2 Cryo-Thermodynamics Solver.
 * Identifies connected `ln2Mask` pipe components via BFS, detects closed cycles
 * (+25% flow bonus), solves exponential thermal relaxation toward steady-state
 * target Kelvin, updates thermal throttling/defect bands, and latches thermal
 * scrams with [320K, 390K] hysteresis.
 *
 * Pure ES Module: zero DOM, Phaser, storage, or Node-runtime dependencies.
 */

import { MACHINE_TYPES, MACHINE_CATALOG, DX, DY } from './gridEngine.js';

const MIN_KELVIN = 77.0;
const MAX_KELVIN = 1200.0;
const DEFAULT_AMBIENT_K = 295.0;
const DEFAULT_SCRAM_CEILING_K = 390.0;
const SCRAM_CLEAR_K = 320.0;
const PASSIVE_RISE_K_PER_KW = 22.0;
const RELAX_ALPHA = 1 - Math.exp(-0.1 / 2.5);

// Pre-allocated scratch buffers (zero GC inside hot tick loop)
const _visited = new Uint8Array(784);
const _queue = new Uint16Array(784);
const _compNodes = new Uint16Array(784);
const _targetTemp = new Float32Array(784);

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Solves one 10Hz cryo-thermal network & scram step.
 * @param {import('./gridEngine.js').GridState} state
 * @param {Record<string, any>} [mods]
 * @returns {{ avgKelvin: number, maxKelvin: number, minKelvin: number, scramCount: number, closedLoopCount: number }}
 */
export function stepCryoLoops(state, mods = {}) {
  const w = state.width;
  const count = w * w;
  const {
    machineType,
    ln2Mask,
    tempKelvin,
    scramActive,
    powerRatio,
    thermalMult,
    defectProb,
  } = state;

  const ambientK = Number.isFinite(mods.ambientK)
    ? clamp(mods.ambientK, MIN_KELVIN, MAX_KELVIN)
    : DEFAULT_AMBIENT_K;
  const scramCeilingK = Number.isFinite(mods.scramCeilingK)
    ? Math.max(340.0, mods.scramCeilingK)
    : DEFAULT_SCRAM_CEILING_K;
  const coolMult = Number.isFinite(mods.cryoMult) ? Math.max(0.1, mods.cryoMult) : 1.0;

  // Baseline passive steady-state temperature for cells without LN2 pipes
  for (let i = 0; i < count; i++) {
    _visited[i] = 0;
    const type = machineType[i];
    if (type <= MACHINE_TYPES.PILLAR || scramActive[i] === 1 || powerRatio[i] <= 0) {
      _targetTemp[i] = ambientK;
    } else if (type === MACHINE_TYPES.CRYO_CHILLER) {
      _targetTemp[i] = MIN_KELVIN;
    } else {
      const cat = MACHINE_CATALOG[type];
      const heatKw = cat ? cat.heatGenKw * powerRatio[i] : 0;
      _targetTemp[i] = clamp(ambientK + heatKw * PASSIVE_RISE_K_PER_KW, MIN_KELVIN, MAX_KELVIN);
    }
  }

  let closedLoopCount = 0;

  // Connected-component BFS across cells with bit 4 (0x10) pipe installed
  for (let i = 0; i < count; i++) {
    if (_visited[i] !== 0 || (ln2Mask[i] & 0x10) === 0) {
      continue;
    }

    let qHead = 0;
    let qTail = 0;
    let compLen = 0;
    let directedEdges = 0;
    let qCool = 0;
    let qGen = 0;
    let poweredHeatNodes = 0;

    _visited[i] = 1;
    _queue[qTail++] = i;

    while (qHead < qTail) {
      const u = _queue[qHead++];
      _compNodes[compLen++] = u;

      const uType = machineType[u];
      const uScram = scramActive[u];
      const uPower = powerRatio[u];

      if (uType > MACHINE_TYPES.PILLAR && uScram === 0 && uPower > 0) {
        const cat = MACHINE_CATALOG[uType];
        if (cat) {
          if (uType === MACHINE_TYPES.CRYO_CHILLER) {
            qCool += cat.coolKw * uPower * coolMult;
          } else if (cat.heatGenKw > 0) {
            qGen += cat.heatGenKw * uPower;
            poweredHeatNodes++;
          }
        }
      }

      const ux = u % w;
      const uy = (u / w) | 0;
      const mask = ln2Mask[u];

      for (let d = 0; d < 4; d++) {
        if ((mask & (1 << d)) === 0) {
          continue;
        }
        const nx = ux + DX[d];
        const ny = uy + DY[d];
        if (nx < 0 || nx >= w || ny < 0 || ny >= w) {
          continue;
        }
        const v = ny * w + nx;
        if ((ln2Mask[v] & 0x10) === 0) {
          continue;
        }
        directedEdges++;
        if (_visited[v] === 0) {
          _visited[v] = 1;
          _queue[qTail++] = v;
        }
      }
    }

    const undirectedEdges = directedEdges >> 1;
    const isClosedLoop = compLen >= 4 && undirectedEdges >= compLen;
    if (isClosedLoop) {
      closedLoopCount++;
    }
    const effectiveCool = isClosedLoop ? qCool * 1.25 : qCool;

    let compTargetK = ambientK;
    if (effectiveCool > 0) {
      if (qGen <= effectiveCool) {
        compTargetK = MIN_KELVIN + (ambientK - MIN_KELVIN) * (qGen / effectiveCool);
      } else {
        const excessKw = qGen - effectiveCool;
        compTargetK = ambientK + (excessKw * PASSIVE_RISE_K_PER_KW) / Math.max(1, poweredHeatNodes);
      }
    } else if (qGen > 0) {
      compTargetK = ambientK + (qGen * PASSIVE_RISE_K_PER_KW) / Math.max(1, poweredHeatNodes);
    }

    compTargetK = clamp(compTargetK, MIN_KELVIN, MAX_KELVIN);
    for (let k = 0; k < compLen; k++) {
      _targetTemp[_compNodes[k]] = compTargetK;
    }
  }

  let sumKelvin = 0;
  let maxKelvin = MIN_KELVIN;
  let minKelvin = MAX_KELVIN;
  let scramCount = 0;

  for (let i = 0; i < count; i++) {
    const tCurr = Number.isFinite(tempKelvin[i]) ? tempKelvin[i] : ambientK;
    const tTarget = clamp(_targetTemp[i], MIN_KELVIN, MAX_KELVIN);
    const tNext = clamp(tCurr + RELAX_ALPHA * (tTarget - tCurr), MIN_KELVIN, MAX_KELVIN);
    tempKelvin[i] = tNext;

    const type = machineType[i];
    if (type <= MACHINE_TYPES.PILLAR) {
      scramActive[i] = 0;
      thermalMult[i] = 1.0;
      defectProb[i] = 0.0;
    } else {
      if (tNext > scramCeilingK) {
        scramActive[i] = 1;
      } else if (tNext < SCRAM_CLEAR_K) {
        scramActive[i] = 0;
      }

      if (scramActive[i] === 1) {
        scramCount++;
        thermalMult[i] = 0.0;
        defectProb[i] = 0.45;
      } else if (tNext < 285.0) {
        thermalMult[i] = 1.15;
        defectProb[i] = 0.0;
      } else if (tNext <= 335.0) {
        thermalMult[i] = 1.0;
        defectProb[i] = 0.0;
      } else {
        const span = Math.max(1.0, scramCeilingK - 335.0);
        const ratio = Math.min(1.0, (tNext - 335.0) / span);
        thermalMult[i] = 1.0 - 0.8 * ratio;
        defectProb[i] = 0.45 * ratio;
      }
    }

    sumKelvin += tNext;
    if (tNext > maxKelvin) maxKelvin = tNext;
    if (tNext < minKelvin) minKelvin = tNext;
  }

  const avgKelvin = count > 0 ? sumKelvin / count : ambientK;

  return {
    avgKelvin: Number(avgKelvin.toFixed(4)),
    maxKelvin: Number((count > 0 ? maxKelvin : ambientK).toFixed(4)),
    minKelvin: Number((count > 0 ? minKelvin : ambientK).toFixed(4)),
    scramCount,
    closedLoopCount,
  };
}
