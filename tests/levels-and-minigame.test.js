import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LEVEL_POOL,
  QUIP_POOL,
  buildLevelChallenge,
  pickNextUnseenLevel,
  drawNextQuip,
} from '../src/sim/levelPool.js';
import { splitMix32 } from '../src/sim/dailySeedGenerator.js';
import { GridEngine, MACHINE_TYPES } from '../src/sim/gridEngine.js';
import {
  MINIGAME_WIDTH,
  MINIGAME_HEIGHT,
  ROUND_DURATION_SEC,
  WAFER_CORE,
  SecretLaserGame,
  computeMinigameReward,
} from '../src/sim/secretMinigame.js';
import {
  CRISIS_TYPES,
  createCrisisIncident,
  nextVariantIndex,
  rollCrisis,
  resolveCrisis,
} from '../src/economy/chaosIncidents.js';
import { bsIsValid, bsCmp, bsZero } from '../src/economy/bigSilicon.js';
import {
  PRIMARY_SAVE_KEY,
  COOKIE_VAULT_NAME,
  CookieVault,
  signPayload,
  validatePrimarySaveRecord,
  buildCanonicalCampaignRecord,
} from '../src/persistence/cookieVault.js';

function verifyBfsConnectivity(gridSize, pillars) {
  const total = gridSize * gridSize;
  const blocked = new Uint8Array(total);
  for (const p of pillars) {
    assert.ok(p.x >= 0 && p.x < gridSize && p.y >= 0 && p.y < gridSize, 'Pillar out of bounds');
    const idx = p.y * gridSize + p.x;
    assert.equal(blocked[idx], 0, `Duplicate pillar at (${p.x},${p.y})`);
    blocked[idx] = 1;
  }

  assert.equal(blocked[0], 0, '(0,0) must stay open');
  assert.equal(blocked[1], 0, '(1,0) must stay open');
  assert.equal(blocked[gridSize], 0, '(0,1) must stay open');
  assert.equal(blocked[total - 1], 0, '(w-1,w-1) must stay open');

  const visited = new Uint8Array(total);
  const queue = [0];
  visited[0] = 1;
  let head = 0;
  const dx = [0, 1, 0, -1];
  const dy = [-1, 0, 1, 0];

  while (head < queue.length) {
    const curr = queue[head++];
    const cx = curr % gridSize;
    const cy = Math.floor(curr / gridSize);
    for (let d = 0; d < 4; d++) {
      const nx = cx + dx[d];
      const ny = cy + dy[d];
      if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
      const nIdx = ny * gridSize + nx;
      if (blocked[nIdx] === 0 && visited[nIdx] === 0) {
        visited[nIdx] = 1;
        queue.push(nIdx);
      }
    }
  }

  assert.equal(
    queue.length,
    total - pillars.length,
    `BFS visited ${queue.length} of ${total - pillars.length} floor cells on ${gridSize}x${gridSize}`
  );
}

function makeMockStorage() {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(String(k), String(v)); },
    removeItem(k) { map.delete(String(k)); },
    clear() { map.clear(); },
  };
}

function makeMockCookieStore() {
  const jar = new Map();
  return {
    getCookie(name) { return jar.has(name) ? jar.get(name) : null; },
    setCookie(name, value, maxAgeSec = 31536000) {
      if (maxAgeSec <= 0 || value === '') jar.delete(name);
      else jar.set(name, String(value));
    },
    removeCookie(name) { jar.delete(name); },
    clear() { jar.clear(); },
  };
}

