import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DIRS,
  MACHINE_TYPES,
  WAFER_STATES,
  GridEngine,
} from '../src/sim/gridEngine.js';
import { stepBeltsAndMachines } from '../src/sim/beltRouter.js';
import { stepCryoLoops } from '../src/sim/cryoLoopSolver.js';
import { stepPowerGrid } from '../src/sim/powerGridSolver.js';
import { splitMix32 } from '../src/sim/dailySeedGenerator.js';

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
  bsLog10,
  bsPow10,
} from '../src/economy/bigSilicon.js';
import { computePendingShards, getPrestigeEffects } from '../src/economy/prestigeProtocol.js';
import { EconomyEngine } from '../src/economy/yieldCurves.js';

import {
  fnv1a32,
  base64UrlEncode,
  base64UrlDecode,
  encodeBlueprint,
  decodeBlueprint,
} from '../src/persistence/blueprintCodec.js';
import {
  MAX_OFFLINE_MS,
  defaultCapByTier,
  solveOfflineCatchup,
} from '../src/persistence/offlineCatchupSolver.js';
import {
  PRIMARY_SAVE_KEY,
  COOKIE_VAULT_NAME,
  signPayload,
  CookieVault,
} from '../src/persistence/cookieVault.js';
import { parsePortableSave } from '../src/persistence/portableSaveIo.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function snapshotWaferHistogram(state) {
  const count = state.width * state.width;
  const byState = [0, 0, 0, 0, 0, 0];
  let totalWafers = 0;
  let totalDefective = 0;
  for (let i = 0; i < count; i++) {
    const w = state.slotWafer[i];
    assert.ok(w >= WAFER_STATES.NONE && w <= WAFER_STATES.GOOD, `Invalid wafer state ${w} at cell ${i}`);
    byState[w]++;
    if (w !== WAFER_STATES.NONE) {
      totalWafers++;
      const d = state.slotDefective[i];
      assert.ok(d === 0 || d === 1, `Invalid defect flag ${d} at cell ${i}`);
      if (d === 1) totalDefective++;
    }
  }
  return { byState, totalWafers, totalDefective };
}

function hashWaferPositions(state) {
  const count = state.width * state.width;
  let h = 0x811c9dc5;
  for (let i = 0; i < count; i++) {
    h ^= (state.slotWafer[i] & 0xff) | ((state.slotDefective[i] & 1) << 4);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function buildHamiltonianLoopCoords(size) {
  const coords = [];
  // Col 0 goes North from (0, size - 1) to (0, 0), turning E at (0, 0).
  // Remaining cols 1..size-1 snake East/West down rows 0..size-1 back into (0, size - 1).
  coords.push([0, 0, MACHINE_TYPES.BELT_CORNER, DIRS.N, 0]);
  for (let y = 0; y < size; y++) {
    if (y % 2 === 0) {
      for (let x = 1; x < size - 1; x++) {
        const type = x === 1 && y > 0 ? MACHINE_TYPES.BELT_CORNER : MACHINE_TYPES.BELT_STRAIGHT;
        const dir = x === 1 && y > 0 ? DIRS.S : DIRS.E;
        const sub = x === 1 && y > 0 ? 1 : 0;
        coords.push([x, y, type, dir, sub]);
      }
      coords.push([size - 1, y, MACHINE_TYPES.BELT_CORNER, DIRS.E, 0]);
    } else {
      coords.push([size - 1, y, MACHINE_TYPES.BELT_CORNER, DIRS.S, 0]);
      for (let x = size - 2; x >= 1; x--) {
        if (x === 1 && y < size - 1) {
          coords.push([1, y, MACHINE_TYPES.BELT_CORNER, DIRS.W, 1]);
        } else {
          coords.push([x, y, MACHINE_TYPES.BELT_STRAIGHT, DIRS.W, 0]);
        }
      }
    }
  }
  coords.push([0, size - 1, MACHINE_TYPES.BELT_CORNER, DIRS.W, 0]);
  for (let y = size - 2; y >= 1; y--) {
    coords.push([0, y, MACHINE_TYPES.BELT_STRAIGHT, DIRS.N, 0]);
  }
  return coords;
}

function build28x28FeedbackFab(engine) {
  // 7x7 tiling of a coupled 4x4 splitter->merger->corner feedback module (784 cells).
  // Every cell in the 4x4 block has valid upstream feeders and downstream feedback targets,
  // linking both internally and across block boundaries.
  const block = [
    [0, 0, MACHINE_TYPES.BELT_CORNER, DIRS.N, 0],
    [1, 0, MACHINE_TYPES.BELT_MERGER, DIRS.E, 0],
    [2, 0, MACHINE_TYPES.BELT_SPLITTER, DIRS.E, 0],
    [3, 0, MACHINE_TYPES.BELT_CORNER, DIRS.E, 0],

    [0, 1, MACHINE_TYPES.BELT_SPLITTER, DIRS.N, 0],
    [1, 1, MACHINE_TYPES.BELT_MERGER, DIRS.N, 0],
    [2, 1, MACHINE_TYPES.BELT_MERGER, DIRS.W, 0],
    [3, 1, MACHINE_TYPES.BELT_MERGER, DIRS.W, 0],

    [0, 2, MACHINE_TYPES.BELT_MERGER, DIRS.N, 0],
    [1, 2, MACHINE_TYPES.BELT_SPLITTER, DIRS.W, 0],
    [2, 2, MACHINE_TYPES.BELT_SPLITTER, DIRS.W, 0],
    [3, 2, MACHINE_TYPES.BELT_CORNER, DIRS.N, 1],

    [0, 3, MACHINE_TYPES.BELT_CORNER, DIRS.E, 1],
    [1, 3, MACHINE_TYPES.BELT_CORNER, DIRS.S, 1],
    [2, 3, MACHINE_TYPES.BELT_MERGER, DIRS.E, 0],
    [3, 3, MACHINE_TYPES.BELT_SPLITTER, DIRS.E, 0],
  ];

  for (let by = 0; by < 28; by += 4) {
    for (let bx = 0; bx < 28; bx += 4) {
      for (const [lx, ly, type, dir, sub] of block) {
        assert.equal(engine.placeMachine(bx + lx, by + ly, type, dir, sub), true);
      }
    }
  }
}

function makeMockStorage() {
  const map = new Map();
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(String(k), String(v));
    },
    removeItem(k) {
      map.delete(String(k));
    },
    clear() {
      map.clear();
    },
  };
}

function makeMockCookieStore() {
  const jar = new Map();
  return {
    getCookie(name) {
      return jar.has(name) ? jar.get(name) : null;
    },
    setCookie(name, value, maxAgeSec = 31536000) {
      if (maxAgeSec <= 0 || value === '') {
        jar.delete(name);
      } else {
        jar.set(name, String(value));
      }
    },
    removeCookie(name) {
      jar.delete(name);
    },
    clear() {
      jar.clear();
    },
    _jar: jar,
  };
}

