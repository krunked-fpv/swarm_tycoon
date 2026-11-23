import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bsZero,
  bsFrom,
  bsNormalize,
  bsIsValid,
  bsSanitize,
  bsAdd,
  bsSub,
  bsSubClamped,
  bsMul,
  bsDiv,
  bsCmp,
  bsMax,
  bsMin,
  bsLog10,
  bsPow10,
  bsToNumber,
  bsFormat,
} from '../src/economy/bigSilicon.js';
import {
  SCALE_TIERS,
  getTierSpec,
  getFleetCost,
  getFleetYieldRatio,
} from '../src/economy/scaleTiers.js';
import {
  PRESTIGE_NODES,
  computePendingShards,
  getNodeCost,
  getPrestigeEffects,
} from '../src/economy/prestigeProtocol.js';
import {
  AGENT_CATALOG,
  computeSectorMultipliers,
} from '../src/economy/agentWorkers.js';
import {
  CRISIS_TYPES,
  createCrisisIncident,
  rollCrisis,
  resolveCrisis,
} from '../src/economy/chaosIncidents.js';
import { EconomyEngine } from '../src/economy/yieldCurves.js';
import { GridEngine, MACHINE_TYPES, DIRS } from '../src/sim/gridEngine.js';

test('1. BigSilicon overflow stress (1e308 -> 1e100000), arithmetic, sanitization, and SI formatting', () => {
  assert.deepEqual(bsZero(), { m: 0, e: 0 });
  assert.equal(bsIsValid(bsZero()), true);
  assert.equal(bsIsValid({ m: 0, e: 5 }), false);
  assert.equal(bsIsValid({ m: 12, e: 2 }), false);
  assert.equal(bsIsValid({ m: 1.5, e: 1.5 }), false);
  assert.equal(bsIsValid({ m: NaN, e: 0 }), false);
  assert.equal(bsIsValid({ m: Infinity, e: 10 }), false);
  assert.equal(bsIsValid({ m: -0, e: 0 }), false);

  // Normalization & string parsing way past IEEE-754 float64 1e308
  const hugeA = bsFrom('1.42e5000');
  const hugeB = bsFrom('2.50e5000');
  const ultra = bsFrom('7.5e100000');
  assert.deepEqual(hugeA, { m: 1.42, e: 5000 });
  assert.deepEqual(ultra, { m: 7.5, e: 100000 });
  assert.equal(bsIsValid(hugeA), true);
  assert.equal(bsIsValid(ultra), true);

  // Sub-normal & unnormalized object folding
  assert.deepEqual(bsNormalize(142, 14), { m: 1.42, e: 16 });
  assert.deepEqual(bsNormalize(0.0045, 10), { m: 4.5, e: 7 });
  assert.deepEqual(bsNormalize(-0, 99), { m: 0, e: 0 });

  // Add / Sub / SubClamped at 1e308..1e5000
  const sum = bsAdd(hugeA, hugeB);
  assert.equal(sum.e, 5000);
  assert.ok(Math.abs(sum.m - 3.92) < 1e-12);

  const crossScaleSum = bsAdd({ m: 1, e: 5000 }, { m: 9, e: 4970 });
  assert.deepEqual(crossScaleSum, { m: 1, e: 5000 });

  const diff = bsSub(hugeB, hugeA);
  assert.equal(diff.e, 5000);
  assert.ok(Math.abs(diff.m - 1.08) < 1e-12);

  const negDiff = bsSub(hugeA, hugeB);
  assert.equal(negDiff.e, 5000);
  assert.ok(Math.abs(negDiff.m - -1.08) < 1e-12);

  assert.deepEqual(bsSubClamped(hugeA, hugeB), { m: 0, e: 0 });
  assert.deepEqual(bsSub(hugeA, hugeA), { m: 0, e: 0 });

  // Mul / Div past 1e308 -> 1e5000
  const prod = bsMul({ m: 5, e: 300 }, { m: 4, e: 4700 });
  assert.deepEqual(prod, { m: 2, e: 5001 });

  const quot = bsDiv({ m: 9, e: 5000 }, { m: 3, e: 4692 });
  assert.deepEqual(quot, { m: 3, e: 308 });
  assert.deepEqual(bsDiv(hugeA, bsZero()), { m: 0, e: 0 });

  // Cmp / Max / Min
  assert.equal(bsCmp(hugeA, hugeB), -1);
  assert.equal(bsCmp(hugeB, hugeA), 1);
  assert.equal(bsCmp(hugeA, { m: 1.42, e: 5000 }), 0);
  assert.equal(bsCmp({ m: -5, e: 10 }, { m: 1, e: 0 }), -1);
  assert.deepEqual(bsMax(hugeA, hugeB), hugeB);
  assert.deepEqual(bsMin(hugeA, hugeB), hugeA);

  // Log10 / Pow10 / ToNumber
  assert.equal(bsLog10({ m: 1, e: 5000 }), 5000);
  assert.ok(Math.abs(bsLog10({ m: 3.1622776601683795, e: 308 }) - 308.5) < 1e-9);
  assert.equal(bsLog10(bsZero()), -Infinity);
  const p5000 = bsPow10(5000);
  assert.deepEqual(p5000, { m: 1, e: 5000 });
  const pFrac = bsPow10(308.5);
  assert.equal(pFrac.e, 308);
  assert.ok(Math.abs(pFrac.m - Math.sqrt(10)) < 1e-12);
  assert.equal(bsToNumber(bsFrom(42.5)), 42.5);
  assert.equal(bsToNumber(hugeA), Infinity);

  // NaN / Infinity sanitization
  const fb = { m: 5, e: 2 };
  assert.deepEqual(bsSanitize(NaN, fb), fb);
  assert.deepEqual(bsSanitize(Infinity, fb), fb);
  assert.deepEqual(bsSanitize(-Infinity, fb), fb);
  assert.deepEqual(bsSanitize({ m: NaN, e: 5 }, fb), fb);
  assert.deepEqual(bsSanitize({ m: 2, e: Infinity }, fb), fb);
  assert.deepEqual(bsSanitize('not-a-number', fb), fb);
  assert.deepEqual(bsSanitize({ m: 25, e: 1 }, fb), { m: 2.5, e: 2 });

  // SI / Engineering formatting
  assert.equal(bsFormat(bsZero(), 'Dies'), '0 Dies');
  assert.equal(bsFormat({ m: 2.5, e: 3 }, 'Dies'), '2.50K Dies');
  assert.equal(bsFormat({ m: 1.42, e: 16 }, 'Dies'), '14.2 Peta-Dies');
  assert.equal(bsFormat({ m: 3.8, e: 21 }, 'FLOPs'), '3.80 Zetta-FLOPs');
  assert.equal(bsFormat({ m: 6.4, e: 30 }, 'Dies'), '6.40 Quetta-Dies');
  assert.equal(bsFormat({ m: 1.42, e: 450 }), '1.42e450');
  assert.equal(bsFormat({ m: 1.42, e: 450 }, 'FLOPs'), '1.42e450 FLOPs');
});