function makeComplex28x28Layout() {
  const cells = new Array(28 * 28).fill(null).map(() => ({
    machineType: 0,
    machineDir: 0,
    machineSub: 0,
    ln2Mask: 0,
    powerMask: 0,
    shuttleWaypoint: 0,
  }));
  const set = (x, y, patch) => {
    const idx = y * 28 + x;
    cells[idx] = { ...cells[idx], ...patch };
  };
  for (let x = 2; x <= 25; x++) {
    set(x, 2, { machineType: 2, machineDir: 1, ln2Mask: 0x1a, powerMask: 0x1a });
    set(x, 25, { machineType: 2, machineDir: 3, ln2Mask: 0x1a, powerMask: 0x1a });
  }
  for (let y = 3; y <= 24; y++) {
    set(25, y, { machineType: 2, machineDir: 2, ln2Mask: 0x15, powerMask: 0x15 });
    set(2, y, { machineType: 2, machineDir: 0, ln2Mask: 0x15, powerMask: 0x15 });
  }
  set(0, 0, { machineType: 14, machineDir: 1, powerMask: 0x16 });
  set(0, 1, { machineType: 13, machineDir: 2, ln2Mask: 0x14 });
  set(12, 12, { machineType: 1, machineDir: 0 });
  set(15, 20, { machineType: 11, machineDir: 3, powerMask: 0x1a });
  return { gridSize: 28, tier: 6, agents: [5, 2, 0, 4], cells };
}

test('1. LEVEL_POOL 24 nodes: unique titles, archetypes, bespoke connected pillar layouts, and GridEngine compatibility', () => {
  assert.equal(LEVEL_POOL.length, 24);

  const expectedArchetypes = [
    'laminar_alley', 'twin_pillars', 'cryo_moat', 'zigzag_stepper',
    'quad_columns', 'courtyard_ring', 'diagonal_baffle', 'pinball_chicanes',
    'foup_canyon', 'cruciform_hub', 'spiral_cleanroom', 'checker_matrix',
    'substation_fortress', 'double_helix_lanes', 'diamond_chamber', 'thermal_furnace_bay',
    'capacitor_gauntlet', 'triple_splitter_maze', 'lunar_crater_ridge', 'vacuum_archipelago',
    'regolith_labyrinth', 'synchrotron_halo', 'orbital_spoke_wheel', 'singularity_core',
  ];
  const expectedGrids = [8, 12, 16, 20, 24, 28];

  const titles = new Set();
  const archetypes = new Set();
  const pillarSignatures = new Set();
  const tierCounts = [0, 0, 0, 0, 0, 0];

  for (let id = 0; id < 24; id++) {
    const node = LEVEL_POOL[id];
    assert.equal(node.id, id);
    assert.equal(node.code, `N${String(id + 1).padStart(2, '0')}`);
    assert.ok(node.tier >= 1 && node.tier <= 6);
    assert.equal(node.gridSize, expectedGrids[node.tier - 1]);
    assert.equal(node.archetype, expectedArchetypes[id]);
    assert.ok(typeof node.title === 'string' && node.title.length > 0);
    assert.ok(typeof node.subtitle === 'string' && node.subtitle.length > 0);
    assert.ok(node.waferGoal > 0);
    assert.ok(node.bonusDies > 0);
    assert.ok(node.bonusShards >= 1);
    assert.ok(Number.isFinite(node.modifiers.powerMult) && node.modifiers.powerMult > 0);
    assert.ok(Number.isFinite(node.modifiers.ambientK) && node.modifiers.ambientK >= 270);
    assert.ok(Number.isFinite(node.modifiers.defectBias) && node.modifiers.defectBias >= 0);
    assert.ok(Number.isFinite(node.modifiers.beltSpeedMult) && node.modifiers.beltSpeedMult > 0);

    tierCounts[node.tier - 1] += 1;
    assert.equal(titles.has(node.title), false, `Duplicate title: ${node.title}`);
    assert.equal(archetypes.has(node.archetype), false, `Duplicate archetype: ${node.archetype}`);
    titles.add(node.title);
    archetypes.add(node.archetype);

    const challenge = buildLevelChallenge(id);
    assert.equal(challenge.id, id);
    assert.equal(challenge.gridSize, node.gridSize);
    assert.ok(challenge.pillars.length >= 4, `Expected >=4 pillars on ${node.archetype}`);

    verifyBfsConnectivity(challenge.gridSize, challenge.pillars);

    const sig = `${challenge.gridSize}|` +
      challenge.pillars.map((p) => `${p.x},${p.y}`).sort().join(';');
    assert.equal(pillarSignatures.has(sig), false, `Duplicate pillar layout on ${node.archetype}`);
    pillarSignatures.add(sig);

    // Determinism & defensive copy check
    const challenge2 = buildLevelChallenge(id);
    assert.deepEqual(challenge2, challenge);
    challenge.pillars[0].x = -99;
    assert.notEqual(buildLevelChallenge(id).pillars[0].x, -99);
  }

  assert.deepEqual(tierCounts, [4, 4, 4, 4, 4, 4]);

  // Verify direct GridEngine integration on a Tier 3 layout
  const canyon = buildLevelChallenge(8);
  const sim = new GridEngine(canyon.gridSize, canyon.code);
  sim.applyDailyPillars(canyon.pillars);
  for (const p of canyon.pillars) {
    assert.equal(sim.getCell(p.x, p.y).machineType, MACHINE_TYPES.PILLAR);
  }
});

