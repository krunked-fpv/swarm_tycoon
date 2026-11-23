# Swarm Tycoon: Silicon Foundry — Module & Data Contracts (SPEC.md)

## 1. Global Constants
- **Project ID**: `swarm_tycoon // IDEA-00438`
- **PWA Cache Version**: `CACHE_VERSION = 'swarm-tycoon-cache-v1'`
- **Primary Save Key**: `PRIMARY_SAVE_KEY = 'swarm_tycoon_save_v1'`
- **Daily Save Key**: `DAILY_SAVE_KEY = 'swarm_tycoon_daily_v1'`
- **Shadow Cookie Name**: `COOKIE_VAULT_NAME = 'krunked-cookie-vault-v1'`
- **IndexedDB Mirror**: `IDB_NAME = 'swarm_tycoon_idb_v1'`, `IDB_STORE = 'vault'`, `IDB_KEY = 'campaign'`
- **Offline Bounds**: `MIN_OFFLINE_MS = 0`, `MAX_OFFLINE_MS = 604800000` (7 days), `MAX_MACRO_SLICES = 28`
- **Grid Constants**: `MAX_GRID_DIM = 28`, `MAX_CELLS = 784`, `TICK_MS = 100`
- **Palette**: Slate `#080C12` / `#121B28`, Wafer Cyan `#00F0FF`, Cryo Frost `#38BDF8`, Neon Gold `#FFB800`, Alert Crimson `#FF3B5C`.

---

## 2. Canonical `BigSilicon` Wire Format (`src/economy/bigSilicon.js`)
Plain JSON-serializable struct used across Economy, Persistence, and UI:
```js
// Zero: { m: 0, e: 0 }
// Non-zero normalized: 1 <= Math.abs(m) < 10, Number.isSafeInteger(e)
/** @typedef {{ m: number, e: number }} BigSilicon */
```
Required exports from `src/economy/bigSilicon.js`:
- `bsZero()`, `bsFrom(input)` (accepts number, string `"1.4e500"`, or `{ m, e }`), `bsNormalize(m, e)`, `bsIsValid(v)`, `bsSanitize(v, fallback)`
- `bsAdd(a, b)`, `bsSub(a, b)` (clamped `>= 0` via `bsSubClamped` or signed `bsSub`), `bsMul(a, b)`, `bsDiv(a, b)`
- `bsCmp(a, b)` (`-1 | 0 | 1`), `bsMax(a, b)`, `bsMin(a, b)`, `bsLog10(a)`, `bsPow10(expFloat)`
- `bsFormat(v, unit = '')` — SI/Engineering notation: `K (1e3)`, `M (1e6)`, `G (1e9)`, `T (1e12)`, `Peta (1e15)`, `Exa (1e18)`, `Zetta (1e21)`, `Yotta (1e24)`, `Ronna (1e27)`, `Quetta (1e30)`, and `1.23e450` above `1e33`. Example: `bsFormat({ m: 1.42, e: 16 }, 'Dies') -> "14.2 Peta-Dies"`.

---

## 3. Simulation Engine Contracts (`src/sim/*`)

### 3.1 Enumerations (`src/sim/gridEngine.js`)
```js
export const MAX_GRID_DIM = 28;
export const MAX_CELLS = 784;
export const TICK_MS = 100;

export const DIRS = { N: 0, E: 1, S: 2, W: 3 }; // DX=[0,1,0,-1], DY=[-1,0,1,0]

export const MACHINE_TYPES = {
  EMPTY: 0,
  PILLAR: 1,
  BELT_STRAIGHT: 2,
  BELT_CORNER: 3,    // sub 0 = CW ((dir+1)%4), sub 1 = CCW ((dir+3)%4)
  BELT_SPLITTER: 4,  // distributes straight/right/left
  BELT_MERGER: 5,    // pulls from inputs, outputs dir
  INGOT_SLICER: 6,   // produces WAFER_STATES.RAW (1)
  PHOTORESIST_COATER: 7, // RAW -> COATED (2)
  EUV_SCANNER: 8,    // COATED -> EXPOSED (3)
  PLASMA_ETCHER: 9,  // EXPOSED -> ETCHED (4)
  METROLOGY_QA: 10,  // ETCHED -> GOOD (5) forward dir; defective diverts (dir+1)%4
  WAFER_VAULT: 11,   // consumes wafers; GOOD->vaultedGood, else->vaultedProto
  RECLAIM_GRINDER: 12, // consumes defective/salvage wafers -> reclaimedCount
  CRYO_CHILLER: 13,  // 77K LN2 source onto connected ln2Mask loop
  POWER_SOURCE: 14,  // local MW/kW supply into connected powerMask busbar
  CAPACITOR_BANK: 15,// energy storage buffer (kJ)
  FOUP_DOCK: 16,     // sub 0 = pickup, sub 1 = dropoff for overhead shuttles
  COMPUTE_RACK: 17,  // Priority-3 AI compute node (+kW draw, +FLOPs boost)
};

export const WAFER_STATES = { NONE: 0, RAW: 1, COATED: 2, EXPOSED: 3, ETCHED: 4, GOOD: 5 };
```

