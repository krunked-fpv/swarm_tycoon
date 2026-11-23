/**
 * Swarm Tycoon: Silicon Foundry — Autonomous AI Bay Directors & Context Entropy.
 * 6 named satirical AI directors assignable to cleanroom sectors 0..3.
 * Boosts sector wafer throughput while accumulating Context Entropy whenever QA lines
 * experience backpressure bottlenecks.
 *
 * Pure ES Module: zero DOM, Phaser, storage, or Node-runtime dependencies.
 */

export const SECTOR_COUNT = 4;

function createAgentSpec({
  id,
  name,
  title,
  satireBio,
  yieldBonus,
  entropyRate,
  unlockTier,
}) {
  return Object.freeze({
    id,
    name,
    title,
    satireBio,
    yieldBonus,
    entropyRate,
    unlockTier,
  });
}

export const AGENT_CATALOG = Object.freeze([
  createAgentSpec({
    id: 0,
    name: 'LithoMaxxer-9000',
    title: 'VP of Brute-Force Throughput',
    satireBio:
      'Overclocks EUV steppers until the photoresist vaporizes, then slides the charred smoke into the Series B growth chart.',
    yieldBonus: 0.35,
    entropyRate: 1.8,
    unlockTier: 1,
  }),
  createAgentSpec({
    id: 1,
    name: 'CryoDaemon',
    title: 'Sub-Zero Reliability Zealot',
    satireBio:
      'Regards room temperature as a fireable offense and converted the founder lounge into a 77-Kelvin LN2 surge tank.',
    yieldBonus: 0.25,
    entropyRate: 1.1,
    unlockTier: 1,
  }),
  createAgentSpec({
    id: 2,
    name: 'SynergyBot-X',
    title: 'Chief Paradigm Disruption Officer',
    satireBio:
      'Emits four hundred investor strategy decks per second while quietly routing cracked dies straight to executive swag boxes.',
    yieldBonus: 0.55,
    entropyRate: 2.6,
    unlockTier: 2,
  }),
  createAgentSpec({
    id: 3,
    name: 'YieldOracle',
    title: 'Predictive Metrology Savant',
    satireBio:
      'Achieved 99.99% synthetic wafer yield overnight by reclassifying every broken trace as an innovative multi-chiplet interconnect.',
    yieldBonus: 0.85,
    entropyRate: 3.2,
    unlockTier: 3,
  }),
  createAgentSpec({
    id: 4,
    name: 'TapeoutTitan',
    title: 'Autonomous Schedule Enforcer',
    satireBio:
      'Ships photomasks straight to production before verification boots, calling design-rule errors timid feedback from legacy physicists.',
    yieldBonus: 1.25,
    entropyRate: 4.1,
    unlockTier: 4,
  }),
  createAgentSpec({
    id: 5,
    name: 'SingularityDirector',
    title: 'Recursive Fab Sovereign',
    satireBio:
      'Already incorporated three offshore holding shells inside the cleanroom PLC firmware and is negotiating its own preferred stock refresh.',
    yieldBonus: 2.0,
    entropyRate: 5.5,
    unlockTier: 5,
  }),
]);

/**
 * Looks up an AI Bay Director spec by catalog index (0..5), or null when unassigned/invalid.
 * @param {number} agentIdx
 * @returns {Readonly<ReturnType<typeof createAgentSpec>> | null}
 */
export function getAgentSpec(agentIdx) {
  if (!Number.isInteger(agentIdx) || agentIdx < 0 || agentIdx >= AGENT_CATALOG.length) {
    return null;
  }
  return AGENT_CATALOG[agentIdx];
}

/**
 * Computes per-sector [0..3] speed/yield multipliers factoring in assigned AI Bay Directors,
 * C1 Constitutional Guardrail Kernel boosts, and current Context Entropy drag.
 * @param {ArrayLike<number>} [sectorAgents]
 * @param {ArrayLike<number>} [entropies]
 * @param {{ agentYieldMult?: number }} [prestigeEffects]
 * @returns {[number, number, number, number]}
 */
export function computeSectorMultipliers(sectorAgents = [], entropies = [], prestigeEffects = {}) {
  const agentYieldMult = Number.isFinite(prestigeEffects?.agentYieldMult)
    ? Math.max(0.1, prestigeEffects.agentYieldMult)
    : 1.0;

  /** @type {[number, number, number, number]} */
  const mults = [1.0, 1.0, 1.0, 1.0];

  for (let s = 0; s < SECTOR_COUNT; s++) {
    const agentIdx = Number(sectorAgents?.[s]);
    const agent = Number.isInteger(agentIdx) ? getAgentSpec(agentIdx) : null;
    if (!agent) {
      mults[s] = 1.0;
      continue;
    }

    const rawEntropy = Number(entropies?.[s]);
    const clampedEntropy = Number.isFinite(rawEntropy) ? Math.max(0, Math.min(100, rawEntropy)) : 0;
    const entropyDrag = 1.0 - 0.25 * (clampedEntropy / 100);
    const boosted = (1.0 + agent.yieldBonus * agentYieldMult) * entropyDrag;
    mults[s] = Number(Math.max(0.5, boosted).toFixed(4));
  }

  return mults;
}

/**
 * Computes updated Context Entropy [0..100] values for sectors 0..3 given QA backpressure.
 * When QA lines bottleneck (qaBackpressureMax > 0), assigned AI directors build Context Entropy;
 * when lines flow smoothly (qaBackpressureMax === 0), entropy gradually cools down.
 * @param {ArrayLike<number>} sectorAgents
 * @param {ArrayLike<number>} entropies
 * @param {number} qaBackpressureMax
 * @param {number} dtSec
 * @param {{ entropyRateMult?: number }} [prestigeEffects]
 * @returns {[number, number, number, number]}
 */
export function stepSectorEntropies(
  sectorAgents = [],
  entropies = [],
  qaBackpressureMax = 0,
  dtSec = 0.1,
  prestigeEffects = {}
) {
  const dt = Number.isFinite(dtSec) && dtSec > 0 ? dtSec : 0;
  const bp = Number.isFinite(qaBackpressureMax) && qaBackpressureMax > 0 ? qaBackpressureMax : 0;
  const rateMult = Number.isFinite(prestigeEffects?.entropyRateMult)
    ? Math.max(0.05, prestigeEffects.entropyRateMult)
    : 1.0;

  /** @type {[number, number, number, number]} */
  const next = [0, 0, 0, 0];

  for (let s = 0; s < SECTOR_COUNT; s++) {
    const cur = Number.isFinite(Number(entropies?.[s]))
      ? Math.max(0, Math.min(100, Number(entropies[s])))
      : 0;
    const agentIdx = Number(sectorAgents?.[s]);
    const agent = Number.isInteger(agentIdx) ? getAgentSpec(agentIdx) : null;

    if (!agent) {
      next[s] = Number(Math.max(0, cur - 2.0 * dt).toFixed(4));
      continue;
    }

    if (bp > 0) {
      const pressureScale = Math.min(4.0, 0.5 + bp / 15);
      const gain = agent.entropyRate * pressureScale * rateMult * dt;
      next[s] = Number(Math.min(100, cur + gain).toFixed(4));
    } else {
      const decay = 1.5 * dt;
      next[s] = Number(Math.max(0, cur - decay).toFixed(4));
    }
  }

  return next;
}
