/**
 * Overhead FOUP Robotic Wafer Shuttle Fleet.
 * Dispatches up to 16 shuttles ferrying wafers directly over floor obstacles
 * between FOUP_DOCK pickup (sub=0, shuttleWaypoint=1) and FOUP_DOCK dropoff
 * (sub=1, shuttleWaypoint=2).
 *
 * Pure ES Module: zero DOM, Phaser, storage, or Node-runtime dependencies.
 */

import { MACHINE_TYPES } from './gridEngine.js';

const MAX_SHUTTLES = 16;
const BASE_SPEED_TILES_PER_TICK = 0.75;

// Pre-allocated scratch buffers (zero GC inside hot tick loop)
const _pickups = new Uint16Array(784);
const _dropoffs = new Uint16Array(784);
const _reservedPick = new Uint8Array(784);
const _reservedDrop = new Uint8Array(784);

function findNearestUnreserved(fromX, fromY, list, count, reservedMask, width) {
  let bestIdx = -1;
  let bestDistSq = Infinity;
  for (let i = 0; i < count; i++) {
    const cellIdx = list[i];
    if (reservedMask[cellIdx] !== 0) {
      continue;
    }
    const cx = cellIdx % width;
    const cy = (cellIdx / width) | 0;
    const dx = cx - fromX;
    const dy = cy - fromY;
    const dSq = dx * dx + dy * dy;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestIdx = cellIdx;
    }
  }
  return bestIdx;
}

function advanceAlongVector(shuttle, speed) {
  const dx = shuttle.targetX - shuttle.x;
  const dy = shuttle.targetY - shuttle.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= speed || dist < 1e-6) {
    shuttle.x = shuttle.targetX;
    shuttle.y = shuttle.targetY;
    shuttle.progress = 1.0;
    return true;
  }
  shuttle.x += (dx / dist) * speed;
  shuttle.y += (dy / dist) * speed;
  const totalDist = Math.max(0.001, shuttle._totalDist || dist);
  const remaining = Math.hypot(shuttle.targetX - shuttle.x, shuttle.targetY - shuttle.y);
  shuttle.progress = Math.max(0, Math.min(1, 1 - remaining / totalDist));
  return false;
}

/**
 * Steps overhead FOUP shuttle fleet for one 10Hz tick.
 * @param {import('./gridEngine.js').GridState} state
 * @param {Record<string, any>} [mods]
 * @returns {{ activeShuttles: number, completedTransfers: number }}
 */
