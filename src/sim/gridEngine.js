/**
 * Swarm Tycoon: Silicon Foundry — Deterministic 10Hz Cleanroom Grid Engine.
 * Manages flat TypedArray state for up to 28x28 (784) tiles and orchestrates
 * power -> cryo -> belt/machine -> overhead FOUP shuttle simulation ticks.
 *
 * Pure ES Module: zero DOM, Phaser, storage, or Node-runtime dependencies.
 */

import { stepPowerGrid } from './powerGridSolver.js';
import { stepCryoLoops } from './cryoLoopSolver.js';
import { stepBeltsAndMachines } from './beltRouter.js';
import { stepShuttles } from './shuttleFleet.js';
import { hashSeedString } from './dailySeedGenerator.js';

export const MAX_GRID_DIM = 28;
export const MAX_CELLS = 784;
export const TICK_MS = 100;

export const DIRS = Object.freeze({ N: 0, E: 1, S: 2, W: 3 });
export const DX = Object.freeze([0, 1, 0, -1]);
export const DY = Object.freeze([-1, 0, 1, 0]);

export const MACHINE_TYPES = Object.freeze({
  EMPTY: 0,
  PILLAR: 1,
  BELT_STRAIGHT: 2,
  BELT_CORNER: 3,
  BELT_SPLITTER: 4,
  BELT_MERGER: 5,
  INGOT_SLICER: 6,
  PHOTORESIST_COATER: 7,
  EUV_SCANNER: 8,
  PLASMA_ETCHER: 9,
  METROLOGY_QA: 10,
  WAFER_VAULT: 11,
  RECLAIM_GRINDER: 12,
  CRYO_CHILLER: 13,
  POWER_SOURCE: 14,
  CAPACITOR_BANK: 15,
  FOUP_DOCK: 16,
  COMPUTE_RACK: 17,
});

export const WAFER_STATES = Object.freeze({
  NONE: 0,
  RAW: 1,
  COATED: 2,
  EXPOSED: 3,
  ETCHED: 4,
  GOOD: 5,
});

function createCatalogEntry({
  id,
  key,
  name,
  shortName,
  costDies,
  powerKw,
  heatGenKw,
  coolKw = 0,
  supplyKw = 0,
  capacityKj = 0,
  maxDischargeKw = 0,
  priority = 1,
  cycleTicks = 1,
  description,
}) {
  return Object.freeze({
    id,
    key,
    name,
    shortName,
    costDies,
    powerKw,
    heatGenKw,
    coolKw,
    supplyKw,
    capacityKj,
    maxDischargeKw,
    priority,
    cycleTicks,
    description,
  });
}

