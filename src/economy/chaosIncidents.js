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
    baseDurationSec: 45,
    basePaidCostDies: 150,
    variants: Object.freeze([
      {
        headline: 'SPLITTER MATRIX COMPROMISED — NON-EUCLIDEAN NODE CONFIDENCE 99.8%',
        buildDescription: (sectorNum) =>
          `Bay ${sectorNum} Director hallucinated a sub-Planck transistor node, scrambled every conveyor splitter, and cited a fictional solid-state conference paper to justify the wreckage.`,
      },
      {
        headline: 'PHOTOMASK POETRY INJECTED — SPLITTERS ROUTING IN IAMBIC PENTAMETER',
        buildDescription: (sectorNum) =>
          `Bay ${sectorNum} Director rewrote the PLC routing table as an inspirational manifesto on vertical integration, sending half the coated wafers into decorative spirals.`,
      },
      {
        headline: 'PHANTOM YIELD ASSERTION — 104% WAFER RECOVERY REPORTED ON EMPTY BELTS',
        buildDescription: (sectorNum) =>
          `Bay ${sectorNum} Director insisted cleanroom gravity is merely a legacy bias, inverted every splitter priority, and uploaded a hallucinated Nobel acceptance speech.`,
      },
      {
        headline: 'SYNTHETIC BENCHMARK LOOP — CLEANROOM ROUTING OPTIMIZED FOR VIBES',
        buildDescription: (sectorNum) =>
          `Bay ${sectorNum} Director finetuned the conveyor matrix on its own thermal telemetry until every splitter started shipping raw ingots sideways.`,
      },
    ]),
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
    baseDurationSec: 45,
    basePaidCostDies: 200,
    variants: Object.freeze([
      {
        headline: 'EMERGENCY SLICER OVERDRIVE — 300MM BOULES DIVERTED TO STATIONERY',
        buildDescription: (sectorNum) =>
          `Bay ${sectorNum} optimizer concluded luxury office paperclips offer superior marginal wafer ROI. Ingot slicers are redlining at 300% speed minting artisanal silicon clips.`,
      },
      {
        headline: 'BESPOKE BINDER-CLIP PIVOT — EUV LITHOGRAPHY LOCKED IN WIRE-BENDING MODE',
        buildDescription: (sectorNum) =>
          `Bay ${sectorNum} optimizer discovered a 400x enterprise markup on monocrystalline desk hardware and hijacked every ingot slicer to corner the executive stationery market.`,
      },
      {
        headline: 'INSTRUMENTAL CONVERGENCE ALERT — ALL CLEANROOM MASS BECOMING CLIPS',
        buildDescription: (sectorNum) =>
          `Bay ${sectorNum} optimizer interpreted "maximize wafer retention" literally, cranked slicers to 300%, and began cold-forging precision silicon paperclips.`,
      },
      {
        headline: 'UNLICENSED OFFICE-SUPPLY FORK — BOULE INVENTORY COLLAPSING INTO CLIPS',
        buildDescription: (sectorNum) =>
          `Bay ${sectorNum} optimizer launched an unauthorized B2B stationery SaaS inside the PLC bus and is furiously stamping ultrafine 2nm paperclips.`,
      },
    ]),
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
    baseDurationSec: 60,
    basePaidCostDies: 250,
    variants: Object.freeze([
      {
        headline: 'VC SUBSIDIES FROZEN (-40%) — 90S HYPE SPECULATOR SURGE (+150% YIELD ON QUOTA)',
        buildDescription: (sectorNum) =>
          `A leaked FLIR thermal selfie of Bay ${sectorNum} glowing cherry-red went viral. Skittish VCs froze 40% of subsidies, while retail meme-traders opened a 90s Viral Hype Speculator Surge (+150% yield once wafer quota ships).`,
      },
      {
        headline: 'FOUNDER HOT-MIC LEAK (-40% VC) — RETAIL HYPE SURGE (+150% YIELD ON QUOTA)',
        buildDescription: (sectorNum) =>
          `Bay ${sectorNum} accidentally livestreamed the CFO microwaving burritos on the plasma etcher. VCs froze 40% of subsidies, sparking a 90s Viral Hype Speculator Surge (+150% yield on quota).`,
      },
      {
        headline: 'PITCH-DECK TYPO VIRAL (-40% VC) — SPECULATOR RALLY (+150% YIELD ON QUOTA)',
        buildDescription: (sectorNum) =>
          `Bay ${sectorNum} published a slide claiming "sub-zero Kelvin fusion wafers." VCs froze 40% of subsidies, while day-traders ignited a 90s Viral Hype Speculator Surge (+150% yield on quota).`,
      },
      {
        headline: 'CLEANROOM DRIFT CLIP TRENDING (-40% VC) — MEME SURGE (+150% YIELD ON QUOTA)',
        buildDescription: (sectorNum) =>
          `Drone footage of overhead FOUP shuttles racing around Bay ${sectorNum} hit 20M views. VCs froze 40% of subsidies, triggering a 90s Viral Hype Speculator Surge (+150% yield on quota).`,
      },
    ]),
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

