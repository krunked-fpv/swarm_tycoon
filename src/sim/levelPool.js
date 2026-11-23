/**
 * Swarm Tycoon: Silicon Foundry — 24 Cleanroom Contract Nodes & Satire Quip Pool.
 * Provides 24 deterministic bespoke fab layouts across Scale Tiers 1..6 (4 per tier),
 * non-repeating 24-bit shuffle-bag node selection, BFS-verified pillar generation,
 * and a 24-entry semiconductor/startup satire quip shuffle bag.
 *
 * Pure ES Module: zero DOM, Phaser, storage, or Node-runtime dependencies.
 */

const TIER_GRID_SIZES = Object.freeze([8, 12, 16, 20, 24, 28]);
const MAX_NODE_MASK = 0xffffff;

const DX = Object.freeze([0, 1, 0, -1]);
const DY = Object.freeze([-1, 0, 1, 0]);

// Scratch buffers for BFS flood-fill validation (max 28x28 = 784)
const _blocked = new Uint8Array(784);
const _visited = new Uint8Array(784);
const _queue = new Uint16Array(784);

function makeNode({
  id,
  tier,
  archetype,
  title,
  subtitle,
  waferGoal,
  bonusDies,
  bonusShards,
  modifiers,
}) {
  const code = `N${String(id + 1).padStart(2, '0')}`;
  const gridSize = TIER_GRID_SIZES[tier - 1];
  return Object.freeze({
    id,
    code,
    title,
    subtitle,
    tier,
    gridSize,
    archetype,
    waferGoal,
    bonusDies,
    bonusShards,
    modifiers: Object.freeze({
      powerMult: modifiers.powerMult,
      ambientK: modifiers.ambientK,
      defectBias: modifiers.defectBias,
      beltSpeedMult: modifiers.beltSpeedMult,
    }),
  });
}