function makeStarterSnapshot8x8() {
  const cells = new Array(64);
  for (let i = 0; i < 64; i++) {
    cells[i] = {
      machineType: i % 8 === 0 ? MACHINE_TYPES.BELT_STRAIGHT : MACHINE_TYPES.EMPTY,
      machineDir: DIRS.S,
      machineSub: 0,
      ln2Mask: 0x15,
      powerMask: 0x15,
      shuttleWaypoint: 0,
    };
  }
  return { gridSize: 8, tier: 1, agents: [0, -1, 1, -1], cells };
}

function buildBlueprintWithChecksum(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(bytes.length - 4, fnv1a32(bytes.subarray(0, bytes.length - 4)), false);
  return 'BP1_' + base64UrlEncode(bytes);
}

// ============================================================================
// 1. Cyclic Conveyor Loops & Splitter/Merger Feedback Torture
// ============================================================================

test('1a. Tight 2x2 CW and CCW 100%-occupied belt loops: 1,000 ticks, zero deadlock, exact conservation', () => {
  const configs = [
    {
      name: '2x2-CW',
      cells: [
        [2, 2, DIRS.N, 0, WAFER_STATES.RAW, 0],
        [3, 2, DIRS.E, 0, WAFER_STATES.COATED, 1],
        [3, 3, DIRS.S, 0, WAFER_STATES.EXPOSED, 0],
        [2, 3, DIRS.W, 0, WAFER_STATES.GOOD, 1],
      ],
    },
    {
      name: '2x2-CCW',
      cells: [
        [2, 2, DIRS.W, 1, WAFER_STATES.ETCHED, 1],
        [2, 3, DIRS.S, 1, WAFER_STATES.RAW, 0],
        [3, 3, DIRS.E, 1, WAFER_STATES.GOOD, 0],
        [3, 2, DIRS.N, 1, WAFER_STATES.COATED, 1],
      ],
    },
  ];

  for (const cfg of configs) {
    const engine = new GridEngine(8, cfg.name);
    for (const [x, y, dir, sub, wafer, def] of cfg.cells) {
      assert.equal(engine.placeMachine(x, y, MACHINE_TYPES.BELT_CORNER, dir, sub), true);
      const idx = engine.index(x, y);
      engine.state.slotWafer[idx] = wafer;
      engine.state.slotDefective[idx] = def;
    }

    const beforeHist = snapshotWaferHistogram(engine.state);
    assert.equal(beforeHist.totalWafers, 4);

    const t0 = performance.now();
    for (let t = 0; t < 1000; t++) {
      const tel = engine.stepTick();
      assert.equal(tel.totalBackpressure, 0, `${cfg.name} deadlocked at tick ${t + 1}`);
      const h = snapshotWaferHistogram(engine.state);
      assert.deepEqual(h, beforeHist, `${cfg.name} wafer conservation violated at tick ${t + 1}`);
    }
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 250, `${cfg.name} 1000 ticks took ${elapsed.toFixed(2)}ms (>= 250ms)`);

    // 1000 % 4 === 0 -> exact full-circle return
    for (const [x, y, , , wafer, def] of cfg.cells) {
      const cell = engine.getCell(x, y);
      assert.equal(cell.slotWafer, wafer);
      assert.equal(cell.slotDefective, def);
    }
  }
});

test('1b. Full 8x8 (64-cell Hamiltonian) 100%-occupied belt loop: 1,000 ticks <250ms, exact conservation', () => {
  const engine = new GridEngine(8, 'HAMILTON-8X8');
  const loop = buildHamiltonianLoopCoords(8);
  assert.equal(loop.length, 64);

  const initial = [];
  for (let i = 0; i < loop.length; i++) {
    const [x, y, type, dir, sub] = loop[i];
    assert.equal(engine.placeMachine(x, y, type, dir, sub), true);
    const idx = engine.index(x, y);
    const wafer = (i % 5) + 1; // cycles through 1..5
    const def = i % 3 === 0 ? 1 : 0;
    engine.state.slotWafer[idx] = wafer;
    engine.state.slotDefective[idx] = def;
    initial.push([wafer, def]);
  }

  const expectedHist = snapshotWaferHistogram(engine.state);
  assert.equal(expectedHist.totalWafers, 64);

  const t0 = performance.now();
  for (let t = 0; t < 1000; t++) {
    const tel = engine.stepTick();
    assert.equal(tel.totalBackpressure, 0, `8x8 loop deadlocked on tick ${t + 1}`);
    assert.equal(tel.brownoutLevel, 0);
  }
  const elapsed = performance.now() - t0;
  assert.ok(elapsed < 250, `8x8 1000 ticks took ${elapsed.toFixed(2)}ms (>= 250ms)`);

  assert.deepEqual(snapshotWaferHistogram(engine.state), expectedHist);
  const shift = 1000 % loop.length;
  for (let i = 0; i < loop.length; i++) {
    const [x, y] = loop[(i + shift) % loop.length];
    const cell = engine.getCell(x, y);
    assert.equal(cell.slotWafer, initial[i][0], `8x8 position mismatch at index ${i}`);
    assert.equal(cell.slotDefective, initial[i][1]);
  }
});

test('1c. Full 28x28 dense splitter->merger feedback network (75% occupied, normal & hallucinating): 1,000 ticks <250ms & exact conservation', () => {
  for (const scenario of [
    { name: '75%-occupied-normal', hallucination: false },
    { name: '75%-occupied-hallucinating', hallucination: true },
  ]) {
    const engine = new GridEngine(28, `TORTURE-28-${scenario.name}`);
    build28x28FeedbackFab(engine);

    const rng = splitMix32(0xdeadbeef);
    for (let i = 0; i < 784; i++) {
      if (i % 4 === 0) continue;
      engine.state.slotWafer[i] = 1 + Math.floor(rng() * 5);
      engine.state.slotDefective[i] = rng() < 0.25 ? 1 : 0;
    }

    const initialHist = snapshotWaferHistogram(engine.state);
    const initialPosHash = hashWaferPositions(engine.state);
    const uniquePosHashes = new Set([initialPosHash]);

    const t0 = performance.now();
    for (let t = 0; t < 1000; t++) {
      const tel = engine.stepTick({
        tierSupplyKw: 1500000,
        hallucinationActive: scenario.hallucination,
      });
      assert.equal(tel.brownoutLevel, 0);
      assert.equal(tel.completedWafers, 0);
      if (t % 50 === 49) {
        uniquePosHashes.add(hashWaferPositions(engine.state));
        assert.deepEqual(
          snapshotWaferHistogram(engine.state),
          initialHist,
          `28x28 ${scenario.name} lost/duplicated wafers at tick ${t + 1}`
        );
      }
    }
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 250, `28x28 ${scenario.name} 1000 ticks took ${elapsed.toFixed(2)}ms (>= 250ms)`);
    assert.deepEqual(snapshotWaferHistogram(engine.state), initialHist);
    assert.ok(uniquePosHashes.size > 5, `28x28 ${scenario.name} appears frozen (${uniquePosHashes.size} distinct states)`);
  }
});