test('2. pickNextUnseenLevel 24-bit shuffle bag & QUIP_POOL 24 non-repeating draws', () => {
  const rng = splitMix32(20261123);

  // Full 24-node sweep across maxTier = 6
  let mask = 0;
  const cycle1 = [];
  for (let i = 0; i < 24; i++) {
    const res = pickNextUnseenLevel(mask, 6, rng);
    assert.equal((mask & (1 << res.nodeId)) === 0, true, `Repeat nodeId ${res.nodeId} in cycle 1`);
    cycle1.push(res.nodeId);
    mask = res.nextBagMask;
  }
  assert.equal(mask, 0xffffff);
  assert.deepEqual([...cycle1].sort((a, b) => a - b), Array.from({ length: 24 }, (_, i) => i));

  // Cycle 2 starts cleanly without repeating last pick of cycle 1
  const cycle2 = [];
  for (let i = 0; i < 24; i++) {
    const res = pickNextUnseenLevel(mask, 6, rng);
    cycle2.push(res.nodeId);
    mask = res.nextBagMask;
  }
  assert.notEqual(cycle2[0], cycle1[23], 'Cycle boundary must avoid immediate back-to-back repeat');
  assert.deepEqual([...cycle2].sort((a, b) => a - b), Array.from({ length: 24 }, (_, i) => i));

  // Tier-capped shuffle bag (maxTier = 2 -> 8 nodes: 0..7)
  let tier2Mask = 0;
  const tier2First = [];
  for (let i = 0; i < 8; i++) {
    const res = pickNextUnseenLevel(tier2Mask, 2, rng);
    assert.ok(res.nodeId >= 0 && res.nodeId <= 7, `Out-of-tier node ${res.nodeId}`);
    tier2First.push(res.nodeId);
    tier2Mask = res.nextBagMask;
  }
  assert.equal(tier2Mask, 0xff);
  assert.deepEqual([...tier2First].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);

  const tier2Second = [];
  for (let i = 0; i < 8; i++) {
    const res = pickNextUnseenLevel(tier2Mask, 2, rng);
    tier2Second.push(res.nodeId);
    tier2Mask = res.nextBagMask;
  }
  assert.notEqual(tier2Second[0], tier2First[7]);
  assert.deepEqual([...tier2Second].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);

  // Resetting eligible bits preserves higher-tier seen bits
  const preservedBit = 1 << 20;
  const mixedMask = preservedBit | 0x0f; // Tier 1 nodes 0..3 all seen + node 20 seen
  const t1Wrap = pickNextUnseenLevel(mixedMask, 1, rng);
  assert.ok(t1Wrap.nodeId >= 0 && t1Wrap.nodeId <= 3);
  assert.notEqual(t1Wrap.nextBagMask & preservedBit, 0, 'Higher-tier bits must be preserved on reset');

  // QUIP_POOL: 24 unique quips, zero back-to-back repeats across 72 draws (even with constant rng)
  assert.equal(QUIP_POOL.length, 24);
  assert.equal(new Set(QUIP_POOL).size, 24);

  let qState = null;
  const drawnQuips = [];
  for (let i = 0; i < 72; i++) {
    const res = drawNextQuip(qState, i < 48 ? rng : () => 0);
    drawnQuips.push(res.text);
    qState = res.nextState;
    if (i > 0) {
      assert.notEqual(drawnQuips[i], drawnQuips[i - 1], `Back-to-back quip repeat at draw ${i}`);
    }
  }
  assert.equal(new Set(drawnQuips.slice(0, 24)).size, 24);
  assert.equal(new Set(drawnQuips.slice(24, 48)).size, 24);
  assert.equal(new Set(drawnQuips.slice(48, 72)).size, 24);
});