export const LEVEL_POOL = Object.freeze([
  // Tier 1 (8x8)
  makeNode({
    id: 0,
    tier: 1,
    archetype: 'laminar_alley',
    title: 'Laminar Wind Tunnel',
    subtitle: 'Class-10 Garage Ductwork',
    waferGoal: 8,
    bonusDies: 250,
    bonusShards: 1,
    modifiers: { powerMult: 1.0, ambientK: 294, defectBias: 0.0, beltSpeedMult: 1.0 },
  }),
  makeNode({
    id: 1,
    tier: 1,
    archetype: 'twin_pillars',
    title: 'Twin Seismic Monoliths',
    subtitle: 'Dual Load-Bearing Basalt Columns',
    waferGoal: 12,
    bonusDies: 360,
    bonusShards: 1,
    modifiers: { powerMult: 0.95, ambientK: 296, defectBias: 0.01, beltSpeedMult: 1.05 },
  }),
  makeNode({
    id: 2,
    tier: 1,
    archetype: 'cryo_moat',
    title: 'LN2 Cryo Basin',
    subtitle: 'Sub-Zero Perimeter Heat Sink',
    waferGoal: 14,
    bonusDies: 450,
    bonusShards: 1,
    modifiers: { powerMult: 1.05, ambientK: 280, defectBias: 0.0, beltSpeedMult: 0.95 },
  }),
  makeNode({
    id: 3,
    tier: 1,
    archetype: 'zigzag_stepper',
    title: 'Serpentine Stepper Bay',
    subtitle: 'Alternating Baffle Lithography Lane',
    waferGoal: 16,
    bonusDies: 580,
    bonusShards: 1,
    modifiers: { powerMult: 0.9, ambientK: 300, defectBias: 0.02, beltSpeedMult: 1.1 },
  }),

  // Tier 2 (12x12)
  makeNode({
    id: 4,
    tier: 2,
    archetype: 'quad_columns',
    title: 'Quad-Column Foundry',
    subtitle: 'Four-Pillar Seed Cleanroom',
    waferGoal: 22,
    bonusDies: 1800,
    bonusShards: 2,
    modifiers: { powerMult: 1.0, ambientK: 295, defectBias: 0.01, beltSpeedMult: 1.0 },
  }),
  makeNode({
    id: 5,
    tier: 2,
    archetype: 'courtyard_ring',
    title: 'Gated Courtyard Ring',
    subtitle: 'Cardinal Portal Isolation Bay',
    waferGoal: 26,
    bonusDies: 2400,
    bonusShards: 2,
    modifiers: { powerMult: 0.92, ambientK: 298, defectBias: 0.02, beltSpeedMult: 1.08 },
  }),
  makeNode({
    id: 6,
    tier: 2,
    archetype: 'diagonal_baffle',
    title: 'Diagonal Waveguide',
    subtitle: '45-Degree Photoresist Chicane',
    waferGoal: 30,
    bonusDies: 3100,
    bonusShards: 3,
    modifiers: { powerMult: 1.1, ambientK: 288, defectBias: 0.01, beltSpeedMult: 1.12 },
  }),
  makeNode({
    id: 7,
    tier: 2,
    archetype: 'pinball_chicanes',
    title: 'Pinball Ricochet Hall',
    subtitle: 'Staggered Vertical Diverter Ribs',
    waferGoal: 35,
    bonusDies: 4000,
    bonusShards: 3,
    modifiers: { powerMult: 0.88, ambientK: 304, defectBias: 0.03, beltSpeedMult: 1.18 },
  }),

  // Tier 3 (16x16)
  makeNode({
    id: 8,
    tier: 3,
    archetype: 'foup_canyon',
    title: 'FOUP Mesa Canyon',
    subtitle: 'Dual Shelf Overhead Shuttle Gorge',
    waferGoal: 42,
    bonusDies: 55000,
    bonusShards: 4,
    modifiers: { powerMult: 1.05, ambientK: 295, defectBias: 0.02, beltSpeedMult: 1.05 },
  }),
  makeNode({
    id: 9,
    tier: 3,
    archetype: 'cruciform_hub',
    title: 'Cruciform EUV Crossroad',
    subtitle: 'Four-Arm Metrology Spine',
    waferGoal: 50,
    bonusDies: 82000,
    bonusShards: 4,
    modifiers: { powerMult: 0.95, ambientK: 302, defectBias: 0.02, beltSpeedMult: 1.15 },
  }),
  makeNode({
    id: 10,
    tier: 3,
    archetype: 'spiral_cleanroom',
    title: 'Archimedean Cleanroom',
    subtitle: 'Inward-Winding Laminar Spiral',
    waferGoal: 58,
    bonusDies: 120000,
    bonusShards: 5,
    modifiers: { powerMult: 1.15, ambientK: 286, defectBias: 0.01, beltSpeedMult: 1.2 },
  }),
  makeNode({
    id: 11,
    tier: 3,
    archetype: 'checker_matrix',
    title: 'Checkerboard Matrix',
    subtitle: 'Periodic Seismic Grid Array',
    waferGoal: 66,
    bonusDies: 165000,
    bonusShards: 5,
    modifiers: { powerMult: 0.85, ambientK: 308, defectBias: 0.04, beltSpeedMult: 1.1 },
  }),

  // Tier 4 (20x20)
  makeNode({
    id: 12,
    tier: 4,
    archetype: 'substation_fortress',
    title: 'Substation Citadel',
    subtitle: 'Hardened Busbar Keep & Bastion',
    waferGoal: 78,
    bonusDies: 25000000,
    bonusShards: 7,
    modifiers: { powerMult: 1.25, ambientK: 296, defectBias: 0.02, beltSpeedMult: 1.08 },
  }),
  makeNode({
    id: 13,
    tier: 4,
    archetype: 'double_helix_lanes',
    title: 'Double-Helix Track',
    subtitle: 'Interleaved Sinusoidal Twin Lanes',
    waferGoal: 90,
    bonusDies: 42000000,
    bonusShards: 8,
    modifiers: { powerMult: 0.95, ambientK: 292, defectBias: 0.03, beltSpeedMult: 1.25 },
  }),
  makeNode({
    id: 14,
    tier: 4,
    archetype: 'diamond_chamber',
    title: 'Diamond Fab Chamber',
    subtitle: 'Octagonal Crystal Lattice Enclosure',
    waferGoal: 105,
    bonusDies: 68000000,
    bonusShards: 8,
    modifiers: { powerMult: 1.0, ambientK: 284, defectBias: 0.02, beltSpeedMult: 1.18 },
  }),
  makeNode({
    id: 15,
    tier: 4,
    archetype: 'thermal_furnace_bay',
    title: 'Thermal Furnace Bay',
    subtitle: 'High-Heat Annealing Radiator Fins',
    waferGoal: 120,
    bonusDies: 95000000,
    bonusShards: 9,
    modifiers: { powerMult: 1.1, ambientK: 324, defectBias: 0.05, beltSpeedMult: 1.22 },
  }),

  // Tier 5 (24x24)
  makeNode({
    id: 16,
    tier: 5,
    archetype: 'capacitor_gauntlet',
    title: 'Capacitor Gauntlet',
    subtitle: 'High-Voltage Corridor & Chokes',
    waferGoal: 145,
    bonusDies: 60000000000,
    bonusShards: 12,
    modifiers: { powerMult: 0.82, ambientK: 304, defectBias: 0.03, beltSpeedMult: 1.25 },
  }),
  makeNode({
    id: 17,
    tier: 5,
    archetype: 'triple_splitter_maze',
    title: 'Triple-Splitter Manifold',
    subtitle: 'Three-Deck Arbitrated Routing Maze',
    waferGoal: 170,
    bonusDies: 110000000000,
    bonusShards: 13,
    modifiers: { powerMult: 1.05, ambientK: 298, defectBias: 0.03, beltSpeedMult: 1.3 },
  }),
  makeNode({
    id: 18,
    tier: 5,
    archetype: 'lunar_crater_ridge',
    title: 'Mare Tranquillitatis Crater',
    subtitle: 'Basalt Rim & Vacuum Regolith Ridge',
    waferGoal: 195,
    bonusDies: 185000000000,
    bonusShards: 14,
    modifiers: { powerMult: 1.15, ambientK: 278, defectBias: 0.04, beltSpeedMult: 1.2 },
  }),
  makeNode({
    id: 19,
    tier: 5,
    archetype: 'vacuum_archipelago',
    title: 'Vacuum Archipelago',
    subtitle: 'Zero-G Cluster Island Array',
    waferGoal: 220,
    bonusDies: 280000000000,
    bonusShards: 15,
    modifiers: { powerMult: 0.9, ambientK: 310, defectBias: 0.05, beltSpeedMult: 1.35 },
  }),

  // Tier 6 (28x28)
  makeNode({
    id: 20,
    tier: 6,
    archetype: 'regolith_labyrinth',
    title: 'Orbital Regolith Labyrinth',
    subtitle: 'Multi-Chamber Deep-Space Fab Maze',
    waferGoal: 260,
    bonusDies: 450000000000000,
    bonusShards: 18,
    modifiers: { powerMult: 0.92, ambientK: 306, defectBias: 0.04, beltSpeedMult: 1.28 },
  }),
  makeNode({
    id: 21,
    tier: 6,
    archetype: 'synchrotron_halo',
    title: 'Synchrotron Storage Halo',
    subtitle: 'Concentric Relativistic Beam Rings',
    waferGoal: 310,
    bonusDies: 900000000000000,
    bonusShards: 20,
    modifiers: { powerMult: 1.2, ambientK: 290, defectBias: 0.04, beltSpeedMult: 1.35 },
  }),
  makeNode({
    id: 22,
    tier: 6,
    archetype: 'orbital_spoke_wheel',
    title: 'Orbital Spoke Array',
    subtitle: 'Radial Gravity-Wheel Lithography Ring',
    waferGoal: 360,
    bonusDies: 1800000000000000,
    bonusShards: 22,
    modifiers: { powerMult: 1.0, ambientK: 314, defectBias: 0.05, beltSpeedMult: 1.4 },
  }),
  makeNode({
    id: 23,
    tier: 6,
    archetype: 'singularity_core',
    title: 'Singularity Core',
    subtitle: 'Event-Horizon Spiral Lithography Vault',
    waferGoal: 420,
    bonusDies: 3600000000000000,
    bonusShards: 25,
    modifiers: { powerMult: 0.85, ambientK: 320, defectBias: 0.06, beltSpeedMult: 1.45 },
  }),
]);

