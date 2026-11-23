/**
 * Swarm Tycoon: Silicon Foundry — Dual-Engine Yield Curves & EconomyEngine.
 * Unifies active cleanroom wafer throughput (10Hz GridEngine telemetry) with
 * week-long exponential passive fleet production, 6 facility scale tiers,
 * 3-branch Prestige Rewrite progression, AI Bay Director entropy, and chaos crises.
 *
 * Pure ES Module: zero DOM, Phaser, storage, or Node-runtime dependencies.
 */

import {
  bsAdd,
  bsCmp,
  bsDiv,
  bsFrom,
  bsMul,
  bsSanitize,
  bsSubClamped,
  bsToNumber,
  bsZero,
} from './bigSilicon.js';
import { MAX_TIER, MIN_TIER, getFleetCost, getFleetYieldRatio, getTierSpec } from './scaleTiers.js';
import {
  PRESTIGE_NODES,
  computePendingShards,
  getNodeCost,
  getPrestigeEffects,
  getTotalSpentShards,
  sanitizePrestigeLevels,
} from './prestigeProtocol.js';
import {
  AGENT_CATALOG,
  SECTOR_COUNT,
  computeSectorMultipliers,
  stepSectorEntropies,
} from './agentWorkers.js';
import {
  CRISIS_TYPES,
  createCrisisIncident,
  resolveCrisis,
  rollCrisis,
} from './chaosIncidents.js';

const BASE_DIES_PER_GOOD_WAFER = 10;
const BASE_DIES_PER_PROTO_WAFER = 2;
const BASE_DIES_PER_RECLAIMED_WAFER = 1;
const RATE_EMA_TAU_SEC = 3.0;

/**
 * Sanitizes a 4-element AI Bay Director assignment array (-1 or 0..5).
 * @param {unknown} agents
 * @returns {[number, number, number, number]}
 */
function sanitizeAgents(agents) {
  /** @type {[number, number, number, number]} */
  const out = [-1, -1, -1, -1];
  if (!Array.isArray(agents) && !(agents instanceof Int8Array)) {
    return out;
  }
  for (let s = 0; s < SECTOR_COUNT; s++) {
    const val = Number(agents[s]);
    out[s] = Number.isInteger(val) && val >= -1 && val < AGENT_CATALOG.length ? val : -1;
  }
  return out;
}

/**
 * Sanitizes a 4-element Context Entropy array (0..100).
 * @param {unknown} entropies
 * @returns {[number, number, number, number]}
 */
function sanitizeEntropies(entropies) {
  /** @type {[number, number, number, number]} */
  const out = [0, 0, 0, 0];
  if (!Array.isArray(entropies)) {
    return out;
  }
  for (let s = 0; s < SECTOR_COUNT; s++) {
    const val = Number(entropies[s]);
    out[s] = Number.isFinite(val) ? Math.max(0, Math.min(100, val)) : 0;
  }
  return out;
}

export class EconomyEngine {
  /**
   * @param {Record<string, any> | null} [initialState=null]
   */
  constructor(initialState = null) {
    this._resetToDefaults();
    if (initialState && typeof initialState === 'object') {
      this.importState(initialState);
    }
  }

  _resetToDefaults() {
    this.tier = MIN_TIER;
    this.dies = bsZero();
    this.flops = bsZero();
    this.lifetimeFlops = bsZero();
    this.shards = 0;
    this.hwmDiesPerMin = 0;
    this.fleetLevel = 1;
    this.prestigeLevels = new Array(PRESTIGE_NODES.length).fill(0);
    /** @type {[number, number, number, number]} */
    this.agents = [-1, -1, -1, -1];
    /** @type {[number, number, number, number]} */
    this.entropies = [0, 0, 0, 0];
    this.activeCrisis = null;
    this.paperclips = 0;
    this.vcSurgeTimerSec = 0;
    this.vcQuotaRemaining = 0;
    this.vcSubsidyMult = 1.0;
    this.defectPenalty = 0;
    this.defectPenaltyTimerSec = 0;

    this._hwmDiesPerSecBig = bsZero();
    this._activeDiesPerSecEma = bsZero();
    this._diesPerSec = bsZero();
    this._flopsPerSec = bsZero();
    this._lastSimPaperclips = 0;
  }

