/**
 * Swarm Tycoon: Silicon Foundry — 3-Branch Prestige Rewrite Protocol.
 * 9 upgrade nodes across Branches A (Lithography & Yield), B (Cryo & Power Grid),
 * and C (AI Governance & Quarantine), powered by overflow-proof bsLog10 shard math.
 *
 * Pure ES Module: zero DOM, Phaser, storage, or Node-runtime dependencies.
 */

import { bsFrom, bsLog10, bsPow10 } from './bigSilicon.js';

export const PRESTIGE_BRANCHES = Object.freeze({
  A: 'Branch A — Lithography & Logistics',
  B: 'Branch B — Cryo & Power Lattice',
  C: 'Branch C — AI Governance & QA',
});

const BASE_SCRAM_CEILING_K = 390;
const SHARD_LOG10_THRESHOLD = 5;

function createPrestigeNode({
  id,
  code,
  branch,
  name,
  effectSummary,
  satireNote,
  baseCost,
  costGrowth,
}) {
  return Object.freeze({
    id,
    code,
    branch,
    name,
    effectSummary,
    satireNote,
    baseCost,
    costGrowth,
  });
}

export const PRESTIGE_NODES = Object.freeze([
  createPrestigeNode({
    id: 0,
    code: 'A1',
    branch: 'A',
    name: 'Photomask Harmonics',
    effectSummary: '1.50x Die Yield multiplier per level.',
    satireNote: 'Turns sub-wavelength diffraction artifacts into patentable marketing bullet points.',
    baseCost: 1,
    costGrowth: 1.75,
  }),
  createPrestigeNode({
    id: 1,
    code: 'A2',
    branch: 'A',
    name: 'High-NA Pellicle Transport',
    effectSummary: '+25% conveyor belt and FOUP shuttle velocity per level.',
    satireNote: 'Magnetic wafer tracks now run fast enough to void every cleanroom warranty in writing.',
    baseCost: 2,
    costGrowth: 1.85,
  }),
  createPrestigeNode({
    id: 2,
    code: 'A3',
    branch: 'A',
    name: 'Self-Replicating Stepper Macros',
    effectSummary: '1.60x passive fleet yield and -12% tier unlock cost per level.',
    satireNote: 'Autonomously spins up shadow fabs in abandoned strip malls whenever cash balances look bored.',
    baseCost: 3,
    costGrowth: 2.0,
  }),
  createPrestigeNode({
    id: 3,
    code: 'B1',
    branch: 'B',
    name: 'Superconducting LN2 Loops',
    effectSummary: '+30% cryo cooling efficiency per level.',
    satireNote: 'Liquid nitrogen circulates so efficiently that adjacent offices require parkas during pitch meetings.',
    baseCost: 1,
    costGrowth: 1.8,
  }),
  createPrestigeNode({
    id: 4,
    code: 'B2',
    branch: 'B',
    name: 'Solid-State Capacitor Lattice',
    effectSummary: '+25% power grid and capacitor supply multiplier per level.',
    satireNote: 'Stores enough megajoules under the floor tiles to briefly outshine the municipal grid.',
    baseCost: 2,
    costGrowth: 1.85,
  }),
  createPrestigeNode({
    id: 5,
    code: 'B3',
    branch: 'B',
    name: 'Refractory SiC Thermal Liners',
    effectSummary: '+40K thermal scram ceiling per level.',
    satireNote: 'If the stepper glows cherry red, we simply raise the redline threshold in firmware.',
    baseCost: 2,
    costGrowth: 1.9,
  }),
  createPrestigeNode({
    id: 6,
    code: 'C1',
    branch: 'C',
    name: 'Constitutional Guardrail Kernels',
    effectSummary: '+35% AI director yield bonus and -15% Context Entropy accumulation per level.',
    satireNote: 'Forces every autonomous Bay Director to sign an unskippable safety waiver before touching the EUV dial.',
    baseCost: 1,
    costGrowth: 1.8,
  }),
  createPrestigeNode({
    id: 7,
    code: 'C2',
    branch: 'C',
    name: 'Speculative KV-Cache Compression',
    effectSummary: '-15% crisis severity/mitigation cost and -12% crisis duration per level.',
    satireNote: 'Summarizes rogue agent meltdowns into a single 3-bullet Slack digest before VCs notice.',
    baseCost: 2,
    costGrowth: 1.9,
  }),
  createPrestigeNode({
    id: 8,
    code: 'C3',
    branch: 'C',
    name: 'Autonomous QA Quarantine Breakers',
    effectSummary: 'Reduces defect pressure and adds +50% Reclaim Grinder yield per level.',
    satireNote: 'Grinds failed prototypes so thoroughly they emerge legally indistinguishable from virgin silicon.',
    baseCost: 3,
    costGrowth: 2.0,
  }),
]);

/**
 * Computes total Prestige Shards unlocked by `lifetimeFlops` minus `alreadyOwnedShards`.
 * Uses bsLog10 so numbers past 1e308 up to 1e100000+ never overflow float64.
 *   1e6 FLOPs    -> 1 shard
 *   1e308 FLOPs  -> 5,274 shards
 *   1e1500 FLOPs -> 57,802 shards
 * @param {number | string | { m: number, e: number }} lifetimeFlops
 * @param {number} [alreadyOwnedShards=0]
 * @returns {number}
 */