test('1d. Saturated 100%-occupied splitter->merger feedback cycles must rotate without permanent deadlock', () => {
  // Minimal 5-cell reproducer: 4-cell SPLITTER -> CORNER -> CORNER -> MERGER feedback loop
  // plus 1 occupied feeder belt into the merger's backSide (s0).
  // Expected per SPEC 3.4: closed-cycle synchronous rotation without deadlocks.
  const mini = new GridEngine(8, 'SPLITTER-MERGER-DEADLOCK');
  mini.placeMachine(1, 1, MACHINE_TYPES.BELT_SPLITTER, DIRS.N, 0);
  mini.placeMachine(2, 1, MACHINE_TYPES.BELT_CORNER, DIRS.E, 0);
  mini.placeMachine(2, 2, MACHINE_TYPES.BELT_CORNER, DIRS.S, 0);
  mini.placeMachine(1, 2, MACHINE_TYPES.BELT_MERGER, DIRS.N, 0);
  mini.placeMachine(1, 3, MACHINE_TYPES.BELT_STRAIGHT, DIRS.N, 0);

  const loopCoords = [
    [1, 1, WAFER_STATES.RAW],
    [2, 1, WAFER_STATES.COATED],
    [2, 2, WAFER_STATES.EXPOSED],
    [1, 2, WAFER_STATES.ETCHED],
    [1, 3, WAFER_STATES.GOOD],
  ];
  for (const [x, y, w] of loopCoords) {
    mini.state.slotWafer[mini.index(x, y)] = w;
  }

  const miniStates = new Set([hashWaferPositions(mini.state)]);
  for (let t = 0; t < 20; t++) {
    mini.stepTick();
    miniStates.add(hashWaferPositions(mini.state));
  }

  // Full 28x28 100%-occupied splitter->merger feedback grid must still conserve wafers <250ms and avoid freeze
  const full28 = new GridEngine(28, 'TORTURE-28-100%-SATURATED');
  build28x28FeedbackFab(full28);
  const rng = splitMix32(0xdeadbeef);
  for (let i = 0; i < 784; i++) {
    full28.state.slotWafer[i] = 1 + Math.floor(rng() * 5);
    full28.state.slotDefective[i] = rng() < 0.25 ? 1 : 0;
  }
  const initialHist = snapshotWaferHistogram(full28.state);
  const fullStates = new Set([hashWaferPositions(full28.state)]);
  const t0 = performance.now();
  for (let t = 0; t < 1000; t++) {
    full28.stepTick({ tierSupplyKw: 1500000 });
    if (t % 50 === 49) {
      fullStates.add(hashWaferPositions(full28.state));
    }
  }
  const elapsed = performance.now() - t0;
  assert.ok(elapsed < 250, `28x28 100%-saturated 1000 ticks took ${elapsed.toFixed(2)}ms`);
  assert.deepEqual(snapshotWaferHistogram(full28.state), initialHist);

  const deadlocks = [];
  if (miniStates.size <= 1) {
    deadlocks.push(`5-cell splitter->merger feedback loop deadlocked (${miniStates.size} state in 20 ticks)`);
  }
  if (fullStates.size <= 1) {
    deadlocks.push(`28x28 100%-saturated splitter->merger feedback grid deadlocked (${fullStates.size} state in 1000 ticks)`);
  }
  assert.equal(deadlocks.length, 0, `beltRouter deadlock detected: ${deadlocks.join('; ')}`);
});

// ============================================================================
// 2. Coupled LN2 / Power Extremes & Hysteresis Non-Oscillation
// ============================================================================

test('2a. Cryo extremes: zero pipes, zero chillers, disconnected pipe islands, >10,000 kW heat & NaN resilience', () => {
  const engine = new GridEngine(28, 'CRYO-EXTREME');

  // Cluster A (y=0..7): unpiped (ln2Mask=0) COMPUTE_RACK + EUV_SCANNER array
  // Cluster B (y=8..13): disconnected hot pipe island with zero chillers
  // Cluster C (y=14..17): disconnected empty pipe island (no machines, zero chillers)
  // Cluster D (y=18..25): overloaded chilled loop (1 chiller vs 200+ heat machines)
  for (let y = 0; y < 28; y++) {
    for (let x = 0; x < 28; x++) {
      if (y === 27 && x < 20) {
        engine.placeMachine(x, y, MACHINE_TYPES.POWER_SOURCE, DIRS.E);
        continue;
      }
      const mType = (x + y) % 2 === 0 ? MACHINE_TYPES.COMPUTE_RACK : MACHINE_TYPES.EUV_SCANNER;
      if (y >= 14 && y <= 17) {
        engine.togglePipe(x, y, true); // pipe-only island, zero machines
      } else {
        engine.placeMachine(x, y, mType, DIRS.E);
        if (y >= 8 && y <= 13) {
          engine.togglePipe(x, y, true); // piped, zero chillers
        } else if (y >= 18 && y <= 26) {
          engine.togglePipe(x, y, true); // piped, 1 chiller
        }
      }
    }
  }
  engine.placeMachine(0, 18, MACHINE_TYPES.CRYO_CHILLER, DIRS.S);

  // Inject corrupt asymmetric pipe masks & NaN/out-of-bounds tempKelvin traps
  engine.state.ln2Mask[engine.index(0, 14)] = 0x1f; // dangling connections across boundary
  engine.state.tempKelvin[engine.index(1, 1)] = NaN;
  engine.state.tempKelvin[engine.index(2, 1)] = Infinity;
  engine.state.tempKelvin[engine.index(3, 1)] = -Infinity;
  engine.state.tempKelvin[engine.index(4, 1)] = 99999;
  engine.state.tempKelvin[engine.index(5, 1)] = -500;

  for (let t = 0; t < 80; t++) {
    const tel = engine.stepTick({
      tierSupplyKw: 1_500_000,
      cryoMult: t % 2 === 0 ? 0 : NaN, // test zero/NaN cryoMult safety
      ambientK: t < 40 ? 295 : 1500, // extreme ambient spike
    });

    for (const k of ['avgKelvin', 'minKelvin', 'maxKelvin', 'powerSupplyKw', 'powerDemandKw']) {
      assert.equal(Number.isFinite(tel[k]), true, `Non-finite telemetry ${k}=${tel[k]} at tick ${t}`);
    }
    assert.ok(tel.minKelvin >= 77 && tel.maxKelvin <= 1200, `Out-of-bounds Kelvin [${tel.minKelvin}, ${tel.maxKelvin}]`);

    for (let i = 0; i < 784; i++) {
      const tk = engine.state.tempKelvin[i];
      assert.equal(Number.isFinite(tk), true, `Cell ${i} tempKelvin became non-finite: ${tk}`);
      assert.ok(tk >= 77 && tk <= 1200, `Cell ${i} tempKelvin=${tk} escaped [77, 1200]`);
    }
  }

  // Direct >10,000 kW heat stress on stepCryoLoops without any chillers or pipes
  const direct = new GridEngine(28, 'HEAT-10MW');
  for (let i = 0; i < 784; i++) {
    direct.state.machineType[i] = MACHINE_TYPES.COMPUTE_RACK; // 8.5 kW * 784 * 2.0 = 13,328 kW
    direct.state.powerRatio[i] = 2.0;
  }
  const cryoRes = stepCryoLoops(direct.state, { cryoMult: 0, scramCeilingK: NaN });
  assert.equal(Number.isFinite(cryoRes.avgKelvin), true);
  assert.ok(cryoRes.maxKelvin <= 1200 && cryoRes.minKelvin >= 77);
});