test('2. All 6 vertical SCALE_TIERS, fleet curves, and EconomyEngine upgradeTier() progression', () => {
  const expectedGridSizes = [8, 12, 16, 20, 24, 28];
  const expectedPowerKw = [15, 120, 2400, 25000, 180000, 1500000];
  const expectedNames = [
    'Garage FPGA Workbench',
    'Seed-Stage Boutique Cleanroom',
    'High-NA EUV Semiconductor Megafab',
    'Hyperscale Autonomous Silicon Campus',
    'Lunar Crater Vacuum Foundry',
    'Orbital Lithography Mega-Fab & AI Cluster',
  ];

  assert.equal(Object.keys(SCALE_TIERS).length, 6);
  for (let t = 1; t <= 6; t++) {
    const spec = getTierSpec(t);
    assert.equal(spec.tier, t);
    assert.equal(spec.name, expectedNames[t - 1]);
    assert.equal(spec.gridSize, expectedGridSizes[t - 1]);
    assert.equal(spec.basePowerKw, expectedPowerKw[t - 1]);
    assert.equal(bsIsValid(spec.unlockCostDies), true);
  }

  // Fleet cost & ratio stay finite and strictly monotonic even at extreme levels
  const c1 = getFleetCost(1);
  const c10 = getFleetCost(10);
  const c1500 = getFleetCost(1500);
  assert.equal(bsCmp(c10, c1), 1);
  assert.equal(bsIsValid(c1500), true);
  assert.ok(c1500.e > 308);
  assert.ok(getFleetYieldRatio(1) > 0);
  assert.ok(getFleetYieldRatio(16) > getFleetYieldRatio(4));

  // Progress through all 6 tiers via EconomyEngine.upgradeTier()
  const econ = new EconomyEngine();
  assert.equal(econ.getDisplayTelemetry().tier, 1);
  assert.equal(econ.upgradeTier(), false); // 0 Dies cannot unlock Tier 2

  for (let targetTier = 2; targetTier <= 6; targetTier++) {
    const nextSpec = getTierSpec(targetTier);
    econ.dies = bsFrom(nextSpec.unlockCostDies);
    assert.equal(econ.getDisplayTelemetry().canUpgradeTier, true);
    assert.equal(econ.upgradeTier(), true);
    assert.equal(econ.getDisplayTelemetry().tier, targetTier);
    assert.equal(econ.getSimulationModifiers().tierSupplyKw, nextSpec.basePowerKw);
  }

  // Tier 6 is the ceiling
  assert.equal(econ.getDisplayTelemetry().nextTierSpec, null);
  assert.equal(econ.getDisplayTelemetry().canUpgradeTier, false);
  assert.equal(econ.upgradeTier(), false);
});

