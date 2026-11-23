/**
 * Factorio-Grade Directional Cleanroom Conveyor & Processing Router.
 * Executes deterministic O(N) 3-color graph traversal + synchronous closed-cycle
 * rotation with zero heap allocations inside the 10Hz hot loop.
 *
 * Pure ES Module: zero DOM, Phaser, storage, or Node-runtime dependencies.
 */

import { MACHINE_TYPES, WAFER_STATES, MACHINE_CATALOG, DX, DY } from './gridEngine.js';

// Pre-allocated scratch TypedArrays (zero GC inside hot tick loop)
const _canOperate = new Uint8Array(784);
const _wantsMove = new Uint8Array(784);
const _target = new Int16Array(784);
const _chosenCand = new Int8Array(784);
const _winnerIn = new Int16Array(784);
const _winnerOffset = new Int8Array(784);
const _winnerOut = new Int16Array(784);
const _color = new Uint8Array(784);
const _pathStack = new Uint16Array(784);
const _movedOut = new Uint8Array(784);
const _movedIn = new Uint8Array(784);

function rollDefect(state, cellIdx, mods) {
  const bias = Number.isFinite(mods.defectBias) ? Math.max(0, mods.defectBias) : 0;
  const prob = state.defectProb[cellIdx] + bias;
  if (prob <= 0) return false;
  if (prob >= 1) return true;

  let x = state.seedState | 0;
  if (x === 0) x = 0x6d2b79f5;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  state.seedState = x >>> 0;
  return (state.seedState / 4294967296) < prob;
}

function canCellAcceptFrom(state, v, fromDir, waferType) {
  const vType = state.machineType[v];
  if (
    vType === MACHINE_TYPES.EMPTY ||
    vType === MACHINE_TYPES.PILLAR ||
    vType === MACHINE_TYPES.INGOT_SLICER ||
    vType === MACHINE_TYPES.CRYO_CHILLER ||
    vType === MACHINE_TYPES.POWER_SOURCE ||
    vType === MACHINE_TYPES.CAPACITOR_BANK ||
    vType === MACHINE_TYPES.COMPUTE_RACK
  ) {
    return false;
  }

  const vDir = state.machineDir[v] & 3;
  const vSub = state.machineSub[v];
  const enterSide = (fromDir + 2) & 3;

  switch (vType) {
    case MACHINE_TYPES.BELT_STRAIGHT:
      return enterSide !== vDir;
    case MACHINE_TYPES.BELT_CORNER:
      return fromDir === vDir;
    case MACHINE_TYPES.BELT_SPLITTER:
      return fromDir === vDir;
    case MACHINE_TYPES.BELT_MERGER:
      return enterSide !== vDir;
    case MACHINE_TYPES.PHOTORESIST_COATER:
      return enterSide !== vDir && waferType === WAFER_STATES.RAW;
    case MACHINE_TYPES.EUV_SCANNER:
      return enterSide !== vDir && waferType === WAFER_STATES.COATED;
    case MACHINE_TYPES.PLASMA_ETCHER:
      return enterSide !== vDir && waferType === WAFER_STATES.EXPOSED;
    case MACHINE_TYPES.METROLOGY_QA:
      return enterSide !== vDir && enterSide !== ((vDir + 1) & 3);
    case MACHINE_TYPES.WAFER_VAULT:
    case MACHINE_TYPES.RECLAIM_GRINDER:
      return true;
    case MACHINE_TYPES.FOUP_DOCK:
      return vSub === 0;
    default:
      return false;
  }
}

function getFixedOutputDir(type, dir, sub, defective) {
  const d = dir & 3;
  if (type === MACHINE_TYPES.BELT_CORNER) {
    return sub === 1 ? (d + 3) & 3 : (d + 1) & 3;
  }
  if (type === MACHINE_TYPES.METROLOGY_QA) {
    return defective === 1 ? (d + 1) & 3 : d;
  }
  return d;
}

function getSplitterDir(baseDir, candIdx) {
  const d = baseDir & 3;
  if (candIdx === 0) return d;
  if (candIdx === 1) return (d + 1) & 3;
  return (d + 3) & 3;
}

function willProbeVacate(startTarget, splitterIdx, slotWafer, count) {
  let probe = startTarget;
  let steps = 0;
  const limit = Math.min(count, 64);
  while (probe !== -1 && steps < limit) {
    if (slotWafer[probe] === 0 || probe === splitterIdx) {
      return true;
    }
    probe = _target[probe];
    steps++;
  }
  return false;
}

