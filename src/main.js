/**
 * Swarm Tycoon: Silicon Foundry — Tactical Command Deck Orchestrator.
 * Binds 10Hz GridEngine simulation, 60fps Phaser 3 rendering, BigSilicon EconomyEngine,
 * self-healing CookieVault persistence, procedural WebAudio, isolated Daily Challenges,
 * #blueprint= URL codec, PWA install prompt, and ./sw.js registration.
 */

import {
  DIRS,
  GridEngine,
  MACHINE_CATALOG,
  MACHINE_TYPES,
  TICK_MS,
} from './sim/gridEngine.js';
import {
  computeDailyEfficiencyScore,
  generateDailyChallenge,
  todayUtcStr,
} from './sim/dailySeedGenerator.js';
import { createCleanroomGame } from './render/isoScene.js';
import { EconomyEngine } from './economy/yieldCurves.js';
import { bsAdd, bsCmp, bsFrom, bsSubClamped, bsZero } from './economy/bigSilicon.js';
import { getTierSpec } from './economy/scaleTiers.js';
import { AGENT_CATALOG } from './economy/agentWorkers.js';
import { rollCrisis } from './economy/chaosIncidents.js';
import { CookieVault } from './persistence/cookieVault.js';
import { solveOfflineCatchup } from './persistence/offlineCatchupSolver.js';
import { decodeBlueprint, encodeBlueprintHash } from './persistence/blueprintCodec.js';
import { parsePortableSave, serializePortableSave } from './persistence/portableSaveIo.js';

import { createHudController } from './ui/hudController.js';
import { createBuildPalette } from './ui/buildPalette.js';
import { createPrestigeModal } from './ui/prestigeModal.js';
import { createCrisisTicker } from './ui/crisisTicker.js';
import { createBlueprintModal } from './ui/blueprintModal.js';
import { createOfflineReportModal } from './ui/offlineReportModal.js';

const AUTOSAVE_INTERVAL_MS = 5000;
const WAFER_NAMES = ['NONE', 'RAW', 'COATED', 'EXPOSED', 'ETCHED', 'GOOD'];
const DIR_CHARS = ['N', 'E', 'S', 'W'];

const SATIRICAL_TICKER_QUIPS = [
  'Series C pitch deck automatically inflated wafer projections by 400%.',
  'Facilities memo: LN2 mist in Hallway B counts as "immersive cloud compute".',
  'EUV mirror alignment certified to within three investor metaphors.',
  'Sub-nanometer tolerances maintained via aggressive rounding in quarterly slides.',
  'Overhead FOUP shuttle requested a seat on the compensation committee.',
];

function createFallbackAudioEngine() {
  let volume = 0.6;
  let muted = false;
  return {
    unlock() {},
    setMasterVolume(v) {
      volume = Math.max(0, Math.min(1, Number(v) || 0));
    },
    setMuted(m) {
      muted = Boolean(m);
    },
    getState() {
      return { volume, muted, unlocked: false };
    },
    updateTelemetry() {},
    playClick() {},
    playPlace() {},
    playWaferComplete() {},
    playEuvFlash() {},
    playShuttleLaunch() {},
    playPrestigeSwell() {},
    playKlaxon() {},
  };
}

async function loadAudioEngine() {
  try {
    const mod = await import('./audio/audioEngine.js');
    if (mod && typeof mod.AudioEngine === 'function') {
      return new mod.AudioEngine();
    }
  } catch {
    // Graceful fallback if audio module is unavailable in isolated syntax/UI preview
  }
  return createFallbackAudioEngine();
}

function isStandaloneMode() {
  try {
    return Boolean(
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      window.navigator?.standalone
    );
  } catch {
    return false;
  }
}

function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }
  navigator.serviceWorker?.register('./sw.js', { scope: './' }).catch(() => {});
}

function setupDailyCleanroom(gridEngine, challenge) {
  gridEngine.importLayoutSnapshot({
    gridSize: challenge.gridSize,
    tier: 2,
    agents: [-1, -1, -1, -1],
    cells: new Array(challenge.gridSize * challenge.gridSize).fill(null).map(() => ({
      machineType: 0,
      machineDir: 0,
      machineSub: 0,
      ln2Mask: 0,
      powerMask: 0,
      shuttleWaypoint: 0,
    })),
  });
  gridEngine.applyDailyPillars(challenge.pillars);

  // Guaranteed open anchors from dailySeedGenerator: (0,0), (1,0), (0,1), (11,11)
  gridEngine.placeMachine(1, 0, MACHINE_TYPES.POWER_SOURCE, DIRS.E, 0);
  gridEngine.placeMachine(0, 1, MACHINE_TYPES.CRYO_CHILLER, DIRS.S, 0);
  gridEngine.toggleBusbar(0, 0, true);
  gridEngine.toggleBusbar(1, 0, true);
  gridEngine.toggleBusbar(0, 1, true);
  gridEngine.togglePipe(0, 1, true);

  // Find a 6-tile open horizontal line to seed an active starter loop around today's pillars
  const w = challenge.gridSize;
  const st = gridEngine.state;
  const isPillar = (x, y) => st.machineType[y * w + x] === MACHINE_TYPES.PILLAR;

  let placedStarter = false;
  for (let y = 2; y <= w - 2 && !placedStarter; y++) {
    for (let x = 0; x <= w - 6 && !placedStarter; x++) {
      let clear = true;
      for (let dx = 0; dx < 6; dx++) {
        if (isPillar(x + dx, y)) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;

      gridEngine.placeMachine(x, y, MACHINE_TYPES.INGOT_SLICER, DIRS.E);
      gridEngine.placeMachine(x + 1, y, MACHINE_TYPES.PHOTORESIST_COATER, DIRS.E);
      gridEngine.placeMachine(x + 2, y, MACHINE_TYPES.EUV_SCANNER, DIRS.E);
      gridEngine.placeMachine(x + 3, y, MACHINE_TYPES.PLASMA_ETCHER, DIRS.E);
      gridEngine.placeMachine(x + 4, y, MACHINE_TYPES.METROLOGY_QA, DIRS.E);
      gridEngine.placeMachine(x + 5, y, MACHINE_TYPES.WAFER_VAULT, DIRS.E);
      if (!isPillar(x + 4, y + 1)) {
        gridEngine.placeMachine(x + 4, y + 1, MACHINE_TYPES.RECLAIM_GRINDER, DIRS.N);
        gridEngine.togglePipe(x + 4, y + 1, true);
        gridEngine.toggleBusbar(x + 4, y + 1, true);
      }

      // Connect cryo & power along row y and BFS back to (0,1) around any pillars
      for (let px = x; px <= x + 5; px++) {
        gridEngine.togglePipe(px, y, true);
        gridEngine.toggleBusbar(px, y, true);
      }

      const startIdx = 1 * w + 0; // (0, 1)
      const targetIdx = y * w + x;
      const visited = new Uint8Array(w * w);
      const parent = new Int16Array(w * w).fill(-1);
      const queue = [startIdx];
      visited[startIdx] = 1;
      let head = 0;
      let found = false;
      const dxs = [0, 1, 0, -1];
      const dys = [-1, 0, 1, 0];

      while (head < queue.length) {
        const cur = queue[head++];
        if (cur === targetIdx) {
          found = true;
          break;
        }
        const cx = cur % w;
        const cy = (cur / w) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = cx + dxs[d];
          const ny = cy + dys[d];
          if (nx < 0 || nx >= w || ny < 0 || ny >= w) continue;
          const nIdx = ny * w + nx;
          if (!visited[nIdx] && !isPillar(nx, ny)) {
            visited[nIdx] = 1;
            parent[nIdx] = cur;
            queue.push(nIdx);
          }
        }
      }

      if (found) {
        let trace = targetIdx;
        while (trace !== -1) {
          const tx = trace % w;
          const ty = (trace / w) | 0;
          gridEngine.togglePipe(tx, ty, true);
          gridEngine.toggleBusbar(tx, ty, true);
          trace = parent[trace];
        }
      }
      placedStarter = true;
    }
  }
}