test('3. chaosIncidents 12 variants cycle without repeats & resolveCrisis remains 100% intact', () => {
  const allHeadlines = new Set();
  const allDescriptions = new Set();

  for (const type of Object.values(CRISIS_TYPES)) {
    // Verify all 4 explicit variantIdx entries are unique
    for (let v = 0; v < 4; v++) {
      const incident = createCrisisIncident(type, 1, { variantIdx: v });
      assert.equal(incident.variantIdx, v);
      assert.equal(incident.sectorIdx, 1);
      allHeadlines.add(incident.headline);
      allDescriptions.add(incident.description);
    }

    // Verify nextVariantIndex cycles through all 4 variants without immediate repeats
    const seenIndices = [];
    for (let draw = 0; draw < 12; draw++) {
      const idx = nextVariantIndex(type, () => 0); // adversarial constant rng
      seenIndices.push(idx);
      if (draw > 0) {
        assert.notEqual(seenIndices[draw], seenIndices[draw - 1], `Immediate variant repeat on ${type} at draw ${draw}`);
      }
    }
    assert.deepEqual([...seenIndices.slice(0, 4)].sort(), [0, 1, 2, 3]);
    assert.deepEqual([...seenIndices.slice(4, 8)].sort(), [0, 1, 2, 3]);
    assert.deepEqual([...seenIndices.slice(8, 12)].sort(), [0, 1, 2, 3]);
  }

  assert.equal(allHeadlines.size, 12);
  assert.equal(allDescriptions.size, 12);

  // Verify resolveCrisis choice IDs & math remain 100% intact across all 3 crisis types
  const hCrisis = rollCrisis(25, [100, 0, 0, 0], () => 0.1);
  assert.equal(hCrisis.type, CRISIS_TYPES.HALLUCINATION);
  const hRes = resolveCrisis(hCrisis, 'rollback_weights', { dies: { m: 1, e: 4 }, entropies: [100, 0, 0, 0] });
  assert.equal(hRes.resolved, true);
  assert.equal(hRes.state.entropies[0], 15);
  assert.equal(hRes.state.defectPenalty, 0);

  const hFree = resolveCrisis(hCrisis, 'gaslight_qa', { dies: bsZero(), entropies: [100, 0, 0, 0] });
  assert.equal(hFree.resolved, true);
  assert.equal(hFree.state.entropies[0], 45);
  assert.equal(hFree.state.defectPenalty, 0.08);

  const pCrisis = createCrisisIncident(CRISIS_TYPES.PAPERCLIP_PANIC, 2);
  const pRes = resolveCrisis(pCrisis, 'kill_switch', {
    dies: { m: 5, e: 3 },
    paperclips: 10,
    entropies: [0, 0, 100, 0],
  });
  assert.equal(pRes.resolved, true);
  assert.equal(pRes.state.paperclips, 0);
  assert.equal(pRes.state.entropies[2], 10);

  const pMeme = resolveCrisis(pCrisis, 'monetize_clips', {
    dies: { m: 1, e: 3 },
    flops: bsZero(),
    lifetimeFlops: bsZero(),
    paperclips: 4,
    entropies: [0, 0, 100, 0],
  });
  assert.equal(pMeme.resolved, true);
  assert.equal(bsCmp(pMeme.flopsDelta, { m: 1, e: 3 }), 0);

  const mCrisis = createCrisisIncident(CRISIS_TYPES.MEME_PR_MELTDOWN, 0);
  const mSpin = resolveCrisis(mCrisis, 'hire_pr_spin', { dies: { m: 1, e: 4 }, entropies: [100, 0, 0, 0] });
  assert.equal(mSpin.resolved, true);
  assert.equal(mSpin.state.vcSurgeTimerSec, 90);
  assert.equal(mSpin.state.vcSubsidyMult, 1.0);

  const mShitpost = resolveCrisis(mCrisis, 'shitpost_response', { dies: bsZero(), entropies: [100, 0, 0, 0] });
  assert.equal(mShitpost.resolved, true);
  assert.equal(mShitpost.state.vcSurgeTimerSec, 60);
  assert.equal(mShitpost.state.entropies[0], 50);
});