/**
 * Checks whether coordinates (x, y) must remain permanently open for substation
 * anchor and diagonal exit clearance.
 */
function isProtectedTile(x, y, gridSize) {
  return (
    (x === 0 && y === 0) ||
    (x === 1 && y === 0) ||
    (x === 0 && y === 1) ||
    (x === gridSize - 1 && y === gridSize - 1)
  );
}

/**
 * Verifies via BFS from (0,0) that every non-pillar floor tile on the grid
 * forms a single connected component including (gridSize - 1, gridSize - 1).
 */
function isGridConnected(gridSize, pillarCount) {
  const total = gridSize * gridSize;
  if (_blocked[0] !== 0 || _blocked[total - 1] !== 0) {
    return false;
  }

  _visited.fill(0, 0, total);
  let head = 0;
  let tail = 0;
  _visited[0] = 1;
  _queue[tail++] = 0;

  while (head < tail) {
    const curr = _queue[head++];
    const cx = curr % gridSize;
    const cy = (curr / gridSize) | 0;

    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) {
        continue;
      }
      const nIdx = ny * gridSize + nx;
      if (_blocked[nIdx] === 0 && _visited[nIdx] === 0) {
        _visited[nIdx] = 1;
        _queue[tail++] = nIdx;
      }
    }
  }

  return tail === total - pillarCount && _visited[total - 1] === 1;
}