export function computePendingShards(lifetimeFlops, alreadyOwnedShards = 0) {
  const flopsBig = bsFrom(lifetimeFlops);
  if (flopsBig.m <= 0) {
    return 0;
  }
  const log10Val = bsLog10(flopsBig);
  if (!Number.isFinite(log10Val) || log10Val < SHARD_LOG10_THRESHOLD + 1) {
    return 0;
  }

  const totalEarned = Math.floor(Math.pow(log10Val - SHARD_LOG10_THRESHOLD, 1.5));
  const owned = Math.max(0, Math.floor(Number(alreadyOwnedShards) || 0));
  return Math.max(0, totalEarned - owned);
}

/**
 * Returns the shard cost to upgrade prestige node `nodeIdx` from `currentLevel` to `currentLevel + 1`.
 * @param {number} nodeIdx
 * @param {number} [currentLevel=0]
 * @returns {number}
 */
export function getNodeCost(nodeIdx, currentLevel = 0) {
  if (!Number.isInteger(nodeIdx) || nodeIdx < 0 || nodeIdx >= PRESTIGE_NODES.length) {
    return Infinity;
  }
  const node = PRESTIGE_NODES[nodeIdx];
  const lvl = Math.max(0, Math.floor(Number(currentLevel) || 0));
  const raw = node.baseCost * Math.pow(node.costGrowth, lvl);
  if (!Number.isFinite(raw)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.max(1, Math.round(raw));
}

/**
 * Computes cumulative shards already invested across a 9-element prestige level array.
 * @param {number[]} [levels]
 * @returns {number}
 */
export function getTotalSpentShards(levels = []) {
  let total = 0;
  for (let i = 0; i < PRESTIGE_NODES.length; i++) {
    const lvl = Math.max(0, Math.floor(Number(levels?.[i]) || 0));
    const capped = Math.min(lvl, 250);
    for (let k = 0; k < capped; k++) {
      const stepCost = getNodeCost(i, k);
      if (total + stepCost > Number.MAX_SAFE_INTEGER) {
        return Number.MAX_SAFE_INTEGER;
      }
      total += stepCost;
    }
  }
  return total;
}

/**
 * Sanitizes an arbitrary prestige array into a clean 9-element integer array.
 * @param {unknown} levels
 * @returns {number[]}
 */
export function sanitizePrestigeLevels(levels) {
  const out = new Array(PRESTIGE_NODES.length).fill(0);
  if (!Array.isArray(levels)) {
    return out;
  }
  for (let i = 0; i < PRESTIGE_NODES.length; i++) {
    const raw = Number(levels[i]);
    out[i] = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  }
  return out;
}

/**
 * Computes all gameplay and simulation multipliers derived from the 9 Prestige Rewrite nodes.
 * @param {number[]} [levels]
 */
export function getPrestigeEffects(levels = []) {
  const clean = sanitizePrestigeLevels(levels);

  const l0 = clean[0];
  const l1 = clean[1];
  const l2 = clean[2];
  const l3 = clean[3];
  const l4 = clean[4];
  const l5 = clean[5];
  const l6 = clean[6];
  const l7 = clean[7];
  const l8 = clean[8];

  const dieYieldBig = bsPow10(l0 * Math.log10(1.5));
  const rawDieYield = Math.pow(1.5, l0);
  const dieYieldMult = Number.isFinite(rawDieYield) ? rawDieYield : Number.MAX_VALUE;

  const beltSpeedMult = Math.min(8.0, 1 + 0.25 * l1);

  const rawFleet = Math.pow(1.6, l2);
  const fleetMult = Number.isFinite(rawFleet) ? rawFleet : Number.MAX_VALUE;
  const fleetMultBig = bsPow10(l2 * Math.log10(1.6));
  const tierDiscountMult = Math.max(0.05, Math.pow(0.88, l2));

  const cryoEfficiencyMult = 1 + 0.3 * l3;
  const capacitorMult = 1 + 0.25 * l4;
  const scramCeilingBonusK = 40 * l5;
  const scramCeilingK = BASE_SCRAM_CEILING_K + scramCeilingBonusK;

  const agentYieldMult = 1 + 0.35 * l6;
  const entropyRateMult = Math.max(0.1, Math.pow(0.85, l6));

  const crisisSeverityMult = Math.max(0.25, Math.pow(0.85, l7));
  const crisisDurationMult = Math.max(0.3, Math.pow(0.88, l7));

  const defectReduction = Math.min(0.85, 1 - Math.pow(0.85, l8));
  const reclaimYieldMult = 1 + 0.5 * l8;

  return {
    levels: clean,
    dieYieldMult,
    dieYieldBig,
    beltSpeedMult,
    fleetMult,
    fleetMultBig,
    tierDiscountMult,
    cryoEfficiencyMult,
    capacitorMult,
    scramCeilingBonusK,
    scramCeilingK,
    agentYieldMult,
    entropyRateMult,
    crisisSeverityMult,
    crisisDurationMult,
    defectReduction,
    reclaimYieldMult,
  };
}
