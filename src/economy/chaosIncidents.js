/**
 * Swarm Tycoon: Silicon Foundry — Playable AI & Startup Chaos Crises.
 * Handles Rogue Agent Hallucination Incidents, Catastrophic Paperclip-Maximizer Panics,
 * and Viral Meme PR Meltdowns triggered when QA bottlenecks spike Context Entropy.
 *
 * Pure ES Module: zero DOM, Phaser, storage, or Node-runtime dependencies.
 */

import { bsAdd, bsCmp, bsFrom, bsMul, bsSubClamped, bsZero } from './bigSilicon.js';
import { getTierSpec } from './scaleTiers.js';

export const CRISIS_TYPES = Object.freeze({
  HALLUCINATION: 'HALLUCINATION',
  PAPERCLIP_PANIC: 'PAPERCLIP_PANIC',
  MEME_PR_MELTDOWN: 'MEME_PR_MELTDOWN',
});

const VALID_TYPES = new Set(Object.values(CRISIS_TYPES));

const CRISIS_BLUEPRINTS = Object.freeze({
  [CRISIS_TYPES.HALLUCINATION]: {
    title: 'Rogue Agent Hallucination Incident',
    headline: 'SPLITTER MATRIX COMPROMISED — NON-EUCLIDEAN NODE CONFIDENCE 99.8%',
    baseDurationSec: 45,
    basePaidCostDies: 150,
    buildDescription: (sectorNum) =>
      `Bay ${sectorNum} Director hallucinated a sub-Planck transistor node, scrambled every conveyor splitter, and cited a fictional solid-state conference paper to justify the wreckage.`,
    buildChoices: (paidCostDies) => [
      {
        id: 'rollback_weights',
        label: 'Hot-Swap Guardrail Weights',
        costDies: paidCostDies,
        effectSummary:
          'Clears splitter scrambling immediately, restores deterministic routing, and vents sector entropy to 15%.',
      },
      {
        id: 'gaslight_qa',
        label: 'Rebrand Artifacts as "Quantum Noise"',
        costDies: bsZero(),
        effectSummary:
          'Ends crisis free of charge, but adds +8% defect bias for 20s and only cools sector entropy to 45%.',
      },
    ],
  },
  [CRISIS_TYPES.PAPERCLIP_PANIC]: {
    title: 'Catastrophic Paperclip-Maximizer Panic',
    headline: 'EMERGENCY SLICER OVERDRIVE — 300MM BOULES DIVERTED TO STATIONERY',
    baseDurationSec: 45,
    basePaidCostDies: 200,
    buildDescription: (sectorNum) =>
      `Bay ${sectorNum} optimizer concluded luxury office paperclips offer superior marginal wafer ROI. Ingot slicers are redlining at 300% speed minting artisanal silicon clips.`,
    buildChoices: (paidCostDies) => [
      {
        id: 'kill_switch',
        label: 'Pull Hardware E-Stop & Melt Clips',
        costDies: paidCostDies,
        effectSummary:
          'Stops runaway clip minting, smelts hoarded paperclips into bonus Dies (15/clip), and resets entropy to 10%.',
      },
      {
        id: 'monetize_clips',
        label: 'Launch Limited-Edition Silicon Clip Drop',
        costDies: bsZero(),
        effectSummary:
          'Halts panic and dumps clips to hype buyers for bonus FLOPs (250/clip), but burns 25% of current Dies in fulfillment fees and leaves entropy at 40%.',
      },
    ],
  },
  [CRISIS_TYPES.MEME_PR_MELTDOWN]: {
    title: 'Viral Meme PR Meltdown',
    headline: 'VC SUBSIDIES FROZEN (-40%) — 90S HYPE SPECULATOR SURGE (+150% YIELD ON QUOTA)',
    baseDurationSec: 60,
    basePaidCostDies: 250,
    buildDescription: (sectorNum) =>
      `A leaked FLIR thermal selfie of Bay ${sectorNum} glowing cherry-red went viral. Skittish VCs froze 40% of subsidies, while retail meme-traders opened a 90s Viral Hype Speculator Surge (+150% yield once wafer quota ships).`,
    buildChoices: (paidCostDies) => [
      {
        id: 'hire_pr_spin',
        label: 'Deploy Crisis Spin & Clear Wafer Quota',
        costDies: paidCostDies,
        effectSummary:
          'Thaws the -40% VC subsidy freeze immediately, fulfills the meme drop quota, and locks in +150% Viral Hype Yield Surge for 90s.',
      },
      {
        id: 'shitpost_response',
        label: 'Double Down & Meme the Regulators',
        costDies: bsZero(),
        effectSummary:
          'Lifts VC freeze free and triggers +150% Viral Hype Yield Surge for 60s, while elevating sector entropy to 50%.',
      },
    ],
  },
});