function addBlock(out, x1, y1, x2, y2) {
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      out.push({ x, y });
    }
  }
}

function addRing(out, cx, cy, minR, maxR, skipFn = null) {
  for (let y = 0; y < 28; y++) {
    for (let x = 0; x < 28; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      if (r >= minR && r <= maxR && (!skipFn || !skipFn(x, y))) {
        out.push({ x, y });
      }
    }
  }
}

/**
 * Produces ordered candidate pillar coordinates for each of the 24 archetypes.
 * @param {string} archetype
 * @param {number} gridSize
 * @returns {Array<{ x: number, y: number }>}
 */
function generateArchetypeCandidates(archetype, gridSize) {
  const pts = [];

  switch (archetype) {
    // --- Tier 1 (8x8) ---
    case 'laminar_alley':
      addBlock(pts, 2, 2, 4, 2);
      addBlock(pts, 3, 5, 5, 5);
      break;

    case 'twin_pillars':
      addBlock(pts, 5, 2, 6, 3);
      addBlock(pts, 1, 4, 2, 5);
      break;

    case 'cryo_moat':
      pts.push(
        { x: 2, y: 2 },
        { x: 5, y: 2 },
        { x: 2, y: 5 },
        { x: 5, y: 5 },
        { x: 3, y: 1 },
        { x: 4, y: 6 }
      );
      break;

    case 'zigzag_stepper':
      addBlock(pts, 2, 1, 2, 4);
      addBlock(pts, 5, 3, 5, 6);
      break;

    // --- Tier 2 (12x12) ---
    case 'quad_columns':
      addBlock(pts, 3, 3, 4, 4);
      addBlock(pts, 7, 3, 8, 4);
      addBlock(pts, 3, 7, 4, 8);
      addBlock(pts, 7, 7, 8, 8);
      break;

    case 'courtyard_ring':
      addBlock(pts, 2, 2, 4, 2);
      addBlock(pts, 7, 2, 9, 2);
      addBlock(pts, 2, 9, 4, 9);
      addBlock(pts, 7, 9, 9, 9);
      addBlock(pts, 2, 3, 2, 4);
      addBlock(pts, 2, 7, 2, 8);
      addBlock(pts, 9, 3, 9, 4);
      addBlock(pts, 9, 7, 9, 8);
      break;

    case 'diagonal_baffle':
      pts.push(
        { x: 2, y: 4 },
        { x: 3, y: 3 },
        { x: 4, y: 2 },
        { x: 4, y: 7 },
        { x: 5, y: 6 },
        { x: 6, y: 5 },
        { x: 7, y: 4 },
        { x: 7, y: 9 },
        { x: 8, y: 8 },
        { x: 9, y: 7 }
      );
      break;

    case 'pinball_chicanes':
      addBlock(pts, 2, 2, 2, 4);
      addBlock(pts, 4, 6, 4, 8);
      addBlock(pts, 6, 1, 6, 3);
      addBlock(pts, 8, 5, 8, 7);
      addBlock(pts, 9, 2, 9, 3);
      pts.push({ x: 5, y: 4 });
      break;

    // --- Tier 3 (16x16) ---
    case 'foup_canyon':
      addBlock(pts, 1, 4, 6, 4);
      addBlock(pts, 9, 4, 13, 4);
      addBlock(pts, 2, 11, 6, 11);
      addBlock(pts, 9, 11, 14, 11);
      addBlock(pts, 4, 7, 4, 8);
      addBlock(pts, 11, 7, 11, 8);
      break;

    case 'cruciform_hub':
      addBlock(pts, 3, 7, 5, 8);
      addBlock(pts, 10, 7, 12, 8);
      addBlock(pts, 7, 3, 8, 5);
      addBlock(pts, 7, 10, 8, 12);
      pts.push({ x: 2, y: 2 }, { x: 13, y: 2 }, { x: 2, y: 13 }, { x: 13, y: 13 });
      break;

    case 'spiral_cleanroom':
      addBlock(pts, 2, 2, 13, 2);
      addBlock(pts, 13, 3, 13, 13);
      addBlock(pts, 2, 13, 12, 13);
      addBlock(pts, 2, 5, 2, 12);
      addBlock(pts, 3, 5, 10, 5);
      addBlock(pts, 10, 6, 10, 10);
      addBlock(pts, 5, 10, 9, 10);
      break;

    case 'checker_matrix':
      for (let y = 2; y <= 13; y += 3) {
        for (let x = 2; x <= 13; x += 3) {
          pts.push({ x, y });
          if (x + 1 <= 13 && y + 1 <= 13 && ((x + y) % 2 === 0)) {
            pts.push({ x: x + 1, y: y + 1 });
          }
        }
      }
      break;

    // --- Tier 4 (20x20) ---
    case 'substation_fortress':
      addBlock(pts, 4, 4, 8, 4);
      addBlock(pts, 11, 4, 15, 4);
      addBlock(pts, 4, 15, 8, 15);
      addBlock(pts, 11, 15, 15, 15);
      addBlock(pts, 4, 5, 4, 8);
      addBlock(pts, 4, 11, 4, 14);
      addBlock(pts, 15, 5, 15, 8);
      addBlock(pts, 15, 11, 15, 14);
      pts.push(
        { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 },
        { x: 17, y: 2 }, { x: 16, y: 2 }, { x: 17, y: 3 },
        { x: 2, y: 17 }, { x: 3, y: 17 }, { x: 2, y: 16 },
        { x: 17, y: 17 }, { x: 16, y: 17 }, { x: 17, y: 16 },
        { x: 7, y: 7 }, { x: 12, y: 7 }, { x: 7, y: 12 }, { x: 12, y: 12 }
      );
      break;

    case 'double_helix_lanes':
      for (let x = 2; x <= 17; x++) {
        if (x % 4 !== 0) {
          const yA = Math.round(6 + 2.8 * Math.sin(x * 0.55));
          pts.push({ x, y: yA });
        }
        if (x % 4 !== 2) {
          const yB = Math.round(13 - 2.8 * Math.sin(x * 0.55));
          pts.push({ x, y: yB });
        }
      }
      break;

    case 'diamond_chamber': {
      const c = 9.5;
      for (let y = 2; y <= 17; y++) {
        for (let x = 2; x <= 17; x++) {
          const d = Math.abs(x - c) + Math.abs(y - c);
          const onGate = x === 9 || x === 10 || y === 9 || y === 10;
          if (d >= 6.5 && d <= 8.0 && !onGate) {
            pts.push({ x, y });
          }
        }
      }
      addBlock(pts, 9, 9, 10, 10);
      break;
    }

    case 'thermal_furnace_bay':
      for (const y of [3, 6, 10, 13, 16]) {
        const offset = (y % 2 === 0) ? 1 : 0;
        addBlock(pts, 2 + offset, y, 5 + offset, y);
        addBlock(pts, 8 + offset, y, 11 + offset, y);
        addBlock(pts, 14 - offset, y, 16 - offset, y);
      }
      break;

    // --- Tier 5 (24x24) ---
    case 'capacitor_gauntlet':
      for (let x = 3; x <= 19; x += 4) {
        addBlock(pts, x, 2, x + 1, 5);
        addBlock(pts, x, 18, x + 1, 21);
      }
      addBlock(pts, 6, 9, 6, 14);
      addBlock(pts, 11, 8, 12, 11);
      addBlock(pts, 11, 13, 12, 16);
      addBlock(pts, 17, 9, 17, 14);
      break;

    case 'triple_splitter_maze':
      // Three horizontal distributor decks with 3 staggered funnel doorways
      for (const [y, gaps] of [
        [5, [4, 12, 19]],
        [11, [7, 15, 21]],
        [17, [3, 11, 18]],
      ]) {
        for (let x = 2; x <= 21; x++) {
          if (!gaps.some((g) => Math.abs(x - g) <= 1)) {
            pts.push({ x, y });
          }
        }
      }
      addBlock(pts, 8, 7, 8, 9);
      addBlock(pts, 15, 7, 15, 9);
      addBlock(pts, 5, 13, 5, 15);
      addBlock(pts, 14, 13, 14, 15);
      break;

    case 'lunar_crater_ridge':
      addRing(pts, 11.5, 11.5, 6.4, 7.6, (x, y) => (
        x >= gridSize || y >= gridSize ||
        Math.abs(x - 11.5) <= 1 || Math.abs(y - 11.5) <= 1
      ));
      addRing(pts, 17.5, 5.5, 2.5, 3.4, (x, y) => (
        x >= gridSize || y >= gridSize || (x === 17 && y > 5) || (y === 5 && x < 17)
      ));
      addBlock(pts, 4, 18, 6, 19);
      break;

    case 'vacuum_archipelago':
      addBlock(pts, 3, 3, 4, 4); pts.push({ x: 5, y: 4 });
      addBlock(pts, 10, 2, 12, 3);
      addBlock(pts, 17, 4, 19, 5); pts.push({ x: 18, y: 6 });
      addBlock(pts, 5, 10, 7, 11); pts.push({ x: 6, y: 9 });
      addBlock(pts, 12, 10, 13, 12); pts.push({ x: 14, y: 11 });
      addBlock(pts, 18, 13, 20, 14);
      addBlock(pts, 3, 17, 5, 18); pts.push({ x: 4, y: 19 });
      addBlock(pts, 10, 17, 12, 18);
      addBlock(pts, 16, 19, 18, 20);
      break;

    // --- Tier 6 (28x28) ---
    case 'regolith_labyrinth':
      for (const wallY of [6, 13, 20]) {
        for (let x = 2; x <= 25; x++) {
          const isGate = (x === 4 || x === 5 || x === 13 || x === 14 || x === 22 || x === 23);
          if (!isGate) pts.push({ x, y: wallY });
        }
      }
      for (const wallX of [7, 14, 21]) {
        for (let y = 2; y <= 25; y++) {
          const isGate = (y === 3 || y === 4 || y === 9 || y === 10 || y === 16 || y === 17 || y === 23 || y === 24);
          if (!isGate) pts.push({ x: wallX, y });
        }
      }
      break;

    case 'synchrotron_halo':
      addRing(pts, 13.5, 13.5, 9.6, 10.9, (x, y) => (
        x >= gridSize || y >= gridSize ||
        Math.abs(x - 13.5) <= 1.2 || Math.abs(y - 13.5) <= 1.2
      ));
      addRing(pts, 13.5, 13.5, 4.8, 5.9, (x, y) => (
        x >= gridSize || y >= gridSize ||
        Math.abs(x - 13.5) <= 1.0 || Math.abs(y - 13.5) <= 1.0
      ));
      addBlock(pts, 13, 13, 14, 14);
      break;

    case 'orbital_spoke_wheel':
      addRing(pts, 13.5, 13.5, 10.5, 11.4, (x, y) => (
        x >= gridSize || y >= gridSize ||
        (Math.abs(x - 13.5) <= 1.0 || Math.abs(y - 13.5) <= 1.0)
      ));
      addRing(pts, 13.5, 13.5, 3.0, 4.0, (x, y) => (
        x >= gridSize || y >= gridSize ||
        (x === 13 && y < 13) || (x === 14 && y > 14)
      ));
      for (let r = 5; r <= 9; r++) {
        pts.push({ x: 13 + r, y: 13 + r });
        pts.push({ x: 14 - r, y: 14 - r });
        pts.push({ x: 13 + r, y: 14 - r });
        pts.push({ x: 14 - r, y: 13 + r });
      }
      break;

    case 'singularity_core':
      addBlock(pts, 13, 13, 14, 14);
      // 4 logarithmic spiral arms radiating outward from (13.5, 13.5)
      for (let arm = 0; arm < 4; arm++) {
        const baseTheta = (arm * Math.PI) / 2;
        for (let step = 0; step < 26; step++) {
          const t = step * 0.14;
          const r = 3.2 + step * 0.36;
          const theta = baseTheta + t;
          const px = Math.round(13.5 + r * Math.cos(theta));
          const py = Math.round(13.5 + r * Math.sin(theta));
          pts.push({ x: px, y: py });
        }
      }
      break;

    default:
      break;
  }

  return pts;
}