### 3.2 `MACHINE_CATALOG` Power & Thermal Tuning
Starter Tier 01 supplies `15.0 kW` at facility substation anchor `(0, 0)` (and automatically covers connected `powerMask` cells, or baseline unpiped `15 kW` facility feed on Tier 01 if substation connected):
- `BELT_*`: `0.1 kW` (`priority: 1`, `heatGenKw: 0.05`)
- `INGOT_SLICER`: `1.5 kW` (`priority: 2`, `heatGenKw: 2.5`, `cycleTicks: 4`)
- `PHOTORESIST_COATER`: `1.5 kW` (`priority: 2`, `heatGenKw: 2.0`, `cycleTicks: 4`)
- `EUV_SCANNER`: `3.5 kW` (`priority: 2`, `heatGenKw: 6.5`, `cycleTicks: 5`)
- `PLASMA_ETCHER`: `2.2 kW` (`priority: 2`, `heatGenKw: 4.0`, `cycleTicks: 4`)
- `METROLOGY_QA`: `1.0 kW` (`priority: 1`, `heatGenKw: 1.0`, `cycleTicks: 2`)
- `WAFER_VAULT`: `0.4 kW` (`priority: 1`, `heatGenKw: 0.2`, `cycleTicks: 1`)
- `RECLAIM_GRINDER`: `0.5 kW` (`priority: 1`, `heatGenKw: 0.8`, `cycleTicks: 2`)
- `CRYO_CHILLER`: `1.5 kW` (`priority: 1`, `heatGenKw: 0.0`, `coolKw: 35.0`)
- `POWER_SOURCE`: `0 kW` draw (`supplyKw: 25.0` base scaled by tier, `priority: 1`, `heatGenKw: 3.0`)
- `CAPACITOR_BANK`: `0 kW` draw (`capacityKj: 600`, `maxDischargeKw: 30`, `priority: 1`, `heatGenKw: 0.4`)
- `FOUP_DOCK`: `0.6 kW` (`priority: 1`, `heatGenKw: 0.4`)
- `COMPUTE_RACK`: `6.0 kW` (`priority: 3`, `heatGenKw: 8.5`)
*(Notice: Starter loop 12.9 kW < 15.0 kW Tier 01 limit. Adding a Priority-3 `COMPUTE_RACK` pushes demand to 18.9 kW and triggers Priority-3 brownout unless supplemented by `POWER_SOURCE` or charged `CAPACITOR_BANK`.)*

### 3.3 Flat TypedArray Layout (`gridEngine.state`)
- `width` (`8..28`), `capacity = 784`
- `machineType: Uint8Array(784)`
- `machineDir: Uint8Array(784)`
- `machineSub: Uint8Array(784)`
- `priorityTier: Uint8Array(784)` (`1..3`)
- `ln2Mask: Uint8Array(784)` (`bits 0..3 = N/E/S/W connections, bit 4 (0x10) = pipe installed`)
- `powerMask: Uint8Array(784)` (`bits 0..3 = N/E/S/W connections, bit 4 (0x10) = busbar installed`)
- `shuttleWaypoint: Uint8Array(784)` (`0=none, 1=pickup, 2=dropoff`)
- `slotWafer: Uint8Array(784)` (`0..5`)
- `slotDefective: Uint8Array(784)` (`0 | 1`)
- `slotProgress: Float32Array(784)` (`0..1`)
- `backpressureTicks: Uint16Array(784)`
- `tempKelvin: Float32Array(784)` (initialized to `295.0`)
- `scramActive: Uint8Array(784)` (`0 | 1`; latch ON at `T > scramCeilingK` default `390`, OFF when `T < 320`)
- `powerRatio: Float32Array(784)` (`0..1`)
- `sectorAgents: Int8Array(4)` (`-1` unassigned, or agent index `0..5`)
- `shuttles: Array<{ id, x, y, targetX, targetY, carryingWafer, carryingDefective, progress, state }>`

