import test from 'node:test';
import assert from 'node:assert/strict';

import { stepBeltsAndMachines } from '../src/sim/beltRouter.js';
import { stepPowerGrid } from '../src/sim/powerGridSolver.js';
import { stepShuttles } from '../src/sim/shuttleFleet.js';
import { stepCryoLoops } from '../src/sim/cryoLoopSolver.js';
import {
  MAX_GRID_DIM,
  MAX_CELLS,
  TICK_MS,
  DIRS,
  DX,
  DY,
  MACHINE_TYPES,
  WAFER_STATES,
  MACHINE_CATALOG,
  GridEngine,
} from '../src/sim/gridEngine.js';
import {
  splitMix32,
  hashSeedString,
  todayUtcStr,
  generateDailyChallenge,
  computeDailyEfficiencyScore,
} from '../src/sim/dailySeedGenerator.js';

test('1. Starter cleanroom wafer loop produces vaultedGood <15kW and <285K', () => {
  assert.equal(MAX_GRID_DIM, 28);
  assert.equal(MAX_CELLS, 784);
  assert.equal(TICK_MS, 100);
  assert.equal(DX.length, 4);
  assert.equal(DY.length, 4);
  assert.equal(MACHINE_CATALOG.length, 18);
  assert.equal(MACHINE_CATALOG.EUV_SCANNER.id, MACHINE_TYPES.EUV_SCANNER);

  const engine = new GridEngine(8, 'TEST-STARTER');
  engine.loadStarterFab();

  let lastTelemetry = null;
  for (let t = 0; t < 120; t++) {
    lastTelemetry = engine.stepTick();
  }

  assert.equal(lastTelemetry.tickCount, 120);
  assert.ok(
    Math.abs(lastTelemetry.powerDemandKw - 12.9) < 1e-4,
    `Expected 12.9 kW demand, got ${lastTelemetry.powerDemandKw}`
  );
  assert.equal(lastTelemetry.powerSupplyKw, 15);
  assert.equal(lastTelemetry.brownoutLevel, 0);
  assert.ok(lastTelemetry.euvFlashes > 0, 'Expected EUV flashes on starter loop');
  assert.ok(lastTelemetry.vaultedGood > 0, `Expected vaultedGood > 0, got ${lastTelemetry.vaultedGood}`);
  assert.equal(lastTelemetry.vaultedProto, 0);
  assert.ok(lastTelemetry.minKelvin < 285, `Expected cryo loop < 285K, got ${lastTelemetry.minKelvin}`);
  assert.equal(lastTelemetry.scramCount, 0);
});

test('1b. Layout snapshot export/import, resize preservation, and PILLAR protection', () => {
  const engine = new GridEngine(8, 'SNAP-TEST');
  engine.loadStarterFab();
  engine.state.sectorAgents[0] = 2;
  engine.state.sectorAgents[3] = 5;

  const snap = engine.exportLayoutSnapshot();
  assert.equal(snap.gridSize, 8);
  assert.equal(snap.cells.length, 64);
  assert.deepEqual(snap.agents, [2, -1, -1, 5]);

  const clone = new GridEngine(12, 'SNAP-TEST');
  assert.equal(clone.importLayoutSnapshot(snap), true);
  assert.equal(clone.state.width, 8);
  assert.deepEqual([...clone.state.sectorAgents], [2, -1, -1, 5]);

  for (let t = 0; t < 80; t++) {
    clone.stepTick();
  }
  assert.ok(clone.state.vaultedGood > 0);

  // Resize preserves (x, y) cells across stride change 8 -> 12
  const slicerBefore = clone.getCell(0, 2);
  clone.resize(12);
  assert.equal(clone.state.width, 12);
  const slicerAfter = clone.getCell(0, 2);
  assert.equal(slicerAfter.machineType, slicerBefore.machineType);
  assert.equal(slicerAfter.ln2Mask, slicerBefore.ln2Mask);
  assert.equal(slicerAfter.powerMask, slicerBefore.powerMask);

  // PILLAR protection and removeMachine mask retention
  clone.applyDailyPillars([{ x: 10, y: 10 }]);
  assert.equal(clone.placeMachine(10, 10, MACHINE_TYPES.BELT_STRAIGHT, DIRS.E), false);
  assert.equal(clone.removeMachine(10, 10), false);
  assert.equal(clone.getCell(10, 10).machineType, MACHINE_TYPES.PILLAR);

  const qaMaskBefore = clone.getCell(3, 4).ln2Mask;
  assert.ok((qaMaskBefore & 0x10) !== 0);
  assert.equal(clone.removeMachine(3, 4), true);
  assert.equal(clone.getCell(3, 4).machineType, MACHINE_TYPES.EMPTY);
  assert.equal(clone.getCell(3, 4).ln2Mask, qaMaskBefore);
});