/**
 * Generates validated, BFS-connected pillar coordinates for a node.
 * Guarantees `(0,0)`, `(1,0)`, `(0,1)`, and `(gridSize - 1, gridSize - 1)` stay open
 * and every non-pillar floor tile remains reachable in a single connected component.
 * @param {string} archetype
 * @param {number} gridSize
 * @returns {Array<{ x: number, y: number }>}
 */
function buildValidatedPillars(archetype, gridSize) {
  const total = gridSize * gridSize;
  _blocked.fill(0, 0, total);
  const candidates = generateArchetypeCandidates(archetype, gridSize);
  const pillars = [];

  for (let i = 0; i < candidates.length; i++) {
    const { x, y } = candidates[i];
    if (x < 0 || x >= gridSize || y < 0 || y >= gridSize) continue;
    if (isProtectedTile(x, y, gridSize)) continue;

    const idx = y * gridSize + x;
    if (_blocked[idx] !== 0) continue;

    _blocked[idx] = 1;
    if (isGridConnected(gridSize, pillars.length + 1)) {
      pillars.push({ x, y });
    } else {
      _blocked[idx] = 0;
    }
  }

  return pillars;
}

/**
 * Builds a complete, deterministic cleanroom contract challenge for node `nodeId` (0..23).
 * @param {number} nodeId
 */