test('2b. Hysteresis [320K, 390K] scram latch holds cleanly without single-tick oscillation', () => {
  const engine = new GridEngine(8, 'HYSTERESIS-STABILITY');
  engine.placeMachine(2, 2, MACHINE_TYPES.COMPUTE_RACK, DIRS.E);
  const rackIdx = engine.index(2, 2);

  // Explicit band sweep: rising 319 -> 390.5 -> falling 389 -> 320.5 -> 319.5
  const sweep = [319, 350, 389.9, 390.5, 389.9, 360, 340, 320.1, 319.9, 325];
  const expected = [0, 0, 0, 1, 1, 1, 1, 1, 0, 0];
  for (let s = 0; s < sweep.length; s++) {
    engine.state.tempKelvin[rackIdx] = sweep[s];
    stepCryoLoops(engine.state, { ambientK: sweep[s] });
    assert.equal(
      engine.state.scramActive[rackIdx],
      expected[s],
      `Hysteresis mismatch at step ${s} (T=${sweep[s]}K)`
    );
  }

  // Coupled GridEngine 400-tick run verifying minimum dwell duration > 10 ticks per state
  const coupled = new GridEngine(8, 'HYSTERESIS-COUPLED');
  coupled.placeMachine(2, 2, MACHINE_TYPES.COMPUTE_RACK, DIRS.E);
  const idx = coupled.index(2, 2);

  let prev = coupled.state.scramActive[idx];
  let runLen = 0;
  let transitions = 0;
  for (let t = 0; t < 400; t++) {
    coupled.stepTick({ tierSupplyKw: 50 });
    const cur = coupled.state.scramActive[idx];
    const temp = coupled.state.tempKelvin[idx];
    if (cur === 1) {
      assert.equal(coupled.state.thermalMult[idx], 0, 'Scrammed rack must have thermalMult=0');
      if (prev === 1) {
        assert.equal(coupled.state.powerRatio[idx], 0, 'Latched scram rack must have powerRatio=0');
      }
    }
    if (cur !== prev) {
      assert.ok(
        runLen >= 10,
        `Hysteresis oscillated too fast: state=${prev} lasted only ${runLen} ticks before switching at T=${temp.toFixed(2)}K`
      );
      transitions++;
      prev = cur;
      runLen = 1;
    } else {
      runLen++;
    }
  }
  assert.ok(transitions >= 3, `Expected multiple thermal scram/recovery cycles, got ${transitions}`);
});

test('2c. Priority 3 -> Priority 2 -> Priority 1 brownout shedding & capacitor discharge stability under oscillating spikes', () => {
  const engine = new GridEngine(8, 'BROWNOUT-OSC');
  // P1: 2x METROLOGY_QA (2.0 kW)
  // P2: 2x EUV_SCANNER (7.0 kW)
  // P3: 2x COMPUTE_RACK (12.0 kW)
  // Total = 21.0 kW; P1+P2 = 9.0 kW; P1 = 2.0 kW
  engine.placeMachine(0, 0, MACHINE_TYPES.METROLOGY_QA, DIRS.E);
  engine.placeMachine(1, 0, MACHINE_TYPES.METROLOGY_QA, DIRS.E);
  engine.placeMachine(2, 0, MACHINE_TYPES.EUV_SCANNER, DIRS.E);
  engine.placeMachine(3, 0, MACHINE_TYPES.EUV_SCANNER, DIRS.E);
  engine.placeMachine(4, 0, MACHINE_TYPES.COMPUTE_RACK, DIRS.E);
  engine.placeMachine(5, 0, MACHINE_TYPES.COMPUTE_RACK, DIRS.E);
  engine.placeMachine(6, 0, MACHINE_TYPES.CAPACITOR_BANK, DIRS.E);

  const p1 = engine.index(0, 0);
  const p2 = engine.index(2, 0);
  const p3 = engine.index(4, 0);

  // Strict Priority 3 -> 2 -> 1 cascade with zero stored charge
  engine.state.capacitorStoredKj = 0;
  let tel = stepPowerGrid(engine.state, { tierSupplyKw: 15.0 }); // 15 < 21, >= 9 -> level 1
  assert.equal(tel.brownoutLevel, 1);
  assert.equal(engine.state.powerRatio[p1], 1);
  assert.equal(engine.state.powerRatio[p2], 1);
  assert.equal(engine.state.powerRatio[p3], 0);
  // Shedding P3 left 15 - 9 = 6 kW surplus, which charged the capacitor by 0.6 kJ
  assert.ok(Math.abs(tel.capacitorStoredKj - 0.6) < 1e-4);

  engine.state.capacitorStoredKj = 0;
  tel = stepPowerGrid(engine.state, { tierSupplyKw: 5.0 }); // 5 < 9, >= 2 -> level 2
  assert.equal(tel.brownoutLevel, 2);
  assert.equal(engine.state.powerRatio[p1], 1);
  assert.equal(engine.state.powerRatio[p2], 0);
  assert.equal(engine.state.powerRatio[p3], 0);

  engine.state.capacitorStoredKj = 0;
  tel = stepPowerGrid(engine.state, { tierSupplyKw: 1.0 }); // 1 < 2 -> level 3
  assert.equal(tel.brownoutLevel, 3);
  assert.equal(engine.state.powerRatio[p1], 0);
  assert.equal(engine.state.powerRatio[p2], 0);
  assert.equal(engine.state.powerRatio[p3], 0);

  // Oscillate demand spikes and supply troughs across 300 ticks with capacitor buffer
  engine.state.capacitorStoredKj = 120.0;
  let observedLevels = new Set();
  for (let t = 0; t < 300; t++) {
    // Oscillate supply between 45 kW (charge) and 4 kW (severe deficit)
    const supply = t % 10 < 4 ? 45.0 : 4.0;
    // Also toggle an extra Priority 3 rack on odd ticks
    if (t % 2 === 1) {
      engine.placeMachine(7, 0, MACHINE_TYPES.COMPUTE_RACK, DIRS.E);
    } else {
      engine.removeMachine(7, 0);
    }
    const pTel = stepPowerGrid(engine.state, { tierSupplyKw: supply });
    observedLevels.add(pTel.brownoutLevel);

    assert.equal(Number.isFinite(pTel.powerSupplyKw), true);
    assert.equal(Number.isFinite(pTel.powerDemandKw), true);
    assert.equal(Number.isFinite(pTel.capacitorStoredKj), true);
    assert.ok(
      pTel.capacitorStoredKj >= 0 && pTel.capacitorStoredKj <= pTel.capacitorMaxKj,
      `Capacitor out of bounds: ${pTel.capacitorStoredKj} vs max ${pTel.capacitorMaxKj}`
    );
    assert.ok(
      engine.state.powerRatio[p1] >= engine.state.powerRatio[p2] &&
        engine.state.powerRatio[p2] >= engine.state.powerRatio[p3],
      'Priority shedding invariant violated: P1 >= P2 >= P3'
    );
  }
  assert.ok(observedLevels.has(0), 'Capacitor / surplus failed to sustain brownoutLevel 0');
});