test('2. Full 100%-occupied cyclic BELT_STRAIGHT/BELT_CORNER loop rotates 500 ticks with zero deadlock or loss', () => {
  const engine = new GridEngine(8, 'RING-500');

  // 4x4 perimeter CW loop of 12 cells:
  // Top: (1,1) corner N->E, (2,1) E, (3,1) E, (4,1) corner E->S
  // Right: (4,2) S, (4,3) S, (4,4) corner S->W
  // Bottom: (3,4) W, (2,4) W, (1,4) corner W->N
  // Left: (1,3) N, (1,2) N
  const loopCoords = [
    [1, 1, MACHINE_TYPES.BELT_CORNER, DIRS.N, 0],
    [2, 1, MACHINE_TYPES.BELT_STRAIGHT, DIRS.E, 0],
    [3, 1, MACHINE_TYPES.BELT_STRAIGHT, DIRS.E, 0],
    [4, 1, MACHINE_TYPES.BELT_CORNER, DIRS.E, 0],
    [4, 2, MACHINE_TYPES.BELT_STRAIGHT, DIRS.S, 0],
    [4, 3, MACHINE_TYPES.BELT_STRAIGHT, DIRS.S, 0],
    [4, 4, MACHINE_TYPES.BELT_CORNER, DIRS.S, 0],
    [3, 4, MACHINE_TYPES.BELT_STRAIGHT, DIRS.W, 0],
    [2, 4, MACHINE_TYPES.BELT_STRAIGHT, DIRS.W, 0],
    [1, 4, MACHINE_TYPES.BELT_CORNER, DIRS.W, 0],
    [1, 3, MACHINE_TYPES.BELT_STRAIGHT, DIRS.N, 0],
    [1, 2, MACHINE_TYPES.BELT_STRAIGHT, DIRS.N, 0],
  ];

  const initialWafers = [
    [WAFER_STATES.RAW, 0],
    [WAFER_STATES.COATED, 1],
    [WAFER_STATES.EXPOSED, 0],
    [WAFER_STATES.ETCHED, 1],
    [WAFER_STATES.GOOD, 0],
    [WAFER_STATES.RAW, 1],
    [WAFER_STATES.COATED, 0],
    [WAFER_STATES.EXPOSED, 1],
    [WAFER_STATES.ETCHED, 0],
    [WAFER_STATES.GOOD, 0],
    [WAFER_STATES.RAW, 0],
    [WAFER_STATES.COATED, 0],
  ];

  for (let i = 0; i < loopCoords.length; i++) {
    const [x, y, type, dir, sub] = loopCoords[i];
    engine.placeMachine(x, y, type, dir, sub);
    const idx = engine.index(x, y);
    engine.state.slotWafer[idx] = initialWafers[i][0];
    engine.state.slotDefective[idx] = initialWafers[i][1];
    engine.state.slotProgress[idx] = 0;
  }

  // First tick advances slotProgress to 1.0 and rotates once synchronously
  engine.stepTick();
  for (let i = 0; i < loopCoords.length; i++) {
    const [x, y] = loopCoords[(i + 1) % loopCoords.length];
    const cell = engine.getCell(x, y);
    assert.equal(cell.slotWafer, initialWafers[i][0], `Mismatch at tick 1 pos ${i}`);
    assert.equal(cell.slotDefective, initialWafers[i][1]);
    assert.equal(cell.backpressureTicks, 0);
  }

  for (let t = 1; t < 500; t++) {
    const tel = engine.stepTick();
    assert.equal(tel.totalBackpressure, 0, `Unexpected deadlock backpressure on tick ${t + 1}`);
  }

  // Verify exact conservation and modulo rotation after 500 ticks
  const shift = 500 % loopCoords.length;
  for (let i = 0; i < loopCoords.length; i++) {
    const [x, y] = loopCoords[(i + shift) % loopCoords.length];
    const cell = engine.getCell(x, y);
    assert.equal(cell.slotWafer, initialWafers[i][0], `Item lost/misaligned at index ${i}`);
    assert.equal(cell.slotDefective, initialWafers[i][1]);
  }
});