export function buildLevelChallenge(nodeId) {
  const safeId = Number.isInteger(nodeId)
    ? Math.max(0, Math.min(LEVEL_POOL.length - 1, nodeId))
    : 0;
  const spec = LEVEL_POOL[safeId];
  const pillars = buildValidatedPillars(spec.archetype, spec.gridSize);

  return {
    id: spec.id,
    code: spec.code,
    title: spec.title,
    subtitle: spec.subtitle,
    tier: spec.tier,
    gridSize: spec.gridSize,
    archetype: spec.archetype,
    pillars,
    modifiers: { ...spec.modifiers },
    waferGoal: spec.waferGoal,
    bonusDies: spec.bonusDies,
    bonusShards: spec.bonusShards,
  };
}

let _lastPickedNodeId = -1;

function pickRandomItem(items, rng) {
  const rRaw = typeof rng === 'function' ? Number(rng()) : Math.random();
  const r = Number.isFinite(rRaw)
    ? Math.max(0, Math.min(0.999999999, rRaw - Math.floor(rRaw)))
    : Math.random();
  return items[Math.floor(r * items.length)];
}

/**
 * Draws the next unseen Cleanroom Contract Node using a 24-bit shuffle-bag bitmask
 * filtered by `node.tier <= maxTier`. When all eligible nodes are seen, resets ONLY
 * those eligible bits while preserving other bits and avoiding back-to-back repeats.
 * @param {number} [bagMask=0]
 * @param {number} [maxTier=6]
 * @param {() => number} [rng=Math.random]
 * @returns {{ nodeId: number, nextBagMask: number }}
 */