// ============================================================================
// 3. BigSilicon Extreme Exponent & Prestige Arithmetic Stress
// ============================================================================

test('3a. BigSilicon extreme fuzz (1e308 -> 1e50000) across all arithmetic ops', () => {
  const rng = splitMix32(0xcafebabe);
  const opsSample = [];
  for (let i = 0; i < 200; i++) {
    const expA = 308 + Math.floor(rng() * (50000 - 308));
    const expB = 308 + Math.floor(rng() * (50000 - 308));
    const mantA = (rng() < 0.2 ? -1 : 1) * (1 + rng() * 8.999999);
    const mantB = (rng() < 0.2 ? -1 : 1) * (1 + rng() * 8.999999);
    opsSample.push([bsNormalize(mantA, expA), bsNormalize(mantB, expB)]);
  }
  // Include fixed extreme anchors at 1e308 and 1e50000
  opsSample.push([{ m: 1, e: 308 }, { m: 9.999999999999, e: 50000 }]);
  opsSample.push([{ m: 5, e: 50000 }, { m: 5, e: 50000 }]);
  opsSample.push([{ m: 1, e: 50000 }, { m: -1, e: 50000 }]);

  for (const [a, b] of opsSample) {
    assert.equal(bsIsValid(a), true);
    assert.equal(bsIsValid(b), true);

    const sum = bsAdd(a, b);
    const diff = bsSub(a, b);
    const diffClamped = bsSubClamped(a, b);
    const prod = bsMul(a, b);
    const quot = bsDiv(a, b);

    for (const r of [sum, diff, diffClamped, prod, quot]) {
      assert.equal(bsIsValid(r), true, `Invalid BigSilicon result: ${JSON.stringify(r)}`);
    }

    assert.ok(bsCmp(diffClamped, bsZero()) >= 0, 'bsSubClamped returned negative value');
    if (bsCmp(a, b) > 0) {
      assert.equal(bsCmp(b, a), -1);
    } else if (bsCmp(a, b) < 0) {
      assert.equal(bsCmp(b, a), 1);
    }

    if (a.m > 0) {
      const l = bsLog10(a);
      assert.equal(Number.isFinite(l), true);
      const back = bsPow10(l);
      assert.equal(bsIsValid(back), true);
      assert.ok(Math.abs(bsLog10(back) - l) < 1e-9, `pow10(log10) drift: ${l} vs ${bsLog10(back)}`);
    }

    // Multiplicative inverse sanity at extreme exponents
    if (b.m !== 0) {
      const roundTrip = bsDiv(prod, b);
      assert.equal(bsIsValid(roundTrip), true);
      const relDiff = Math.abs(bsLog10({ m: Math.abs(roundTrip.m), e: roundTrip.e }) - bsLog10({ m: Math.abs(a.m), e: a.e }));
      assert.ok(relDiff < 1e-11, `Mul/Div precision drift ${relDiff}`);
    }
  }
});

test('3b. BigSilicon extreme exponent gaps, division-by-zero, and NaN/Infinity/null/{} poisoning via bsSanitize', () => {
  const huge = { m: 1, e: 50000 };
  const tiny = { m: 9, e: 1 };
  const fallback = { m: 3.5, e: 7 };

  assert.deepEqual(bsAdd(huge, tiny), huge);
  assert.deepEqual(bsAdd(tiny, huge), huge);
  assert.deepEqual(bsSub(huge, tiny), huge);
  assert.deepEqual(bsSubClamped(tiny, huge), bsZero());
  assert.deepEqual(bsSub(huge, huge), bsZero());
  assert.deepEqual(bsDiv(huge, bsZero()), bsZero());
  assert.deepEqual(bsDiv(huge, 0), bsZero());
  assert.deepEqual(bsDiv(huge, -0), bsZero());
  assert.deepEqual(bsFrom('1.23456789e50000'), { m: 1.23456789, e: 50000 });
  assert.deepEqual(bsFrom('0e50000'), bsZero());

  const poisonedInputs = [
    NaN,
    Infinity,
    -Infinity,
    null,
    undefined,
    {},
    [],
    '',
    'NaN',
    'Infinity',
    '-Infinity',
    '1.5e',
    { m: NaN, e: 50000 },
    { m: 1, e: NaN },
    { m: Infinity, e: 10 },
    { m: 1, e: Infinity },
    { m: 1, e: -Infinity },
    { m: '1', e: 5 },
    { m: 1, e: '5' },
  ];

  for (const bad of poisonedInputs) {
    const clean = bsSanitize(bad, fallback);
    assert.deepEqual(clean, fallback, `bsSanitize failed to reject poisoned input: ${String(bad)}`);
    assert.equal(bsIsValid(clean), true);
  }

  // Even a poisoned fallback cannot leak NaN/Infinity
  assert.deepEqual(bsSanitize(NaN, { m: NaN, e: Infinity }), bsZero());
  assert.equal(bsIsValid(bsSanitize(-0, fallback)), true);
  assert.deepEqual(bsSanitize({ m: -0, e: 99 }, fallback), bsZero());
});

test('3c. Prestige shard precision at 1e308, 1e1500, 1e25000 FLOPs and extreme prestige node overflow defense', () => {
  assert.equal(computePendingShards({ m: 1, e: 308 }, 0), Math.floor(Math.pow(308 - 5, 1.5)));
  assert.equal(computePendingShards({ m: 1, e: 1500 }, 0), Math.floor(Math.pow(1500 - 5, 1.5)));
  assert.equal(computePendingShards({ m: 1, e: 25000 }, 0), Math.floor(Math.pow(25000 - 5, 1.5)));
  assert.equal(computePendingShards({ m: 1, e: 50000 }, 0), Math.floor(Math.pow(50000 - 5, 1.5)));

  assert.equal(computePendingShards({ m: 1, e: 25000 }, Infinity), 0);
  assert.equal(computePendingShards({ m: 1, e: 25000 }, NaN), Math.floor(Math.pow(25000 - 5, 1.5)));
  assert.equal(computePendingShards({ m: -5, e: 1000 }, 0), 0);

  const fx = getPrestigeEffects([99999, 99999, 99999, 99999, 99999, 99999, 99999, 99999, 99999]);
  assert.equal(Number.isFinite(fx.dieYieldMult), true);
  assert.equal(Number.isFinite(fx.fleetMult), true);
  assert.equal(bsIsValid(fx.dieYieldBig), true);
  assert.equal(bsIsValid(fx.fleetMultBig), true);
  assert.ok(fx.dieYieldBig.e > 17000);
  assert.ok(fx.fleetMultBig.e > 20000);

  const econ = new EconomyEngine({
    tier: 6,
    prestige: [99999, 99999, 99999, 99999, 99999, 99999, 99999, 99999, 99999],
  });
  const step = econ.tickFromSim({ deltaGood: 10, qaBackpressureMax: 0 }, 1.0);
  assert.equal(bsIsValid(step.totalDiesEarned), true);
  const tel = econ.getDisplayTelemetry();
  assert.equal(bsIsValid(tel.dies), true);
  assert.equal(bsIsValid(tel.flops), true);
  assert.equal(bsIsValid(tel.lifetimeFlops), true);
  assert.equal(Number.isFinite(tel.hwmDiesPerMin), true);
  assert.equal(Number.isFinite(tel.yieldMultiplier), true);
  assert.equal(Number.isSafeInteger(tel.pendingShards), true);
});