async function bootCommandDeck() {
  registerServiceWorker();

  const hudEl = document.getElementById('hud-bar');
  const dailyBannerEl = document.getElementById('daily-banner');
  const buildDockEl = document.getElementById('build-dock');
  const crisisDockEl = document.getElementById('crisis-dock');
  const workspaceEl = document.getElementById('workspace');
  const viewportEl = document.getElementById('cleanroom-viewport');
  const inspectorEl = document.getElementById('tile-inspector');
  const toastRackEl = document.getElementById('toast-rack');
  const centerCamBtn = document.getElementById('btn-center-cam');
  const mobileCrisisBtn = document.getElementById('btn-mobile-crisis');
  const mobileTabBtns = Array.from(document.querySelectorAll('#mobile-dock-tabs [data-mobile-pane]'));

  const prestigeModalEl = document.getElementById('prestige-modal');
  const blueprintModalEl = document.getElementById('blueprint-modal');
  const offlineModalEl = document.getElementById('offline-modal');

  const vault = new CookieVault();
  const gridEngine = new GridEngine(8, 'CAMPAIGN');
  const economyEngine = new EconomyEngine();
  const audioEngine = await loadAudioEngine();

  let renderer = null;
  let lastTelemetry = null;
  let heatmapMode = 0;
  let fpsEma = 60;
  let wafersPerSecEma = 0;
  let lastWaferSfxMs = 0;
  let lastEuvSfxMs = 0;
  let lastShuttleSfxMs = 0;
  let prevShuttleCount = 0;
  let lastQuipSec = 0;

  const toolState = {
    toolId: MACHINE_TYPES.BELT_STRAIGHT,
    dir: DIRS.E,
    sub: 0,
    kind: 'machine',
  };

  const hoverCoords = { gx: -1, gy: -1 };
  const pinnedCoords = { gx: -1, gy: -1 };

  const vaultStatus = {
    source: 'fresh',
    selfHealed: false,
    healedFrom: null,
    cookieRegenerated: false,
    cookieBytes: 0,
    primaryBytes: 0,
    lastSavedAt: 0,
  };

  const installState = {
    available: false,
    dismissed: false,
    installed: isStandaloneMode(),
  };
  let deferredInstallPrompt = null;

  const dailyState = {
    active: false,
    challenge: null,
    seedId: '',
    dateStr: '',
    elapsedSec: 0,
    remainingSec: 900,
    startVaultedGood: 0,
    brownoutTicks: 0,
    kelvinAccum: 0,
    kelvinSamples: 0,
    score: 0,
    bestScore: 0,
    finished: false,
    campaignBackup: null,
  };

  function showToast(message, level = 'info') {
    if (!toastRackEl) return;
    const toast = document.createElement('div');
    toast.className = `toast-item ${level === 'warn' ? 'is-warn' : level === 'error' ? 'is-error' : ''}`.trim();
    toast.textContent = String(message);
    toastRackEl.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3200);
  }

  function syncAgentsToGrid() {
    for (let s = 0; s < 4; s++) {
      gridEngine.state.sectorAgents[s] = economyEngine.agents[s];
    }
  }

  function buildCampaignSavePayload() {
    const econ = economyEngine.exportState();
    const layout = gridEngine.exportLayoutSnapshot();
    const audioSt = audioEngine.getState();
    return {
      v: 1,
      tClose: Date.now(),
      tier: econ.tier,
      dies: econ.dies,
      flops: econ.flops,
      lifetimeFlops: econ.lifetimeFlops,
      shards: econ.shards,
      hwmDiesPerMin: econ.hwmDiesPerMin,
      fleetLevel: econ.fleetLevel,
      prestige: econ.prestige,
      agents: econ.agents,
      entropies: econ.entropies,
      paperclips: econ.paperclips,
      audio: {
        vol: Number.isFinite(audioSt.volume) ? audioSt.volume : 0.6,
        mute: Boolean(audioSt.muted),
      },
      layout,
    };
  }

  function saveDailyProgress() {
    if (!dailyState.active || !dailyState.challenge) return false;
    return vault.saveDailyState({
      seedId: dailyState.seedId,
      dateStr: dailyState.dateStr,
      bestScore: dailyState.bestScore,
      lastScore: dailyState.score,
      elapsedSec: dailyState.elapsedSec,
      finished: dailyState.finished,
      updatedAt: Date.now(),
    });
  }

  function forceSave() {
    if (dailyState.active) {
      const ok = saveDailyProgress();
      return { ok, mode: 'daily', cookieBytes: vaultStatus.cookieBytes, primaryBytes: vaultStatus.primaryBytes };
    }
    const res = vault.saveCampaign(buildCampaignSavePayload(), Date.now());
    vaultStatus.cookieBytes = res.cookieBytes;
    vaultStatus.primaryBytes = res.primaryBytes;
    vaultStatus.lastSavedAt = Date.now();
    return { ...res, mode: 'campaign' };
  }

  function buildUiSnapshot() {
    const econ = economyEngine.getDisplayTelemetry();
    const sim = lastTelemetry || {
      tickCount: gridEngine.state.tickCount,
      vaultedGood: gridEngine.state.vaultedGood,
      vaultedProto: gridEngine.state.vaultedProto,
      reclaimedCount: gridEngine.state.reclaimedCount,
      powerSupplyKw: econ.tierSpec?.basePowerKw || 15,
      powerDemandKw: 0,
      capacitorStoredKj: gridEngine.state.capacitorStoredKj,
      capacitorMaxKj: 0,
      brownoutLevel: 0,
      avgKelvin: 295.0,
      scramCount: 0,
      qaBackpressureMax: 0,
      totalBackpressure: 0,
    };

    return {
      economy: econ,
      sim,
      wafersPerSec: wafersPerSecEma,
      gridWidth: gridEngine.state.width,
      heatmapMode,
      toolState: { ...toolState },
      vaultStatus: { ...vaultStatus },
      audioState: audioEngine.getState(),
      installPrompt: { ...installState },
      daily: {
        active: dailyState.active,
        seedId: dailyState.seedId,
        dateStr: dailyState.dateStr,
        remainingSec: dailyState.remainingSec,
        elapsedSec: dailyState.elapsedSec,
        score: dailyState.score,
        bestScore: dailyState.bestScore,
        modifiers: dailyState.challenge?.modifiers || null,
        finished: dailyState.finished,
      },
    };
  }

  function updateInspector() {
    if (!inspectorEl) return;
    const gx = hoverCoords.gx >= 0 ? hoverCoords.gx : pinnedCoords.gx;
    const gy = hoverCoords.gy >= 0 ? hoverCoords.gy : pinnedCoords.gy;
    if (gx < 0 || gy < 0 || !gridEngine.inBounds(gx, gy)) {
      inspectorEl.hidden = true;
      return;
    }

    const cell = gridEngine.getCell(gx, gy);
    if (!cell) {
      inspectorEl.hidden = true;
      return;
    }

    const cat = MACHINE_CATALOG[cell.machineType];
    const half = gridEngine.state.width >>> 1;
    const sectorNum = (gx >= half ? 1 : 0) + (gy >= half ? 2 : 0) + 1;
    const waferName = WAFER_NAMES[cell.slotWafer] || 'NONE';
    const waferTag = cell.slotDefective ? `${waferName} (DEF)` : waferName;
    const ln2On = (cell.ln2Mask & 0x10) !== 0;
    const pwrOn = (cell.powerMask & 0x10) !== 0;

    inspectorEl.hidden = false;
    inspectorEl.replaceChildren();

    const head = document.createElement('div');
    head.className = 'inspector-head';
    const titleSpan = document.createElement('span');
    titleSpan.textContent = `${cat ? cat.name : 'Floor'} (${gx},${gy})`;
    const dirSpan = document.createElement('span');
    dirSpan.className = 'num';
    dirSpan.textContent = cell.machineType >= 2 ? `DIR ${DIR_CHARS[cell.machineDir & 3]} · Bay ${sectorNum}` : `Bay ${sectorNum}`;
    head.append(titleSpan, dirSpan);

    const grid = document.createElement('div');
    grid.className = 'inspector-grid';

    const pairs = [
      ['Temp', `${cell.tempKelvin.toFixed(1)} K${cell.scramActive ? ' SCRAM' : ''}`],
      ['Power', `${Math.round(cell.powerRatio * 100)}%`],
      ['Wafer', waferTag],
      ['Queue', `${cell.backpressureTicks}t`],
      ['LN2', ln2On ? 'PIPED' : 'NONE'],
      ['Busbar', pwrOn ? 'WIRED' : 'NONE'],
    ];

    for (const [k, v] of pairs) {
      const kv = document.createElement('div');
      kv.className = 'inspector-kv';
      const kEl = document.createElement('span');
      kEl.className = 'inspector-k';
      kEl.textContent = k;
      const vEl = document.createElement('span');
      vEl.className = 'inspector-val';
      vEl.textContent = v;
      kv.append(kEl, vEl);
      grid.appendChild(kv);
    }

    inspectorEl.append(head, grid);
  }

  let hud = null;
  let buildPalette = null;
  let crisisTicker = null;
  let prestigeModal = null;
  let blueprintModal = null;
  let offlineModal = null;

  function updateAllUi() {
    const snap = buildUiSnapshot();
    hud?.update(snap);
    buildPalette?.update(snap);
    crisisTicker?.update(snap);
    prestigeModal?.update(snap);
    if (mobileCrisisBtn) {
      mobileCrisisBtn.hidden = !snap.economy.activeCrisis;
    }
    updateInspector();
  }

  function setHeatmapMode(mode) {
    const m = Math.max(0, Math.min(3, mode | 0));
    heatmapMode = m;
    renderer?.setHeatmapMode(m);
    updateAllUi();
    return m;
  }

  function rotateTool() {
    toolState.dir = (toolState.dir + 1) & 3;
    renderer?.setToolState(toolState);
    audioEngine.playClick();
    updateAllUi();
  }

  function toggleToolSub() {
    if (toolState.toolId === MACHINE_TYPES.BELT_MERGER) {
      toolState.sub = (toolState.sub + 1) & 3;
    } else {
      toolState.sub = (toolState.sub + 1) & 1;
    }
    renderer?.setToolState(toolState);
    audioEngine.playClick();
    updateAllUi();
  }

  function normalizeToolOverride(rawOverride) {
    if (rawOverride === undefined || rawOverride === null) {
      return { ...toolState, free: false };
    }
    if (typeof rawOverride === 'number') {
      if (rawOverride === 0) return { toolId: 0, kind: 'erase', dir: toolState.dir, sub: toolState.sub, free: false };
      if (rawOverride < 0) return { toolId: -1, kind: 'select', dir: toolState.dir, sub: toolState.sub, free: false };
      return { toolId: rawOverride | 0, kind: 'machine', dir: toolState.dir, sub: toolState.sub, free: false };
    }
    if (typeof rawOverride === 'string') {
      const lower = rawOverride.toLowerCase();
      if (lower === 'ln2') return { toolId: 'ln2', kind: 'ln2', dir: toolState.dir, sub: toolState.sub, free: false };
      if (lower === 'power') return { toolId: 'power', kind: 'power', dir: toolState.dir, sub: toolState.sub, free: false };
      if (lower === 'erase' || lower === 'demolish') return { toolId: 0, kind: 'erase', dir: toolState.dir, sub: toolState.sub, free: false };
      return { toolId: -1, kind: 'select', dir: toolState.dir, sub: toolState.sub, free: false };
    }
    const id = rawOverride.toolId ?? rawOverride.type ?? toolState.toolId;
    const dir = (rawOverride.dir ?? toolState.dir) & 3;
    const sub = (rawOverride.sub ?? toolState.sub) & 3;
    const free = Boolean(rawOverride.free);
    if (id === 'ln2' || rawOverride.kind === 'ln2') return { toolId: 'ln2', kind: 'ln2', dir, sub, free };
    if (id === 'power' || rawOverride.kind === 'power') return { toolId: 'power', kind: 'power', dir, sub, free };
    if (id === 0 || rawOverride.kind === 'erase') return { toolId: 0, kind: 'erase', dir, sub, free };
    if (typeof id === 'number' && id >= 1) return { toolId: id | 0, kind: 'machine', dir, sub, free };
    return { toolId: -1, kind: 'select', dir, sub, free };
  }

  function handleTileAction(gx, gy, mouseButton = 0, toolOverride = null) {
    audioEngine.unlock();
    if (!gridEngine.inBounds(gx, gy)) {
      return false;
    }

    const cell = gridEngine.getCell(gx, gy);
    if (!cell) return false;

    const activeTool =
      mouseButton === 2
        ? { toolId: 0, kind: 'erase', dir: toolState.dir, sub: toolState.sub, free: false }
        : normalizeToolOverride(toolOverride);

    if (activeTool.kind === 'select') {
      pinnedCoords.gx = gx;
      pinnedCoords.gy = gy;
      audioEngine.playClick();
      updateInspector();
      return true;
    }

    if (activeTool.kind === 'ln2') {
      if (cell.machineType === MACHINE_TYPES.PILLAR) {
        showToast('Cannot route LN2 pipe through structural pillar.', 'warn');
        return false;
      }
      const ok = gridEngine.togglePipe(gx, gy);
      if (ok) {
        audioEngine.playPlace();
        updateAllUi();
      }
      return ok;
    }

    if (activeTool.kind === 'power') {
      if (cell.machineType === MACHINE_TYPES.PILLAR) {
        showToast('Cannot route power busbar through structural pillar.', 'warn');
        return false;
      }
      const ok = gridEngine.toggleBusbar(gx, gy);
      if (ok) {
        audioEngine.playPlace();
        updateAllUi();
      }
      return ok;
    }

    if (activeTool.kind === 'erase') {
      if (cell.machineType === MACHINE_TYPES.PILLAR) {
        showToast('Seismic pillars are immovable.', 'warn');
        return false;
      }
      if (cell.machineType === MACHINE_TYPES.EMPTY) {
        let clearedConduit = false;
        if ((cell.ln2Mask & 0x10) !== 0) {
          gridEngine.togglePipe(gx, gy, false);
          clearedConduit = true;
        }
        if ((cell.powerMask & 0x10) !== 0) {
          gridEngine.toggleBusbar(gx, gy, false);
          clearedConduit = true;
        }
        if (clearedConduit) {
          audioEngine.playPlace();
          updateAllUi();
        }
        return clearedConduit;
      }
      const oldCat = MACHINE_CATALOG[cell.machineType];
      const removed = gridEngine.removeMachine(gx, gy);
      if (removed) {
        if (oldCat && oldCat.costDies > 0) {
          const salvage = Math.floor(oldCat.costDies * 0.5);
          if (salvage > 0) {
            economyEngine.dies = bsAdd(economyEngine.dies, bsFrom(salvage));
          }
        }
        audioEngine.playPlace();
        updateAllUi();
      }
      return removed;
    }

    if (activeTool.kind === 'machine') {
      const mType = activeTool.toolId;
      if (!Number.isInteger(mType) || mType < 2 || mType >= MACHINE_CATALOG.length) {
        return false;
      }
      if (cell.machineType === MACHINE_TYPES.PILLAR) {
        showToast('Cannot place equipment atop seismic pillar.', 'warn');
        return false;
      }
      const dir = activeTool.dir & 3;
      const sub = activeTool.sub & 3;

      if (cell.machineType === mType) {
        if (cell.machineDir === dir && cell.machineSub === sub) {
          return false;
        }
        const rotated = gridEngine.placeMachine(gx, gy, mType, dir, sub);
        if (rotated) {
          audioEngine.playPlace();
          updateAllUi();
        }
        return rotated;
      }

      const newCat = MACHINE_CATALOG[mType];
      const oldCat = cell.machineType >= 2 ? MACHINE_CATALOG[cell.machineType] : null;
      const cost = activeTool.free ? 0 : (newCat?.costDies || 0);
      const refund = activeTool.free || !oldCat ? 0 : Math.floor((oldCat.costDies || 0) * 0.5);
      const availableDies = bsAdd(economyEngine.dies, bsFrom(refund));

      if (cost > 0 && bsCmp(availableDies, bsFrom(cost)) < 0) {
        showToast(`Need ${cost} Dies to fabricate ${newCat.shortName}.`, 'warn');
        return false;
      }

      const placed = gridEngine.placeMachine(gx, gy, mType, dir, sub);
      if (!placed) return false;

      if (cost > 0 || refund > 0) {
        economyEngine.dies = bsSubClamped(availableDies, bsFrom(cost));
      }
      audioEngine.playPlace();
      updateAllUi();
      return true;
    }

    return false;
  }

  function importBlueprintHash(rawHash) {
    const decoded = decodeBlueprint(String(rawHash || ''));
    if (!decoded.ok) {
      return { ok: false, error: decoded.error };
    }

    if (dailyState.active) {
      const w = gridEngine.state.width;
      const copyW = Math.min(w, decoded.gridSize);
      for (let y = 0; y < copyW; y++) {
        for (let x = 0; x < copyW; x++) {
          const dstCell = gridEngine.getCell(x, y);
          if (!dstCell || dstCell.machineType === MACHINE_TYPES.PILLAR) continue;
          const srcCell = decoded.cells[y * decoded.gridSize + x];
          if (!srcCell || srcCell.machineType === MACHINE_TYPES.PILLAR) continue;
          gridEngine.placeMachine(x, y, srcCell.machineType, srcCell.machineDir, srcCell.machineSub);
          gridEngine.togglePipe(x, y, (srcCell.ln2Mask & 0x10) !== 0);
          gridEngine.toggleBusbar(x, y, (srcCell.powerMask & 0x10) !== 0);
        }
      }
      renderer?.syncGridSize();
      updateAllUi();
      crisisTicker?.pushLog(`Imported ${decoded.gridSize}×${decoded.gridSize} blueprint onto Daily grid (pillars preserved).`, 'gold');
      return { ok: true, gridSize: w, tier: economyEngine.tier };
    }

    const targetW = getTierSpec(economyEngine.tier).gridSize;
    if (decoded.gridSize === targetW) {
      gridEngine.importLayoutSnapshot({
        gridSize: targetW,
        tier: economyEngine.tier,
        agents: decoded.agents,
        cells: decoded.cells,
      });
    } else {
      gridEngine.resize(targetW);
      const copyW = Math.min(targetW, decoded.gridSize);
      for (let y = 0; y < targetW; y++) {
        for (let x = 0; x < targetW; x++) {
          if (x < copyW && y < copyW) {
            const c = decoded.cells[y * decoded.gridSize + x];
            gridEngine.placeMachine(x, y, c.machineType, c.machineDir, c.machineSub);
            gridEngine.togglePipe(x, y, (c.ln2Mask & 0x10) !== 0);
            gridEngine.toggleBusbar(x, y, (c.powerMask & 0x10) !== 0);
          } else {
            gridEngine.removeMachine(x, y);
            gridEngine.togglePipe(x, y, false);
            gridEngine.toggleBusbar(x, y, false);
          }
        }
      }
    }

    for (let s = 0; s < 4; s++) {
      const candidate = decoded.agents[s];
      if (candidate >= 0 && candidate < AGENT_CATALOG.length && economyEngine.tier >= AGENT_CATALOG[candidate].unlockTier) {
        economyEngine.assignAgent(s, candidate);
      } else if (candidate === -1) {
        economyEngine.assignAgent(s, -1);
      }
    }
    syncAgentsToGrid();
    renderer?.syncGridSize();
    renderer?.centerCamera();
    forceSave();
    updateAllUi();
    crisisTicker?.pushLog(`Applied #blueprint layout (${decoded.gridSize}×${decoded.gridSize} · Tier 0${decoded.tier}).`, 'good');
    return { ok: true, gridSize: decoded.gridSize, tier: decoded.tier };
  }

  function triggerDailyChallenge(dateStr = todayUtcStr()) {
    audioEngine.unlock();
    if (!dailyState.active) {
      // Snapshot active campaign cleanly before switching to isolated Daily sandbox
      forceSave();
      dailyState.campaignBackup = {
        econState: economyEngine.exportState(),
        layout: gridEngine.exportLayoutSnapshot(),
      };
    }

    const challenge = generateDailyChallenge(dateStr);
    const savedDaily = vault.loadDailyState();
    const prevBest = savedDaily && savedDaily.seedId === challenge.seedId ? Number(savedDaily.bestScore) || 0 : 0;

    dailyState.active = true;
    dailyState.challenge = challenge;
    dailyState.seedId = challenge.seedId;
    dailyState.dateStr = challenge.dateStr;
    dailyState.elapsedSec = 0;
    dailyState.remainingSec = challenge.durationSec;
    dailyState.brownoutTicks = 0;
    dailyState.kelvinAccum = 0;
    dailyState.kelvinSamples = 0;
    dailyState.score = 0;
    dailyState.bestScore = prevBest;
    dailyState.finished = false;

    setupDailyCleanroom(gridEngine, challenge);
    dailyState.startVaultedGood = gridEngine.state.vaultedGood;

    economyEngine.importState({
      tier: 2,
      dies: bsFrom(1500),
      flops: bsZero(),
      lifetimeFlops: bsZero(),
      shards: 0,
      hwmDiesPerMin: 0,
      fleetLevel: 1,
      prestige: new Array(9).fill(0),
      agents: [-1, -1, -1, -1],
      entropies: [0, 0, 0, 0],
      paperclips: 0,
    });
    syncAgentsToGrid();
    wafersPerSecEma = 0;
    lastTelemetry = null;

    saveDailyProgress();
    renderer?.syncGridSize();
    renderer?.centerCamera();
    updateAllUi();
    crisisTicker?.pushLog(
      `Daily Challenge started: ${challenge.seedId} (${challenge.pillars.length} seismic pillars, 15:00 clock).`,
      'gold'
    );
    showToast(`Daily Seed ${challenge.seedId} active!`);
    return challenge;
  }

  function exitDailyChallenge() {
    if (!dailyState.active) return false;
    saveDailyProgress();

    const backup = dailyState.campaignBackup;
    dailyState.active = false;
    dailyState.challenge = null;
    dailyState.campaignBackup = null;
    dailyState.finished = false;

    if (backup) {
      economyEngine.importState(backup.econState);
      gridEngine.importLayoutSnapshot(backup.layout);
      gridEngine.tier = economyEngine.tier;
      syncAgentsToGrid();
    }

    wafersPerSecEma = 0;
    lastTelemetry = null;
    renderer?.syncGridSize();
    renderer?.centerCamera();
    updateAllUi();
    crisisTicker?.pushLog('Exited Daily Challenge — campaign cleanroom restored untouched.', 'good');
    showToast('Returned to Campaign Cleanroom.');
    return true;
  }

  function applyHydratedState(stateObj) {
    economyEngine.importState(stateObj);
    gridEngine.importLayoutSnapshot(stateObj.layout);
    gridEngine.tier = economyEngine.tier;
    syncAgentsToGrid();
    if (stateObj.audio) {
      audioEngine.setMasterVolume(stateObj.audio.vol ?? 0.6);
      audioEngine.setMuted(Boolean(stateObj.audio.mute));
    }
    renderer?.syncGridSize();
    renderer?.centerCamera();
    updateAllUi();
  }

  function hydrateNow() {
    if (dailyState.active) {
      return { ok: false, reason: 'daily_active' };
    }
    const res = vault.hydrateCampaign(Date.now());
    vaultStatus.source = res.source;
    vaultStatus.selfHealed = res.selfHealed;
    vaultStatus.healedFrom = res.healedFrom || null;
    vaultStatus.cookieRegenerated = res.cookieRegenerated;
    if (res.state) {
      applyHydratedState(res.state);
    }
    updateAllUi();
    return res;
  }

  // Mount UI modules
  hud = createHudController({
    hudEl,
    dailyBannerEl,
    callbacks: {
      onSetHeatmap(mode) {
        audioEngine.unlock();
        audioEngine.playClick();
        setHeatmapMode(mode);
      },
      onUpgradeTier() {
        audioEngine.unlock();
        if (dailyState.active) return;
        const ok = economyEngine.upgradeTier();
        if (!ok) return;
        const nextSpec = getTierSpec(economyEngine.tier);
        gridEngine.resize(nextSpec.gridSize);
        audioEngine.playPrestigeSwell();
        renderer?.syncGridSize();
        renderer?.centerCamera();
        forceSave();
        updateAllUi();
        crisisTicker?.pushLog(`Expanded to ${nextSpec.name} (${nextSpec.gridSize}×${nextSpec.gridSize}).`, 'good');
        showToast(`Upgraded to ${nextSpec.name}!`);
      },
      onResetDaily() {
        audioEngine.playClick();
        triggerDailyChallenge(todayUtcStr());
      },
      async onCopyDailyBrag() {
        audioEngine.unlock();
        audioEngine.playClick();
        const m = dailyState.challenge?.modifiers || {};
        const brag = `Swarm Tycoon Daily [${dailyState.seedId}] — Efficiency Score: ${dailyState.score} (Best: ${dailyState.bestScore} / Target: ${m.targetScore || 0}) | Power ×${(m.powerMult ?? 1).toFixed(2)} · Ambient ${m.ambientK ?? 295}K`;
        try {
          await navigator.clipboard?.writeText(brag);
          showToast('Daily Brag copied to clipboard!');
        } catch {
          showToast(brag);
        }
      },
      onExitDaily() {
        audioEngine.playClick();
        exitDailyChallenge();
      },
      onOpenBlueprint() {
        audioEngine.unlock();
        audioEngine.playClick();
        blueprintModal?.open();
      },
      onOpenPrestige() {
        audioEngine.unlock();
        audioEngine.playClick();
        prestigeModal?.open(buildUiSnapshot());
      },
      onToggleMute() {
        audioEngine.unlock();
        const cur = audioEngine.getState();
        audioEngine.setMuted(!cur.muted);
        if (!dailyState.active) forceSave();
        updateAllUi();
      },
      onVolumeChange(vol) {
        audioEngine.unlock();
        audioEngine.setMasterVolume(vol);
        if (!dailyState.active) forceSave();
        updateAllUi();
      },
      async onInstallApp() {
        if (!deferredInstallPrompt) return;
        audioEngine.unlock();
        audioEngine.playClick();
        try {
          await deferredInstallPrompt.prompt();
          await deferredInstallPrompt.userChoice;
        } catch {
          // ignore cancelled prompt
        }
        deferredInstallPrompt = null;
        installState.available = false;
        updateAllUi();
      },
      onDismissInstall() {
        installState.dismissed = true;
        updateAllUi();
      },
      onInspectVault() {
        audioEngine.unlock();
        audioEngine.playClick();
        showToast(
          vaultStatus.selfHealed
            ? `Vault self-healed from ${vaultStatus.healedFrom} (${vaultStatus.cookieBytes}B cookie).`
            : `Vault synced (${vaultStatus.source}, ${vaultStatus.cookieBytes}B shadow cookie).`
        );
      },
    },
  });

  buildPalette = createBuildPalette({
    containerEl: buildDockEl,
    callbacks: {
      onSelectTool(tool) {
        audioEngine.unlock();
        audioEngine.playClick();
        toolState.toolId = tool.toolId;
        toolState.kind = tool.kind;
        renderer?.setToolState(toolState);
        updateAllUi();
      },
      onRotate: rotateTool,
      onToggleSub: toggleToolSub,
      onUpgradeFleet() {
        audioEngine.unlock();
        if (dailyState.active) return;
        if (economyEngine.upgradeFleet()) {
          audioEngine.playClick();
          forceSave();
          updateAllUi();
          crisisTicker?.pushLog(`Autonomous FOUP Fleet upgraded to Lv.${economyEngine.fleetLevel}.`, 'good');
        }
      },
      onAssignAgent(sectorIdx, agentIdx) {
        audioEngine.unlock();
        if (economyEngine.assignAgent(sectorIdx, agentIdx)) {
          syncAgentsToGrid();
          audioEngine.playClick();
          if (!dailyState.active) forceSave();
          updateAllUi();
          const spec = agentIdx >= 0 ? AGENT_CATALOG[agentIdx] : null;
          crisisTicker?.pushLog(
            spec
              ? `Assigned ${spec.name} to Bay ${sectorIdx + 1}.`
              : `Returned Bay ${sectorIdx + 1} to manual oversight.`
          );
        }
      },
    },
  });

  crisisTicker = createCrisisTicker({
    containerEl: crisisDockEl,
    callbacks: {
      onMitigateCrisis(choiceId) {
        audioEngine.unlock();
        const prevTitle = economyEngine.activeCrisis?.title || 'Incident';
        if (economyEngine.mitigateCrisis(choiceId)) {
          audioEngine.playClick();
          if (!dailyState.active) forceSave();
          updateAllUi();
          crisisTicker.pushLog(`${prevTitle} mitigated via [${choiceId}].`, 'good');
          showToast('Incident mitigated!');
        } else {
          showToast('Insufficient Dies for selected mitigation.', 'warn');
        }
      },
      onSimulateQaStress() {
        audioEngine.unlock();
        if (economyEngine.activeCrisis) return;
        economyEngine.entropies[0] = Math.min(100, (economyEngine.entropies[0] || 0) + 50);
        audioEngine.playClick();
        if (economyEngine.entropies[0] >= 100) {
          const rolled = rollCrisis(25, economyEngine.entropies);
          if (rolled) {
            economyEngine._activateCrisis(rolled);
            audioEngine.playKlaxon('crisis');
            crisisTicker.pushLog(`ALERT: ${rolled.title} triggered in Bay ${rolled.sectorIdx + 1}!`, 'crisis');
          }
        } else {
          crisisTicker.pushLog(
            `Manual QA stress pulse injected — Bay 1 Context Entropy at ${Math.round(economyEngine.entropies[0])}%.`,
            'gold'
          );
        }
        updateAllUi();
      },
    },
  });

  prestigeModal = createPrestigeModal({
    modalEl: prestigeModalEl,
    callbacks: {
      onBuyNode(nodeIdx) {
        audioEngine.unlock();
        if (dailyState.active) return;
        if (economyEngine.buyPrestigeNode(nodeIdx)) {
          audioEngine.playClick();
          forceSave();
          updateAllUi();
        }
      },
      onRewriteArchitecture() {
        audioEngine.unlock();
        if (dailyState.active) return;
        const pend = economyEngine.getDisplayTelemetry().pendingShards;
        if (pend <= 0) return;
        economyEngine.rewriteArchitecture();
        gridEngine.loadStarterFab();
        syncAgentsToGrid();
        wafersPerSecEma = 0;
        lastTelemetry = null;
        renderer?.syncGridSize();
        renderer?.centerCamera();
        renderer?.triggerPrestigeVfx();
        audioEngine.playPrestigeSwell();
        forceSave();
        updateAllUi();
        prestigeModal.close();
        crisisTicker.pushLog(`Architecture Rewrite executed! Banked +${pend} Photomask Shards.`, 'gold');
        showToast(`Architecture Rewrite complete (+${pend} Shards)!`);
      },
      onClose() {
        audioEngine.playClick();
      },
    },
  });

  blueprintModal = createBlueprintModal({
    modalEl: blueprintModalEl,
    callbacks: {
      onGetCurrentBlueprint() {
        const snap = gridEngine.exportLayoutSnapshot();
        return {
          hash: encodeBlueprintHash(snap),
          gridSize: snap.gridSize,
          tier: economyEngine.tier,
        };
      },
      onImportBlueprint(rawInput) {
        audioEngine.unlock();
        const res = importBlueprintHash(rawInput);
        if (res.ok) {
          audioEngine.playPlace();
          showToast('Blueprint loaded into cleanroom!');
        }
        return res;
      },
      onExportJsonSave() {
        audioEngine.unlock();
        audioEngine.playClick();
        const payload = buildCampaignSavePayload();
        const dateTag = todayUtcStr();
        return {
          jsonText: serializePortableSave(payload),
          filename: `swarm-tycoon-save-${dateTag}.json`,
        };
      },
      onImportJsonSave(jsonText) {
        audioEngine.unlock();
        if (dailyState.active) {
          return { ok: false, error: 'Exit Daily Mode before importing a full campaign save.' };
        }
        const parsed = parsePortableSave(jsonText);
        if (!parsed.ok) {
          return parsed;
        }
        applyHydratedState(parsed.state);
        forceSave();
        audioEngine.playPrestigeSwell();
        crisisTicker.pushLog('Verified portable .json campaign save restored.', 'good');
        showToast('Campaign save imported!');
        return { ok: true };
      },
      onClose() {
        audioEngine.playClick();
      },
    },
  });

  offlineModal = createOfflineReportModal({
    modalEl: offlineModalEl,
    callbacks: {
      onClose() {
        audioEngine.playClick();
      },
    },
  });

  // Hydrate persistent state via CookieVault before booting Phaser scene
  const hydration = vault.hydrateCampaign(Date.now());
  vaultStatus.source = hydration.source;
  vaultStatus.selfHealed = hydration.selfHealed;
  vaultStatus.healedFrom = hydration.healedFrom || null;
  vaultStatus.cookieRegenerated = hydration.cookieRegenerated;

  let pendingOfflineReport = null;

  if (hydration.source === 'fresh' || !hydration.state) {
    gridEngine.loadStarterFab();
    economyEngine._resetToDefaults();
    economyEngine.dies = bsFrom(250);
    syncAgentsToGrid();
    const saveRes = forceSave();
    vaultStatus.cookieBytes = saveRes.cookieBytes || 0;
    vaultStatus.primaryBytes = saveRes.primaryBytes || 0;
    crisisTicker.pushLog('Initialized Tier 01 starter cleanroom loop (250 starter Dies credited).', 'good');
  } else {
    const st = hydration.state;
    economyEngine.importState(st);
    gridEngine.importLayoutSnapshot(st.layout);
    gridEngine.tier = economyEngine.tier;
    syncAgentsToGrid();
    if (st.audio) {
      audioEngine.setMasterVolume(st.audio.vol ?? 0.6);
      audioEngine.setMuted(Boolean(st.audio.mute));
    }

    const maxTheoreticalDiesPerSec = 250 * Math.pow(10, Math.max(0, economyEngine.tier - 1));
    const report = solveOfflineCatchup({
      tClose: st.tClose,
      tOpen: Date.now(),
      hwmDiesPerMin: economyEngine.hwmDiesPerMin,
      fleetLevel: economyEngine.fleetLevel,
      tier: economyEngine.tier,
      prestigeLevels: economyEngine.prestigeLevels,
      agents: economyEngine.agents,
      maxTheoreticalDiesPerSec,
    });

    if (!report.clockRollback && report.validDeltaMs >= 1000) {
      if (report.diesEarned.m > 0) {
        economyEngine.dies = bsAdd(economyEngine.dies, report.diesEarned);
      }
      if (report.flopsEarned.m > 0) {
        economyEngine.flops = bsAdd(economyEngine.flops, report.flopsEarned);
        economyEngine.lifetimeFlops = bsAdd(economyEngine.lifetimeFlops, report.flopsEarned);
      }
      pendingOfflineReport = report;
    } else if (report.clockRollback) {
      pendingOfflineReport = report;
    }

    const saveRes = forceSave();
    vaultStatus.cookieBytes = saveRes.cookieBytes || 0;
    vaultStatus.primaryBytes = saveRes.primaryBytes || 0;

    if (hydration.selfHealed) {
      crisisTicker.pushLog(
        `Self-healed campaign state from ${hydration.healedFrom} (${vaultStatus.cookieBytes}B vault).`,
        'gold'
      );
    } else {
      crisisTicker.pushLog(`Hydrated campaign from ${hydration.source}.`, 'info');
    }
  }

  // Boot Phaser 3 isometric renderer
  try {
    renderer = createCleanroomGame(viewportEl, {
      getGridEngine: () => gridEngine,
      getEconomyState: () => economyEngine.getDisplayTelemetry(),
      onTileAction(gx, gy, mouseButton) {
        handleTileAction(gx, gy, mouseButton);
      },
      onHoverTile(gx, gy) {
        hoverCoords.gx = gx;
        hoverCoords.gy = gy;
        updateInspector();
      },
    });
    renderer.setToolState(toolState);
    renderer.setHeatmapMode(heatmapMode);
    renderer.syncGridSize();
  } catch (err) {
    console.warn('Renderer initialization deferred:', err);
  }

  // Wire Viewport Controls & Mobile Tabs
  centerCamBtn?.addEventListener('click', () => {
    audioEngine.unlock();
    audioEngine.playClick();
    renderer?.centerCamera();
  });

  mobileCrisisBtn?.addEventListener('click', () => {
    audioEngine.unlock();
    audioEngine.playClick();
    if (workspaceEl) workspaceEl.dataset.mobileTab = 'ops';
    for (const tabBtn of mobileTabBtns) {
      tabBtn.classList.toggle('is-active', tabBtn.dataset.mobilePane === 'ops');
    }
  });

  for (const tabBtn of mobileTabBtns) {
    tabBtn.addEventListener('click', () => {
      audioEngine.unlock();
      audioEngine.playClick();
      const pane = tabBtn.dataset.mobilePane || 'build';
      if (workspaceEl) workspaceEl.dataset.mobileTab = pane;
      for (const b of mobileTabBtns) {
        b.classList.toggle('is-active', b === tabBtn);
      }
    });
  }

  // Keyboard ergonomics
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) {
      if (e.key === 'Escape') {
        prestigeModal.close();
        blueprintModal.close();
        offlineModal.close();
      }
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'r') {
      e.preventDefault();
      rotateTool();
    } else if (k === 'c') {
      e.preventDefault();
      renderer?.centerCamera();
    } else if (k === '0' || k === '1' || k === '2' || k === '3') {
      setHeatmapMode(Number(k));
    } else if (k === 'escape') {
      prestigeModal.close();
      blueprintModal.close();
      offlineModal.close();
    }
  });

  // Unlock WebAudio on first user gesture
  const unlockOnce = () => {
    audioEngine.unlock();
  };
  window.addEventListener('pointerdown', unlockOnce, { passive: true });
  window.addEventListener('keydown', unlockOnce, { passive: true });

  // PWA beforeinstallprompt listener
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    if (isStandaloneMode()) return;
    deferredInstallPrompt = e;
    installState.available = true;
    updateAllUi();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    installState.installed = true;
    installState.available = false;
    updateAllUi();
  });

  // Hash #blueprint= boot & hashchange handling
  function handleLocationHash(rawHash) {
    if (typeof rawHash !== 'string' || !rawHash.includes('#blueprint=')) return;
    const decoded = decodeBlueprint(rawHash);
    if (!decoded.ok) {
      showToast(`Invalid URL blueprint: ${decoded.error}`, 'error');
      return;
    }
    blueprintModal.open(rawHash);
    showToast('Blueprint loaded into preview — click Load Blueprint to apply.');
  }

  window.addEventListener('hashchange', () => handleLocationHash(window.location.hash));

  // Initial render & modals
  updateAllUi();
  if (pendingOfflineReport) {
    offlineModal.show(pendingOfflineReport);
  }
  if (window.location.hash) {
    handleLocationHash(window.location.hash);
  }

  // Deterministic 10Hz Simulation Accumulator inside requestAnimationFrame
  let lastPerfMs = performance.now();
  let lastWallMs = Date.now();
  let simAccumMs = 0;
  let autosaveAccumMs = 0;

  function stepOneSimTick() {
    const prevCrisis = economyEngine.activeCrisis;
    const prevScrams = lastTelemetry?.scramCount || 0;
    const prevBrownout = lastTelemetry?.brownoutLevel || 0;

    const mods = economyEngine.getSimulationModifiers();
    if (dailyState.active && dailyState.challenge) {
      const dm = dailyState.challenge.modifiers;
      mods.ambientK = dm.ambientK;
      mods.powerMult = (mods.powerMult || 1) * (dm.powerMult || 1);
      mods.defectBias = Math.max(mods.defectBias || 0, dm.defectBias || 0);
    }

    const simTel = gridEngine.stepTick(mods);
    lastTelemetry = simTel;

    const instantWps = (simTel.deltaGood || 0) / (TICK_MS / 1000);
    wafersPerSecEma = wafersPerSecEma * 0.88 + instantWps * 0.12;

    economyEngine.tickFromSim(simTel, TICK_MS / 1000);

    audioEngine.updateTelemetry({
      totalMw: (simTel.powerDemandKw || 0) / 1000,
      brownoutLevel: simTel.brownoutLevel || 0,
      activeCrisis: Boolean(economyEngine.activeCrisis),
      scramCount: simTel.scramCount || 0,
    });

    const nowMs = performance.now();
    if ((simTel.deltaGood || 0) > 0 && nowMs - lastWaferSfxMs >= 140) {
      lastWaferSfxMs = nowMs;
      audioEngine.playWaferComplete();
    }
    if ((simTel.euvFlashes || 0) > 0 && nowMs - lastEuvSfxMs >= 180) {
      lastEuvSfxMs = nowMs;
      audioEngine.playEuvFlash();
    }
    const shuttleCount = gridEngine.state.shuttles.length;
    if (shuttleCount > prevShuttleCount && nowMs - lastShuttleSfxMs >= 350) {
      lastShuttleSfxMs = nowMs;
      audioEngine.playShuttleLaunch();
    }
    prevShuttleCount = shuttleCount;

    if ((simTel.scramCount || 0) > prevScrams) {
      audioEngine.playKlaxon('scram');
      crisisTicker.pushLog(`THERMAL SCRAM: ${simTel.scramCount} module(s) exceeded ceiling Kelvin!`, 'crisis');
    }
    if ((simTel.brownoutLevel || 0) > 0 && prevBrownout === 0) {
      audioEngine.playKlaxon('brownout');
      crisisTicker.pushLog(`GRID BROWNOUT L${simTel.brownoutLevel}: Shedding lower-priority loads.`, 'gold');
    }
    if (!prevCrisis && economyEngine.activeCrisis) {
      audioEngine.playKlaxon('crisis');
      crisisTicker.pushLog(
        `CHAOS INCIDENT: ${economyEngine.activeCrisis.title} in Bay ${economyEngine.activeCrisis.sectorIdx + 1}!`,
        'crisis'
      );
    }

    if (dailyState.active && !dailyState.finished && dailyState.challenge) {
      dailyState.elapsedSec = Math.min(dailyState.challenge.durationSec, dailyState.elapsedSec + TICK_MS / 1000);
      dailyState.remainingSec = Math.max(0, dailyState.challenge.durationSec - dailyState.elapsedSec);
      dailyState.kelvinAccum += simTel.avgKelvin;
      dailyState.kelvinSamples += 1;
      if (simTel.brownoutLevel > 0) dailyState.brownoutTicks += 1;

      dailyState.score = computeDailyEfficiencyScore({
        vaultedGood: Math.max(0, simTel.vaultedGood - dailyState.startVaultedGood),
        avgKelvin: dailyState.kelvinAccum / Math.max(1, dailyState.kelvinSamples),
        brownoutTicks: dailyState.brownoutTicks,
        elapsedSec: dailyState.elapsedSec,
        totalBackpressure: simTel.totalBackpressure,
      });
      if (dailyState.score > dailyState.bestScore) {
        dailyState.bestScore = dailyState.score;
      }
      if (dailyState.remainingSec <= 0) {
        dailyState.finished = true;
        saveDailyProgress();
        crisisTicker.pushLog(`Daily Run Complete! Final Efficiency Score: ${dailyState.score}.`, 'gold');
        showToast(`Daily Run Complete! Score: ${dailyState.score}`);
      }
    }

    // Periodic ambient quip for second-monitor flavor
    const simSec = Math.floor(gridEngine.state.tickCount / 10);
    if (simSec < lastQuipSec) {
      lastQuipSec = simSec;
    } else if (simSec >= lastQuipSec + 60) {
      lastQuipSec = simSec;
      const quipIdx = Math.floor(simSec / 60) % SATIRICAL_TICKER_QUIPS.length;
      crisisTicker.pushLog(SATIRICAL_TICKER_QUIPS[quipIdx], 'info');
    }
  }

  function frameLoop(nowPerfMs) {
    const rawDeltaMs = nowPerfMs - lastPerfMs;
    lastPerfMs = nowPerfMs;

    const nowWall = Date.now();
    const wallGapMs = nowWall - lastWallMs;
    lastWallMs = nowWall;

    if (rawDeltaMs > 0 && rawDeltaMs < 1000) {
      const instFps = 1000 / Math.max(1, rawDeltaMs);
      fpsEma = fpsEma * 0.9 + Math.min(240, instFps) * 0.1;
    }

    // Background tab gap > 5000ms routed via analytical offline solver (ARCHITECTURE.md Sec 3)
    if (!dailyState.active && wallGapMs > 5000 && economyEngine.hwmDiesPerMin > 0) {
      const maxTheoretical = 250 * Math.pow(10, Math.max(0, economyEngine.tier - 1));
      const gapReport = solveOfflineCatchup({
        tClose: nowWall - wallGapMs,
        tOpen: nowWall,
        hwmDiesPerMin: economyEngine.hwmDiesPerMin,
        fleetLevel: economyEngine.fleetLevel,
        tier: economyEngine.tier,
        prestigeLevels: economyEngine.prestigeLevels,
        agents: economyEngine.agents,
        maxTheoreticalDiesPerSec: maxTheoretical,
      });
      if (!gapReport.clockRollback && gapReport.diesEarned.m > 0) {
        economyEngine.dies = bsAdd(economyEngine.dies, gapReport.diesEarned);
        economyEngine.flops = bsAdd(economyEngine.flops, gapReport.flopsEarned);
        economyEngine.lifetimeFlops = bsAdd(economyEngine.lifetimeFlops, gapReport.flopsEarned);
        if (gapReport.validDeltaMs >= 60000) {
          offlineModal.show(gapReport);
        }
        forceSave();
      }
    }

    const clampedDt = Math.min(250, Math.max(0, rawDeltaMs));
    simAccumMs += clampedDt;
    autosaveAccumMs += clampedDt;

    let ticked = false;
    while (simAccumMs >= TICK_MS) {
      simAccumMs -= TICK_MS;
      stepOneSimTick();
      ticked = true;
    }

    if (ticked) {
      updateAllUi();
    }

    if (autosaveAccumMs >= AUTOSAVE_INTERVAL_MS) {
      autosaveAccumMs = 0;
      if (dailyState.active) {
        saveDailyProgress();
      } else {
        forceSave();
      }
    }

    requestAnimationFrame(frameLoop);
  }

  requestAnimationFrame(frameLoop);

  const flushOnLeave = () => {
    if (dailyState.active) {
      saveDailyProgress();
    } else {
      forceSave();
    }
  };
  window.addEventListener('beforeunload', flushOnLeave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushOnLeave();
    }
  });

  // Expose diagnostic handle per SPEC & Contract
  window.__SWARM_TYCOON__ = {
    getState() {
      return {
        mode: dailyState.active ? 'daily' : 'campaign',
        ...buildUiSnapshot(),
      };
    },
    getGridEngine: () => gridEngine,
    getEconomyEngine: () => economyEngine,
    getAudioEngine: () => audioEngine,
    getRenderer: () => renderer,
    forceSave,
    hydrateNow,
    getFps: () => renderer?.getMeasuredFps?.() ?? Math.round(fpsEma * 10) / 10,
    getVaultStatus: () => ({ ...vaultStatus }),
    triggerDailyChallenge,
    exitDailyChallenge,
    exportBlueprintHash: () => encodeBlueprintHash(gridEngine.exportLayoutSnapshot()),
    importBlueprintHash,
    setHeatmapMode,
    placeTile: (x, y, toolOverride) => handleTileAction(x, y, 0, toolOverride),
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    bootCommandDeck();
  });
} else {
  bootCommandDeck();
}