### 3.4 `GridEngine` & Companion Module APIs
- `beltRouter.js`: `stepBeltsAndMachines(state, mods)` — `O(N)` 3-color traversal + closed-cycle synchronous rotation without deadlocks or item deletion; returns `{ vaultedGood, vaultedProto, reclaimedCount, euvFlashes, completedWafers }`.
- `shuttleFleet.js`: `stepShuttles(state, mods)` — dispatches overhead FOUP shuttles between `FOUP_DOCK` (`sub=0` / `shuttleWaypoint=1`) and `FOUP_DOCK` (`sub=1` / `shuttleWaypoint=2`).
- `cryoLoopSolver.js`: `stepCryoLoops(state, mods)` — identifies connected `ln2Mask` pipe components, detects closed cycles (`+25%` flow bonus), computes exponential relaxation toward steady-state Kelvin (`[77K, 1200K]`), applies thermal multipliers (`<285K -> 1.15`, `285..335K -> 1.0`, `335..scramCeilingK -> 1.0..0.2`, `scramActive -> 0.0`), and updates hysteresis scrams (`>390K` ON, `<320K` OFF).
- `powerGridSolver.js`: `stepPowerGrid(state, mods)` — aggregates facility + `POWER_SOURCE` supply + `CAPACITOR_BANK` charge/discharge (`capacitorStoredKj`), sheds Priority 3 -> Priority 2 -> Priority 1 on deficit, and returns `{ powerSupplyKw, powerDemandKw, capacitorStoredKj, capacitorMaxKj, brownoutLevel }`.
- `dailySeedGenerator.js`:
  - `splitMix32(seedInt)`, `hashSeedString(str)`
  - `generateDailyChallenge(utcDateStr = todayUtc())` using `"IDEA00438-" + utcDateStr` -> `{ seedId, dateStr, gridSize: 12, pillars: Array<{x,y}>, modifiers: { powerMult, ambientK, defectBias, targetScore }, durationSec: 900 }` (guaranteed flood-fill open path across `(0,0)`..`(11,11)`).
  - `computeDailyEfficiencyScore({ vaultedGood, avgKelvin, brownoutTicks, elapsedSec, totalBackpressure }) -> number`.

---

## 4. Economy & Chaos Contracts (`src/economy/*`)
- `scaleTiers.js`: `SCALE_TIERS` (6 tiers: `1..6`, grid sizes `[8, 12, 16, 20, 24, 28]`, base facility kW `[15, 120, 2400, 25000, 180000, 1500000]`).
- `prestigeProtocol.js`: `PRESTIGE_NODES` (9 nodes across Branches `'A' | 'B' | 'C'`, 3 per branch), `computePendingShards(lifetimeFlops, currentShards)` using `bsLog10`, `getPrestigeEffects(levels)`.
- `agentWorkers.js`: `AGENT_CATALOG` (6 named satirical AI directors, zero vendor model names), `computeSectorMultipliers(sectorAgents, entropies, prestigeEffects)`.
- `chaosIncidents.js`: `CRISIS_TYPES = { HALLUCINATION, PAPERCLIP_PANIC, MEME_PR_MELTDOWN }`, `rollCrisis(qaBackpressureMax, entropies, rng)`, `resolveCrisis(crisis, choiceId, state)`.
- `yieldCurves.js`: `EconomyEngine` exposing `tickFromSim(simTelemetry, dtSec)`, `getSimulationModifiers()`, `getDisplayTelemetry()`, `upgradeTier()`, `upgradeFleet()`, `buyPrestigeNode(idx)`, `rewriteArchitecture()` (Prestige reset preserving shards/prestigeLevels), `assignAgent(sectorIdx, agentIdx)`, `mitigateCrisis(choiceId)`, `exportState()`, `importState(data)`.

---

## 5. Persistence & Blueprint Contracts (`src/persistence/*`)