test('3a. Splitter round-robin, hallucination scramble without loss, and Merger arbitration', () => {
  // Splitter distributing across 3 branches (Straight E, Right S, Left N)
  const splitEngine = new GridEngine(8, 'SPLITTER-TEST');
  splitEngine.placeMachine(1, 3, MACHINE_TYPES.INGOT_SLICER, DIRS.E);
  splitEngine.placeMachine(2, 3, MACHINE_TYPES.BELT_SPLITTER, DIRS.E);
  // Straight E -> Vault
  splitEngine.placeMachine(3, 3, MACHINE_TYPES.BELT_STRAIGHT, DIRS.E);
  splitEngine.placeMachine(4, 3, MACHINE_TYPES.WAFER_VAULT, DIRS.E);
  // Right S -> Belt -> Vault
  splitEngine.placeMachine(2, 4, MACHINE_TYPES.BELT_STRAIGHT, DIRS.S);
  splitEngine.placeMachine(2, 5, MACHINE_TYPES.WAFER_VAULT, DIRS.S);
  // Left N -> Belt -> Vault
  splitEngine.placeMachine(2, 2, MACHINE_TYPES.BELT_STRAIGHT, DIRS.N);
  splitEngine.placeMachine(2, 1, MACHINE_TYPES.WAFER_VAULT, DIRS.N);

  for (let t = 0; t < 80; t++) {
    splitEngine.stepTick();
  }
  assert.ok(splitEngine.state.vaultedProto >= 12);

  // Inspect each vault independently via fresh test with collector belts (no consumption)
  const distEngine = new GridEngine(8, 'SPLIT-3WAY');
  distEngine.placeMachine(2, 3, MACHINE_TYPES.BELT_SPLITTER, DIRS.E);
  distEngine.placeMachine(3, 3, MACHINE_TYPES.BELT_STRAIGHT, DIRS.E); // Straight
  distEngine.placeMachine(2, 4, MACHINE_TYPES.BELT_STRAIGHT, DIRS.S); // Right
  distEngine.placeMachine(2, 2, MACHINE_TYPES.BELT_STRAIGHT, DIRS.N); // Left

  for (let step = 0; step < 3; step++) {
    const sIdx = distEngine.index(2, 3);
    distEngine.state.slotWafer[sIdx] = WAFER_STATES.RAW;
    distEngine.state.slotProgress[sIdx] = 0;
    distEngine.stepTick();
  }
  assert.equal(distEngine.getCell(3, 3).slotWafer, WAFER_STATES.RAW);
  assert.equal(distEngine.getCell(2, 4).slotWafer, WAFER_STATES.RAW);
  assert.equal(distEngine.getCell(2, 2).slotWafer, WAFER_STATES.RAW);

  // Hallucination scramble preserves all items cleanly
  const halEngine = new GridEngine(8, 'HAL-SPLIT');
  halEngine.placeMachine(1, 3, MACHINE_TYPES.INGOT_SLICER, DIRS.E);
  halEngine.placeMachine(2, 3, MACHINE_TYPES.BELT_SPLITTER, DIRS.E);
  halEngine.placeMachine(3, 3, MACHINE_TYPES.WAFER_VAULT, DIRS.E);
  halEngine.placeMachine(2, 4, MACHINE_TYPES.WAFER_VAULT, DIRS.S);
  halEngine.placeMachine(2, 2, MACHINE_TYPES.WAFER_VAULT, DIRS.N);
  for (let t = 0; t < 60; t++) {
    halEngine.stepTick({ hallucinationActive: true });
  }
  assert.ok(halEngine.state.vaultedProto >= 10);

  // Merger fair arbitration across two saturated inputs (North & South into East merger)
  const mergeEngine = new GridEngine(8, 'MERGE-TEST');
  mergeEngine.placeMachine(2, 1, MACHINE_TYPES.INGOT_SLICER, DIRS.S);
  mergeEngine.placeMachine(2, 2, MACHINE_TYPES.BELT_STRAIGHT, DIRS.S);
  mergeEngine.placeMachine(2, 5, MACHINE_TYPES.INGOT_SLICER, DIRS.N);
  mergeEngine.placeMachine(2, 4, MACHINE_TYPES.BELT_STRAIGHT, DIRS.N);
  mergeEngine.placeMachine(2, 3, MACHINE_TYPES.BELT_MERGER, DIRS.E, 0);
  mergeEngine.placeMachine(3, 3, MACHINE_TYPES.BELT_STRAIGHT, DIRS.E);
  mergeEngine.placeMachine(4, 3, MACHINE_TYPES.WAFER_VAULT, DIRS.E);

  for (let t = 0; t < 60; t++) {
    mergeEngine.stepTick();
  }
  assert.ok(mergeEngine.state.vaultedProto >= 10);
});