export function stepShuttles(state, mods = {}) {
  const w = state.width;
  const count = w * w;
  const {
    machineType,
    shuttleWaypoint,
    slotWafer,
    slotDefective,
    slotProgress,
    powerRatio,
    scramActive,
    shuttles,
  } = state;

  const maxShuttles = Math.max(
    1,
    Math.min(MAX_SHUTTLES, Math.floor(mods.fleetLevel ?? 1))
  );
  const speed =
    BASE_SPEED_TILES_PER_TICK *
    (Number.isFinite(mods.shuttleSpeedMult) ? Math.max(0.1, mods.shuttleSpeedMult) : 1.0);

  let pickupCount = 0;
  let dropoffCount = 0;

  for (let i = 0; i < count; i++) {
    _reservedPick[i] = 0;
    _reservedDrop[i] = 0;
    if (machineType[i] !== MACHINE_TYPES.FOUP_DOCK) {
      continue;
    }
    if (powerRatio[i] <= 0 || scramActive[i] === 1) {
      continue;
    }
    if (shuttleWaypoint[i] === 1 && slotWafer[i] !== 0) {
      _pickups[pickupCount++] = i;
    } else if (shuttleWaypoint[i] === 2 && slotWafer[i] === 0) {
      _dropoffs[dropoffCount++] = i;
    }
  }

  // Reserve existing shuttle targets first so two shuttles never target the same dock
  for (let s = 0; s < shuttles.length; s++) {
    const sh = shuttles[s];
    if (sh.state === 'to_pickup' && sh._srcIdx >= 0 && sh._srcIdx < count) {
      _reservedPick[sh._srcIdx] = 1;
    }
    if ((sh.state === 'to_pickup' || sh.state === 'to_dropoff') && sh._dstIdx >= 0 && sh._dstIdx < count) {
      _reservedDrop[sh._dstIdx] = 1;
    }
  }

  let completedTransfers = 0;
  let activeShuttles = 0;

  // Step existing shuttles
  for (let s = 0; s < shuttles.length; s++) {
    const sh = shuttles[s];

    if (sh.state === 'to_pickup') {
      const pIdx = sh._srcIdx;
      const validPick =
        pIdx >= 0 &&
        pIdx < count &&
        machineType[pIdx] === MACHINE_TYPES.FOUP_DOCK &&
        shuttleWaypoint[pIdx] === 1 &&
        slotWafer[pIdx] !== 0 &&
        powerRatio[pIdx] > 0 &&
        scramActive[pIdx] === 0;

      if (!validPick) {
        if (sh._dstIdx >= 0 && sh._dstIdx < count) _reservedDrop[sh._dstIdx] = 0;
        sh.state = 'idle';
        sh.progress = 0;
        sh._srcIdx = -1;
        sh._dstIdx = -1;
      } else {
        const arrived = advanceAlongVector(sh, speed);
        if (arrived) {
          sh.carryingWafer = slotWafer[pIdx];
          sh.carryingDefective = slotDefective[pIdx];
          slotWafer[pIdx] = 0;
          slotDefective[pIdx] = 0;
          slotProgress[pIdx] = 0;
          // Keep _reservedPick[pIdx] = 1 for the remainder of this tick because pIdx is now empty

          let dIdx = sh._dstIdx;
          const validDrop =
            dIdx >= 0 &&
            dIdx < count &&
            machineType[dIdx] === MACHINE_TYPES.FOUP_DOCK &&
            shuttleWaypoint[dIdx] === 2 &&
            slotWafer[dIdx] === 0 &&
            powerRatio[dIdx] > 0 &&
            scramActive[dIdx] === 0;
          if (!validDrop) {
            dIdx = findNearestUnreserved(sh.x, sh.y, _dropoffs, dropoffCount, _reservedDrop, w);
          }
          if (dIdx >= 0) {
            _reservedDrop[dIdx] = 1;
            sh._dstIdx = dIdx;
            sh.targetX = dIdx % w;
            sh.targetY = (dIdx / w) | 0;
            sh._totalDist = Math.max(0.001, Math.hypot(sh.targetX - sh.x, sh.targetY - sh.y));
            sh.progress = 0;
            sh.state = 'to_dropoff';
          } else {
            sh._dstIdx = -1;
            sh.progress = 0;
            sh.state = 'to_dropoff';
          }
        }
      }
    }

    if (sh.state === 'to_dropoff') {
      let dIdx = sh._dstIdx;
      const validDrop =
        dIdx >= 0 &&
        dIdx < count &&
        machineType[dIdx] === MACHINE_TYPES.FOUP_DOCK &&
        shuttleWaypoint[dIdx] === 2 &&
        slotWafer[dIdx] === 0 &&
        powerRatio[dIdx] > 0 &&
        scramActive[dIdx] === 0;

      if (!validDrop) {
        if (dIdx >= 0 && dIdx < count) _reservedDrop[dIdx] = 0;
        const altDrop = findNearestUnreserved(sh.x, sh.y, _dropoffs, dropoffCount, _reservedDrop, w);
        if (altDrop >= 0) {
          _reservedDrop[altDrop] = 1;
          sh._dstIdx = altDrop;
          sh.targetX = altDrop % w;
          sh.targetY = (altDrop / w) | 0;
          sh._totalDist = Math.max(0.001, Math.hypot(sh.targetX - sh.x, sh.targetY - sh.y));
          dIdx = altDrop;
        } else {
          dIdx = -1;
          sh._dstIdx = -1;
        }
      }

      if (dIdx >= 0) {
        const arrived = advanceAlongVector(sh, speed);
        if (arrived) {
          slotWafer[dIdx] = sh.carryingWafer;
          slotDefective[dIdx] = sh.carryingDefective;
          slotProgress[dIdx] = 1.0;
          // Keep _reservedDrop[dIdx] = 1 for the remainder of this tick because dIdx is now occupied
          sh.carryingWafer = 0;
          sh.carryingDefective = 0;
          sh._srcIdx = -1;
          sh._dstIdx = -1;
          sh.progress = 0;
          sh.state = 'idle';
          completedTransfers++;
        }
      }
    }

    if (sh.state === 'idle' && s < maxShuttles) {
      const pIdx = findNearestUnreserved(sh.x, sh.y, _pickups, pickupCount, _reservedPick, w);
      if (pIdx >= 0) {
        const px = pIdx % w;
        const py = (pIdx / w) | 0;
        const dIdx = findNearestUnreserved(px, py, _dropoffs, dropoffCount, _reservedDrop, w);
        if (dIdx >= 0) {
          _reservedPick[pIdx] = 1;
          _reservedDrop[dIdx] = 1;
          sh._srcIdx = pIdx;
          sh._dstIdx = dIdx;
          sh.targetX = px;
          sh.targetY = py;
          sh._totalDist = Math.max(0.001, Math.hypot(px - sh.x, py - sh.y));
          sh.progress = 0;
          sh.state = 'to_pickup';

          // If shuttle was already docked right at pickup, pick up immediately
          if (sh._totalDist <= 1e-4) {
            sh.carryingWafer = slotWafer[pIdx];
            sh.carryingDefective = slotDefective[pIdx];
            slotWafer[pIdx] = 0;
            slotDefective[pIdx] = 0;
            slotProgress[pIdx] = 0;
            sh.targetX = dIdx % w;
            sh.targetY = (dIdx / w) | 0;
            sh._totalDist = Math.max(0.001, Math.hypot(sh.targetX - sh.x, sh.targetY - sh.y));
            sh.state = 'to_dropoff';
          }
        }
      }
    }

    if (sh.state !== 'idle') {
      activeShuttles++;
    }
  }

  // Spawn additional shuttles up to maxShuttles if unreserved docks still await pickup
  while (shuttles.length < maxShuttles) {
    const pIdx = findNearestUnreserved(0, 0, _pickups, pickupCount, _reservedPick, w);
    if (pIdx < 0) break;
    const px = pIdx % w;
    const py = (pIdx / w) | 0;
    const dIdx = findNearestUnreserved(px, py, _dropoffs, dropoffCount, _reservedDrop, w);
    if (dIdx < 0) break;

    _reservedPick[pIdx] = 1;
    _reservedDrop[dIdx] = 1;
    const dx = dIdx % w;
    const dy = (dIdx / w) | 0;
    const totalDist = Math.max(0.001, Math.hypot(dx - px, dy - py));

    const shuttle = {
      id: shuttles.length + 1,
      x: px,
      y: py,
      targetX: dx,
      targetY: dy,
      carryingWafer: slotWafer[pIdx],
      carryingDefective: slotDefective[pIdx],
      progress: 0,
      state: 'to_dropoff',
      _srcIdx: pIdx,
      _dstIdx: dIdx,
      _totalDist: totalDist,
    };

    slotWafer[pIdx] = 0;
    slotDefective[pIdx] = 0;
    slotProgress[pIdx] = 0;

    shuttles.push(shuttle);
    activeShuttles++;
  }

  return { activeShuttles, completedTransfers };
}