### 5.1 Primary Save (`localStorage["swarm_tycoon_save_v1"]`)
```js
{
  v: 1,
  tClose: 1795414700000,
  tier: 1,
  dies: { m: 1.5, e: 2 },
  flops: { m: 3.2, e: 4 },
  lifetimeFlops: { m: 8.4, e: 4 },
  shards: 0,
  hwmDiesPerMin: 12.5,
  fleetLevel: 1,
  prestige: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  agents: [-1, -1, -1, -1],
  entropies: [0, 0, 0, 0],
  paperclips: 0,
  audio: { vol: 0.6, mute: false },
  layout: { gridSize: 8, tier: 1, agents: [-1, -1, -1, -1], cells: [...] },
  bp: "BP1_...",
  sig: "a1b2c3d4" // 8-char FNV-1a over canonical JSON without sig
}
```

### 5.2 Shadow Cookie (`krunked-cookie-vault-v1`, `< 3800` bytes)
Base64URL-encoded UTF-8 JSON containing:
```js
{
  v: 1, tClose, tier, dies, flops, lifetimeFlops,
  shards, hwm, fleetLvl, prestige, agents, vol, mute, bp, sig
}
```
Signed by `fnv1aHex` over canonical string. Validated strictly on read; rejected if `sig` mismatches or fields fail schema bounds.

### 5.3 `#blueprint=` Binary RLE Wire Layout (`src/persistence/blueprintCodec.js`)
Prefix string: `BP1_<base64url>` (hash helper accepts `#blueprint=BP1_...` or `BP1_...`).
Binary byte layout:
- Bytes `0..3`: ASCII `"BP01"`
- Byte `4`: version (`1`)
- Byte `5`: `gridSize` (`8..28`)
- Byte `6`: `tier` (`1..6`)
- Bytes `7..10`: 4x `Int8` (`agents[0..3]`)
- Bytes `11..12`: `Uint16 BE` `runCount` (`1 <= runCount <= gridSize * gridSize`)
- Repeated `runCount` times (6 bytes each):
  - `Uint16 BE` `count` (`1 <= count <= 784`, cumulative sum MUST equal `gridSize * gridSize`)
  - `Uint32 BE` `packedCell`: `(type & 0x1F) | ((dir & 0x3) << 5) | ((sub & 0x3) << 7) | ((ln2Mask & 0x1F) << 9) | ((powerMask & 0x1F) << 14) | ((shuttleWaypoint & 0x3) << 19)`
- Final 4 bytes: `Uint32 BE` FNV-1a checksum over bytes `[0 .. end-4)`.

### 5.4 Offline Catch-Up (`src/persistence/offlineCatchupSolver.js`)
`solveOfflineCatchup({ tClose, tOpen, hwmDiesPerMin, fleetLevel, tier, prestigeLevels, agents, maxTheoreticalDiesPerSec })`:
- Returns `{ validDeltaMs, clockRollback, capped, slicesSimulated, diesEarned, flopsEarned, shardsHint, elapsedMs }`
- Clamps `deltaMs = tOpen - tClose` to `[0, 604800000]`.
- Rejects negative deltas (`clockRollback: true`, zero yield).
- Caps `hwmDiesPerMin` against theoretical tier ceiling (`maxTheoreticalDiesPerSec * 60`) to neutralize client save tampering.
- Integrates across `<= 28` analytical steady-state macro-slices in `< 5ms`.

---

## 6. Renderer & WebAudio Contracts
- **`IsoCleanroomScene` (`src/render/isoScene.js`)**:
  - `constructor(hooks)` (`hooks: { getGridEngine, getEconomyState, onTileAction, onHoverTile }`)
  - `setHeatmapMode(mode)` (`0=Off, 1=Thermal, 2=Backpressure, 3=Power`)
  - `setToolState(tool)` (`{ toolId, dir, sub }`)
  - `syncGridSize()`, `triggerPrestigeVfx()`, `centerCamera()`, `getMeasuredFps()`
- **`AudioEngine` (`src/audio/audioEngine.js`)**:
  - `unlock()`, `setMasterVolume(v)`, `setMuted(muted)`, `getState()`
  - `updateTelemetry({ totalMw, brownoutLevel, activeCrisis, scramCount })`
  - `playClick()`, `playPlace()`, `playWaferComplete()`, `playEuvFlash()`, `playShuttleLaunch()`, `playPrestigeSwell()`, `playKlaxon(kind)`