test('3b. METROLOGY_QA defect diversion to RECLAIM_GRINDER, backpressure, and FOUP shuttle over pillars', () => {
  const qaEngine = new GridEngine(8, 'QA-TEST');
  qaEngine.placeMachine(1, 3, MACHINE_TYPES.BELT_STRAIGHT, DIRS.E);
  qaEngine.placeMachine(2, 3, MACHINE_TYPES.METROLOGY_QA, DIRS.E);
  qaEngine.placeMachine(3, 3, MACHINE_TYPES.WAFER_VAULT, DIRS.E);
  qaEngine.placeMachine(2, 4, MACHINE_TYPES.RECLAIM_GRINDER, DIRS.S);

  // Inject defective ETCHED wafer
  const bIdx = qaEngine.index(1, 3);
  qaEngine.state.slotWafer[bIdx] = WAFER_STATES.ETCHED;
  qaEngine.state.slotDefective[bIdx] = 1;
  qaEngine.state.slotProgress[bIdx] = 0;

  for (let t = 0; t < 10; t++) {
    qaEngine.stepTick();
  }
  assert.equal(qaEngine.state.reclaimedCount, 1);
  assert.equal(qaEngine.state.vaultedGood, 0);

  // Inject clean ETCHED wafer -> promoted to GOOD -> WAFER_VAULT
  qaEngine.state.slotWafer[bIdx] = WAFER_STATES.ETCHED;
  qaEngine.state.slotDefective[bIdx] = 0;
  qaEngine.state.slotProgress[bIdx] = 0;

  for (let t = 0; t < 10; t++) {
    qaEngine.stepTick();
  }
  assert.equal(qaEngine.state.vaultedGood, 1);

  // Remove RECLAIM_GRINDER and inject defective wafer -> qaBackpressureMax increments
  qaEngine.removeMachine(2, 4);
  qaEngine.state.slotWafer[bIdx] = WAFER_STATES.ETCHED;
  qaEngine.state.slotDefective[bIdx] = 1;
  qaEngine.state.slotProgress[bIdx] = 0;
  let tel = null;
  for (let t = 0; t < 12; t++) {
    tel = qaEngine.stepTick();
  }
  assert.ok(tel.qaBackpressureMax >= 4, `Expected QA backpressure >= 4, got ${tel.qaBackpressureMax}`);

  // FOUP shuttle transfer across full-height PILLAR wall
  const foupEngine = new GridEngine(8, 'FOUP-WALL');
  for (let y = 0; y < 8; y++) {
    foupEngine.applyDailyPillars([{ x: 3, y }]);
  }
  foupEngine.placeMachine(0, 3, MACHINE_TYPES.INGOT_SLICER, DIRS.E);
  foupEngine.placeMachine(1, 3, MACHINE_TYPES.BELT_STRAIGHT, DIRS.E);
  foupEngine.placeMachine(2, 3, MACHINE_TYPES.FOUP_DOCK, DIRS.E, 0); // pickup
  foupEngine.placeMachine(5, 3, MACHINE_TYPES.FOUP_DOCK, DIRS.E, 1); // dropoff
  foupEngine.placeMachine(6, 3, MACHINE_TYPES.BELT_STRAIGHT, DIRS.E);
  foupEngine.placeMachine(7, 3, MACHINE_TYPES.WAFER_VAULT, DIRS.E);

  for (let t = 0; t < 50; t++) {
    foupEngine.stepTick({ fleetLevel: 2 });
  }
  assert.ok(foupEngine.state.shuttles.length >= 1, 'Expected active FOUP shuttle');
  assert.ok(
    foupEngine.state.vaultedProto > 0,
    `Expected FOUP shuttle to ferry wafers across pillar wall, got ${foupEngine.state.vaultedProto}`
  );
});