test('4. SecretLaserGame: dust/clip/cryo/star hits, fever 2x, 30s round completion, and computeMinigameReward', () => {
  assert.equal(MINIGAME_WIDTH, 640);
  assert.equal(MINIGAME_HEIGHT, 400);
  assert.equal(ROUND_DURATION_SEC, 30);
  assert.deepEqual(WAFER_CORE, { x: 320, y: 355 });

  const game = new SecretLaserGame({ rng: splitMix32(4242) });
  const init = game.getState();
  assert.equal(init.score, 0);
  assert.equal(init.timeLeft, 30);
  assert.equal(init.finished, false);
  assert.equal(init.shield, 100);

  // Blast radius (58px) hit and miss
  const d1 = game.spawnTarget('dust');
  assert.equal(d1.radius, 22);
  assert.equal(d1.basePoints, 100);
  const hitEdge = game.fireAt(d1.x + 54, d1.y);
  assert.equal(hitEdge.hitCount, 1);
  assert.equal(hitEdge.combo, 1);
  assert.equal(hitEdge.scoreDelta, 100);

  // Miss resets combo & fever
  const missRes = game.fireAt(10, 390);
  assert.equal(missRes.hitCount, 0);
  assert.equal(missRes.combo, 0);
  assert.equal(missRes.feverActive, false);
  assert.equal(game.getState().misses, 1);

  // Clip zig-zag sinusoidal velocity & Cryo 0.45x slowdown
  const clipNormal = game.spawnTarget('clip');
  assert.equal(clipNormal.radius, 24);
  const xStart = clipNormal.x;
  const yStart = clipNormal.y;
  game.step(0.5);
  const dyNormal = game.targets[0].y - yStart;
  assert.ok(dyNormal > 0, 'Target must drift downward toward WAFER_CORE');
  assert.notEqual(game.targets[0].x, xStart);

  // Clear and test exact Cryo freeze slowdown ratio (0.45x)
  game.reset();
  const c1 = game.spawnTarget('dust');
  c1.x = 320;
  c1.y = 100;
  c1.vx = 0;
  c1.vy = 60;
  game.step(1.0);
  assert.ok(Math.abs((c1.y - 100) - 60) < 1e-6);

  const cryoTarget = game.spawnTarget('cryo');
  assert.equal(cryoTarget.color, '#38BDF8');
  const cryoHit = game.fireAt(cryoTarget.x, cryoTarget.y);
  assert.equal(cryoHit.triggeredCryo, true);
  assert.equal(game.freezeTimer, 4.0);

  const yBeforeFreezeStep = c1.y;
  game.step(1.0);
  assert.ok(Math.abs((c1.y - yBeforeFreezeStep) - 60 * 0.45) < 1e-6);

  // Combo fever (>=5) + Golden Star screen-clear chain reaction
  game.reset();
  for (let i = 0; i < 4; i++) {
    const t = game.spawnTarget('dust');
    const res = game.fireAt(t.x, t.y);
    assert.equal(res.feverActive, false);
  }
  const fifth = game.spawnTarget('dust');
  const fifthHit = game.fireAt(fifth.x, fifth.y);
  assert.equal(fifthHit.combo, 5);
  assert.equal(fifthHit.feverActive, true);
  assert.equal(fifthHit.scoreDelta, 100 * 5 * 2);

  // Spawn 3 extra hazards + 1 Golden Star -> hitting star clears ALL 4!
  game.spawnTarget('dust');
  game.spawnTarget('clip');
  game.spawnTarget('cryo');
  const star = game.spawnTarget('star');
  assert.equal(star.color, '#FFB800');
  const starHit = game.fireAt(star.x, star.y);
  assert.equal(starHit.triggeredStar, true);
  assert.equal(starHit.hitCount, 4);
  assert.equal(game.targets.length, 0);
  assert.equal(game.getState().bursts.length >= 4, true);
  assert.equal(game.getState().floatingTexts.length >= 4, true);

  // Run full 30s round: shield drain never ends round early, completes cleanly at 30s
  const roundGame = new SecretLaserGame({ rng: splitMix32(99) });
  for (let step = 0; step < 299; step++) {
    roundGame.step(0.1);
    assert.equal(roundGame.finished, false);
    assert.ok(roundGame.shield > 0);
  }
  roundGame.step(0.2);
  assert.equal(roundGame.finished, true);
  assert.equal(roundGame.timeLeft, 0);
  assert.equal(roundGame.fireAt(320, 200).hitCount, 0);

  // computeMinigameReward normalization & tier/score scaling
  const r0 = computeMinigameReward(0, 1);
  assert.equal(r0.medal, 'BRONZE');
  assert.equal(bsIsValid(r0.diesReward), true);
  assert.equal(bsIsValid(r0.flopsReward), true);

  const rBronze = computeMinigameReward(1200, 1);
  const rSilver = computeMinigameReward(3200, 1);
  const rGold = computeMinigameReward(9000, 2);
  const rPrismatic = computeMinigameReward(18000, 6);

  assert.equal(rBronze.medal, 'BRONZE');
  assert.equal(rSilver.medal, 'SILVER');
  assert.equal(rGold.medal, 'GOLD');
  assert.equal(rPrismatic.medal, 'PRISMATIC');

  for (const r of [rBronze, rSilver, rGold, rPrismatic]) {
    assert.equal(bsIsValid(r.diesReward), true);
    assert.equal(bsIsValid(r.flopsReward), true);
    assert.equal(bsCmp(r.diesReward, bsZero()), 1);
    assert.equal(bsCmp(r.flopsReward, bsZero()), 1);
  }
  assert.equal(bsCmp(rSilver.diesReward, rBronze.diesReward), 1);
  assert.equal(bsCmp(rGold.diesReward, rSilver.diesReward), 1);
  assert.equal(bsCmp(rPrismatic.diesReward, rGold.diesReward), 1);
});