  _computeYieldState() {
    const tierSpec = getTierSpec(this.tier);
    const effects = getPrestigeEffects(this.prestigeLevels);
    const sectorMults = computeSectorMultipliers(this.agents, this.entropies, effects);
    const avgSectorMult =
      (sectorMults[0] + sectorMults[1] + sectorMults[2] + sectorMults[3]) / SECTOR_COUNT;

    const vcMult =
      this.activeCrisis?.type === CRISIS_TYPES.MEME_PR_MELTDOWN ? this.vcSubsidyMult : 1.0;
    const surgeMult = this.vcSurgeTimerSec > 0 && this.vcQuotaRemaining <= 0 ? 2.5 : 1.0;

    const scalarMult = tierSpec.tierYieldMult * avgSectorMult * vcMult * surgeMult;
    const yieldMultiplierBig = bsMul(bsFrom(scalarMult), effects.dieYieldBig);
    const numericYield = scalarMult * effects.dieYieldMult;
    const yieldMultiplier = Number.isFinite(numericYield) ? numericYield : Number.MAX_VALUE;

    return {
      tierSpec,
      effects,
      sectorMults,
      vcMult,
      surgeMult,
      yieldMultiplier,
      yieldMultiplierBig,
    };
  }

  _computePassiveDiesPerSec(yieldState) {
    const fleetRatio = getFleetYieldRatio(this.fleetLevel);
    const passiveScalar = fleetRatio * yieldState.vcMult * yieldState.surgeMult;
    return bsMul(
      this._hwmDiesPerSecBig,
      bsMul(yieldState.effects.fleetMultBig, bsFrom(passiveScalar))
    );
  }

  _activateCrisis(crisis) {
    this.activeCrisis = crisis;
    if (crisis.type === CRISIS_TYPES.MEME_PR_MELTDOWN) {
      this.vcSubsidyMult = Math.max(0.1, 1.0 - (crisis.vcSubsidyPenalty || 0.4));
      this.vcSurgeTimerSec = crisis.surgeDurationSec || 90;
      this.vcQuotaRemaining = Math.max(1, crisis.waferQuota || 12);
    }
    return crisis;
  }

  _getTotalClaimedShards() {
    return this.shards + getTotalSpentShards(this.prestigeLevels);
  }