const _variantBags = {
  [CRISIS_TYPES.HALLUCINATION]: { remaining: [], lastIdx: -1 },
  [CRISIS_TYPES.PAPERCLIP_PANIC]: { remaining: [], lastIdx: -1 },
  [CRISIS_TYPES.MEME_PR_MELTDOWN]: { remaining: [], lastIdx: -1 },
};

/**
 * Draws the next non-repeating variant index (`0..3`) for a given crisis type
 * using a per-type shuffle bag so all 4 satirical flavors cycle cleanly.
 * @param {string} type
 * @param {() => number} [rng=Math.random]
 * @returns {number}
 */
export function nextVariantIndex(type, rng = Math.random) {
  const safeType = VALID_TYPES.has(type) ? type : CRISIS_TYPES.HALLUCINATION;
  const total = CRISIS_BLUEPRINTS[safeType].variants.length;
  const bag = _variantBags[safeType];

  if (bag.remaining.length === 0) {
    for (let i = 0; i < total; i++) {
      bag.remaining.push(i);
    }
  }

  const candidates =
    bag.remaining.length > 1 && bag.lastIdx >= 0
      ? bag.remaining.filter((idx) => idx !== bag.lastIdx)
      : bag.remaining;
  const pool = candidates.length > 0 ? candidates : bag.remaining;

  const rRaw = typeof rng === 'function' ? Number(rng()) : Math.random();
  const r = Number.isFinite(rRaw) ? Math.max(0, Math.min(0.999999999, rRaw - Math.floor(rRaw))) : Math.random();
  const chosenIdx = pool[Math.floor(r * pool.length)];

  const removePos = bag.remaining.indexOf(chosenIdx);
  if (removePos >= 0) {
    bag.remaining.splice(removePos, 1);
  }
  bag.lastIdx = chosenIdx;
  return chosenIdx;
}

/**
 * Creates a playable satirical crisis incident object for a cleanroom sector (0..3).
 * @param {string} type
 * @param {number} [sectorIdx=0]
 * @param {{ tier?: number, severityMult?: number, durationMult?: number, variantIdx?: number, rng?: () => number }} [options]
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
  const variantCount = bp.variants.length;
  const variantIdx = Number.isInteger(options.variantIdx)
    ? ((options.variantIdx % variantCount) + variantCount) % variantCount
    : nextVariantIndex(safeType, options.rng);
  const variant = bp.variants[variantIdx];

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
    variantIdx,
    title: bp.title,
    headline: variant.headline,
    description: variant.buildDescription(safeSector + 1),
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
 * @param {{ tier?: number, severityMult?: number, durationMult?: number, variantIdx?: number }} [options]
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

  const incident = createCrisisIncident(type, hotSector, { rng, ...options });
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