test('4. cryoLoopSolver cooling <285K (1.15x), hysteresis scram (>390K ON, 340K latched, <320K OFF), and zero-pipe empty grid safety', () => {
  // Empty grid with zero pipes -> finite temperatures, no NaN/Infinity
  const emptyEngine = new GridEngine(8, 'CRYO-EMPTY');
  const emptyTel = emptyEngine.stepTick();
  assert.equal(Number.isFinite(emptyTel.avgKelvin), true);
  assert.equal(Number.isFinite(emptyTel.minKelvin), true);
  assert.equal(Number.isFinite(emptyTel.maxKelvin), true);
  assert.equal(emptyTel.scramCount, 0);

  // Closed-loop cryo cooling below 285K gives 1.15x thermalMult boost
  const coolEngine = new GridEngine(8, 'CRYO-LOOP');
  coolEngine.placeMachine(1, 1, MACHINE_TYPES.CRYO_CHILLER, DIRS.S);
  coolEngine.placeMachine(2, 1, MACHINE_TYPES.EUV_SCANNER, DIRS.E);
  coolEngine.togglePipe(1, 1, true);
  coolEngine.togglePipe(2, 1, true);
  coolEngine.togglePipe(2, 2, true);
  coolEngine.togglePipe(1, 2, true);

  for (let t = 0; t < 20; t++) {
    coolEngine.stepTick();
  }
  const euvCell = coolEngine.getCell(2, 1);
  assert.ok(euvCell.tempKelvin < 285, `Expected EUV < 285K, got ${euvCell.tempKelvin}`);
  assert.ok(Math.abs(euvCell.thermalMult - 1.15) < 1e-4);

  // Overheat uncooled COMPUTE_RACK past 390K -> scramActive = 1
  const hotEngine = new GridEngine(8, 'CRYO-HOT');
  hotEngine.placeMachine(2, 2, MACHINE_TYPES.COMPUTE_RACK, DIRS.E);
  hotEngine.placeMachine(3, 2, MACHINE_TYPES.POWER_SOURCE, DIRS.E);
  const rackIdx = hotEngine.index(2, 2);

  let scrammed = false;
  for (let t = 0; t < 60; t++) {
    hotEngine.stepTick();
    if (hotEngine.state.scramActive[rackIdx] === 1) {
      scrammed = true;
      break;
    }
  }
  assert.equal(scrammed, true, 'Expected uncooled COMPUTE_RACK to trip thermal scram > 390K');
  assert.ok(hotEngine.state.tempKelvin[rackIdx] > 390);

  // Hysteresis check: at 340K scram remains latched ON
  hotEngine.state.tempKelvin[rackIdx] = 340.0;
  stepCryoLoops(hotEngine.state);
  assert.equal(hotEngine.state.scramActive[rackIdx], 1);
  assert.equal(hotEngine.state.thermalMult[rackIdx], 0);

  // Cooling below 320K clears scramActive to 0
  hotEngine.state.tempKelvin[rackIdx] = 315.0;
  stepCryoLoops(hotEngine.state);
  assert.equal(hotEngine.state.scramActive[rackIdx], 0);
  assert.equal(hotEngine.state.thermalMult[rackIdx], 1.0);
});

test('5. powerGridSolver Priority 3 -> Priority 2 cascading brownout and POWER_SOURCE / CAPACITOR_BANK recovery', () => {
  const engine = new GridEngine(8, 'PWR-CASCADE');
  engine.loadStarterFab();

  // Adding COMPUTE_RACK (+6 kW -> 18.9 kW > 15 kW) trips Priority 3 only (brownoutLevel 1)
  engine.placeMachine(0, 6, MACHINE_TYPES.COMPUTE_RACK, DIRS.E);
  const rackIdx = engine.index(0, 6);
  const slicerIdx = engine.index(0, 2);
  const qaIdx = engine.index(3, 4);

  let tel = engine.stepTick();
  assert.ok(Math.abs(tel.powerDemandKw - 18.9) < 1e-4);
  assert.equal(tel.brownoutLevel, 1);
  assert.equal(engine.state.powerRatio[rackIdx], 0);
  assert.equal(engine.state.powerRatio[slicerIdx], 1);
  assert.equal(engine.state.powerRatio[qaIdx], 1);

  // Cascading Priority 2 brownout when supply drops below P1+P2 (12.9 kW)
  tel = engine.stepTick({ tierSupplyKw: 10.0 });
  assert.equal(tel.brownoutLevel, 2);
  assert.equal(engine.state.powerRatio[rackIdx], 0);
  assert.equal(engine.state.powerRatio[slicerIdx], 0); // Priority 2 shed
  assert.equal(engine.state.powerRatio[qaIdx], 1);     // Priority 1 preserved

  // Priority 1 blackout when supply < P1
  tel = engine.stepTick({ tierSupplyKw: 2.0 });
  assert.equal(tel.brownoutLevel, 3);
  assert.equal(engine.state.powerRatio[qaIdx], 0);

  // Recovery via CAPACITOR_BANK buffer
  engine.placeMachine(1, 6, MACHINE_TYPES.CAPACITOR_BANK, DIRS.E);
  engine.state.capacitorStoredKj = 50.0;
  tel = engine.stepTick();
  assert.equal(tel.brownoutLevel, 0);
  assert.equal(engine.state.powerRatio[rackIdx], 1);
  assert.ok(tel.capacitorStoredKj < 50.0, 'Expected capacitor discharge during overload');

  // Drain capacitor & recover permanently via POWER_SOURCE (+25 kW -> 40 kW)
  engine.state.capacitorStoredKj = 0;
  engine.placeMachine(2, 6, MACHINE_TYPES.POWER_SOURCE, DIRS.E);
  tel = engine.stepTick();
  assert.equal(tel.brownoutLevel, 0);
  assert.equal(tel.powerSupplyKw, 40);
  assert.equal(engine.state.powerRatio[rackIdx], 1);
});