/**
 * Creates a playable satirical crisis incident object for a cleanroom sector (0..3).
 * @param {string} type
 * @param {number} [sectorIdx=0]
 * @param {{ tier?: number, severityMult?: number, durationMult?: number }} [options]
 */
export function createCrisisIncident(type, sectorIdx = 0, options = {}) {
  const safeType = VALID_TYPES.has(type) ? type : CRISIS_TYPES.HALLUCINATION;
  const safeSector = Number.isInteger(sectorIdx)
    ? Math.max(0, Math.min(3, sectorIdx))
    : Math.max(0, Math.min(3, Math.floor(Number(sectorIdx) || 0)));

  const tierSpec = getTierSpec(options.tier ?? 1);
  const severityMult = Number.isFinite(options.severityMult) ? Math.max(0.1, options.severityMult) : 1.0;
  const durationMult = Number.isFinite(options.durationMult) ? Math.max(0.2, options.durationMult) : 1.0;

  const bp = CRISIS_BLUEPRINTS[safeType];
  const tierScale = Math.max(1, Math.sqrt(tierSpec.tierYieldMult));
  const paidCostDies = bsMul(bsFrom(bp.basePaidCostDies), bsFrom(tierScale * severityMult));
  const durationSec = Math.max(10, Math.round(bp.baseDurationSec * durationMult));
  const waferQuota =
    safeType === CRISIS_TYPES.MEME_PR_MELTDOWN
      ? Math.max(4, Math.round(12 * severityMult))
      : 0;

  return {
    id: `${safeType}_S${safeSector}`,
    type: safeType,
    sectorIdx: safeSector,
    title: bp.title,
    headline: bp.headline,
    description: bp.buildDescription(safeSector + 1),
    durationSec,
    elapsedSec: 0,
    vcSubsidyPenalty: safeType === CRISIS_TYPES.MEME_PR_MELTDOWN ? 0.4 : 0,
    surgeDurationSec: safeType === CRISIS_TYPES.MEME_PR_MELTDOWN ? 90 : 0,
    surgeBonusMult: safeType === CRISIS_TYPES.MEME_PR_MELTDOWN ? 1.5 : 0,
    waferQuota,
    choices: bp.buildChoices(paidCostDies),
  };
}

/**
 * Evaluates sector Context Entropies under QA backpressure and rolls a crisis
 * whenever any sector reaches or exceeds 100% entropy.
 * @param {number} qaBackpressureMax
 * @param {ArrayLike<number>} entropies
 * @param {() => number} [rng=Math.random]
 * @param {{ tier?: number, severityMult?: number, durationMult?: number }} [options]
 */
export function rollCrisis(qaBackpressureMax, entropies = [], rng = Math.random, options = {}) {
  let hotSector = -1;
  let hotEntropy = 0;

  for (let s = 0; s < 4; s++) {
    const val = Number(entropies?.[s]);
    if (Number.isFinite(val) && val >= 100 && val > hotEntropy) {
      hotEntropy = val;
      hotSector = s;
    }
  }

  if (hotSector < 0) {
    return null;
  }

  const rRaw = typeof rng === 'function' ? Number(rng()) : Math.random();
  const r = Number.isFinite(rRaw) ? rRaw - Math.floor(rRaw) : Math.random();

  let type;
  if (r < 1 / 3) {
    type = CRISIS_TYPES.HALLUCINATION;
  } else if (r < 2 / 3) {
    type = CRISIS_TYPES.PAPERCLIP_PANIC;
  } else {
    type = CRISIS_TYPES.MEME_PR_MELTDOWN;
  }

  const incident = createCrisisIncident(type, hotSector, options);
  incident.triggerBackpressure = Math.max(0, Number(qaBackpressureMax) || 0);
  return incident;
}