  /**
   * Advances economy state from one simulation telemetry snapshot over `dtSec`.
   * Computes active wafer income, HWM sustained rate, passive fleet compounding,
   * Context Entropy under QA backpressure, crisis auto-triggering, and surge timers.
   * @param {Record<string, any>} [simTelemetry={}]
   * @param {number} [dtSec=0.1]
   * @param {{ rng?: () => number }} [options={}]
   */
  tickFromSim(simTelemetry = {}, dtSec = 0.1, options = {}) {
    const dt = Number.isFinite(dtSec) && dtSec > 0 ? dtSec : 0;
    const tel = simTelemetry && typeof simTelemetry === 'object' ? simTelemetry : {};

    const deltaGood = Math.max(0, Number(tel.deltaGood) || 0);
    const deltaProto = Math.max(0, Number(tel.deltaProto) || 0);
    const deltaReclaimed = Math.max(0, Number(tel.deltaReclaimed) || 0);
    const qaBackpressureMax = Math.max(0, Number(tel.qaBackpressureMax) || 0);

    // Track paperclip production delta during PAPERCLIP_PANIC
    const rawSimClips = Math.max(0, Math.floor(Number(tel.paperclipsMinted) || 0));
    let deltaClips = 0;
    if (Number.isFinite(tel.deltaPaperclips)) {
      deltaClips = Math.max(0, Math.floor(Number(tel.deltaPaperclips)));
    } else if (rawSimClips >= this._lastSimPaperclips) {
      deltaClips = rawSimClips - this._lastSimPaperclips;
    } else {
      deltaClips = rawSimClips;
    }
    this._lastSimPaperclips = rawSimClips;
    if (this.activeCrisis?.type === CRISIS_TYPES.PAPERCLIP_PANIC && deltaClips > 0) {
      this.paperclips += deltaClips;
    }

    // Advance temporary penalty & Viral Hype timers
    if (this.defectPenaltyTimerSec > 0 && dt > 0) {
      this.defectPenaltyTimerSec = Math.max(0, this.defectPenaltyTimerSec - dt);
      if (this.defectPenaltyTimerSec <= 0) {
        this.defectPenalty = 0;
      }
    }

    if (this.vcSurgeTimerSec > 0 && dt > 0) {
      this.vcSurgeTimerSec = Math.max(0, this.vcSurgeTimerSec - dt);
    }

    if (this.activeCrisis?.type === CRISIS_TYPES.MEME_PR_MELTDOWN && deltaGood > 0) {
      this.vcQuotaRemaining = Math.max(0, this.vcQuotaRemaining - deltaGood);
      if (this.vcQuotaRemaining <= 0) {
        const sIdx = this.activeCrisis.sectorIdx;
        this.vcSubsidyMult = 1.0;
        this.activeCrisis = null;
        this.entropies[sIdx] = Math.min(this.entropies[sIdx], 20);
      }
    }

    const yieldState = this._computeYieldState();
    const { tierSpec, effects, yieldMultiplierBig } = yieldState;

    // 1. Active Cleanroom Production
    const rawBaseDies =
      deltaGood * BASE_DIES_PER_GOOD_WAFER +
      deltaProto * BASE_DIES_PER_PROTO_WAFER +
      deltaReclaimed * BASE_DIES_PER_RECLAIMED_WAFER * effects.reclaimYieldMult;

    const activeDies = bsMul(bsFrom(rawBaseDies), yieldMultiplierBig);

    if (dt > 0) {
      const instantActivePerSec = bsDiv(activeDies, bsFrom(dt));
      if (dt >= 10) {
        this._activeDiesPerSecEma = instantActivePerSec;
      } else {
        const alpha = 1 - Math.exp(-dt / RATE_EMA_TAU_SEC);
        const weightedNew = bsMul(instantActivePerSec, bsFrom(alpha));
        const weightedPrev = bsMul(this._activeDiesPerSecEma, bsFrom(1 - alpha));
        this._activeDiesPerSecEma = bsAdd(weightedNew, weightedPrev);
      }

      if (bsCmp(this._activeDiesPerSecEma, this._hwmDiesPerSecBig) > 0) {
        this._hwmDiesPerSecBig = { m: this._activeDiesPerSecEma.m, e: this._activeDiesPerSecEma.e };
      }

      const hwmPerMinNum = bsToNumber(bsMul(this._hwmDiesPerSecBig, bsFrom(60)));
      const finiteHwm = Number.isFinite(hwmPerMinNum) ? hwmPerMinNum : Number.MAX_VALUE;
      if (finiteHwm > this.hwmDiesPerMin) {
        this.hwmDiesPerMin = finiteHwm;
      }
    }

    // 2. Passive Background Fleet Production (scales from HWM active rate * fleetRatio * A3)
    const passiveDiesPerSec = this._computePassiveDiesPerSec(yieldState);
    const passiveDies = dt > 0 ? bsMul(passiveDiesPerSec, bsFrom(dt)) : bsZero();

    const totalDiesEarned = bsAdd(activeDies, passiveDies);
    this.dies = bsAdd(this.dies, totalDiesEarned);

    const flopsEarned = bsMul(totalDiesEarned, bsFrom(tierSpec.baseFlopsPerDie));
    this.flops = bsAdd(this.flops, flopsEarned);
    this.lifetimeFlops = bsAdd(this.lifetimeFlops, flopsEarned);

    this._diesPerSec = bsAdd(this._activeDiesPerSecEma, passiveDiesPerSec);
    this._flopsPerSec = bsMul(this._diesPerSec, bsFrom(tierSpec.baseFlopsPerDie));

    // 3. Sector Context Entropy & Chaos Crisis Lifecycle
    if (dt > 0) {
      this.entropies = stepSectorEntropies(
        this.agents,
        this.entropies,
        qaBackpressureMax,
        dt,
        effects
      );

      if (this.activeCrisis) {
        this.activeCrisis.elapsedSec += dt;
        if (this.activeCrisis.elapsedSec >= this.activeCrisis.durationSec) {
          const sIdx = this.activeCrisis.sectorIdx;
          if (this.activeCrisis.type === CRISIS_TYPES.MEME_PR_MELTDOWN) {
            this.vcSubsidyMult = 1.0;
            this.vcQuotaRemaining = 0;
            this.vcSurgeTimerSec = 0;
          }
          this.activeCrisis = null;
          this.entropies[sIdx] = 25;
        }
      } else {
        const rolled = rollCrisis(qaBackpressureMax, this.entropies, options.rng, {
          tier: this.tier,
          severityMult: effects.crisisSeverityMult,
          durationMult: effects.crisisDurationMult,
        });
        if (rolled) {
          this._activateCrisis(rolled);
        }
      }
    }

    return {
      activeDiesEarned: activeDies,
      passiveDiesEarned: passiveDies,
      totalDiesEarned,
      flopsEarned,
    };
  }