test('6. dailySeedGenerator SplitMix32 determinism and flood-fill connectivity across 12x12 grids', () => {
  const r1 = splitMix32(hashSeedString('IDEA00438-2026-11-23'));
  const r2 = splitMix32(hashSeedString('IDEA00438-2026-11-23'));
  for (let i = 0; i < 20; i++) {
    const a = r1();
    const b = r2();
    assert.equal(a, b);
    assert.ok(a >= 0 && a < 1);
  }

  assert.match(todayUtcStr(), /^\d{4}-\d{2}-\d{2}$/);

  const c1 = generateDailyChallenge('2026-11-23');
  const c2 = generateDailyChallenge('2026-11-23');
  const c3 = generateDailyChallenge('2026-11-24');

  assert.equal(c1.seedId, 'IDEA00438-2026-11-23');
  assert.equal(c1.gridSize, 12);
  assert.equal(c1.durationSec, 900);
  assert.deepEqual(c1, c2);
  assert.notDeepEqual(c1.pillars, c3.pillars);
  assert.ok(c1.pillars.length >= 6 && c1.pillars.length <= 10);

  // Verify BFS flood-fill connectivity after applyDailyPillars across 15 generated dates
  for (let day = 10; day <= 24; day++) {
    const challenge = generateDailyChallenge(`2026-11-${day}`);
    const engine = new GridEngine(challenge.gridSize, challenge.seedId);
    engine.applyDailyPillars(challenge.pillars);

    const w = engine.state.width;
    const visited = new Uint8Array(w * w);
    const queue = [0];
    visited[0] = 1;
    let head = 0;
    while (head < queue.length) {
      const idx = queue[head++];
      const x = idx % w;
      const y = (idx / w) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (!engine.inBounds(nx, ny)) continue;
        const nIdx = engine.index(nx, ny);
        if (visited[nIdx] === 0 && engine.state.machineType[nIdx] !== MACHINE_TYPES.PILLAR) {
          visited[nIdx] = 1;
          queue.push(nIdx);
        }
      }
    }

    const openCells = w * w - challenge.pillars.length;
    assert.equal(queue.length, openCells, `Disconnected floor on ${challenge.seedId}`);
    assert.equal(visited[engine.index(11, 11)], 1);
  }

  // Efficiency score scoring sanity
  assert.equal(computeDailyEfficiencyScore({ vaultedGood: 0, avgKelvin: 250 }), 0);
  const goodScore = computeDailyEfficiencyScore({
    vaultedGood: 40,
    avgKelvin: 270,
    brownoutTicks: 0,
    elapsedSec: 300,
    totalBackpressure: 2,
  });
  const penalizedScore = computeDailyEfficiencyScore({
    vaultedGood: 40,
    avgKelvin: 360,
    brownoutTicks: 20,
    elapsedSec: 300,
    totalBackpressure: 100,
  });
  assert.ok(goodScore > penalizedScore);
});