export function pickNextUnseenLevel(bagMask = 0, maxTier = 6, rng = Math.random) {
  const safeTier = Number.isFinite(maxTier)
    ? Math.max(1, Math.min(6, Math.floor(maxTier)))
    : 6;
  let mask = (Number.isFinite(bagMask) ? (bagMask | 0) : 0) & MAX_NODE_MASK;

  const eligible = [];
  let eligibleMask = 0;
  for (let i = 0; i < LEVEL_POOL.length; i++) {
    const node = LEVEL_POOL[i];
    if (node.tier <= safeTier) {
      eligible.push(node);
      eligibleMask |= (1 << node.id);
    }
  }

  let unseen = eligible.filter((node) => (mask & (1 << node.id)) === 0);

  if (unseen.length === 0) {
    mask = mask & (~eligibleMask & MAX_NODE_MASK);
    unseen = eligible.length > 1 && _lastPickedNodeId >= 0
      ? eligible.filter((node) => node.id !== _lastPickedNodeId)
      : eligible.slice();
    if (unseen.length === 0) {
      unseen = eligible.slice();
    }
  }

  const chosen = pickRandomItem(unseen, rng);
  _lastPickedNodeId = chosen.id;
  const nextBagMask = (mask | (1 << chosen.id)) & MAX_NODE_MASK;

  return {
    nodeId: chosen.id,
    nextBagMask,
  };
}

