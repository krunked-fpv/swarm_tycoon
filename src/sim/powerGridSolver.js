/**
 * Multi-Tier Cleanroom Power Grid Solver.
 * Aggregates facility substation supply, POWER_SOURCE generators, and
 * CAPACITOR_BANK charge/discharge buffers, then enforces Priority 3 -> 2 -> 1
 * breaker brownout cascades.
 *
 * Pure ES Module: zero DOM, Phaser, storage, or Node-runtime dependencies.
 */

import { MACHINE_TYPES, MACHINE_CATALOG, TICK_MS } from './gridEngine.js';

const EPS = 1e-6;

/**
 * Solves one 10Hz power distribution & breaker-shedding step.
 * @param {import('./gridEngine.js').GridState} state
 * @param {Record<string, any>} [mods]
 * @returns {{ powerSupplyKw: number, powerDemandKw: number, capacitorStoredKj: number, capacitorMaxKj: number, brownoutLevel: number }}
 */
export function stepPowerGrid(state, mods = {}) {
  const dtSec = TICK_MS / 1000;
  const count = state.width * state.width;
  const { machineType, priorityTier, scramActive, powerRatio } = state;

  const tierSupplyKw = Number.isFinite(mods.tierSupplyKw) ? Math.max(0, mods.tierSupplyKw) : 15.0;
  const powerMult = Number.isFinite(mods.powerMult) ? Math.max(0.1, mods.powerMult) : 1.0;
  const tierScale = Number.isFinite(mods.powerSourceScale)
    ? Math.max(0.1, mods.powerSourceScale)
    : Math.max(1, tierSupplyKw / 15.0);

  let baseSupplyKw = tierSupplyKw * powerMult;
  let demandP1 = 0;
  let demandP2 = 0;
  let demandP3 = 0;
  let capacitorMaxKj = 0;
  let maxCapRateKw = 0;

  for (let i = 0; i < count; i++) {
    const type = machineType[i];
    if (type <= MACHINE_TYPES.PILLAR) {
      powerRatio[i] = 0;
      continue;
    }

    if (scramActive[i] === 1) {
      powerRatio[i] = 0;
      continue;
    }

    const cat = MACHINE_CATALOG[type];
    if (!cat) {
      powerRatio[i] = 0;
      continue;
    }

    if (type === MACHINE_TYPES.POWER_SOURCE) {
      baseSupplyKw += cat.supplyKw * tierScale * powerMult;
    } else if (type === MACHINE_TYPES.CAPACITOR_BANK) {
      capacitorMaxKj += cat.capacityKj;
      maxCapRateKw += cat.maxDischargeKw;
    }

    const drawKw = cat.powerKw;
    if (drawKw > 0) {
      const prio = priorityTier[i] || cat.priority || 1;
      if (prio >= 3) {
        demandP3 += drawKw;
      } else if (prio === 2) {
        demandP2 += drawKw;
      } else {
        demandP1 += drawKw;
      }
    }
  }

  // Clamp capacitor energy to currently installed bank capacity
  if (state.capacitorStoredKj > capacitorMaxKj) {
    state.capacitorStoredKj = capacitorMaxKj;
  } else if (state.capacitorStoredKj < 0) {
    state.capacitorStoredKj = 0;
  }

  const totalDemandKw = demandP1 + demandP2 + demandP3;
  const maxAvailableKw = Math.min(maxCapRateKw, state.capacitorStoredKj / dtSec);

  let ratioP1 = 0;
  let ratioP2 = 0;
  let ratioP3 = 0;
  let brownoutLevel = 0;
  let activeDemandKw = 0;

  if (totalDemandKw <= baseSupplyKw + maxAvailableKw + EPS) {
    brownoutLevel = 0;
    ratioP1 = 1;
    ratioP2 = 1;
    ratioP3 = 1;
    activeDemandKw = totalDemandKw;
  } else if (demandP1 + demandP2 <= baseSupplyKw + maxAvailableKw + EPS) {
    brownoutLevel = 1;
    ratioP1 = 1;
    ratioP2 = 1;
    ratioP3 = 0;
    activeDemandKw = demandP1 + demandP2;
  } else if (demandP1 <= baseSupplyKw + maxAvailableKw + EPS) {
    brownoutLevel = 2;
    ratioP1 = 1;
    ratioP2 = 0;
    ratioP3 = 0;
    activeDemandKw = demandP1;
  } else {
    brownoutLevel = 3;
    ratioP1 = 0;
    ratioP2 = 0;
    ratioP3 = 0;
    activeDemandKw = 0;
  }

  let dischargeKw = 0;
  if (activeDemandKw > baseSupplyKw + EPS) {
    dischargeKw = Math.min(maxAvailableKw, activeDemandKw - baseSupplyKw);
    state.capacitorStoredKj = Math.max(0, state.capacitorStoredKj - dischargeKw * dtSec);
  } else if (capacitorMaxKj > state.capacitorStoredKj && baseSupplyKw > activeDemandKw + EPS) {
    const surplusKw = baseSupplyKw - activeDemandKw;
    const chargeKw = Math.min(surplusKw, maxCapRateKw);
    const addedKj = Math.min(capacitorMaxKj - state.capacitorStoredKj, chargeKw * dtSec);
    state.capacitorStoredKj += addedKj;
  }

  for (let i = 0; i < count; i++) {
    const type = machineType[i];
    if (type <= MACHINE_TYPES.PILLAR || scramActive[i] === 1) {
      powerRatio[i] = 0;
      continue;
    }

    const cat = MACHINE_CATALOG[type];
    const prio = priorityTier[i] || (cat ? cat.priority : 1);
    if (prio >= 3) {
      powerRatio[i] = ratioP3;
    } else if (prio === 2) {
      powerRatio[i] = ratioP2;
    } else {
      powerRatio[i] = ratioP1;
    }
  }

  return {
    powerSupplyKw: Number((baseSupplyKw + dischargeKw).toFixed(4)),
    powerDemandKw: Number(totalDemandKw.toFixed(4)),
    capacitorStoredKj: Number(state.capacitorStoredKj.toFixed(4)),
    capacitorMaxKj: Number(capacitorMaxKj.toFixed(4)),
    brownoutLevel,
  };
}