test('3. Prestige Rewrite shard math (1e6, 1e308, 1e1500), A/B/C multipliers, and rewriteArchitecture()', () => {
  assert.equal(PRESTIGE_NODES.length, 9);
  assert.equal(computePendingShards(0, 0), 0);
  assert.equal(computePendingShards({ m: 9.9, e: 5 }, 0), 0);

  const s1e6 = computePendingShards({ m: 1, e: 6 }, 0);
  const s1e308 = computePendingShards({ m: 1, e: 308 }, 0);
  const s1e1500 = computePendingShards({ m: 1, e: 1500 }, 0);
  const s1e5000 = computePendingShards({ m: 1, e: 5000 }, 0);

  assert.ok(s1e6 >= 1, `Expected >= 1 shard at 1e6 FLOPs, got ${s1e6}`);
  assert.ok(s1e308 > s1e6 && Number.isSafeInteger(s1e308));
  assert.ok(s1e1500 > s1e308 && Number.isSafeInteger(s1e1500));
  assert.ok(s1e5000 > s1e1500 && Number.isSafeInteger(s1e5000));
  assert.equal(computePendingShards({ m: 1, e: 308 }, s1e308), 0);

  // Branch A/B/C effect verification
  const baseFx = getPrestigeEffects([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(baseFx.dieYieldMult, 1);
  assert.equal(baseFx.scramCeilingK, 390);

  const maxedFx = getPrestigeEffects([3, 2, 2, 2, 2, 3, 2, 2, 2]);
  assert.ok(maxedFx.dieYieldMult > 3.0);
  assert.equal(maxedFx.beltSpeedMult, 1.5);
  assert.ok(maxedFx.fleetMult > 2.5);
  assert.ok(maxedFx.tierDiscountMult < 1.0);
  assert.equal(maxedFx.cryoEfficiencyMult, 1.6);
  assert.equal(maxedFx.capacitorMult, 1.5);
  assert.equal(maxedFx.scramCeilingK, 390 + 3 * 40); // +40K per level on B3
  assert.equal(maxedFx.agentYieldMult, 1.7);
  assert.ok(maxedFx.entropyRateMult < 1.0);
  assert.ok(maxedFx.crisisSeverityMult < 1.0);
  assert.ok(maxedFx.crisisDurationMult < 1.0);
  assert.ok(maxedFx.defectReduction > 0);
  assert.equal(maxedFx.reclaimYieldMult, 2.0);

  // Full Prestige Rewrite cycle preserving shards & prestige levels while resetting run currency
  const econ = new EconomyEngine({
    tier: 4,
    dies: { m: 5, e: 12 },
    flops: { m: 1, e: 18 },
    lifetimeFlops: { m: 1, e: 308 },
    shards: 10,
    hwmDiesPerMin: 5000,
    fleetLevel: 8,
    prestige: [1, 0, 0, 0, 0, 2, 0, 0, 0],
  });

  const beforePending = econ.getDisplayTelemetry().pendingShards;
  assert.ok(beforePending > 0);
  assert.equal(econ.rewriteArchitecture(), true);

  const afterTel = econ.getDisplayTelemetry();
  assert.equal(afterTel.tier, 1);
  assert.equal(afterTel.fleetLevel, 1);
  assert.equal(afterTel.hwmDiesPerMin, 0);
  assert.deepEqual(afterTel.dies, bsZero());
  assert.deepEqual(afterTel.flops, bsZero());
  assert.deepEqual(afterTel.lifetimeFlops, { m: 1, e: 308 });
  assert.equal(afterTel.shards, 10 + beforePending);
  assert.deepEqual(afterTel.prestigeLevels, [1, 0, 0, 0, 0, 2, 0, 0, 0]);
  assert.equal(afterTel.pendingShards, 0); // cannot double-claim shards

  // Buy prestige nodes and confirm modifiers reflect immediately
  const nodeCost = getNodeCost(5, 2);
  assert.ok(afterTel.shards >= nodeCost);
  assert.equal(econ.buyPrestigeNode(5), true); // B3 level 2 -> 3
  assert.equal(econ.getSimulationModifiers().scramCeilingK, 390 + 3 * 40);
  assert.equal(econ.buyPrestigeNode(99), false);
});

test('4. AI Bay Directors entropy accumulation under QA backpressure -> triggering & resolving all 3 crises', () => {
  assert.equal(AGENT_CATALOG.length, 6);
  const expectedDirectors = [
    'LithoMaxxer-9000',
    'CryoDaemon',
    'SynergyBot-X',
    'YieldOracle',
    'TapeoutTitan',
    'SingularityDirector',
  ];
  assert.deepEqual(
    AGENT_CATALOG.map((a) => a.name),
    expectedDirectors
  );

  const sectorMults = computeSectorMultipliers([0, -1, 1, -1], [0, 0, 50, 0], {
    agentYieldMult: 1.0,
  });
  assert.ok(sectorMults[0] > 1.3);
  assert.equal(sectorMults[1], 1.0);
  assert.ok(sectorMults[2] > 1.0 && sectorMults[2] < 1.25);

  const econ = new EconomyEngine({ dies: { m: 5, e: 4 } });
  // Tier 1 allows agents 0 & 1, locks tier >= 2 directors
  assert.equal(econ.assignAgent(0, 0), true);
  assert.equal(econ.assignAgent(1, 5), false);

  // QA backpressure drives Context Entropy to 100% and triggers HALLUCINATION
  for (let s = 0; s < 25; s++) {
    econ.tickFromSim({ deltaGood: 1, qaBackpressureMax: 45 }, 1.0, { rng: () => 0.1 });
    if (econ.getDisplayTelemetry().activeCrisis) break;
  }

  let tel = econ.getDisplayTelemetry();
  assert.ok(tel.activeCrisis, 'Expected QA backpressure to trigger a crisis');
  assert.equal(tel.activeCrisis.type, CRISIS_TYPES.HALLUCINATION);
  assert.equal(tel.activeCrisis.choices.length, 2);
  assert.equal(econ.getSimulationModifiers().hallucinationActive, true);
  assert.equal(econ.mitigateCrisis('rollback_weights'), true);
  assert.equal(econ.getDisplayTelemetry().activeCrisis, null);
  assert.equal(econ.getSimulationModifiers().hallucinationActive, false);

  // Trigger & resolve PAPERCLIP_PANIC (minting paperclips then melting via kill_switch)
  const clipCrisis = econ.triggerCrisisDebug(CRISIS_TYPES.PAPERCLIP_PANIC, 0);
  assert.equal(clipCrisis.type, CRISIS_TYPES.PAPERCLIP_PANIC);
  assert.equal(econ.getSimulationModifiers().paperclipActive, true);
  econ.tickFromSim({ deltaGood: 0, paperclipsMinted: 25, qaBackpressureMax: 0 }, 0.5);
  assert.equal(econ.getDisplayTelemetry().paperclips, 25);
  assert.equal(econ.mitigateCrisis('kill_switch'), true);
  assert.equal(econ.getDisplayTelemetry().activeCrisis, null);
  assert.equal(econ.getDisplayTelemetry().paperclips, 0);

  // Trigger MEME_PR_MELTDOWN: verifies -40% VC subsidy active, then +150% surge upon quota / resolution
  // Cool sector entropy to 0 first so baseYield stays invariant across the 1s quota tick
  econ.tickFromSim({ deltaGood: 0, qaBackpressureMax: 0 }, 10.0);
  const baseYield = econ.getDisplayTelemetry().yieldMultiplier;
  const memeCrisis = econ.triggerCrisisDebug(CRISIS_TYPES.MEME_PR_MELTDOWN, 0);
  assert.equal(memeCrisis.type, CRISIS_TYPES.MEME_PR_MELTDOWN);
  tel = econ.getDisplayTelemetry();
  assert.ok(Math.abs(tel.vcSubsidyMult - 0.6) < 1e-6);
  assert.ok(Math.abs(tel.yieldMultiplier - baseYield * 0.6) < 1e-6);
  assert.equal(tel.vcSurgeTimerSec, 90);
  assert.ok(tel.vcQuotaRemaining > 0);

  // Fulfill wafer quota organically via tickFromSim -> unlocks +150% (2.5x) Viral Hype Surge
  econ.tickFromSim({ deltaGood: tel.vcQuotaRemaining, qaBackpressureMax: 0 }, 1.0);
  tel = econ.getDisplayTelemetry();
  assert.equal(tel.activeCrisis, null);
  assert.equal(tel.vcQuotaRemaining, 0);
  assert.ok(tel.vcSurgeTimerSec > 85);
  assert.ok(Math.abs(tel.yieldMultiplier - baseYield * 2.5) < 1e-6);

  // Standalone rollCrisis + resolveCrisis insufficient-dies guard
  const rolledMeme = rollCrisis(30, [10, 100, 0, 0], () => 0.9);
  assert.equal(rolledMeme.type, CRISIS_TYPES.MEME_PR_MELTDOWN);
  assert.equal(rolledMeme.sectorIdx, 1);
  const broke = resolveCrisis(rolledMeme, 'hire_pr_spin', { dies: bsZero() });
  assert.equal(broke.resolved, false);
  assert.equal(broke.reason, 'insufficient_dies');
  const freeSpin = resolveCrisis(rolledMeme, 'shitpost_response', { dies: bsZero() });
  assert.equal(freeSpin.resolved, true);
  assert.equal(freeSpin.state.vcSurgeTimerSec, 60);

  assert.equal(createCrisisIncident(CRISIS_TYPES.HALLUCINATION, 3).sectorIdx, 3);
});

test('5. Dual-engine tickFromSim HWM + fleet output, GridEngine coupling, and save state sanitization', () => {
  const sim = new GridEngine(8, 'ECON-INTEGRATION');
  sim.loadStarterFab();

  const econ = new EconomyEngine();
  econ.assignAgent(0, 0);

  for (let t = 0; t < 120; t++) {
    const mods = econ.getSimulationModifiers();
    const simTel = sim.stepTick(mods);
    econ.tickFromSim(simTel, 0.1, { rng: () => 0.2 });
  }

  const midTel = econ.getDisplayTelemetry();
  assert.ok(bsCmp(midTel.dies, bsZero()) > 0, 'Expected active cleanroom to generate Dies');
  assert.ok(bsCmp(midTel.flops, bsZero()) > 0, 'Expected FLOPs scaled from Dies');
  assert.ok(midTel.hwmDiesPerMin > 0, `Expected hwmDiesPerMin > 0, got ${midTel.hwmDiesPerMin}`);

  // Pure passive ticks (deltaGood = 0) continue producing via fleet from HWM
  const diesBeforeIdle = { ...midTel.dies };
  const idleRes = econ.tickFromSim({ deltaGood: 0, qaBackpressureMax: 0 }, 10.0);
  assert.ok(bsCmp(idleRes.passiveDiesEarned, bsZero()) > 0);
  assert.equal(bsCmp(econ.getDisplayTelemetry().dies, diesBeforeIdle), 1);

  // Upgrade fleet level and confirm passive output scales up
  econ.dies = bsFrom(1e5);
  assert.equal(econ.upgradeFleet(), true);
  assert.equal(econ.getDisplayTelemetry().fleetLevel, 2);
  const idleRes2 = econ.tickFromSim({ deltaGood: 0, qaBackpressureMax: 0 }, 10.0);
  assert.equal(bsCmp(idleRes2.passiveDiesEarned, idleRes.passiveDiesEarned), 1);

  // State export/import roundtrip & corrupt payload sanitization
  const exported = econ.exportState();
  const restored = new EconomyEngine(exported);
  assert.deepEqual(restored.exportState(), exported);

  const sanitized = new EconomyEngine({
    tier: 99,
    dies: { m: NaN, e: 5 },
    flops: Infinity,
    lifetimeFlops: { m: 1.5, e: 400 },
    shards: -12,
    hwmDiesPerMin: NaN,
    fleetLevel: 0,
    prestige: [2, -5, 'bad'],
    agents: [0, 99, -1, 2],
    entropies: [150, -10, NaN, 40],
  });
  const sTel = sanitized.getDisplayTelemetry();
  assert.equal(sTel.tier, 6);
  assert.deepEqual(sTel.dies, bsZero());
  assert.deepEqual(sTel.flops, bsZero());
  assert.deepEqual(sTel.lifetimeFlops, { m: 1.5, e: 400 });
  assert.equal(sTel.shards, 0);
  assert.equal(sTel.hwmDiesPerMin, 0);
  assert.equal(sTel.fleetLevel, 1);
  assert.deepEqual(sTel.prestigeLevels, [2, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(sTel.agents, [0, -1, -1, 2]);
  assert.deepEqual(sTel.entropies, [100, 0, 0, 40]);

  // Ensure GridEngine can run with HALLUCINATION / PAPERCLIP mods without throwing
  const chaosSim = new GridEngine(8, 'CHAOS-SIM');
  chaosSim.placeMachine(1, 3, MACHINE_TYPES.INGOT_SLICER, DIRS.E);
  chaosSim.placeMachine(2, 3, MACHINE_TYPES.BELT_SPLITTER, DIRS.E);
  chaosSim.placeMachine(3, 3, MACHINE_TYPES.WAFER_VAULT, DIRS.E);
  econ.triggerCrisisDebug(CRISIS_TYPES.PAPERCLIP_PANIC, 0);
  for (let t = 0; t < 20; t++) {
    const tel = chaosSim.stepTick(econ.getSimulationModifiers());
    econ.tickFromSim(tel, 0.1);
  }
  assert.ok(econ.getDisplayTelemetry().paperclips > 0);
});

test('6. Post-1e308 EconomyEngine stability: high prestige yield, passive fleet, and shard progression', () => {
  const megaEcon = new EconomyEngine({
    tier: 6,
    dies: { m: 1.5, e: 450 },
    flops: { m: 3.0, e: 459 },
    lifetimeFlops: { m: 3.0, e: 459 },
    fleetLevel: 1200,
    prestige: [10, 5, 5, 5, 5, 5, 5, 5, 5],
  });

  const stepRes = megaEcon.tickFromSim({ deltaGood: 5, qaBackpressureMax: 0 }, 1.0);
  assert.equal(bsIsValid(stepRes.totalDiesEarned), true);

  const tel = megaEcon.getDisplayTelemetry();
  assert.equal(bsIsValid(tel.dies), true);
  assert.equal(bsIsValid(tel.flops), true);
  assert.equal(bsIsValid(tel.lifetimeFlops), true);
  assert.equal(bsIsValid(tel.fleetCost), true);
  assert.equal(Number.isFinite(tel.hwmDiesPerMin), true);
  assert.ok(tel.pendingShards > 0 && Number.isSafeInteger(tel.pendingShards));
  assert.ok(bsFormat(tel.dies, 'Dies').includes('e'));

  // Even extreme prestige levels whose multiplier alone exceeds 1e308 stay valid and finite
  const hyperPrestige = new EconomyEngine({
    tier: 6,
    prestige: [2000, 10, 500, 5, 5, 5, 5, 5, 5],
  });
  const hyperRes = hyperPrestige.tickFromSim({ deltaGood: 5, qaBackpressureMax: 0 }, 1.0);
  assert.equal(bsIsValid(hyperRes.totalDiesEarned), true);
  assert.ok(hyperRes.totalDiesEarned.e > 350);
  const hyperTel = hyperPrestige.getDisplayTelemetry();
  assert.equal(bsIsValid(hyperTel.dies), true);
  assert.equal(bsIsValid(hyperTel.lifetimeFlops), true);
  assert.equal(Number.isFinite(hyperTel.hwmDiesPerMin), true);
});