export const QUIP_POOL = Object.freeze([
  'Remember: a thermal scram is just your EUV scanner expressing strong founder conviction.',
  'Series B pitch rule #1: call every wafer defect an artisanal sub-nanometer airgap.',
  'Cryo loops are running at 77 Kelvin, which is still warmer than your CFO during capex review.',
  'If the overhead FOUP shuttle starts holding standups, revoke its Slack token immediately.',
  'OSHA called about the lunar foundry; we reminded them jurisdiction ends at the Karman line.',
  'Never ask a Bay Director why the stepper output looks like a luxury office paperclip.',
  'Pro tip: three belts in a closed circle generate zero wafers and 100% executive alignment.',
  'We eliminated 40% of cleanroom dust by redefining airborne particulates as micro-doped silicon.',
  'Our cleanroom floor is ISO-1 certified except during Friday espresso-fueled tapeout sprints.',
  'When metrology QA bottlenecks, simply raise the acceptable defect chart axis to logarithmic.',
  'A capacitor bank discharging at 30kW counts as renewable energy if your burn rate is fast enough.',
  'Your Seed-Stage angels love the cleanroom tour until someone drops a HEPA curtain into the plasma etcher.',
  'Why pay for redundant substations when Priority-3 compute racks brown out so aesthetically?',
  'Each Prestige Rewrite sheds legacy technical debt while keeping every hard-earned silicon shard.',
  'If an ingot slicer runs at 300% speed, do not blink or it will slice your slide deck too.',
  'Our orbital mega-fab radiates waste heat straight into deep space for zero-footprint tax credits.',
  'Always keep tile (0,0) clear unless you enjoy explaining dark-fab outages to the municipal grid.',
  'Remember: Context Entropy only spikes when your AI directors feel micromanaged by physics.',
  'A closed LN2 cryo loop boosts flow by 25%, mostly out of sheer thermodynamic peer pressure.',
  'Reclaim grinders convert cracked prototype wafers into morally ambiguous virgin silicon stock.',
  'Investors asked for vertical integration, so we put six cleanroom tiers on top of one garage.',
  'If you spot a rogue golden reticle drifting near the wafer core, shoot first and file tickets later.',
  'Throughput dips below 90%? Blame cosmic rays, solar flares, or legacy Fortran lithography drivers.',
  'Congratulations on reaching Tier 6—your fab now consumes more watts than a mid-sized peninsula.',
]);

/**
 * Draws the next satirical quip from `QUIP_POOL` without back-to-back repeats,
 * cycling cleanly through all 24 quips per bag epoch.
 * @param {{ mask?: number, lastIdx?: number } | null} [bagState=null]
 * @param {() => number} [rng=Math.random]
 * @returns {{ text: string, nextState: { mask: number, lastIdx: number } }}
 */
export function drawNextQuip(bagState = null, rng = Math.random) {
  const total = QUIP_POOL.length;
  const fullMask = (1 << total) - 1;

  let mask = bagState && Number.isInteger(bagState.mask) ? (bagState.mask & fullMask) : 0;
  const lastIdx = bagState && Number.isInteger(bagState.lastIdx) ? bagState.lastIdx : -1;

  const unseen = [];
  for (let i = 0; i < total; i++) {
    if ((mask & (1 << i)) === 0) {
      unseen.push(i);
    }
  }

  let candidates;
  if (unseen.length === 0) {
    mask = 0;
    candidates = [];
    for (let i = 0; i < total; i++) {
      if (i !== lastIdx) candidates.push(i);
    }
    if (candidates.length === 0) candidates.push(0);
  } else if (unseen.length > 1 && lastIdx >= 0) {
    candidates = unseen.filter((idx) => idx !== lastIdx);
  } else {
    candidates = unseen;
  }

  const chosenIdx = pickRandomItem(candidates, rng);

  return {
    text: QUIP_POOL[chosenIdx],
    nextState: {
      mask: (mask | (1 << chosenIdx)) & fullMask,
      lastIdx: chosenIdx,
    },
  };
}