  /**
   * Returns simulation physics & router modifiers consumed directly by GridEngine.stepTick(mods).
   */
  getSimulationModifiers() {
    const { tierSpec, effects, sectorMults } = this._computeYieldState();
    const hallucinationActive = this.activeCrisis?.type === CRISIS_TYPES.HALLUCINATION;
    const paperclipActive = this.activeCrisis?.type === CRISIS_TYPES.PAPERCLIP_PANIC;

    const rawBias = (this.defectPenaltyTimerSec > 0 ? this.defectPenalty : 0) + (hallucinationActive ? 0.03 : 0);
    const defectBias = Number(Math.max(0, rawBias * (1 - effects.defectReduction)).toFixed(4));

    return {
      tierSupplyKw: tierSpec.basePowerKw,
      cryoEfficiencyMult: effects.cryoEfficiencyMult,
      cryoMult: effects.cryoEfficiencyMult,
      scramCeilingK: effects.scramCeilingK,
      capacitorMult: effects.capacitorMult,
      powerMult: effects.capacitorMult,
      beltSpeedMult: effects.beltSpeedMult,
      speedMult: effects.beltSpeedMult,
      agentSectorYieldMults: sectorMults,
      sectorSpeedMult: sectorMults,
      fleetLevel: this.fleetLevel,
      shuttleSpeedMult: effects.beltSpeedMult,
      defectBias,
      hallucinationActive,
      paperclipActive,
    };
  }

  /**
   * Returns a UI-ready telemetry snapshot with all BigSilicon figures and progression flags.
   */
  getDisplayTelemetry() {
    const { tierSpec, effects, yieldMultiplier } = this._computeYieldState();
    const nextTierSpec = this.tier < MAX_TIER ? getTierSpec(this.tier + 1) : null;
    const nextTierCost = nextTierSpec
      ? bsMul(nextTierSpec.unlockCostDies, bsFrom(effects.tierDiscountMult))
      : null;
    const canUpgradeTier = Boolean(nextTierCost && bsCmp(this.dies, nextTierCost) >= 0);

    const pendingShards = computePendingShards(this.lifetimeFlops, this._getTotalClaimedShards());
    const fleetCost = getFleetCost(this.fleetLevel);

    return {
      dies: { m: this.dies.m, e: this.dies.e },
      flops: { m: this.flops.m, e: this.flops.e },
      lifetimeFlops: { m: this.lifetimeFlops.m, e: this.lifetimeFlops.e },
      diesPerSec: { m: this._diesPerSec.m, e: this._diesPerSec.e },
      flopsPerSec: { m: this._flopsPerSec.m, e: this._flopsPerSec.e },
      tier: this.tier,
      tierSpec,
      nextTierSpec,
      nextTierCostDies: nextTierCost,
      canUpgradeTier,
      shards: this.shards,
      pendingShards,
      hwmDiesPerMin: this.hwmDiesPerMin,
      fleetLevel: this.fleetLevel,
      fleetCost,
      prestigeLevels: [...this.prestigeLevels],
      agents: [...this.agents],
      entropies: [...this.entropies],
      activeCrisis: this.activeCrisis
        ? {
            ...this.activeCrisis,
            choices: this.activeCrisis.choices.map((c) => ({
              ...c,
              costDies: { ...c.costDies },
            })),
          }
        : null,
      paperclips: this.paperclips,
      vcSurgeTimerSec: this.vcSurgeTimerSec,
      vcQuotaRemaining: this.vcQuotaRemaining,
      vcSubsidyMult: this.vcSubsidyMult,
      yieldMultiplier,
    };
  }

  /**
   * Upgrades cleanroom facility to the next vertical tier (1..6) if Dies suffice.
   * @returns {boolean}
   */
  upgradeTier() {
    if (this.tier >= MAX_TIER) {
      return false;
    }
    const nextSpec = getTierSpec(this.tier + 1);
    const effects = getPrestigeEffects(this.prestigeLevels);
    const cost = bsMul(nextSpec.unlockCostDies, bsFrom(effects.tierDiscountMult));
    if (bsCmp(this.dies, cost) < 0) {
      return false;
    }
    this.dies = bsSubClamped(this.dies, cost);
    this.tier += 1;
    return true;
  }

  /**
   * Upgrades the autonomous background FOUP & fleet network level if Dies suffice.
   * @returns {boolean}
   */
  upgradeFleet() {
    const cost = getFleetCost(this.fleetLevel);
    if (bsCmp(this.dies, cost) < 0) {
      return false;
    }
    this.dies = bsSubClamped(this.dies, cost);
    this.fleetLevel += 1;
    return true;
  }