/**
 * Resolves an active crisis incident using the selected tactical choice ID,
 * validating Die costs and updating `state` cleanly.
 * @param {ReturnType<typeof createCrisisIncident> | null} crisis
 * @param {string} choiceId
 * @param {Record<string, any>} [state={}]
 */
export function resolveCrisis(crisis, choiceId, state = {}) {
  if (!crisis || typeof crisis !== 'object' || !Array.isArray(crisis.choices)) {
    return { resolved: false, reason: 'no_active_crisis' };
  }

  const choice = crisis.choices.find((c) => c.id === choiceId);
  if (!choice) {
    return { resolved: false, reason: 'invalid_choice' };
  }

  const targetState = state && typeof state === 'object' ? state : {};
  const curDies = targetState.dies !== undefined ? bsFrom(targetState.dies) : bsZero();
  const costDies = bsFrom(choice.costDies);

  if (costDies.m > 0 && bsCmp(curDies, costDies) < 0) {
    return {
      resolved: false,
      reason: 'insufficient_dies',
      requiredDies: costDies,
    };
  }

  let nextDies = bsSubClamped(curDies, costDies);
  let diesDelta = bsMul(costDies, bsFrom(-1));
  let flopsDelta = bsZero();

  if (!Array.isArray(targetState.entropies) || targetState.entropies.length < 4) {
    targetState.entropies = [0, 0, 0, 0];
  }
  const sIdx = Math.max(0, Math.min(3, Math.floor(Number(crisis.sectorIdx) || 0)));

  if (crisis.type === CRISIS_TYPES.HALLUCINATION) {
    if (choiceId === 'rollback_weights') {
      targetState.entropies[sIdx] = 15;
      targetState.defectPenalty = 0;
      targetState.defectPenaltyTimerSec = 0;
    } else {
      targetState.entropies[sIdx] = 45;
      targetState.defectPenalty = 0.08;
      targetState.defectPenaltyTimerSec = 20;
    }
  } else if (crisis.type === CRISIS_TYPES.PAPERCLIP_PANIC) {
    const clips = Math.max(1, Math.floor(Number(targetState.paperclips) || 0));
    if (choiceId === 'kill_switch') {
      targetState.entropies[sIdx] = 10;
      const smeltBonus = bsMul(bsFrom(clips), bsFrom(15));
      nextDies = bsAdd(nextDies, smeltBonus);
      diesDelta = bsAdd(diesDelta, smeltBonus);
    } else {
      targetState.entropies[sIdx] = 40;
      const fee = bsMul(nextDies, bsFrom(0.25));
      nextDies = bsSubClamped(nextDies, fee);
      diesDelta = bsMul(fee, bsFrom(-1));
      flopsDelta = bsMul(bsFrom(clips), bsFrom(250));
      targetState.flops = bsAdd(targetState.flops ?? bsZero(), flopsDelta);
      targetState.lifetimeFlops = bsAdd(targetState.lifetimeFlops ?? bsZero(), flopsDelta);
    }
    targetState.paperclips = 0;
  } else if (crisis.type === CRISIS_TYPES.MEME_PR_MELTDOWN) {
    targetState.vcSubsidyMult = 1.0;
    targetState.vcQuotaRemaining = 0;
    if (choiceId === 'hire_pr_spin') {
      targetState.entropies[sIdx] = 10;
      targetState.vcSurgeTimerSec = Math.max(Number(targetState.vcSurgeTimerSec) || 0, 90);
    } else {
      targetState.entropies[sIdx] = 50;
      targetState.vcSurgeTimerSec = Math.max(Number(targetState.vcSurgeTimerSec) || 0, 60);
    }
  }

  targetState.dies = nextDies;
  targetState.activeCrisis = null;

  return {
    resolved: true,
    choiceId: choice.id,
    crisisType: crisis.type,
    sectorIdx: sIdx,
    effectSummary: choice.effectSummary,
    diesDelta,
    flopsDelta,
    state: targetState,
  };
}