test('7. CCW corner loop, merger fairness vs priority, splitter backpressure spillover, and paperclip panic', () => {
  // 2x2 CCW corner loop (sub=1): (1,1) W->S, (1,2) S->E, (2,2) E->N, (2,1) N->W
  const ccw = new GridEngine(8, 'CCW-LOOP');
  const ccwCells = [
    [1, 1, DIRS.W, 1, WAFER_STATES.RAW],
    [1, 2, DIRS.S, 1, WAFER_STATES.COATED],
    [2, 2, DIRS.E, 1, WAFER_STATES.EXPOSED],
    [2, 1, DIRS.N, 1, WAFER_STATES.GOOD],
  ];
  for (const [x, y, dir, sub, wafer] of ccwCells) {
    ccw.placeMachine(x, y, MACHINE_TYPES.BELT_CORNER, dir, sub);
    ccw.state.slotWafer[ccw.index(x, y)] = wafer;
  }
  for (let t = 0; t < 101; t++) {
    const tel = ccw.stepTick();
    assert.equal(tel.totalBackpressure, 0);
  }
  const shift = 101 % 4;
  for (let i = 0; i < 4; i++) {
    const [x, y] = ccwCells[(i + shift) % 4];
    assert.equal(ccw.getCell(x, y).slotWafer, ccwCells[i][4]);
  }

  // Fair merger arbitration drains both North (defective -> reclaimed) and South (clean -> vaulted)
  const fair = new GridEngine(8, 'MERGER-FAIR');
  fair.placeMachine(2, 1, MACHINE_TYPES.BELT_STRAIGHT, DIRS.S);
  fair.placeMachine(2, 5, MACHINE_TYPES.BELT_STRAIGHT, DIRS.N);
  fair.placeMachine(2, 2, MACHINE_TYPES.BELT_STRAIGHT, DIRS.S);
  fair.placeMachine(2, 4, MACHINE_TYPES.BELT_STRAIGHT, DIRS.N);
  fair.placeMachine(2, 3, MACHINE_TYPES.BELT_MERGER, DIRS.E, 0);
  fair.placeMachine(3, 3, MACHINE_TYPES.METROLOGY_QA, DIRS.E);
  fair.placeMachine(4, 3, MACHINE_TYPES.WAFER_VAULT, DIRS.E);
  fair.placeMachine(3, 4, MACHINE_TYPES.RECLAIM_GRINDER, DIRS.S);

  for (let t = 0; t < 60; t++) {
    const nIdx = fair.index(2, 1);
    const sIdx = fair.index(2, 5);
    if (fair.state.slotWafer[nIdx] === 0) {
      fair.state.slotWafer[nIdx] = WAFER_STATES.ETCHED;
      fair.state.slotDefective[nIdx] = 1;
    }
    if (fair.state.slotWafer[sIdx] === 0) {
      fair.state.slotWafer[sIdx] = WAFER_STATES.ETCHED;
      fair.state.slotDefective[sIdx] = 0;
    }
    fair.stepTick();
  }
  assert.ok(fair.state.vaultedGood >= 5, `Expected clean branch vaulted >= 5, got ${fair.state.vaultedGood}`);
  assert.ok(fair.state.reclaimedCount >= 5, `Expected defect branch reclaimed >= 5, got ${fair.state.reclaimedCount}`);

  // Priority merger (sub=2 -> leftSide priority when facing E => North side at (2,2))
  const prio = new GridEngine(8, 'MERGER-PRIO');
  prio.placeMachine(2, 2, MACHINE_TYPES.BELT_STRAIGHT, DIRS.S);
  prio.placeMachine(2, 4, MACHINE_TYPES.BELT_STRAIGHT, DIRS.N);
  prio.placeMachine(2, 3, MACHINE_TYPES.BELT_MERGER, DIRS.E, 2);
  prio.placeMachine(3, 3, MACHINE_TYPES.WAFER_VAULT, DIRS.E);

  for (let t = 0; t < 12; t++) {
    const nIdx = prio.index(2, 2);
    const sIdx = prio.index(2, 4);
    if (prio.state.slotWafer[nIdx] === 0) {
      prio.state.slotWafer[nIdx] = WAFER_STATES.GOOD;
      prio.state.slotDefective[nIdx] = 0;
    }
    if (prio.state.slotWafer[sIdx] === 0) {
      prio.state.slotWafer[sIdx] = WAFER_STATES.RAW;
      prio.state.slotDefective[sIdx] = 0;
    }
    prio.stepTick();
  }
  assert.ok(prio.state.vaultedGood > 0);
  assert.equal(prio.state.vaultedProto, 0);

  // Splitter backpressure spillover + Paperclip Panic minting
  const spill = new GridEngine(8, 'SPLITTER-SPILL');
  spill.placeMachine(1, 3, MACHINE_TYPES.INGOT_SLICER, DIRS.E);
  spill.placeMachine(2, 3, MACHINE_TYPES.BELT_SPLITTER, DIRS.E);
  spill.placeMachine(3, 3, MACHINE_TYPES.BELT_STRAIGHT, DIRS.E); // dead-end straight
  spill.placeMachine(2, 4, MACHINE_TYPES.WAFER_VAULT, DIRS.S);   // open right branch

  let tel = null;
  for (let t = 0; t < 20; t++) {
    tel = spill.stepTick({ paperclipActive: true });
  }
  assert.ok(tel.paperclipsMinted >= 10);
  assert.ok(spill.state.vaultedProto >= 8);
});