// ============================================================================
// 4. Anti-Tamper Offline Catch-Up, Shadow Cookie & Malformed #blueprint= Fuzzing
// ============================================================================

test('4a. Offline catch-up anti-tamper: rollbacks, NaN/Infinity, +50yr clamp, 1e200 HWM & 99999 prestige', () => {
  const tClose = 1_795_000_000_000;

  // Negative clock rollbacks
  for (const delta of [-1, -500_000, -999_999_999]) {
    const res = solveOfflineCatchup({
      tClose,
      tOpen: tClose + delta,
      hwmDiesPerMin: 5000,
      fleetLevel: 10,
      tier: 3,
    });
    assert.equal(res.clockRollback, true);
    assert.equal(res.validDeltaMs, 0);
    assert.deepEqual(res.diesEarned, { m: 0, e: 0 });
    assert.deepEqual(res.flopsEarned, { m: 0, e: 0 });
    assert.equal(res.slicesSimulated, 0);
  }

  // NaN / Infinity / malformed timestamps
  for (const [c, o] of [
    [NaN, tClose],
    [tClose, NaN],
    [Infinity, Infinity],
    [-Infinity, tClose],
    [tClose, Infinity],
    ['1000', '2000'],
    [null, tClose],
  ]) {
    const res = solveOfflineCatchup({ tClose: c, tOpen: o, hwmDiesPerMin: 5000, tier: 2 });
    assert.equal(res.clockRollback, true);
    assert.equal(res.validDeltaMs, 0);
    assert.deepEqual(res.diesEarned, { m: 0, e: 0 });
  }

  // +50-year timestamp (+1.577e12 ms) strictly clamped to 604800000ms (7 days)
  const sevenDay = solveOfflineCatchup({
    tClose,
    tOpen: tClose + MAX_OFFLINE_MS,
    hwmDiesPerMin: 1200,
    fleetLevel: 5,
    tier: 3,
    prestigeLevels: [2, 1, 0, 0, 0, 0, 0, 0, 0],
    agents: [0, 1, -1, -1],
  });
  const fiftyYear = solveOfflineCatchup({
    tClose,
    tOpen: tClose + 1.577e12,
    hwmDiesPerMin: 1200,
    fleetLevel: 5,
    tier: 3,
    prestigeLevels: [2, 1, 0, 0, 0, 0, 0, 0, 0],
    agents: [0, 1, -1, -1],
  });
  assert.equal(fiftyYear.capped, true);
  assert.equal(fiftyYear.validDeltaMs, 604800000);
  assert.equal(fiftyYear.slicesSimulated, 28);
  assert.deepEqual(fiftyYear.diesEarned, sevenDay.diesEarned);
  assert.deepEqual(fiftyYear.flopsEarned, sevenDay.flopsEarned);

  // Tampered 1e200 HWM, fleetLevel=999999, prestige=[99999, ...]
  const legitCap = solveOfflineCatchup({
    tClose,
    tOpen: tClose + MAX_OFFLINE_MS,
    hwmDiesPerMin: defaultCapByTier(2) * 60,
    fleetLevel: 500,
    tier: 2,
    prestigeLevels: new Array(9).fill(1000),
    agents: [0, 1, 2, 3],
  });

  for (const badHwm of [1e200, Infinity, { m: 1, e: 50000 }]) {
    const tampered = solveOfflineCatchup({
      tClose,
      tOpen: tClose + MAX_OFFLINE_MS,
      hwmDiesPerMin: badHwm,
      fleetLevel: 999999,
      tier: 2,
      prestigeLevels: new Array(9).fill(99999),
      agents: [0, 1, 2, 3],
    });
    assert.equal(tampered.tamperClamped, true);
    assert.deepEqual(tampered.diesEarned, legitCap.diesEarned);
    assert.deepEqual(tampered.flopsEarned, legitCap.flopsEarned);
  }
});