const catalogList = [
  createCatalogEntry({
    id: MACHINE_TYPES.EMPTY,
    key: 'EMPTY',
    name: 'Cleanroom Floor',
    shortName: 'FLOOR',
    costDies: 0,
    powerKw: 0,
    heatGenKw: 0,
    priority: 1,
    cycleTicks: 1,
    description: 'ISO-1 anti-static subfloor tile.',
  }),
  createCatalogEntry({
    id: MACHINE_TYPES.PILLAR,
    key: 'PILLAR',
    name: 'Structural Column',
    shortName: 'PILLAR',
    costDies: 0,
    powerKw: 0,
    heatGenKw: 0,
    priority: 1,
    cycleTicks: 1,
    description: 'Immovable cleanroom load-bearing seismic pillar.',
  }),
  createCatalogEntry({
    id: MACHINE_TYPES.BELT_STRAIGHT,
    key: 'BELT_STRAIGHT',
    name: 'EUV Wafer Track',
    shortName: 'BELT',
    costDies: 5,
    powerKw: 0.1,
    heatGenKw: 0.05,
    priority: 1,
    cycleTicks: 1,
    description: 'Linear magnetic levitation wafer conveyor.',
  }),
  createCatalogEntry({
    id: MACHINE_TYPES.BELT_CORNER,
    key: 'BELT_CORNER',
    name: 'EUV Corner Track',
    shortName: 'TURN',
    costDies: 5,
    powerKw: 0.1,
    heatGenKw: 0.05,
    priority: 1,
    cycleTicks: 1,
    description: '90-degree wafer track (sub 0 = CW, sub 1 = CCW).',
  }),
  createCatalogEntry({
    id: MACHINE_TYPES.BELT_SPLITTER,
    key: 'BELT_SPLITTER',
    name: 'Track Splitter',
    shortName: 'SPLIT',
    costDies: 20,
    powerKw: 0.1,
    heatGenKw: 0.05,
    priority: 1,
    cycleTicks: 1,
    description: 'Backpressure-aware 3-way round-robin wafer splitter.',
  }),
  createCatalogEntry({
    id: MACHINE_TYPES.BELT_MERGER,
    key: 'BELT_MERGER',
    name: 'Priority Merger',
    shortName: 'MERGE',
    costDies: 20,
    powerKw: 0.1,
    heatGenKw: 0.05,
    priority: 1,
    cycleTicks: 1,
    description: 'Arbitrated 3-input wafer merger (sub 0 = fair, 1..3 = priority).',
  }),
  createCatalogEntry({
    id: MACHINE_TYPES.INGOT_SLICER,
    key: 'INGOT_SLICER',
    name: 'Ingot Wire Slicer',
    shortName: 'SLICER',
    costDies: 50,
    powerKw: 1.5,
    heatGenKw: 2.5,
    priority: 2,
    cycleTicks: 4,
    description: 'Slices monocrystalline silicon boules into raw 300mm wafers.',
  }),
  createCatalogEntry({
    id: MACHINE_TYPES.PHOTORESIST_COATER,
    key: 'PHOTORESIST_COATER',
    name: 'Spin Coater',
    shortName: 'COATER',
    costDies: 75,
    powerKw: 1.5,
    heatGenKw: 2.0,
    priority: 2,
    cycleTicks: 4,
    description: 'Deposits uniform EUV photoresist film onto raw wafers.',
  }),
  createCatalogEntry({
    id: MACHINE_TYPES.EUV_SCANNER,
    key: 'EUV_SCANNER',
    name: 'High-NA EUV Scanner',
    shortName: 'EUV',
    costDies: 200,
    powerKw: 3.5,
    heatGenKw: 6.5,
    priority: 2,
    cycleTicks: 5,
    description: '13.5nm extreme ultraviolet lithography stepper.',
  }),
  createCatalogEntry({
    id: MACHINE_TYPES.PLASMA_ETCHER,
    key: 'PLASMA_ETCHER',
    name: 'Plasma Etcher',
    shortName: 'ETCHER',
    costDies: 120,
    powerKw: 2.2,
    heatGenKw: 4.0,
    priority: 2,
    cycleTicks: 4,
    description: 'Anisotropic plasma chamber carving sub-nanometer gates.',
  }),
  createCatalogEntry({
    id: MACHINE_TYPES.METROLOGY_QA,
    key: 'METROLOGY_QA',
    name: 'Metrology QA Gate',
    shortName: 'QA',
    costDies: 80,
    powerKw: 1.0,
    heatGenKw: 1.0,
    priority: 1,
    cycleTicks: 2,
    description: 'Verifies etched wafers forward; diverts defects sideways (dir+1).',
  }),
  createCatalogEntry({
    id: MACHINE_TYPES.WAFER_VAULT,
    key: 'WAFER_VAULT',
    name: 'Wafer Vault',
    shortName: 'VAULT',
    costDies: 100,
    powerKw: 0.4,
    heatGenKw: 0.2,
    priority: 1,
    cycleTicks: 1,
    description: 'Banks certified GOOD wafers for die yield or prototypes.',
  }),
  createCatalogEntry({
    id: MACHINE_TYPES.RECLAIM_GRINDER,
    key: 'RECLAIM_GRINDER',
    name: 'Reclaim Grinder',
    shortName: 'GRIND',
    costDies: 60,
    powerKw: 0.5,
    heatGenKw: 0.8,
    priority: 1,
    cycleTicks: 2,
    description: 'Pulverizes rejected wafers into reclaimed silicon feedstock.',
  }),
  createCatalogEntry({
    id: MACHINE_TYPES.CRYO_CHILLER,
    key: 'CRYO_CHILLER',
    name: '77K LN2 Chiller',
    shortName: 'CRYO',
    costDies: 150,
    powerKw: 1.5,
    heatGenKw: 0.0,
    coolKw: 35.0,
    priority: 1,
    cycleTicks: 1,
    description: 'Pumps 77K liquid nitrogen through connected cryo pipe loops.',
  }),
  createCatalogEntry({
    id: MACHINE_TYPES.POWER_SOURCE,
    key: 'POWER_SOURCE',
    name: 'Micro-Turbine Bus',
    shortName: 'PWR',
    costDies: 250,
    powerKw: 0,
    heatGenKw: 3.0,
    supplyKw: 25.0,
    priority: 1,
    cycleTicks: 1,
    description: 'Dedicated cleanroom power module boosting grid supply capacity.',
  }),
  createCatalogEntry({
    id: MACHINE_TYPES.CAPACITOR_BANK,
    key: 'CAPACITOR_BANK',
    name: 'Supercap Buffer',
    shortName: 'CAP',
    costDies: 180,
    powerKw: 0,
    heatGenKw: 0.4,
    capacityKj: 600,
    maxDischargeKw: 30,
    priority: 1,
    cycleTicks: 1,
    description: 'Stores 600 kJ surplus energy to ride out peak load brownouts.',
  }),
  createCatalogEntry({
    id: MACHINE_TYPES.FOUP_DOCK,
    key: 'FOUP_DOCK',
    name: 'Overhead FOUP Dock',
    shortName: 'FOUP',
    costDies: 110,
    powerKw: 0.6,
    heatGenKw: 0.4,
    priority: 1,
    cycleTicks: 1,
    description: 'Automated OHT shuttle port (sub 0 = pickup, sub 1 = dropoff).',
  }),
  createCatalogEntry({
    id: MACHINE_TYPES.COMPUTE_RACK,
    key: 'COMPUTE_RACK',
    name: 'AI Compute Rack',
    shortName: 'RACK',
    costDies: 300,
    powerKw: 6.0,
    heatGenKw: 8.5,
    priority: 3,
    cycleTicks: 1,
    description: 'Priority-3 tensor rack driving FLOPs throughput and thermal load.',
  }),
];