/**
 * Steps conveyor routing and machine wafer processing for one 10Hz tick.
 * @param {import('./gridEngine.js').GridState} state
 * @param {Record<string, any>} [mods]
 * @returns {{ vaultedGood: number, vaultedProto: number, reclaimedCount: number, euvFlashes: number, completedWafers: number }}
 */
export function stepBeltsAndMachines(state, mods = {}) {
  const w = state.width;
  const count = w * w;
  const half = w >>> 1;

  const {
    machineType,
    machineDir,
    machineSub,
    slotWafer,
    slotDefective,
    slotProgress,
    backpressureTicks,
    scramActive,
    powerRatio,
    thermalMult,
    _splitterCursor,
    _mergerCursor,
  } = state;

  const globalSpeed = Number.isFinite(mods.speedMult) ? Math.max(0.1, mods.speedMult) : 1.0;
  const sectorArr = Array.isArray(mods.sectorSpeedMult) ? mods.sectorSpeedMult : null;
  const paperclipActive = Boolean(mods.paperclipActive);
  const hallucinationActive = Boolean(mods.hallucinationActive);

  let vaultedGood = 0;
  let vaultedProto = 0;
  let reclaimedCount = 0;
  let euvFlashes = 0;
  let completedWafers = 0;

  // Phase 1: Machine processing, belt advancement, and scratch reset
  for (let i = 0; i < count; i++) {
    _wantsMove[i] = 0;
    _target[i] = -1;
    _chosenCand[i] = -1;
    _winnerIn[i] = -1;
    _winnerOffset[i] = -1;
    _winnerOut[i] = -1;
    _color[i] = 0;
    _movedOut[i] = 0;
    _movedIn[i] = 0;

    const type = machineType[i];
    const operates = type > MACHINE_TYPES.PILLAR && scramActive[i] === 0 && powerRatio[i] > 0;
    _canOperate[i] = operates ? 1 : 0;

    if (!operates) {
      continue;
    }

    const x = i % w;
    const y = (i / w) | 0;
    const sector = (x >= half ? 1 : 0) + (y >= half ? 2 : 0);
    const sectorMult = sectorArr ? (Number(sectorArr[sector]) || 1.0) : 1.0;
    const tMult = thermalMult[i] > 0 ? thermalMult[i] : 0;
    const effMult = powerRatio[i] * tMult * sectorMult * globalSpeed;
    const cat = MACHINE_CATALOG[type];
    const cycle = cat && cat.cycleTicks > 0 ? cat.cycleTicks : 1;

    switch (type) {
      case MACHINE_TYPES.BELT_STRAIGHT:
      case MACHINE_TYPES.BELT_CORNER:
      case MACHINE_TYPES.BELT_SPLITTER:
      case MACHINE_TYPES.BELT_MERGER: {
        if (slotWafer[i] !== WAFER_STATES.NONE) {
          slotProgress[i] = Math.min(1.0, slotProgress[i] + effMult);
          if (slotProgress[i] >= 1.0 - 1e-6) {
            _wantsMove[i] = 1;
          }
        }
        break;
      }

      case MACHINE_TYPES.INGOT_SLICER: {
        if (slotWafer[i] === WAFER_STATES.NONE) {
          const panicMult = paperclipActive ? 3.0 : 1.0;
          slotProgress[i] = Math.min(1.0, slotProgress[i] + (effMult * panicMult) / cycle);
          if (slotProgress[i] >= 1.0 - 1e-6) {
            slotWafer[i] = WAFER_STATES.RAW;
            slotDefective[i] = rollDefect(state, i, mods) ? 1 : 0;
            slotProgress[i] = 1.0;
            if (paperclipActive) {
              state.paperclipsMinted++;
            }
          }
        }
        if (slotWafer[i] !== WAFER_STATES.NONE && slotProgress[i] >= 1.0 - 1e-6) {
          _wantsMove[i] = 1;
        }
        break;
      }

      case MACHINE_TYPES.PHOTORESIST_COATER: {
        if (slotWafer[i] === WAFER_STATES.RAW && slotProgress[i] < 1.0 - 1e-6) {
          slotProgress[i] = Math.min(1.0, slotProgress[i] + effMult / cycle);
          if (slotProgress[i] >= 1.0 - 1e-6) {
            slotWafer[i] = WAFER_STATES.COATED;
            slotProgress[i] = 1.0;
          }
        }
        if (slotWafer[i] !== WAFER_STATES.NONE && slotProgress[i] >= 1.0 - 1e-6) {
          _wantsMove[i] = 1;
        }
        break;
      }

      case MACHINE_TYPES.EUV_SCANNER: {
        if (slotWafer[i] === WAFER_STATES.COATED && slotProgress[i] < 1.0 - 1e-6) {
          slotProgress[i] = Math.min(1.0, slotProgress[i] + effMult / cycle);
          if (slotProgress[i] >= 1.0 - 1e-6) {
            slotWafer[i] = WAFER_STATES.EXPOSED;
            slotProgress[i] = 1.0;
            euvFlashes++;
            state.euvFlashes++;
            if (slotDefective[i] === 0 && rollDefect(state, i, mods)) {
              slotDefective[i] = 1;
            }
          }
        }
        if (slotWafer[i] !== WAFER_STATES.NONE && slotProgress[i] >= 1.0 - 1e-6) {
          _wantsMove[i] = 1;
        }
        break;
      }

      case MACHINE_TYPES.PLASMA_ETCHER: {
        if (slotWafer[i] === WAFER_STATES.EXPOSED && slotProgress[i] < 1.0 - 1e-6) {
          slotProgress[i] = Math.min(1.0, slotProgress[i] + effMult / cycle);
          if (slotProgress[i] >= 1.0 - 1e-6) {
            slotWafer[i] = WAFER_STATES.ETCHED;
            slotProgress[i] = 1.0;
            if (slotDefective[i] === 0 && rollDefect(state, i, mods)) {
              slotDefective[i] = 1;
            }
          }
        }
        if (slotWafer[i] !== WAFER_STATES.NONE && slotProgress[i] >= 1.0 - 1e-6) {
          _wantsMove[i] = 1;
        }
        break;
      }

      case MACHINE_TYPES.METROLOGY_QA: {
        if (slotWafer[i] !== WAFER_STATES.NONE && slotProgress[i] < 1.0 - 1e-6) {
          slotProgress[i] = Math.min(1.0, slotProgress[i] + effMult / cycle);
          if (slotProgress[i] >= 1.0 - 1e-6) {
            if (slotWafer[i] === WAFER_STATES.ETCHED && slotDefective[i] === 0) {
              slotWafer[i] = WAFER_STATES.GOOD;
            } else if (slotWafer[i] !== WAFER_STATES.GOOD) {
              slotDefective[i] = 1;
            }
            slotProgress[i] = 1.0;
          }
        }
        if (slotWafer[i] !== WAFER_STATES.NONE && slotProgress[i] >= 1.0 - 1e-6) {
          _wantsMove[i] = 1;
        }
        break;
      }

      case MACHINE_TYPES.WAFER_VAULT: {
        if (slotWafer[i] !== WAFER_STATES.NONE) {
          slotProgress[i] = Math.min(1.0, slotProgress[i] + effMult / cycle);
          if (slotProgress[i] >= 1.0 - 1e-6) {
            if (slotWafer[i] === WAFER_STATES.GOOD && slotDefective[i] === 0) {
              vaultedGood++;
              state.vaultedGood++;
            } else {
              vaultedProto++;
              state.vaultedProto++;
            }
            completedWafers++;
            slotWafer[i] = WAFER_STATES.NONE;
            slotDefective[i] = 0;
            slotProgress[i] = 0;
          }
        }
        break;
      }

      case MACHINE_TYPES.RECLAIM_GRINDER: {
        if (slotWafer[i] !== WAFER_STATES.NONE) {
          slotProgress[i] = Math.min(1.0, slotProgress[i] + effMult / cycle);
          if (slotProgress[i] >= 1.0 - 1e-6) {
            reclaimedCount++;
            state.reclaimedCount++;
            slotWafer[i] = WAFER_STATES.NONE;
            slotDefective[i] = 0;
            slotProgress[i] = 0;
          }
        }
        break;
      }

      case MACHINE_TYPES.FOUP_DOCK: {
        if (machineSub[i] === 1 && slotWafer[i] !== WAFER_STATES.NONE) {
          slotProgress[i] = 1.0;
          _wantsMove[i] = 1;
        }
        break;
      }

      default:
        break;
    }
  }

  // Phase 2a-1: Target selection for fixed-direction cells
  for (let i = 0; i < count; i++) {
    if (_wantsMove[i] === 0) continue;
    const type = machineType[i];
    if (type === MACHINE_TYPES.BELT_SPLITTER) continue;

    const outDir = getFixedOutputDir(type, machineDir[i], machineSub[i], slotDefective[i]);
    const nx = (i % w) + DX[outDir];
    const ny = ((i / w) | 0) + DY[outDir];
    if (nx < 0 || nx >= w || ny < 0 || ny >= w) continue;

    const v = ny * w + nx;
    if (canCellAcceptFrom(state, v, outDir, slotWafer[i])) {
      _target[i] = v;
    }
  }

  // Phase 2a-2: Target selection for BELT_SPLITTER (backpressure & cycle aware)
  for (let i = 0; i < count; i++) {
    if (_wantsMove[i] === 0 || machineType[i] !== MACHINE_TYPES.BELT_SPLITTER) {
      continue;
    }
    const baseDir = machineDir[i] & 3;
    const x = i % w;
    const y = (i / w) | 0;

    let startK = _splitterCursor[i] % 3;
    if (hallucinationActive) {
      const h = (Math.imul(state.tickCount + 1, 2654435761) ^ Math.imul(i + 1, 2246822519)) >>> 0;
      startK = h % 3;
    }

    let chosenV = -1;
    let chosenK = -1;

    // Pass 1: Prefer an immediately empty accepting neighbor
    for (let k = 0; k < 3; k++) {
      const candIdx = (startK + k) % 3;
      const outDir = getSplitterDir(baseDir, candIdx);
      const nx = x + DX[outDir];
      const ny = y + DY[outDir];
      if (nx < 0 || nx >= w || ny < 0 || ny >= w) continue;
      const v = ny * w + nx;
      if (slotWafer[v] === 0 && canCellAcceptFrom(state, v, outDir, slotWafer[i])) {
        chosenV = v;
        chosenK = candIdx;
        break;
      }
    }

    // Pass 2: Fall back to an occupied accepting neighbor that will vacate
    if (chosenV === -1) {
      for (let k = 0; k < 3; k++) {
        const candIdx = (startK + k) % 3;
        const outDir = getSplitterDir(baseDir, candIdx);
        const nx = x + DX[outDir];
        const ny = y + DY[outDir];
        if (nx < 0 || nx >= w || ny < 0 || ny >= w) continue;
        const v = ny * w + nx;
        if (
          canCellAcceptFrom(state, v, outDir, slotWafer[i]) &&
          _target[v] !== -1 &&
          willProbeVacate(_target[v], i, slotWafer, count)
        ) {
          chosenV = v;
          chosenK = candIdx;
          break;
        }
      }
    }

    _target[i] = chosenV;
    _chosenCand[i] = chosenK;
  }

  // Phase 2b: In-degree arbitration so every node has in-degree <= 1 and out-degree <= 1
  for (let v = 0; v < count; v++) {
    const vx = v % w;
    const vy = (v / w) | 0;
    const vType = machineType[v];
    const vDir = machineDir[v] & 3;
    const vSub = machineSub[v];

    const backSide = (vDir + 2) & 3;
    const leftSide = (vDir + 3) & 3;
    const rightSide = (vDir + 1) & 3;

    if (vType === MACHINE_TYPES.BELT_MERGER) {
      let s0 = backSide;
      let s1 = leftSide;
      let s2 = rightSide;

      if (vSub === 2) {
        s0 = leftSide;
        s1 = backSide;
        s2 = rightSide;
      } else if (vSub === 3) {
        s0 = rightSide;
        s1 = backSide;
        s2 = leftSide;
      } else if (vSub === 0) {
        const cur = _mergerCursor[v] % 3;
        if (cur === 1) {
          s0 = leftSide;
          s1 = rightSide;
          s2 = backSide;
        } else if (cur === 2) {
          s0 = rightSide;
          s1 = backSide;
          s2 = leftSide;
        }
      }

      for (let step = 0; step < 3; step++) {
        const side = step === 0 ? s0 : step === 1 ? s1 : s2;
        const ux = vx + DX[side];
        const uy = vy + DY[side];
        if (ux < 0 || ux >= w || uy < 0 || uy >= w) continue;
        const u = uy * w + ux;
        if (_target[u] === v) {
          _winnerIn[v] = u;
          _winnerOut[u] = v;
          _winnerOffset[v] = vSub === 0 ? (_mergerCursor[v] + step) % 3 : step;
          break;
        }
      }
    } else {
      for (let step = 0; step < 4; step++) {
        const side =
          step === 0 ? backSide : step === 1 ? leftSide : step === 2 ? rightSide : vDir;
        const ux = vx + DX[side];
        const uy = vy + DY[side];
        if (ux < 0 || ux >= w || uy < 0 || uy >= w) continue;
        const u = uy * w + ux;
        if (_target[u] === v) {
          _winnerIn[v] = u;
          _winnerOut[u] = v;
          break;
        }
      }
    }
  }

  // Phase 2c: O(N) 3-color traversal + closed-cycle synchronous rotation
  for (let start = 0; start < count; start++) {
    if (_color[start] !== 0 || _winnerOut[start] === -1) {
      continue;
    }

    let sp = 0;
    let curr = start;
    let dest = -1;
    let cycleStart = -1;

    while (curr !== -1) {
      if (_color[curr] === 1) {
        for (let p = 0; p < sp; p++) {
          if (_pathStack[p] === curr) {
            cycleStart = p;
            break;
          }
        }
        break;
      }

      if (_color[curr] === 2) {
        if (slotWafer[curr] === 0) {
          dest = curr;
        }
        break;
      }

      if (slotWafer[curr] === 0) {
        dest = curr;
        _color[curr] = 2;
        break;
      }

      _color[curr] = 1;
      _pathStack[sp++] = curr;
      curr = _winnerOut[curr];
    }

    if (cycleStart >= 0) {
      const lastNode = _pathStack[sp - 1];
      const lastWafer = slotWafer[lastNode];
      const lastDef = slotDefective[lastNode];

      for (let p = sp - 1; p > cycleStart; p--) {
        const dst = _pathStack[p];
        const src = _pathStack[p - 1];
        slotWafer[dst] = slotWafer[src];
        slotDefective[dst] = slotDefective[src];
        slotProgress[dst] = 0;
        _movedOut[src] = 1;
        _movedIn[dst] = 1;
      }

      const firstNode = _pathStack[cycleStart];
      slotWafer[firstNode] = lastWafer;
      slotDefective[firstNode] = lastDef;
      slotProgress[firstNode] = 0;
      _movedOut[lastNode] = 1;
      _movedIn[firstNode] = 1;

      for (let p = 0; p < sp; p++) {
        _color[_pathStack[p]] = 2;
      }
    } else if (dest >= 0) {
      for (let p = sp - 1; p >= 0; p--) {
        const src = _pathStack[p];
        const dst = p === sp - 1 ? dest : _pathStack[p + 1];
        slotWafer[dst] = slotWafer[src];
        slotDefective[dst] = slotDefective[src];
        slotProgress[dst] = 0;
        slotWafer[src] = 0;
        slotDefective[src] = 0;
        slotProgress[src] = 0;
        _movedOut[src] = 1;
        _movedIn[dst] = 1;
        _color[src] = 2;
        _color[dst] = 2;
      }
    } else {
      for (let p = 0; p < sp; p++) {
        _color[_pathStack[p]] = 2;
      }
    }
  }

  // Phase 2d: Advance arbitration cursors only on committed moves & track backpressure
  for (let i = 0; i < count; i++) {
    if (_movedOut[i] === 1 && machineType[i] === MACHINE_TYPES.BELT_SPLITTER && _chosenCand[i] >= 0) {
      _splitterCursor[i] = (_chosenCand[i] + 1) % 3;
    }
    if (
      _movedIn[i] === 1 &&
      machineType[i] === MACHINE_TYPES.BELT_MERGER &&
      machineSub[i] === 0 &&
      _winnerOffset[i] >= 0
    ) {
      _mergerCursor[i] = (_winnerOffset[i] + 1) % 3;
    }

    if (_wantsMove[i] === 1 && _movedOut[i] === 0) {
      if (backpressureTicks[i] < 65535) {
        backpressureTicks[i]++;
      }
    } else {
      backpressureTicks[i] = 0;
    }
  }

  return {
    vaultedGood,
    vaultedProto,
    reclaimedCount,
    euvFlashes,
    completedWafers,
  };
}