test('8. Cryo closed-loop +25% bonus, linear throttle band, multi-shuttle fleet, and capacitor charging', () => {
  assert.equal(typeof stepBeltsAndMachines, 'function');
  assert.equal(typeof stepPowerGrid, 'function');
  assert.equal(typeof stepShuttles, 'function');

  // Compare closed 8-node ring (8 edges) vs open 8-node C-chain (7 edges) under 40.5 kW load (>35 kW open, <43.75 kW closed)
  const closed = new GridEngine(8, 'CLOSED-LOOP');
  const open = new GridEngine(8, 'OPEN-LINE');

  const ringCoords = [
    [1, 1],
    [2, 1],
    [3, 1],
    [3, 2],
    [3, 3],
    [2, 3],
    [1, 3],
    [1, 2],
  ];

  for (const eng of [closed, open]) {
    eng.placeMachine(1, 1, MACHINE_TYPES.CRYO_CHILLER, DIRS.S);
    // 4 COMPUTE_RACKs (34 kW) + 1 EUV_SCANNER (6.5 kW) = 40.5 kW heat
    eng.placeMachine(2, 1, MACHINE_TYPES.COMPUTE_RACK, DIRS.E);
    eng.placeMachine(3, 1, MACHINE_TYPES.COMPUTE_RACK, DIRS.E);
    eng.placeMachine(3, 2, MACHINE_TYPES.COMPUTE_RACK, DIRS.E);
    eng.placeMachine(3, 3, MACHINE_TYPES.COMPUTE_RACK, DIRS.E);
    eng.placeMachine(2, 3, MACHINE_TYPES.EUV_SCANNER, DIRS.E);
    eng.placeMachine(6, 5, MACHINE_TYPES.POWER_SOURCE, DIRS.E);
    eng.placeMachine(6, 6, MACHINE_TYPES.POWER_SOURCE, DIRS.E);
    for (const [x, y] of ringCoords) {
      eng.togglePipe(x, y, true);
    }
  }
  // Open line breaks the (1,1)-(1,2) edge, leaving 8 nodes and 7 edges (zero cycles)
  open.state.ln2Mask[open.index(1, 1)] &= ~0x04;
  open.state.ln2Mask[open.index(1, 2)] &= ~0x01;

  let cCryo = null;
  let oCryo = null;
  for (let t = 0; t < 25; t++) {
    closed.stepTick();
    open.stepTick();
  }
  cCryo = stepCryoLoops(closed.state);
  oCryo = stepCryoLoops(open.state);
  assert.equal(cCryo.closedLoopCount, 1);
  assert.equal(oCryo.closedLoopCount, 0);
  assert.ok(closed.getCell(2, 1).tempKelvin < open.getCell(2, 1).tempKelvin);

  // Multi-shuttle FOUP fleet (4 parallel shuttles)
  const fleet = new GridEngine(12, 'MULTI-FOUP');
  for (let y = 0; y < 12; y++) {
    fleet.applyDailyPillars([{ x: 5, y }]);
  }
  for (let row = 0; row < 4; row++) {
    const y = row * 2 + 1;
    fleet.placeMachine(2, y, MACHINE_TYPES.FOUP_DOCK, DIRS.E, 0);
    fleet.placeMachine(8, y, MACHINE_TYPES.FOUP_DOCK, DIRS.E, 1);
    fleet.placeMachine(9, y, MACHINE_TYPES.WAFER_VAULT, DIRS.E);
    fleet.state.slotWafer[fleet.index(2, y)] = WAFER_STATES.GOOD;
  }
  for (let t = 0; t < 25; t++) {
    fleet.stepTick({ fleetLevel: 4 });
  }
  assert.equal(fleet.state.shuttles.length, 4);
  assert.equal(fleet.state.vaultedGood, 4);

  // Capacitor charging from surplus then bridging temporary overload
  const cap = new GridEngine(8, 'CAP-CHARGE');
  cap.placeMachine(0, 0, MACHINE_TYPES.CAPACITOR_BANK, DIRS.E);
  for (let t = 0; t < 20; t++) {
    cap.stepTick({ tierSupplyKw: 15.0 }); // +1.5 kJ/tick up to 30 kJ
  }
  assert.ok(cap.state.capacitorStoredKj >= 29.0);
  cap.placeMachine(1, 0, MACHINE_TYPES.COMPUTE_RACK, DIRS.E); // 6 kW
  cap.placeMachine(2, 0, MACHINE_TYPES.COMPUTE_RACK, DIRS.E); // 12 kW
  cap.placeMachine(3, 0, MACHINE_TYPES.COMPUTE_RACK, DIRS.E); // 18 kW (>15 kW)
  const capTel = cap.stepTick({ tierSupplyKw: 15.0 });
  assert.equal(capTel.brownoutLevel, 0);
});