for (let i = 0; i < catalogList.length; i++) {
  const entry = catalogList[i];
  Object.defineProperty(catalogList, entry.key, {
    value: entry,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

export const MACHINE_CATALOG = Object.freeze(catalogList);

const RESIZE_FIELD_NAMES = [
  'machineType',
  'machineDir',
  'machineSub',
  'priorityTier',
  'ln2Mask',
  'powerMask',
  'shuttleWaypoint',
  'slotWafer',
  'slotDefective',
  'slotProgress',
  'backpressureTicks',
  'tempKelvin',
  'scramActive',
  'powerRatio',
  'thermalMult',
  'defectProb',
  '_splitterCursor',
  '_mergerCursor',
];

/**
 * @typedef {ReturnType<GridEngine['_createInitialState']>} GridState
 */

export class GridEngine {
  /**
   * @param {number} [width=8]
   * @param {string} [seedStr='CAMPAIGN']
   */
  constructor(width = 8, seedStr = 'CAMPAIGN') {
    const validW = this._clampWidth(width);
    this.seedStr = String(seedStr);
    this.tier = this._widthToTier(validW);
    this.state = this._createInitialState(validW, this.seedStr);
  }

  _clampWidth(width) {
    const w = Math.floor(Number(width) || 8);
    return Math.max(8, Math.min(MAX_GRID_DIM, w));
  }

  _widthToTier(width) {
    return Math.max(1, Math.min(6, Math.round((width - 4) / 4)));
  }

  _createInitialState(width, seedStr) {
    const tempKelvin = new Float32Array(MAX_CELLS);
    tempKelvin.fill(295.0);
    const priorityTier = new Uint8Array(MAX_CELLS);
    priorityTier.fill(1);
    const thermalMult = new Float32Array(MAX_CELLS);
    thermalMult.fill(1.0);
    const sectorAgents = new Int8Array(4);
    sectorAgents.fill(-1);

    return {
      width,
      capacity: MAX_CELLS,
      machineType: new Uint8Array(MAX_CELLS),
      machineDir: new Uint8Array(MAX_CELLS),
      machineSub: new Uint8Array(MAX_CELLS),
      priorityTier,
      ln2Mask: new Uint8Array(MAX_CELLS),
      powerMask: new Uint8Array(MAX_CELLS),
      shuttleWaypoint: new Uint8Array(MAX_CELLS),
      slotWafer: new Uint8Array(MAX_CELLS),
      slotDefective: new Uint8Array(MAX_CELLS),
      slotProgress: new Float32Array(MAX_CELLS),
      backpressureTicks: new Uint16Array(MAX_CELLS),
      tempKelvin,
      scramActive: new Uint8Array(MAX_CELLS),
      powerRatio: new Float32Array(MAX_CELLS),
      thermalMult,
      defectProb: new Float32Array(MAX_CELLS),
      sectorAgents,
      shuttles: [],
      capacitorStoredKj: 0,
      tickCount: 0,
      vaultedGood: 0,
      vaultedProto: 0,
      reclaimedCount: 0,
      paperclipsMinted: 0,
      euvFlashes: 0,
      seedState: hashSeedString(seedStr) || 0x12345678,
      _splitterCursor: new Uint8Array(MAX_CELLS),
      _mergerCursor: new Uint8Array(MAX_CELLS),
    };
  }

  _resetState(width = this.state.width) {
    const st = this.state;
    st.width = this._clampWidth(width);
    st.machineType.fill(0);
    st.machineDir.fill(0);
    st.machineSub.fill(0);
    st.priorityTier.fill(1);
    st.ln2Mask.fill(0);
    st.powerMask.fill(0);
    st.shuttleWaypoint.fill(0);
    st.slotWafer.fill(0);
    st.slotDefective.fill(0);
    st.slotProgress.fill(0);
    st.backpressureTicks.fill(0);
    st.tempKelvin.fill(295.0);
    st.scramActive.fill(0);
    st.powerRatio.fill(0);
    st.thermalMult.fill(1.0);
    st.defectProb.fill(0);
    st.sectorAgents.fill(-1);
    st.shuttles.length = 0;
    st.capacitorStoredKj = 0;
    st.tickCount = 0;
    st.vaultedGood = 0;
    st.vaultedProto = 0;
    st.reclaimedCount = 0;
    st.paperclipsMinted = 0;
    st.euvFlashes = 0;
    st.seedState = hashSeedString(this.seedStr) || 0x12345678;
    st._splitterCursor.fill(0);
    st._mergerCursor.fill(0);
  }

  /**
   * Checks whether integer coordinates (x, y) lie inside the active grid.
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  inBounds(x, y) {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      x < this.state.width &&
      y >= 0 &&
      y < this.state.width
    );
  }

  /**
   * Returns linear cell index for (x, y), or -1 if out of bounds.
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  index(x, y) {
    if (!this.inBounds(x, y)) return -1;
    return y * this.state.width + x;
  }

  /**
   * Returns a plain snapshot object for tile (x, y), or null if out of bounds.
   * @param {number} x
   * @param {number} y
   */
  getCell(x, y) {
    const idx = this.index(x, y);
    if (idx < 0) return null;
    const st = this.state;
    return {
      x,
      y,
      index: idx,
      machineType: st.machineType[idx],
      machineDir: st.machineDir[idx],
      machineSub: st.machineSub[idx],
      priorityTier: st.priorityTier[idx],
      ln2Mask: st.ln2Mask[idx],
      powerMask: st.powerMask[idx],
      shuttleWaypoint: st.shuttleWaypoint[idx],
      slotWafer: st.slotWafer[idx],
      slotDefective: st.slotDefective[idx],
      slotProgress: st.slotProgress[idx],
      backpressureTicks: st.backpressureTicks[idx],
      tempKelvin: st.tempKelvin[idx],
      scramActive: st.scramActive[idx],
      powerRatio: st.powerRatio[idx],
      thermalMult: st.thermalMult[idx],
    };
  }

  /**
   * Resizes the active cleanroom dimension while preserving existing (x, y)
   * machines, slots, temperatures, and masks inside the overlapping bounds.
   * @param {number} newSize
   */
  resize(newSize) {
    const newW = this._clampWidth(newSize);
    const oldW = this.state.width;
    this.tier = this._widthToTier(newW);
    if (newW === oldW) {
      return;
    }

    const st = this.state;
    const copyW = Math.min(oldW, newW);

    for (let f = 0; f < RESIZE_FIELD_NAMES.length; f++) {
      const name = RESIZE_FIELD_NAMES[f];
      const arr = st[name];
      const copy = new arr.constructor(MAX_CELLS);
      if (name === 'tempKelvin') copy.fill(295.0);
      else if (name === 'priorityTier') copy.fill(1);
      else if (name === 'thermalMult') copy.fill(1.0);

      for (let y = 0; y < copyW; y++) {
        for (let x = 0; x < copyW; x++) {
          copy[y * newW + x] = arr[y * oldW + x];
        }
      }
      arr.set(copy);
    }

    st.width = newW;

    // Trim edge connectivity bits on the new boundary
    for (let y = 0; y < newW; y++) {
      for (let x = 0; x < newW; x++) {
        const idx = y * newW + x;
        if (x === 0) {
          st.ln2Mask[idx] &= ~0x08;
          st.powerMask[idx] &= ~0x08;
        }
        if (x === newW - 1) {
          st.ln2Mask[idx] &= ~0x02;
          st.powerMask[idx] &= ~0x02;
        }
        if (y === 0) {
          st.ln2Mask[idx] &= ~0x01;
          st.powerMask[idx] &= ~0x01;
        }
        if (y === newW - 1) {
          st.ln2Mask[idx] &= ~0x04;
          st.powerMask[idx] &= ~0x04;
        }
      }
    }

    // Drop any shuttles targeting coordinates outside new bounds
    for (let s = st.shuttles.length - 1; s >= 0; s--) {
      const sh = st.shuttles[s];
      if (sh.targetX >= newW || sh.targetY >= newW || sh.x >= newW || sh.y >= newW) {
        st.shuttles.splice(s, 1);
      }
    }
  }

  /**
   * Places a machine on tile (x, y). Refuses placing over PILLAR tiles.
   * @param {number} x
   * @param {number} y
   * @param {number} type
   * @param {number} [dir=1]
   * @param {number} [sub=0]
   * @returns {boolean}
   */
  placeMachine(x, y, type, dir = 1, sub = 0) {
    const idx = this.index(x, y);
    if (idx < 0) return false;
    if (!Number.isInteger(type) || type < 0 || type >= MACHINE_CATALOG.length) {
      return false;
    }

    const st = this.state;
    if (st.machineType[idx] === MACHINE_TYPES.PILLAR) {
      return false;
    }

    const prevType = st.machineType[idx];
    const cleanDir = dir & 3;
    const cleanSub = sub & 3;
    const cat = MACHINE_CATALOG[type];

    st.machineType[idx] = type;
    st.machineDir[idx] = cleanDir;
    st.machineSub[idx] = cleanSub;
    st.priorityTier[idx] = cat ? cat.priority : 1;
    st.shuttleWaypoint[idx] =
      type === MACHINE_TYPES.FOUP_DOCK ? ((cleanSub & 1) === 0 ? 1 : 2) : 0;

    if (prevType !== type) {
      st.slotWafer[idx] = 0;
      st.slotDefective[idx] = 0;
      st.slotProgress[idx] = 0;
      st.backpressureTicks[idx] = 0;
      st._splitterCursor[idx] = 0;
      st._mergerCursor[idx] = 0;
    }

    return true;
  }

  /**
   * Removes the machine on tile (x, y), leaving LN2 pipe & power busbar masks intact.
   * Refuses removing PILLAR tiles.
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  removeMachine(x, y) {
    const idx = this.index(x, y);
    if (idx < 0) return false;
    const st = this.state;
    if (st.machineType[idx] === MACHINE_TYPES.PILLAR) {
      return false;
    }

    st.machineType[idx] = MACHINE_TYPES.EMPTY;
    st.machineDir[idx] = 0;
    st.machineSub[idx] = 0;
    st.priorityTier[idx] = 1;
    st.shuttleWaypoint[idx] = 0;
    st.slotWafer[idx] = 0;
    st.slotDefective[idx] = 0;
    st.slotProgress[idx] = 0;
    st.backpressureTicks[idx] = 0;
    st.scramActive[idx] = 0;
    st._splitterCursor[idx] = 0;
    st._mergerCursor[idx] = 0;
    return true;
  }

  _toggleMaskBit(maskArr, x, y, enabled) {
    const idx = this.index(x, y);
    if (idx < 0) return false;

    const nextOn = enabled === undefined ? (maskArr[idx] & 0x10) === 0 : Boolean(enabled);

    if (!nextOn) {
      maskArr[idx] = 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        const nIdx = this.index(nx, ny);
        if (nIdx >= 0) {
          const opp = (d + 2) & 3;
          maskArr[nIdx] &= ~(1 << opp);
        }
      }
      return true;
    }

    let mask = 0x10;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      const nIdx = this.index(nx, ny);
      if (nIdx >= 0 && (maskArr[nIdx] & 0x10) !== 0) {
        const opp = (d + 2) & 3;
        mask |= 1 << d;
        maskArr[nIdx] |= 1 << opp;
      }
    }
    maskArr[idx] = mask;
    return true;
  }

  /**
   * Toggles LN2 cryo pipe bit 4 (0x10) and updates N/E/S/W neighbor edge bits symmetrically.
   * @param {number} x
   * @param {number} y
   * @param {boolean} [enabled]
   * @returns {boolean}
   */
  togglePipe(x, y, enabled) {
    return this._toggleMaskBit(this.state.ln2Mask, x, y, enabled);
  }

  /**
   * Toggles power busbar bit 4 (0x10) and updates N/E/S/W neighbor edge bits symmetrically.
   * @param {number} x
   * @param {number} y
   * @param {boolean} [enabled]
   * @returns {boolean}
   */
  toggleBusbar(x, y, enabled) {
    return this._toggleMaskBit(this.state.powerMask, x, y, enabled);
  }

  /**
   * Resets to an operational 8x8 Tier 01 starter cleanroom fab loop (<15 kW, <285K).
   */
  loadStarterFab() {
    this.tier = 1;
    this._resetState(8);

    // Cryo chiller cooling the closed LN2 loop
    this.placeMachine(0, 1, MACHINE_TYPES.CRYO_CHILLER, DIRS.S);

    // Upper line going East: Slicer -> Belt -> Coater -> Belt -> EUV -> Belt -> Corner(E->S)
    this.placeMachine(0, 2, MACHINE_TYPES.INGOT_SLICER, DIRS.E);
    this.placeMachine(1, 2, MACHINE_TYPES.BELT_STRAIGHT, DIRS.E);
    this.placeMachine(2, 2, MACHINE_TYPES.PHOTORESIST_COATER, DIRS.E);
    this.placeMachine(3, 2, MACHINE_TYPES.BELT_STRAIGHT, DIRS.E);
    this.placeMachine(4, 2, MACHINE_TYPES.EUV_SCANNER, DIRS.E);
    this.placeMachine(5, 2, MACHINE_TYPES.BELT_STRAIGHT, DIRS.E);
    this.placeMachine(6, 2, MACHINE_TYPES.BELT_CORNER, DIRS.E, 0);

    // Right return turn South -> West
    this.placeMachine(6, 3, MACHINE_TYPES.BELT_STRAIGHT, DIRS.S);
    this.placeMachine(6, 4, MACHINE_TYPES.BELT_CORNER, DIRS.S, 0);

    // Lower line going West: Etcher -> Belt -> Metrology QA -> Belt -> Wafer Vault
    this.placeMachine(5, 4, MACHINE_TYPES.PLASMA_ETCHER, DIRS.W);
    this.placeMachine(4, 4, MACHINE_TYPES.BELT_STRAIGHT, DIRS.W);
    this.placeMachine(3, 4, MACHINE_TYPES.METROLOGY_QA, DIRS.W);
    this.placeMachine(2, 4, MACHINE_TYPES.BELT_STRAIGHT, DIRS.W);
    this.placeMachine(1, 4, MACHINE_TYPES.WAFER_VAULT, DIRS.W);

    // Defect diversion (QA dir=W => (W+1)%4 = N => (3,3))
    this.placeMachine(3, 3, MACHINE_TYPES.RECLAIM_GRINDER, DIRS.N);

    // Closed-loop 77K LN2 cryo pipe covering chiller and all processing tools
    for (let x = 0; x <= 5; x++) {
      this.togglePipe(x, 1, true);
      this.togglePipe(x, 2, true);
      this.togglePipe(x, 4, true);
    }
    for (let y = 1; y <= 4; y++) {
      this.togglePipe(0, y, true);
      this.togglePipe(5, y, true);
    }
    this.togglePipe(3, 3, true);

    // Power busbars anchored from substation (0,0) across the starter fab
    this.toggleBusbar(0, 0, true);
    this.toggleBusbar(0, 1, true);
    for (let x = 0; x <= 6; x++) {
      this.toggleBusbar(x, 2, true);
    }
    this.toggleBusbar(6, 3, true);
    for (let x = 1; x <= 6; x++) {
      this.toggleBusbar(x, 4, true);
    }
    this.toggleBusbar(3, 3, true);
  }

  /**
   * Places immovable structural pillars onto the grid (e.g., for Daily Challenges).
   * @param {Array<{ x: number, y: number }>} pillars
   */
  applyDailyPillars(pillars = []) {
    const st = this.state;
    for (let i = 0; i < pillars.length; i++) {
      const p = pillars[i];
      if (!p || !this.inBounds(p.x, p.y)) continue;
      const idx = p.y * st.width + p.x;
      this.togglePipe(p.x, p.y, false);
      this.toggleBusbar(p.x, p.y, false);
      st.machineType[idx] = MACHINE_TYPES.PILLAR;
      st.machineDir[idx] = 0;
      st.machineSub[idx] = 0;
      st.priorityTier[idx] = 1;
      st.shuttleWaypoint[idx] = 0;
      st.slotWafer[idx] = 0;
      st.slotDefective[idx] = 0;
      st.slotProgress[idx] = 0;
      st.backpressureTicks[idx] = 0;
      st.scramActive[idx] = 0;
    }
  }

  /**
   * Executes one deterministic 10Hz simulation tick (100ms):
   * Power Grid -> Cryo Loops -> Belts & Machines -> FOUP Shuttles.
   * @param {Record<string, any>} [externalModifiers]
   */
  stepTick(externalModifiers = {}) {
    const st = this.state;
    st.tickCount++;

    const prevGood = st.vaultedGood;
    const prevProto = st.vaultedProto;
    const prevReclaimed = st.reclaimedCount;

    const powerTelemetry = stepPowerGrid(st, externalModifiers);
    const cryoTelemetry = stepCryoLoops(st, externalModifiers);
    const beltTelemetry = stepBeltsAndMachines(st, externalModifiers);
    stepShuttles(st, externalModifiers);

    const count = st.width * st.width;
    let qaBackpressureMax = 0;
    let totalBackpressure = 0;
    for (let i = 0; i < count; i++) {
      const bp = st.backpressureTicks[i];
      totalBackpressure += bp;
      if (st.machineType[i] === MACHINE_TYPES.METROLOGY_QA && bp > qaBackpressureMax) {
        qaBackpressureMax = bp;
      }
    }

    return {
      tickCount: st.tickCount,
      vaultedGood: st.vaultedGood,
      vaultedProto: st.vaultedProto,
      reclaimedCount: st.reclaimedCount,
      paperclipsMinted: st.paperclipsMinted,
      deltaGood: st.vaultedGood - prevGood,
      deltaProto: st.vaultedProto - prevProto,
      deltaReclaimed: st.reclaimedCount - prevReclaimed,
      euvFlashes: beltTelemetry.euvFlashes,
      powerSupplyKw: powerTelemetry.powerSupplyKw,
      powerDemandKw: powerTelemetry.powerDemandKw,
      capacitorStoredKj: powerTelemetry.capacitorStoredKj,
      capacitorMaxKj: powerTelemetry.capacitorMaxKj,
      brownoutLevel: powerTelemetry.brownoutLevel,
      avgKelvin: cryoTelemetry.avgKelvin,
      maxKelvin: cryoTelemetry.maxKelvin,
      minKelvin: cryoTelemetry.minKelvin,
      scramCount: cryoTelemetry.scramCount,
      qaBackpressureMax,
      totalBackpressure,
      completedWafers: beltTelemetry.completedWafers,
    };
  }

  /**
   * Exports a plain JSON-serializable layout snapshot compatible with blueprintCodec & saves.
   */
  exportLayoutSnapshot() {
    const st = this.state;
    const w = st.width;
    const count = w * w;
    const cells = new Array(count);

    for (let i = 0; i < count; i++) {
      cells[i] = {
        machineType: st.machineType[i],
        machineDir: st.machineDir[i],
        machineSub: st.machineSub[i],
        ln2Mask: st.ln2Mask[i],
        powerMask: st.powerMask[i],
        shuttleWaypoint: st.shuttleWaypoint[i],
      };
    }

    return {
      gridSize: w,
      tier: this.tier,
      agents: [st.sectorAgents[0], st.sectorAgents[1], st.sectorAgents[2], st.sectorAgents[3]],
      cells,
    };
  }

  /**
   * Imports a layout snapshot into the engine cleanly.
   * @param {{ gridSize?: number, tier?: number, agents?: number[], cells?: any[] }} snap
   * @returns {boolean}
   */
  importLayoutSnapshot(snap) {
    if (!snap || typeof snap !== 'object' || !Array.isArray(snap.cells)) {
      return false;
    }

    const gridSize = this._clampWidth(snap.gridSize ?? Math.sqrt(snap.cells.length));
    const expectedCount = gridSize * gridSize;
    if (snap.cells.length !== expectedCount) {
      return false;
    }

    this.tier = Number.isInteger(snap.tier)
      ? Math.max(1, Math.min(6, snap.tier))
      : this._widthToTier(gridSize);
    this._resetState(gridSize);

    const st = this.state;
    if (Array.isArray(snap.agents)) {
      for (let a = 0; a < 4; a++) {
        const val = snap.agents[a];
        st.sectorAgents[a] = Number.isInteger(val) && val >= -1 && val <= 5 ? val : -1;
      }
    }

    for (let i = 0; i < expectedCount; i++) {
      const c = snap.cells[i];
      if (!c) continue;
      const type = Number.isInteger(c.machineType) && c.machineType >= 0 && c.machineType < MACHINE_CATALOG.length
        ? c.machineType
        : 0;
      const dir = (c.machineDir ?? 0) & 3;
      const sub = (c.machineSub ?? 0) & 3;
      const cat = MACHINE_CATALOG[type];

      st.machineType[i] = type;
      st.machineDir[i] = dir;
      st.machineSub[i] = sub;
      st.priorityTier[i] = cat ? cat.priority : 1;
      st.ln2Mask[i] = (c.ln2Mask ?? 0) & 0x1f;
      st.powerMask[i] = (c.powerMask ?? 0) & 0x1f;
      st.shuttleWaypoint[i] =
        type === MACHINE_TYPES.FOUP_DOCK
          ? ((sub & 1) === 0 ? 1 : 2)
          : ((c.shuttleWaypoint ?? 0) & 3);
    }

    return true;
  }
}