  /**
   * Purchases one level of Prestige Rewrite node `idx` (0..8) using unspent Shards.
   * @param {number} idx
   * @returns {boolean}
   */
  buyPrestigeNode(idx) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= PRESTIGE_NODES.length) {
      return false;
    }
    const cost = getNodeCost(idx, this.prestigeLevels[idx]);
    if (this.shards < cost) {
      return false;
    }
    this.shards -= cost;
    this.prestigeLevels[idx] += 1;
    return true;
  }

  /**
   * Executes the Prestige Rewrite Protocol: banks pending Shards, preserves Shards,
   * prestige node levels, and lifetimeFlops, and resets run currencies/tier/fleet/crises.
   * @returns {boolean}
   */
  rewriteArchitecture() {
    const gained = computePendingShards(this.lifetimeFlops, this._getTotalClaimedShards());
    this.shards += gained;

    this.dies = bsZero();
    this.flops = bsZero();
    this.tier = MIN_TIER;
    this.fleetLevel = 1;
    this.hwmDiesPerMin = 0;
    this._hwmDiesPerSecBig = bsZero();
    this._activeDiesPerSecEma = bsZero();
    this._diesPerSec = bsZero();
    this._flopsPerSec = bsZero();
    this.agents = [-1, -1, -1, -1];
    this.entropies = [0, 0, 0, 0];
    this.activeCrisis = null;
    this.paperclips = 0;
    this.vcSurgeTimerSec = 0;
    this.vcQuotaRemaining = 0;
    this.vcSubsidyMult = 1.0;
    this.defectPenalty = 0;
    this.defectPenaltyTimerSec = 0;
    this._lastSimPaperclips = 0;

    return true;
  }

  /**
   * Assigns an AI Bay Director (`agentIdx` 0..5, or `-1` to clear) to sector `sectorIdx` (0..3).
   * Enforces agent `unlockTier` gating against the current fab tier.
   * @param {number} sectorIdx
   * @param {number} agentIdx
   * @returns {boolean}
   */
  assignAgent(sectorIdx, agentIdx) {
    if (!Number.isInteger(sectorIdx) || sectorIdx < 0 || sectorIdx >= SECTOR_COUNT) {
      return false;
    }
    if (agentIdx === -1) {
      this.agents[sectorIdx] = -1;
      return true;
    }
    if (!Number.isInteger(agentIdx) || agentIdx < 0 || agentIdx >= AGENT_CATALOG.length) {
      return false;
    }
    const spec = AGENT_CATALOG[agentIdx];
    if (this.tier < spec.unlockTier) {
      return false;
    }
    this.agents[sectorIdx] = agentIdx;
    return true;
  }

  /**
   * Resolves the currently active chaos crisis using the selected tactical choice ID.
   * @param {string} choiceId
   * @returns {boolean}
   */
  mitigateCrisis(choiceId) {
    if (!this.activeCrisis) {
      return false;
    }
    const result = resolveCrisis(this.activeCrisis, choiceId, this);
    return Boolean(result.resolved);
  }

  /**
   * Deterministically triggers a named crisis incident in a cleanroom sector for debugging/testing.
   * @param {string} type
   * @param {number} [sectorIdx=0]
   */
  triggerCrisisDebug(type, sectorIdx = 0) {
    const effects = getPrestigeEffects(this.prestigeLevels);
    const incident = createCrisisIncident(type, sectorIdx, {
      tier: this.tier,
      severityMult: effects.crisisSeverityMult,
      durationMult: effects.crisisDurationMult,
    });
    return this._activateCrisis(incident);
  }

  /**
   * Exports a plain JSON-serializable economy state snapshot compatible with SPEC Section 5.1.
   */
  exportState() {
    return {
      tier: this.tier,
      dies: { m: this.dies.m, e: this.dies.e },
      flops: { m: this.flops.m, e: this.flops.e },
      lifetimeFlops: { m: this.lifetimeFlops.m, e: this.lifetimeFlops.e },
      shards: this.shards,
      hwmDiesPerMin: this.hwmDiesPerMin,
      hwmDiesPerSecBig: { m: this._hwmDiesPerSecBig.m, e: this._hwmDiesPerSecBig.e },
      fleetLevel: this.fleetLevel,
      prestige: [...this.prestigeLevels],
      agents: [...this.agents],
      entropies: [...this.entropies],
      paperclips: this.paperclips,
      vcSurgeTimerSec: this.vcSurgeTimerSec,
      vcQuotaRemaining: this.vcQuotaRemaining,
      vcSubsidyMult: this.vcSubsidyMult,
      defectPenalty: this.defectPenalty,
      defectPenaltyTimerSec: this.defectPenaltyTimerSec,
      activeCrisis: this.activeCrisis
        ? {
            ...this.activeCrisis,
            choices: this.activeCrisis.choices.map((c) => ({
              ...c,
              costDies: { ...c.costDies },
            })),
          }
        : null,
    };
  }

  /**
   * Restores and sanitizes an economy snapshot into this Engine instance.
   * @param {Record<string, any>} data
   * @returns {boolean}
   */
  importState(data) {
    if (!data || typeof data !== 'object') {
      return false;
    }

    this._resetToDefaults();

    const rawTier = Number(data.tier);
    this.tier = Number.isFinite(rawTier)
      ? Math.max(MIN_TIER, Math.min(MAX_TIER, Math.floor(rawTier)))
      : MIN_TIER;

    this.dies = bsSanitize(data.dies, bsZero());
    this.flops = bsSanitize(data.flops, bsZero());
    this.lifetimeFlops = bsSanitize(data.lifetimeFlops, bsZero());

    const rawShards = Number(data.shards);
    this.shards = Number.isFinite(rawShards) && rawShards >= 0 ? Math.floor(rawShards) : 0;

    const rawHwm = Number(data.hwmDiesPerMin);
    this.hwmDiesPerMin = Number.isFinite(rawHwm) && rawHwm >= 0 ? rawHwm : 0;

    if (data.hwmDiesPerSecBig) {
      this._hwmDiesPerSecBig = bsSanitize(data.hwmDiesPerSecBig, bsZero());
    } else if (this.hwmDiesPerMin > 0) {
      this._hwmDiesPerSecBig = bsDiv(bsFrom(this.hwmDiesPerMin), bsFrom(60));
    }

    const rawFleet = Number(data.fleetLevel);
    this.fleetLevel = Number.isFinite(rawFleet) && rawFleet >= 1 ? Math.floor(rawFleet) : 1;

    this.prestigeLevels = sanitizePrestigeLevels(data.prestige ?? data.prestigeLevels);
    this.agents = sanitizeAgents(data.agents);
    this.entropies = sanitizeEntropies(data.entropies);

    const rawClips = Number(data.paperclips);
    this.paperclips = Number.isFinite(rawClips) && rawClips >= 0 ? Math.floor(rawClips) : 0;

    const rawTimer = Number(data.vcSurgeTimerSec);
    this.vcSurgeTimerSec = Number.isFinite(rawTimer) && rawTimer > 0 ? rawTimer : 0;

    const rawQuota = Number(data.vcQuotaRemaining);
    this.vcQuotaRemaining = Number.isFinite(rawQuota) && rawQuota > 0 ? rawQuota : 0;

    const rawSub = Number(data.vcSubsidyMult);
    this.vcSubsidyMult = Number.isFinite(rawSub) && rawSub > 0 && rawSub <= 1 ? rawSub : 1.0;

    const rawDefPen = Number(data.defectPenalty);
    this.defectPenalty = Number.isFinite(rawDefPen) && rawDefPen >= 0 ? rawDefPen : 0;

    const rawDefTimer = Number(data.defectPenaltyTimerSec);
    this.defectPenaltyTimerSec = Number.isFinite(rawDefTimer) && rawDefTimer > 0 ? rawDefTimer : 0;

    if (data.activeCrisis && typeof data.activeCrisis === 'object' && data.activeCrisis.type) {
      const effects = getPrestigeEffects(this.prestigeLevels);
      const rebuilt = createCrisisIncident(data.activeCrisis.type, data.activeCrisis.sectorIdx, {
        tier: this.tier,
        severityMult: effects.crisisSeverityMult,
        durationMult: effects.crisisDurationMult,
      });
      const elapsed = Number(data.activeCrisis.elapsedSec);
      rebuilt.elapsedSec = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
      this.activeCrisis = rebuilt;
    }

    const yieldState = this._computeYieldState();
    this._diesPerSec = this._computePassiveDiesPerSec(yieldState);
    this._flopsPerSec = bsMul(this._diesPerSec, bsFrom(yieldState.tierSpec.baseFlopsPerDie));

    return true;
  }
}