test('4b. CookieVault fuzzing: truncated base64url, bit-flipped sig, oversized payloads, prototype pollution & forged future tClose', () => {
  const ls = makeMockStorage();
  const cookieStore = makeMockCookieStore();
  const vault = new CookieVault({ localStorage: ls, cookieStore });
  const tNow = 1_795_500_000_000;

  const legit = {
    tier: 1,
    dies: { m: 3.2, e: 4 },
    flops: { m: 6.4, e: 6 },
    lifetimeFlops: { m: 8.8, e: 6 },
    shards: 5,
    hwmDiesPerMin: 240,
    fleetLevel: 2,
    prestige: [1, 0, 0, 0, 0, 0, 0, 0, 0],
    agents: [0, -1, 1, -1],
    layout: makeStarterSnapshot8x8(),
  };

  assert.equal(vault.saveCampaign(legit, tNow - 10_000).ok, true);
  const validCookie = cookieStore.getCookie(COOKIE_VAULT_NAME);
  const validPrimary = ls.getItem(PRIMARY_SAVE_KEY);

  // 1) Truncated Base64URL cookie at multiple cut points -> rejected, repaired from localStorage
  for (const cut of [1, 5, 17, Math.floor(validCookie.length / 2), validCookie.length - 1]) {
    cookieStore.setCookie(COOKIE_VAULT_NAME, validCookie.slice(0, cut));
    const res = vault.hydrateCampaign(tNow);
    assert.equal(res.source, 'localStorage');
    assert.equal(res.cookieRegenerated, true);
    assert.equal(res.state.shards, 5);
  }

  // 2) Bit-flipped sig in cookie -> rejected cleanly
  const cookieObj = JSON.parse(Buffer.from(validCookie, 'base64url').toString('utf8'));
  const badHex = cookieObj.sig[0] === '0' ? '1' : '0';
  cookieObj.sig = badHex + cookieObj.sig.slice(1);
  cookieStore.setCookie(COOKIE_VAULT_NAME, Buffer.from(JSON.stringify(cookieObj), 'utf8').toString('base64url'));
  let res = vault.hydrateCampaign(tNow);
  assert.equal(res.source, 'localStorage');
  assert.equal(res.cookieRegenerated, true);

  // 3) Oversized payloads (> 100KB cookie garbage & > 2MB portable save)
  cookieStore.setCookie(COOKIE_VAULT_NAME, 'A'.repeat(120_000));
  res = vault.hydrateCampaign(tNow);
  assert.equal(res.source, 'localStorage');
  assert.equal(res.cookieRegenerated, true);
  assert.equal(parsePortableSave('{' + '"x":"a",'.repeat(300_000) + '"z":1}').ok, false);

  // 4) Prototype-pollution payloads (__proto__, constructor, prototype)
  const protoCookieStr = Buffer.from(
    JSON.stringify({
      __proto__: { polluted: true },
      constructor: { prototype: { polluted: true } },
      ...JSON.parse(Buffer.from(validCookie, 'base64url').toString('utf8')),
      shards: 999999, // invalid sig + proto payload
    }),
    'utf8'
  ).toString('base64url');
  cookieStore.setCookie(COOKIE_VAULT_NAME, protoCookieStr);
  res = vault.hydrateCampaign(tNow);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(res.state.shards, 5);
  assert.equal(Object.hasOwn(res.state, '__proto__'), false);
  assert.equal(Object.hasOwn(res.state, 'constructor'), false);

  // Raw JSON string with literal "__proto__" key in parsePortableSave & primary save
  const rawProtoJson = `{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"v":1,"sig":"00000000"}`;
  assert.equal(parsePortableSave(rawProtoJson).ok, false);
  assert.equal(({}).polluted, undefined);

  // Even if valid sig accompanies injected "__proto__"/"constructor" in JSON, sanitized output strips them
  const parsedPrimary = JSON.parse(validPrimary);
  const jsonWithInjectedKeys =
    `{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},` +
    validPrimary.slice(1);
  const portRes = parsePortableSave(jsonWithInjectedKeys);
  assert.equal(portRes.ok, true);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.hasOwn(portRes.state, '__proto__'), false);
  assert.equal(Object.hasOwn(portRes.state, 'constructor'), false);
  assert.equal(portRes.state.shards, parsedPrimary.shards);

  // 5) Re-signed schema overflow tampering (fleetLevel = 999999, prestige = [99999, ...]) rejected
  const schemaForged = signPayload({ ...parsedPrimary, fleetLevel: 999999 });
  assert.equal(parsePortableSave(JSON.stringify(schemaForged)).ok, false);
  const prestigeForged = signPayload({ ...parsedPrimary, prestige: new Array(9).fill(99999) });
  assert.equal(parsePortableSave(JSON.stringify(prestigeForged)).ok, false);

  // 6) Forged future tClose (now + 3600000ms) in krunked-cookie-vault-v1 defeated by valid localStorage
  const validCookiePlain = JSON.parse(Buffer.from(validCookie, 'base64url').toString('utf8'));
  const futureCookieSigned = signPayload({
    ...validCookiePlain,
    tClose: tNow + 3_600_000,
    lifetimeFlops: { m: 9.9, e: 9999 },
    shards: 7777,
  });
  cookieStore.setCookie(
    COOKIE_VAULT_NAME,
    Buffer.from(JSON.stringify(futureCookieSigned), 'utf8').toString('base64url')
  );
  const futureDefeated = vault.hydrateCampaign(tNow);
  assert.equal(futureDefeated.source, 'localStorage');
  assert.equal(futureDefeated.cookieRegenerated, true);
  assert.equal(futureDefeated.state.shards, 5);
  assert.ok(futureDefeated.state.tClose <= tNow);
});

test('4c. decodeBlueprint fuzzing: 25+ malformed payloads, RLE zip-bombs, checksum mismatches & >100KB strings', () => {
  const validBp = encodeBlueprint(makeStarterSnapshot8x8());
  const validBytes = base64UrlDecode(validBp.slice(4));

  const mutateAndSign = (fn) => {
    const copy = new Uint8Array(validBytes);
    fn(copy);
    return buildBlueprintWithChecksum(copy);
  };

  // Construct RLE zip-bomb (>784 cells), multi-run overflow, zero-count run, under-run, bad runCount
  const zipBombSingle = (() => {
    const buf = new Uint8Array(13 + 6 + 4);
    const view = new DataView(buf.buffer);
    buf.set([0x42, 0x50, 0x30, 0x31, 1, 28, 6]);
    view.setInt8(7, -1); view.setInt8(8, -1); view.setInt8(9, -1); view.setInt8(10, -1);
    view.setUint16(11, 1, false);
    view.setUint16(13, 65535, false); // > 784
    view.setUint32(15, 0, false);
    return buildBlueprintWithChecksum(buf);
  })();

  const zipBombMultiRun = (() => {
    const buf = new Uint8Array(13 + 12 + 4);
    const view = new DataView(buf.buffer);
    buf.set([0x42, 0x50, 0x30, 0x31, 1, 28, 6]);
    view.setInt8(7, -1); view.setInt8(8, -1); view.setInt8(9, -1); view.setInt8(10, -1);
    view.setUint16(11, 2, false);
    view.setUint16(13, 400, false); view.setUint32(15, 0, false);
    view.setUint16(19, 400, false); view.setUint32(21, 0, false); // 800 > 784
    return buildBlueprintWithChecksum(buf);
  })();

  const zeroCountRun = (() => {
    const buf = new Uint8Array(13 + 12 + 4);
    const view = new DataView(buf.buffer);
    buf.set([0x42, 0x50, 0x30, 0x31, 1, 8, 1]);
    view.setInt8(7, -1); view.setInt8(8, -1); view.setInt8(9, -1); view.setInt8(10, -1);
    view.setUint16(11, 2, false);
    view.setUint16(13, 0, false); view.setUint32(15, 0, false);
    view.setUint16(19, 64, false); view.setUint32(21, 0, false);
    return buildBlueprintWithChecksum(buf);
  })();

  const zeroRunCountHeader = (() => {
    const buf = new Uint8Array(13 + 4);
    const view = new DataView(buf.buffer);
    buf.set([0x42, 0x50, 0x30, 0x31, 1, 8, 1]);
    view.setInt8(7, -1); view.setInt8(8, -1); view.setInt8(9, -1); view.setInt8(10, -1);
    view.setUint16(11, 0, false);
    return buildBlueprintWithChecksum(buf);
  })();

  const underFilledRun = (() => {
    const buf = new Uint8Array(13 + 6 + 4);
    const view = new DataView(buf.buffer);
    buf.set([0x42, 0x50, 0x30, 0x31, 1, 8, 1]);
    view.setInt8(7, -1); view.setInt8(8, -1); view.setInt8(9, -1); view.setInt8(10, -1);
    view.setUint16(11, 1, false);
    view.setUint16(13, 63, false); // 63 != 64
    view.setUint32(15, 0, false);
    return buildBlueprintWithChecksum(buf);
  })();

  const trailingExtraByte = (() => {
    const buf = new Uint8Array(validBytes.length + 1);
    buf.set(validBytes);
    buf[buf.length - 1] = 0xff;
    return buildBlueprintWithChecksum(buf);
  })();

  const badChecksumHeader = (() => {
    const b = new Uint8Array(validBytes);
    b[6] = 2; // mutated without updating checksum
    return 'BP1_' + base64UrlEncode(b);
  })();

  const badChecksumBody = (() => {
    const b = new Uint8Array(validBytes);
    b[15] ^= 0x01;
    return 'BP1_' + base64UrlEncode(b);
  })();

  const hugeValidHeaderPayload = (() => {
    const huge = new Uint8Array(90_000);
    huge.set(validBytes);
    return '#blueprint=BP1_' + base64UrlEncode(huge); // > 120KB string
  })();

  const malformedVectors = [
    null,
    undefined,
    12345,
    {},
    [],
    '',
    '   ',
    '#blueprint=',
    'BP1_',
    '#blueprint=BP1_',
    'BP2_' + validBp.slice(4),
    'BP1_!!!!invalid!!!!',
    'BP1_AAAAA', // impossible base64url length % 4 === 1
    'BP1_' + base64UrlEncode(validBytes.subarray(0, 10)),
    'BP1_' + base64UrlEncode(validBytes.subarray(0, validBytes.length - 1)),
    mutateAndSign((b) => { b[0] = 0x58; b[1] = 0x58; }), // "XX01"
    mutateAndSign((b) => { b[4] = 99; }), // wrong version
    mutateAndSign((b) => { b[5] = 0; }), // gridSize 0
    mutateAndSign((b) => { b[5] = 29; }), // gridSize 29
    mutateAndSign((b) => { b[6] = 0; }), // tier 0
    mutateAndSign((b) => { b[6] = 7; }), // tier 7
    mutateAndSign((b) => { b[7] = 6; }), // invalid agent 6
    mutateAndSign((b) => { b[8] = 254; }), // invalid agent -2
    zipBombSingle,
    zipBombMultiRun,
    zeroCountRun,
    zeroRunCountHeader,
    underFilledRun,
    trailingExtraByte,
    badChecksumHeader,
    badChecksumBody,
    '#blueprint=' + validBp + '&tamper=1',
    'BP1_' + 'A'.repeat(120_000), // >100KB valid base64url garbage
    '#blueprint=BP1_' + '!'.repeat(120_000), // >100KB invalid base64url garbage
    hugeValidHeaderPayload,
  ];

  // Add 50 deterministic random binary garbage payloads
  const rng = splitMix32(0x13579bdf);
  for (let i = 0; i < 50; i++) {
    const len = 1 + Math.floor(rng() * 160);
    const bytes = new Uint8Array(len);
    for (let k = 0; k < len; k++) {
      bytes[k] = Math.floor(rng() * 256);
    }
    malformedVectors.push('#blueprint=BP1_' + base64UrlEncode(bytes));
  }

  for (let i = 0; i < malformedVectors.length; i++) {
    let out;
    assert.doesNotThrow(() => {
      out = decodeBlueprint(malformedVectors[i]);
    }, `decodeBlueprint threw on vector #${i}`);
    assert.equal(out.ok, false, `decodeBlueprint unexpectedly accepted malformed vector #${i}`);
  }
});

