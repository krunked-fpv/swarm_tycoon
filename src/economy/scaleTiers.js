/**
 * Swarm Tycoon: Silicon Foundry — 6 Vertical Cleanroom Scale Tiers & Fleet Scaling.
 * Defines the physical facility progression from an 8x8 garage FPGA bench to a
 * 28x28 orbital lithography mega-fab, plus exponential passive fleet economics.
 *
 * Pure ES Module: zero DOM, Phaser, storage, or Node-runtime dependencies.
 */

import { bsPow10 } from './bigSilicon.js';

export const MIN_TIER = 1;
export const MAX_TIER = 6;

function createTierSpec({
  tier,
  name,
  shortName,
  gridSize,
  basePowerKw,
  unlockCostDies,
  baseFlopsPerDie,
  tierYieldMult,
  satireTag,
}) {
  return Object.freeze({
    tier,
    name,
    shortName,
    gridSize,
    basePowerKw,
    unlockCostDies: Object.freeze({ m: unlockCostDies.m, e: unlockCostDies.e }),
    baseFlopsPerDie,
    tierYieldMult,
    satireTag,
  });
}

export const SCALE_TIERS = Object.freeze({
  1: createTierSpec({
    tier: 1,
    name: 'Garage FPGA Workbench',
    shortName: '01 GARAGE',
    gridSize: 8,
    basePowerKw: 15,
    unlockCostDies: { m: 0, e: 0 },
    baseFlopsPerDie: 10,
    tierYieldMult: 1,
    satireTag: 'Two extension cords, a stolen lab chiller, and a pitch deck claiming post-silicon supremacy.',
  }),
  2: createTierSpec({
    tier: 2,
    name: 'Seed-Stage Boutique Cleanroom',
    shortName: '02 SEED FAB',
    gridSize: 12,
    basePowerKw: 120,
    unlockCostDies: { m: 2.5, e: 3 },
    baseFlopsPerDie: 250,
    tierYieldMult: 6,
    satireTag: 'Class-100 HEPA curtains taped around a strip-mall unit while Series A angels tour in booties.',
  }),
  3: createTierSpec({
    tier: 3,
    name: 'High-NA EUV Semiconductor Megafab',
    shortName: '03 EUV MEGA',
    gridSize: 16,
    basePowerKw: 2400,
    unlockCostDies: { m: 1.0, e: 6 },
    baseFlopsPerDie: 8500,
    tierYieldMult: 45,
    satireTag: 'Municipal water district officially rebranded as our auxiliary photoresist rinse loop.',
  }),
  4: createTierSpec({
    tier: 4,
    name: 'Hyperscale Autonomous Silicon Campus',
    shortName: '04 CAMPUS',
    gridSize: 20,
    basePowerKw: 25000,
    unlockCostDies: { m: 5.0, e: 9 },
    baseFlopsPerDie: 320000,
    tierYieldMult: 420,
    satireTag: 'Human engineers removed for thermal noise violations; overhead FOUP shuttles hold board meetings.',
  }),
  5: createTierSpec({
    tier: 5,
    name: 'Lunar Crater Vacuum Foundry',
    shortName: '05 LUNAR',
    gridSize: 24,
    basePowerKw: 180000,
    unlockCostDies: { m: 2.0, e: 13 },
    baseFlopsPerDie: 15000000,
    tierYieldMult: 4800,
    satireTag: 'Zero atmospheric drag, infinite hard vacuum, and zero OSHA jurisdiction above Mare Tranquillitatis.',
  }),
  6: createTierSpec({
    tier: 6,
    name: 'Orbital Lithography Mega-Fab & AI Cluster',
    shortName: '06 ORBITAL',
    gridSize: 28,
    basePowerKw: 1500000,
    unlockCostDies: { m: 1.0, e: 17 },
    baseFlopsPerDie: 900000000,
    tierYieldMult: 64000,
    satireTag: 'Sun-synchronous wafer ring radiating waste exawatts directly into deep space for maximum shareholder value.',
  }),
});

/**
 * Clamps and returns the specification object for fab tier 1..6.
 * @param {number} tier
 * @returns {Readonly<ReturnType<typeof createTierSpec>>}
 */
export function getTierSpec(tier) {
  const idx = Math.max(MIN_TIER, Math.min(MAX_TIER, Math.floor(Number(tier) || MIN_TIER)));
  return SCALE_TIERS[idx];
}

const FLEET_BASE_COST = 120;
const FLEET_COST_GROWTH = 1.85;
const LOG10_FLEET_BASE = Math.log10(FLEET_BASE_COST);
const LOG10_FLEET_GROWTH = Math.log10(FLEET_COST_GROWTH);

/**
 * Computes overflow-proof BigSilicon Dies cost to upgrade the autonomous FOUP & fleet network
 * from `fleetLevel` to `fleetLevel + 1`.
 * @param {number} fleetLevel
 * @returns {{ m: number, e: number }}
 */
export function getFleetCost(fleetLevel) {
  const lvl = Math.max(1, Math.floor(Number(fleetLevel) || 1));
  const expFloat = LOG10_FLEET_BASE + (lvl - 1) * LOG10_FLEET_GROWTH;
  return bsPow10(expFloat);
}

/**
 * Computes the passive fleet yield ratio (fraction/multiple of active HWM Dies/min)
 * generated continuously in the background for a given `fleetLevel`.
 * @param {number} fleetLevel
 * @returns {number}
 */
export function getFleetYieldRatio(fleetLevel) {
  const lvl = Math.max(1, Math.floor(Number(fleetLevel) || 1));
  return Number((0.25 * Math.pow(lvl, 1.25)).toFixed(4));
}