test('5. CookieVault expedition persistence, legacy payload compat, <3800B cookie budget, and self-healing', () => {
  const ls = makeMockStorage();
  const cookieStore = makeMockCookieStore();
  const vault = new CookieVault({ localStorage: ls, cookieStore });
  const tSave = 1_795_500_000_000;

  const fullState = {
    tier: 6,
    dies: { m: 7.5, e: 15 },
    flops: { m: 3.2, e: 20 },
    lifetimeFlops: { m: 8.4, e: 22 },
    shards: 88,
    hwmDiesPerMin: 550000,
    fleetLevel: 35,
    prestige: [4, 3, 2, 5, 2, 3, 2, 1, 6],
    agents: [5, 2, 0, 4],
    entropies: [0, 0, 0, 0],
    paperclips: 0,
    audio: { vol: 0.8, mute: false },
    expedition: {
      clearedMask: 0xabcdef,
      bagMask: 0x123456,
      secretUnlocked: true,
      secretBest: 24680,
    },
    layout: makeComplex28x28Layout(),
  };

  const saveRes = vault.saveCampaign(fullState, tSave);
  assert.equal(saveRes.ok, true);
  assert.ok(saveRes.cookieBytes < 3800, `Cookie exceeded 3800B: ${saveRes.cookieBytes}`);

  // Wipe localStorage -> self-heal from compact cookie preserving expedition
  ls.clear();
  const healed = vault.hydrateCampaign(tSave + 5000);
  assert.equal(healed.source, 'cookie');
  assert.equal(healed.selfHealed, true);
  assert.deepEqual(healed.state.expedition, fullState.expedition);

  // Wipe cookie -> regenerate cookie from primary preserving expedition
  cookieStore.clear();
  const regen = vault.hydrateCampaign(tSave + 10_000);
  assert.equal(regen.source, 'localStorage');
  assert.equal(regen.cookieRegenerated, true);
  assert.deepEqual(regen.state.expedition, fullState.expedition);

  // Modify ONLY expedition in primary save -> statesEquivalent must trigger cookie regeneration
  const primaryObj = JSON.parse(ls.getItem(PRIMARY_SAVE_KEY));
  const updatedPrimary = signPayload({
    ...primaryObj,
    expedition: {
      clearedMask: 0xffffff,
      bagMask: 0x0000ff,
      secretUnlocked: true,
      secretBest: 31500,
    },
  });
  ls.setItem(PRIMARY_SAVE_KEY, JSON.stringify(updatedPrimary));
  const expSync = vault.hydrateCampaign(tSave + 15_000);
  assert.equal(expSync.source, 'localStorage');
  assert.equal(expSync.cookieRegenerated, true);

  ls.clear();
  const healedAfterExpSync = vault.hydrateCampaign(tSave + 20_000);
  assert.equal(healedAfterExpSync.source, 'cookie');
  assert.deepEqual(healedAfterExpSync.state.expedition, updatedPrimary.expedition);

  // Legacy signed save without `expedition` remains 100% valid & defaults cleanly
  const canonical = buildCanonicalCampaignRecord(fullState, tSave);
  delete canonical.expedition;
  const legacySigned = signPayload(canonical);
  const legacyRes = validatePrimarySaveRecord(legacySigned);
  assert.equal(legacyRes.ok, true);
  assert.deepEqual(legacyRes.state.expedition, {
    clearedMask: 0,
    bagMask: 0,
    secretUnlocked: false,
    secretBest: 0,
  });

  // Invalid expedition fields in signed primary save or cookie `xp` are rejected
  const badExpPrimary = signPayload({
    ...primaryObj,
    expedition: { clearedMask: 0x1ffffff, bagMask: 0, secretUnlocked: false, secretBest: 0 },
  });
  assert.equal(validatePrimarySaveRecord(badExpPrimary).ok, false);

  const validCookieStr = cookieStore.getCookie(COOKIE_VAULT_NAME);
  const cookieJson = JSON.parse(Buffer.from(validCookieStr, 'base64url').toString('utf8'));
  const badCookieSigned = signPayload({ ...cookieJson, xp: [0, 0, 2, 0] });
  cookieStore.setCookie(
    COOKIE_VAULT_NAME,
    Buffer.from(JSON.stringify(badCookieSigned), 'utf8').toString('base64url')
  );
  ls.clear();
  const rejectedBadCookie = vault.hydrateCampaign(tSave + 25_000);
  assert.equal(rejectedBadCookie.source, 'fresh');
});