// ============================================================================
// 5. Repo Hygiene & Subpath Safety Static Audit
// ============================================================================

test('5. Repo hygiene: zero root-absolute URLs, zero vendor model IDs, valid PNG icons & precache manifest', () => {
  function collectJsFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...collectJsFiles(full));
      else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
  }

  const targetFiles = [
    path.join(REPO_ROOT, 'index.html'),
    path.join(REPO_ROOT, 'manifest.json'),
    path.join(REPO_ROOT, 'sw.js'),
    path.join(REPO_ROOT, 'styles', 'cleanroom.css'),
    ...collectJsFiles(path.join(REPO_ROOT, 'src')),
  ];

  const rootAbsPattern = /(?:["'`(=]|\s)\/(?:src|vendor|styles|icons|manifest\.json|sw\.js)\b/g;
  const vendorPrefixes = [
    ['g', 'p', 't'].join(''),
    ['c', 'l', 'a', 'u', 'd', 'e'].join(''),
    ['g', 'e', 'm', 'i', 'n', 'i'].join(''),
    ['l', 'l', 'a', 'm', 'a'].join(''),
    ['m', 'i', 's', 't', 'r', 'a', 'l'].join(''),
    ['d', 'e', 'e', 'p', 's', 'e', 'e', 'k'].join(''),
    ['q', 'w', 'e', 'n'].join(''),
    ['s', 'o', 'n', 'n', 'e', 't'].join(''),
    ['o', 'p', 'u', 's'].join(''),
    ['h', 'a', 'i', 'k', 'u'].join(''),
  ];
  const vendorModelRe = new RegExp(`\\b(?:${vendorPrefixes.join('|')})[-_]?\\d+`, 'i');

  for (const filePath of targetFiles) {
    const rel = path.relative(REPO_ROOT, filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    const absMatches = content.match(rootAbsPattern);
    assert.equal(absMatches, null, `Root-absolute URL detected in ${rel}: ${absMatches}`);
    assert.equal(vendorModelRe.test(content), false, `Vendor model ID detected in ${rel}`);
  }

  // Verify subpath-relative manifest, index.html, and sw.js precache entries exist
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith('./'), `Manifest icon src must be relative: ${icon.src}`);
  }

  const swText = fs.readFileSync(path.join(REPO_ROOT, 'sw.js'), 'utf8');
  const precacheMatch = swText.match(/PRECACHE_URLS\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(precacheMatch, 'PRECACHE_URLS array missing in sw.js');
  const urlMatches = [...precacheMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(urlMatches.length >= 25);
  for (const relUrl of urlMatches) {
    assert.ok(relUrl.startsWith('./'), `sw.js precache entry not subpath-relative: ${relUrl}`);
    if (relUrl !== './') {
      assert.equal(fs.existsSync(path.join(REPO_ROOT, relUrl)), true, `Missing precached asset: ${relUrl}`);
    }
  }

  // Verify PNG magic bytes & exact dimensions for 192x192 and 512x512 icons
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (const [iconRel, expectedDim] of [
    ['icons/icon-192.png', 192],
    ['icons/icon-512.png', 512],
  ]) {
    const buf = fs.readFileSync(path.join(REPO_ROOT, iconRel));
    assert.ok(buf.length >= 24, `${iconRel} too small to be valid PNG`);
    assert.equal(buf.subarray(0, 8).equals(pngMagic), true, `${iconRel} invalid PNG magic signature`);
    assert.equal(buf.subarray(12, 16).toString('ascii'), 'IHDR', `${iconRel} missing IHDR chunk`);
    assert.equal(buf.readUInt32BE(16), expectedDim, `${iconRel} width mismatch`);
    assert.equal(buf.readUInt32BE(20), expectedDim, `${iconRel} height mismatch`);
  }
});
