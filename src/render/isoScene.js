/**
 * Phaser 3 2:1 Isometric Cleanroom Renderer
 * - Pixel-precise 2:1 projection (TILE_W = 64, TILE_H = 32)
 * - Object-pooled tiles, conduits, machines, status beacons, wafers, FOUP shuttles, & VFX
 * - Batched WebGL PostFX passes (WaferIridescencePipeline + HeatmapOverlayPipeline)
 * - Locked 60fps target with Canvas2D & headless Node ESM safe guards
 */

import {
  PALETTE,
  createProceduralTextures,
  getConduitTextureKey,
  getMachineTextureKey,
  getWaferTextureKey,
} from './proceduralTextures.js';
import {
  attachWaferIridescence,
  WAFER_IRIDESCENCE_KEY,
} from './waferIridescencePipeline.js';
import {
  HEATMAP_MODES,
  attachHeatmapOverlayPipeline,
  computeTileHeatmapStyle,
} from './heatmapOverlayPipeline.js';
import { CleanroomVfxPool } from './cleanroomVfx.js';

export const TILE_W = 64;
export const TILE_H = 32;
export const HALF_W = TILE_W * 0.5;
export const HALF_H = TILE_H * 0.5;

const MAX_GRID_DIM = 28;
const MAX_CELLS = MAX_GRID_DIM * MAX_GRID_DIM; // 784
const MAX_SHUTTLES = 32;

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

// Vertical elevation (px) for wafer die rendered atop machines (6..17)
const MACHINE_WAFER_OFFSET_Y = new Float32Array([
  0, 0, -5, -5, -7, -7, -14, -22, -18, -16, -10, -24, -14, -14, -14, -14, -12, -16,
]);

const MACHINE_CANVAS_ORIGIN_Y = 51 / 68;
const BELT_CANVAS_ORIGIN_Y = 23 / 40;
const FLOOR_CANVAS_ORIGIN_Y = 16 / 36;

/**
 * Exact 2:1 isometric projection: grid (gx, gy) -> world screen (x, y).
 */
export function isoToScreen(gx, gy) {
  return {
    x: (gx - gy) * HALF_W,
    y: (gx + gy) * HALF_H,
  };
}

/**
 * Exact inverse isometric picking: world (wx, wy) or { x, y } -> integer { gx, gy }.
 */
export function screenToIso(wxOrPt, wy) {
  let wx;
  let py;
  if (wxOrPt !== null && typeof wxOrPt === 'object') {
    wx = Number(wxOrPt.x) || 0;
    py = Number(wxOrPt.y) || 0;
  } else {
    wx = Number(wxOrPt) || 0;
    py = Number(wy) || 0;
  }

  const a = wx / HALF_W;
  const b = py / HALF_H;
  const gx = Math.floor((a + b) * 0.5 + 0.5) || 0;
  const gy = Math.floor((b - a) * 0.5 + 0.5) || 0;
  return { gx, gy };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function resolveToolId(tool) {
  if (!tool) return { toolId: -1, dir: 0, sub: 0, kind: 'select' };
  const rawId = tool.toolId;
  const dir = (tool.dir || 0) & 3;
  const sub = (tool.sub || 0) & 1;
  if (rawId === 'ln2' || rawId === 'LN2' || rawId === 101 || tool.kind === 'ln2') {
    return { toolId: -1, dir, sub, kind: 'ln2' };
  }
  if (rawId === 'power' || rawId === 'POWER' || rawId === 102 || tool.kind === 'power') {
    return { toolId: -1, dir, sub, kind: 'power' };
  }
  if (rawId === 0 || rawId === 'erase' || rawId === 'demolish') {
    return { toolId: 0, dir, sub, kind: 'erase' };
  }
  if (typeof rawId === 'number' && rawId >= 1 && rawId <= 17) {
    return { toolId: rawId | 0, dir, sub, kind: 'machine' };
  }
  return { toolId: -1, dir, sub, kind: 'select' };
}

function installCleanroomMethods(targetProto) {
  const methods = {
    _initCleanroomState(hooks) {
      this._hooks = hooks || {};
      this._heatmapMode = HEATMAP_MODES.OFF;
      this._toolState = { toolId: 2, dir: 1, sub: 0, kind: 'machine' };
      this._gridSize = 8;
      this._booted = false;
      this._destroyed = false;

      // Measured FPS EMA
      this._fpsEma = 60;
      this._simTimeSec = 0;

      // Hover & camera gesture state
      this._hoverGx = -1;
      this._hoverGy = -1;
      this._isDragging = false;
      this._wasPinching = false;
      this._pinchDist0 = 0;
      this._pinchZoom0 = 1;
      this._downX = 0;
      this._downY = 0;
      this._downButton = 0;
      this._camStartX = 0;
      this._camStartY = 0;

      // Pools & dirty caches
      this._floorPool = null;
      this._powerPool = null;
      this._ln2Pool = null;
      this._machinePool = null;
      this._waferPool = null;
      this._beaconPool = null;
      this._heatmapPool = null;
      this._shuttlePool = null;
      this._shuttleWaferPool = null;

      this._prevFloorVariant = new Int8Array(MAX_CELLS).fill(-1);
      this._prevPowerMask = new Int16Array(MAX_CELLS).fill(-1);
      this._prevLn2Mask = new Int16Array(MAX_CELLS).fill(-1);
      this._prevMachineKey = new Int32Array(MAX_CELLS).fill(-1);
      this._prevWaferKey = new Int16Array(MAX_CELLS).fill(-1);
      this._prevSlotWafer = new Uint8Array(MAX_CELLS);
      this._prevSlotDefective = new Uint8Array(MAX_CELLS);
      this._prevScram = new Uint8Array(MAX_CELLS);
      this._waferSlideAge = new Float32Array(MAX_CELLS);
      this._euvCooldown = new Float32Array(MAX_CELLS);
      this._cryoCooldown = new Float32Array(MAX_CELLS);

      this._dockSignature = -1;
      this._perimeterSignature = '';
      this._heatmapPipeline = null;
      this._waferPipeline = null;
      this._vfx = null;
    },

    create() {
      const Phaser = globalThis.Phaser;
      if (!Phaser) return;

      this._destroyed = false;
      createProceduralTextures(this);

      // Layers ordered cleanly by isometric depth
      this._floorLayer = this.add.layer().setDepth(0);
      this._sectorGfx = this.add.graphics().setDepth(50);
      this._conduitLayer = this.add.layer().setDepth(200);
      this._beltLayer = this.add.layer().setDepth(400);
      this._machineLayer = this.add.layer().setDepth(1000);
      this._waferLayer = this.add.layer().setDepth(2200);
      this._beaconLayer = this.add.layer().setDepth(2250);
      this._heatmapLayer = this.add.layer().setDepth(2400);
      this._foupRailGfx = this.add.graphics().setDepth(2950);
      this._foupLayer = this.add.layer().setDepth(3000);
      this._hoverLayer = this.add.layer().setDepth(3500);
      this._vfxLayer = this.add.layer().setDepth(4000);

      // Attach WebGL PostFX pipelines once per layer (no-op in Canvas2D fallback)
      if (attachWaferIridescence(this._waferLayer, this)) {
        const inst = this._waferLayer.getPostPipeline?.(WAFER_IRIDESCENCE_KEY);
        this._waferPipeline = Array.isArray(inst) ? inst[0] : inst;
      }
      this._heatmapPipeline = attachHeatmapOverlayPipeline(this._heatmapLayer, this);
      this._heatmapLayer.setVisible(this._heatmapMode !== HEATMAP_MODES.OFF);

      this._allocatePools();
      this._createHoverReticle();
      this._vfx = new CleanroomVfxPool(this, this._vfxLayer);

      this._setupCameraAndInput();
      this.events?.once?.('destroy', () => this.destroy());
      this._booted = true;

      this.syncGridSize();
      this.centerCamera();
    },

    _allocatePools() {
      this._floorPool = new Array(MAX_CELLS);
      this._powerPool = new Array(MAX_CELLS);
      this._ln2Pool = new Array(MAX_CELLS);
      this._machinePool = new Array(MAX_CELLS);
      this._waferPool = new Array(MAX_CELLS);
      this._beaconPool = new Array(MAX_CELLS);
      this._heatmapPool = new Array(MAX_CELLS);

      for (let gy = 0; gy < MAX_GRID_DIM; gy++) {
        for (let gx = 0; gx < MAX_GRID_DIM; gx++) {
          const i = gy * MAX_GRID_DIM + gx;
          const pt = isoToScreen(gx, gy);

          const fl = this.add.image(pt.x, pt.y, 'floor_0')
            .setOrigin(0.5, FLOOR_CANVAS_ORIGIN_Y)
            .setDepth(1 + (gx + gy) * 0.01)
            .setVisible(false);
          this._floorLayer.add(fl);
          this._floorPool[i] = fl;

          const pw = this.add.image(pt.x, pt.y, 'power_mask_0')
            .setOrigin(0.5, 0.5)
            .setVisible(false);
          this._conduitLayer.add(pw);
          this._powerPool[i] = pw;

          const ln = this.add.image(pt.x, pt.y, 'ln2_mask_0')
            .setOrigin(0.5, 0.5)
            .setVisible(false);
          this._conduitLayer.add(ln);
          this._ln2Pool[i] = ln;

          const mc = this.add.image(pt.x, pt.y, 'machine_2_0_0')
            .setOrigin(0.5, BELT_CANVAS_ORIGIN_Y)
            .setDepth(400 + gx + gy)
            .setVisible(false);
          this._beltLayer.add(mc);
          this._machinePool[i] = mc;

          const wf = this.add.image(pt.x, pt.y, 'wafer_1')
            .setOrigin(0.5, 0.5)
            .setDepth(gx + gy)
            .setVisible(false);
          this._waferLayer.add(wf);
          this._waferPool[i] = wf;

          const bc = this.add.image(pt.x + 12, pt.y - 31, 'machine_beacon')
            .setOrigin(0.5, 0.5)
            .setScale(0.75)
            .setVisible(false);
          this._beaconLayer.add(bc);
          this._beaconPool[i] = bc;

          const hm = this.add.image(pt.x, pt.y, 'heatmap_tile')
            .setOrigin(0.5, 0.5)
            .setVisible(false);
          this._heatmapLayer.add(hm);
          this._heatmapPool[i] = hm;
        }
      }

      this._shuttlePool = new Array(MAX_SHUTTLES);
      this._shuttleWaferPool = new Array(MAX_SHUTTLES);
      for (let i = 0; i < MAX_SHUTTLES; i++) {
        const sh = this.add.image(0, 0, 'shuttle_pod').setOrigin(0.5, 0.6).setVisible(false);
        this._foupLayer.add(sh);
        this._shuttlePool[i] = sh;

        const sw = this.add.image(0, 0, 'wafer_1').setOrigin(0.5, 0.5).setScale(0.78).setVisible(false);
        this._foupLayer.add(sw);
        this._shuttleWaferPool[i] = sw;
      }
    },

    _createHoverReticle() {
      this._hoverDiamond = this.add.image(0, 0, 'hover_diamond')
        .setOrigin(0.5, 0.5)
        .setVisible(false);
      this._hoverGhost = this.add.image(0, 0, 'machine_2_1_0')
        .setOrigin(0.5, BELT_CANVAS_ORIGIN_Y)
        .setAlpha(0.6)
        .setVisible(false);
      this._hoverLayer.add(this._hoverDiamond);
      this._hoverLayer.add(this._hoverGhost);
    },

    _setupCameraAndInput() {
      const cam = this.cameras.main;
      cam.setBackgroundColor(PALETTE.SLATE_DEEP);
      cam.setBounds(-1600, -600, 3200, 2400);

      // Enable secondary pointer for touch pinch zoom
      this.input.addPointer(1);
      if (this.input.mouse) {
        this.input.mouse.disableContextMenu();
      }

      this.input.on('pointerdown', (pointer) => {
        if (this._destroyed) return;
        const p1 = this.input.pointer1;
        const p2 = this.input.pointer2;
        if (p1?.isDown && p2?.isDown) {
          this._wasPinching = true;
          this._isDragging = true;
          this._pinchDist0 = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
          this._pinchZoom0 = cam.zoom;
          return;
        }

        this._wasPinching = false;
        this._isDragging = false;
        this._downX = pointer.x;
        this._downY = pointer.y;
        this._downButton = pointer.button || 0;
        this._camStartX = cam.scrollX;
        this._camStartY = cam.scrollY;
      });

      this.input.on('pointermove', (pointer) => {
        if (this._destroyed) return;
        const p1 = this.input.pointer1;
        const p2 = this.input.pointer2;

        if (p1?.isDown && p2?.isDown) {
          this._wasPinching = true;
          this._isDragging = true;
          const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
          const nextZoom = clamp(this._pinchZoom0 * (dist / this._pinchDist0), 0.45, 2.5);
          cam.setZoom(nextZoom);
          return;
        }

        if (pointer.isDown) {
          const dx = pointer.x - this._downX;
          const dy = pointer.y - this._downY;
          const isPanBtn = pointer.middleButtonDown() || pointer.rightButtonDown();
          if (isPanBtn || Math.hypot(dx, dy) >= 7) {
            this._isDragging = true;
            cam.scrollX = this._camStartX - dx / cam.zoom;
            cam.scrollY = this._camStartY - dy / cam.zoom;
          }
        }

        this._updateHoverFromPointer(pointer);
      });

      this.input.on('pointerup', (pointer) => {
        if (this._destroyed) return;
        const p1 = this.input.pointer1;
        const p2 = this.input.pointer2;
        if (this._wasPinching) {
          if (!p1?.isDown && !p2?.isDown) {
            this._wasPinching = false;
            this._isDragging = false;
          }
          return;
        }

        if (!this._isDragging) {
          const worldPt = cam.getWorldPoint(pointer.x, pointer.y);
          const { gx, gy } = screenToIso(worldPt);
          const simState = this._getSimState();
          const dim = clamp(simState?.width || this._gridSize || 8, 8, MAX_GRID_DIM);
          if (gx >= 0 && gx < dim && gy >= 0 && gy < dim) {
            const btn = pointer.button === 2 || pointer.rightButtonReleased() ? 2 : 0;
            this._hooks?.onTileAction?.(gx, gy, btn);
          }
        }
        this._isDragging = false;
      });

      this.input.on('wheel', (pointer, _objs, _dx, deltaY) => {
        if (this._destroyed) return;
        const factor = deltaY > 0 ? 0.9 : 1.11;
        const oldZoom = cam.zoom;
        const newZoom = clamp(oldZoom * factor, 0.45, 2.5);
        if (Math.abs(newZoom - oldZoom) < 0.0001) return;

        const before = cam.getWorldPoint(pointer.x, pointer.y);
        cam.setZoom(newZoom);
        const after = cam.getWorldPoint(pointer.x, pointer.y);
        cam.scrollX += before.x - after.x;
        cam.scrollY += before.y - after.y;
        this._updateHoverFromPointer(pointer);
      });

      this._onResize = () => {
        if (!this._destroyed && this._booted) {
          this.centerCamera();
        }
      };
      this.scale?.on('resize', this._onResize);
    },

    _getSimState() {
      const engine = this._hooks?.getGridEngine?.();
      if (!engine) return null;
      return engine.state || engine;
    },

    _updateHoverFromPointer(pointer) {
      const cam = this.cameras?.main;
      if (!cam || !pointer) return;
      const worldPt = cam.getWorldPoint(pointer.x, pointer.y);
      const { gx, gy } = screenToIso(worldPt);
      const simState = this._getSimState();
      const dim = clamp(simState?.width || this._gridSize || 8, 8, MAX_GRID_DIM);
      const inBounds = gx >= 0 && gx < dim && gy >= 0 && gy < dim;
      const nextGx = inBounds ? gx : -1;
      const nextGy = inBounds ? gy : -1;

      if (nextGx !== this._hoverGx || nextGy !== this._hoverGy) {
        this._hoverGx = nextGx;
        this._hoverGy = nextGy;
        this._hooks?.onHoverTile?.(nextGx, nextGy);
      }
    },

    setHeatmapMode(mode) {
      const m = clamp(mode | 0, 0, 3);
      this._heatmapMode = m;
      if (this._heatmapLayer) {
        this._heatmapLayer.setVisible(m !== HEATMAP_MODES.OFF);
      }
      if (this._heatmapPipeline) {
        this._heatmapPipeline.mode = m;
      }
    },

    setToolState(tool) {
      this._toolState = resolveToolId(tool);
    },

    syncGridSize() {
      const simState = this._getSimState();
      const dim = clamp(simState?.width || 8, 8, MAX_GRID_DIM);
      const prevDim = this._gridSize;
      this._gridSize = dim;

      if (!this._booted) return;

      for (let gy = 0; gy < MAX_GRID_DIM; gy++) {
        for (let gx = 0; gx < MAX_GRID_DIM; gx++) {
          const i = gy * MAX_GRID_DIM + gx;
          const active = gx < dim && gy < dim;
          const fl = this._floorPool[i];
          if (!active) {
            if (fl.visible) fl.setVisible(false);
            this._powerPool[i].setVisible(false);
            this._ln2Pool[i].setVisible(false);
            this._machinePool[i].setVisible(false);
            this._waferPool[i].setVisible(false);
            this._beaconPool[i].setVisible(false);
            this._heatmapPool[i].setVisible(false);
            continue;
          }

          const variant = (gx === 0 && gy === 0) ? 2 : ((gx + gy) & 1);
          if (this._prevFloorVariant[i] !== variant) {
            this._prevFloorVariant[i] = variant;
            fl.setTexture(variant === 2 ? 'floor_substation' : variant === 1 ? 'floor_1' : 'floor_0');
          }
          if (!fl.visible) fl.setVisible(true);
        }
      }

      this._prevSlotWafer.fill(0);
      this._prevSlotDefective.fill(0);
      this._prevScram.fill(0);
      this._waferSlideAge.fill(0);
      this._perimeterSignature = '';
      this._dockSignature = -1;
      if (prevDim !== dim) {
        this.centerCamera();
      }
    },

    centerCamera() {
      const cam = this.cameras?.main;
      if (!cam) return;
      const dim = clamp(this._gridSize || 8, 8, MAX_GRID_DIM);
      const center = isoToScreen((dim - 1) * 0.5, (dim - 1) * 0.5);
      const gridPixelW = dim * TILE_W;
      const gridPixelH = dim * TILE_H + 64;
      const vw = cam.width || this.scale?.width || 1280;
      const vh = cam.height || this.scale?.height || 720;
      const fitZoom = clamp(Math.min(vw / (gridPixelW * 1.2), vh / (gridPixelH * 1.32)), 0.5, 1.65);
      cam.setZoom(fitZoom);
      cam.centerOn(center.x, center.y - 8);
    },

    triggerPrestigeVfx() {
      if (!this._vfx) return;
      const dim = clamp(this._gridSize || 8, 8, MAX_GRID_DIM);
      const center = isoToScreen((dim - 1) * 0.5, (dim - 1) * 0.5);
      this._vfx.triggerPrestigeVfx(center.x, center.y);
    },

    getMeasuredFps() {
      const loopFps = this.game?.loop?.actualFps;
      if (Number.isFinite(this._fpsEma) && this._fpsEma > 0) {
        return Math.round(this._fpsEma * 10) / 10;
      }
      return Number.isFinite(loopFps) && loopFps > 0 ? Math.round(loopFps * 10) / 10 : 60;
    },

    update(time, delta) {
      if (this._destroyed || !this._booted) return;

      const dtSec = Math.min(0.05, Math.max(0.001, (delta || 16.667) * 0.001));
      const instFps = 1000 / Math.max(1, delta || 16.667);
      this._fpsEma = this._fpsEma * 0.9 + clamp(instFps, 1, 240) * 0.1;
      this._simTimeSec += dtSec;

      const simState = this._getSimState();
      const econState = this._hooks?.getEconomyState?.() || null;
      const dim = clamp(simState?.width || this._gridSize || 8, 8, MAX_GRID_DIM);
      if (dim !== this._gridSize) {
        this.syncGridSize();
      }

      if (simState) {
        this._syncCells(simState, dim, dtSec);
        this._syncShuttles(simState);
        this._syncSectorPerimeter(dim, simState, econState);
      } else {
        this._syncSectorPerimeter(dim, null, econState);
      }

      this._syncHoverReticle(simState, dim);
      this._vfx?.update(dtSec);
    },

    _syncCells(state, dim, dtSec) {
      const machineType = state.machineType;
      const machineDir = state.machineDir;
      const machineSub = state.machineSub;
      const ln2Mask = state.ln2Mask;
      const powerMask = state.powerMask;
      const slotWafer = state.slotWafer;
      const slotDefective = state.slotDefective;
      const slotProgress = state.slotProgress;
      const backpressureTicks = state.backpressureTicks;
      const tempKelvin = state.tempKelvin;
      const scramActive = state.scramActive;
      const powerRatio = state.powerRatio;
      const shuttleWaypoint = state.shuttleWaypoint;

      const tNow = this._simTimeSec;
      const heatmapMode = this._heatmapMode;
      const showHeat = heatmapMode !== HEATMAP_MODES.OFF;
      let visibleWafers = 0;
      let alertAccum = 0;
      let dockSig = 17;

      for (let gy = 0; gy < dim; gy++) {
        for (let gx = 0; gx < dim; gx++) {
          const simIdx = gy * dim + gx;
          const poolIdx = gy * MAX_GRID_DIM + gx;

          // 1. Power busbar overlay
          const pMask = powerMask ? powerMask[simIdx] : 0;
          const pwSp = this._powerPool[poolIdx];
          if ((pMask & 0x10) !== 0) {
            const pConn = pMask & 0x0F;
            if (this._prevPowerMask[poolIdx] !== pConn) {
              this._prevPowerMask[poolIdx] = pConn;
              pwSp.setTexture(getConduitTextureKey('power', pConn));
            }
            if (!pwSp.visible) pwSp.setVisible(true);
          } else if (pwSp.visible) {
            pwSp.setVisible(false);
          }

          // 2. LN2 Cryo loop overlay
          const lMask = ln2Mask ? ln2Mask[simIdx] : 0;
          const lnSp = this._ln2Pool[poolIdx];
          if ((lMask & 0x10) !== 0) {
            const lConn = lMask & 0x0F;
            if (this._prevLn2Mask[poolIdx] !== lConn) {
              this._prevLn2Mask[poolIdx] = lConn;
              lnSp.setTexture(getConduitTextureKey('ln2', lConn));
            }
            if (!lnSp.visible) lnSp.setVisible(true);
          } else if (lnSp.visible) {
            lnSp.setVisible(false);
          }

          // 3. Machine / Belt sprite
          const mType = machineType ? machineType[simIdx] : 0;
          const mDir = machineDir ? (machineDir[simIdx] & 3) : 0;
          const mSub = machineSub ? (machineSub[simIdx] & 1) : 0;
          const mcSp = this._machinePool[poolIdx];
          const bcSp = this._beaconPool[poolIdx];

          const temp = tempKelvin ? tempKelvin[simIdx] : 295;
          const scram = scramActive ? scramActive[simIdx] : 0;
          const pRatio = powerRatio ? powerRatio[simIdx] : 1;
          const bpTicks = backpressureTicks ? backpressureTicks[simIdx] : 0;

          if (mType === 16 || (shuttleWaypoint && shuttleWaypoint[simIdx] > 0)) {
            const wp = shuttleWaypoint ? shuttleWaypoint[simIdx] : (mSub + 1);
            dockSig = ((dockSig * 31) ^ ((gx << 8) | (gy << 2) | wp)) | 0;
          }

          if (mType > 0) {
            const keyCode = (mType << 8) | (mDir << 2) | mSub;
            if (this._prevMachineKey[poolIdx] !== keyCode) {
              this._prevMachineKey[poolIdx] = keyCode;
              const isBelt = mType >= 2 && mType <= 5;
              mcSp.setTexture(getMachineTextureKey(mType, mDir, mSub));
              mcSp.setOrigin(0.5, isBelt ? BELT_CANVAS_ORIGIN_Y : MACHINE_CANVAS_ORIGIN_Y);
              mcSp.setDepth((isBelt ? 400 : 1000) + gx + gy);
              if (isBelt && mcSp.displayList !== this._beltLayer) {
                this._beltLayer.add(mcSp);
              } else if (!isBelt && mcSp.displayList !== this._machineLayer) {
                this._machineLayer.add(mcSp);
              }
            }
            if (!mcSp.visible) mcSp.setVisible(true);

            // Machine status tint & beacon
            if (scram) {
              alertAccum += 1;
              const pulse = Math.sin(tNow * 14 + gx + gy) > 0;
              mcSp.setTint(pulse ? 0xFF7B93 : 0xFFFFFF);
            } else if (mType >= 6 && pRatio < 0.99) {
              alertAccum += 0.35;
              const flicker = Math.sin(tNow * 24 + gx * 3 + gy) > 0.15;
              mcSp.setTint(flicker ? 0x7A8798 : 0x555E6B);
            } else if (mcSp.isTinted) {
              mcSp.clearTint();
            }

            if (mType >= 6) {
              if (scram) {
                bcSp.setTint(0xFF3B5C);
                bcSp.setAlpha(0.45 + 0.55 * Math.abs(Math.sin(tNow * 10)));
              } else if (pRatio < 0.99) {
                const flick = Math.sin(tNow * 26 + gx * 1.9 + gy) > 0.1;
                bcSp.setTint(flick ? 0xFFB800 : 0x5A1C1C);
                bcSp.setAlpha(flick ? 0.9 : 0.35);
              } else if (mType === 8 || mType === 14) {
                bcSp.setTint(0xFFB800);
                bcSp.setAlpha(0.92);
              } else if (slotWafer && slotWafer[simIdx] > 0) {
                bcSp.setTint(0x10F5A0);
                bcSp.setAlpha(0.95);
              } else {
                bcSp.setTint(0x00F0FF);
                bcSp.setAlpha(0.75);
              }
              if (!bcSp.visible) bcSp.setVisible(true);
            } else if (bcSp.visible) {
              bcSp.setVisible(false);
            }
          } else {
            if (mcSp.visible) mcSp.setVisible(false);
            if (bcSp.visible) bcSp.setVisible(false);
          }

          // 4. Wafer die interpolation & EUV/defect edge VFX
          const wState = slotWafer ? slotWafer[simIdx] : 0;
          const wDef = slotDefective ? (slotDefective[simIdx] ? 1 : 0) : 0;
          const prevW = this._prevSlotWafer[poolIdx];
          const prevDef = this._prevSlotDefective[poolIdx];
          const prevSc = this._prevScram[poolIdx];

          if (this._euvCooldown[poolIdx] > 0) this._euvCooldown[poolIdx] -= dtSec;
          if (this._cryoCooldown[poolIdx] > 0) this._cryoCooldown[poolIdx] -= dtSec;

          // EUV flash when EUV_SCANNER transitions COATED(2) -> EXPOSED(3)
          if (mType === 8 && wState === 3 && prevW === 2 && this._euvCooldown[poolIdx] <= 0) {
            const pt = isoToScreen(gx, gy);
            this._vfx?.spawnEuvFlash(pt.x, pt.y);
            this._euvCooldown[poolIdx] = 0.25;
          }
          // Defect spark on new defect or scram latch
          if ((wDef === 1 && prevDef === 0) || (scram === 1 && prevSc === 0)) {
            const pt = isoToScreen(gx, gy);
            this._vfx?.spawnDefectSpark(pt.x, pt.y);
          }
          // Ambient LN2 cryo frost puff
          if ((mType === 13 || temp < 170) && this._cryoCooldown[poolIdx] <= 0) {
            if (((gx * 7 + gy * 13 + Math.floor(tNow * 6)) & 7) === 0) {
              const pt = isoToScreen(gx, gy);
              this._vfx?.spawnCryoVapor(pt.x, pt.y);
            }
            this._cryoCooldown[poolIdx] = 0.55;
          }

          this._prevSlotWafer[poolIdx] = wState;
          this._prevSlotDefective[poolIdx] = wDef;
          this._prevScram[poolIdx] = scram;

          const wfSp = this._waferPool[poolIdx];
          if (wState > 0) {
            visibleWafers++;
            const wKeyCode = (wState << 1) | wDef;
            if (this._prevWaferKey[poolIdx] !== wKeyCode) {
              this._prevWaferKey[poolIdx] = wKeyCode;
              wfSp.setTexture(getWaferTextureKey(wState, Boolean(wDef)));
            }

            if (prevW === 0) {
              this._waferSlideAge[poolIdx] = 0;
            } else {
              this._waferSlideAge[poolIdx] = Math.min(1, this._waferSlideAge[poolIdx] + dtSec * 10);
            }

            const prog = slotProgress ? slotProgress[simIdx] : 0;
            let gxOff = 0;
            let gyOff = 0;
            let yPxOff = -5;

            if (mType >= 2 && mType <= 5) {
              const tSlide = bpTicks > 0 ? 0.5 : (prog > 0.01 ? prog : this._waferSlideAge[poolIdx]);
              if (mType === 3) {
                const outDir = (mDir + (mSub === 1 ? 3 : 1)) & 3;
                const inv = 1 - tSlide;
                const p0x = -0.42 * DX[mDir];
                const p0y = -0.42 * DY[mDir];
                const p2x = 0.42 * DX[outDir];
                const p2y = 0.42 * DY[outDir];
                gxOff = inv * inv * p0x + tSlide * tSlide * p2x;
                gyOff = inv * inv * p0y + tSlide * tSlide * p2y;
              } else {
                const span = (tSlide - 0.5) * 0.84;
                gxOff = span * DX[mDir];
                gyOff = span * DY[mDir];
              }
            } else {
              yPxOff = MACHINE_WAFER_OFFSET_Y[mType] || -14;
              yPxOff -= Math.sin(prog * Math.PI) * 2;
            }

            const wPt = isoToScreen(gx + gxOff, gy + gyOff);
            wfSp.setPosition(wPt.x, wPt.y + yPxOff);
            const nextDepth = gx + gy + gxOff + gyOff;
            if (Math.abs(wfSp.depth - nextDepth) >= 0.01) {
              wfSp.setDepth(nextDepth);
            }
            if (!wfSp.visible) wfSp.setVisible(true);
          } else {
            this._waferSlideAge[poolIdx] = 0;
            if (wfSp.visible) wfSp.setVisible(false);
          }

          // 5. Isometric diagnostic heatmap cell
          const hmSp = this._heatmapPool[poolIdx];
          if (showHeat) {
            const style = computeTileHeatmapStyle(
              heatmapMode,
              {
                gx,
                gy,
                machineType: mType,
                tempKelvin: temp,
                scramActive: scram,
                backpressureTicks: bpTicks,
                powerRatio: pRatio,
                ln2Mask: lMask,
                powerMask: pMask,
              },
              tNow
            );
            if (style.visible) {
              hmSp.setTint(style.tint);
              hmSp.setAlpha(style.alpha);
              if (!hmSp.visible) hmSp.setVisible(true);
            } else if (hmSp.visible) {
              hmSp.setVisible(false);
            }
          } else if (hmSp.visible) {
            hmSp.setVisible(false);
          }
        }
      }

      if (this._waferLayer) {
        this._waferLayer.setVisible(visibleWafers > 0);
      }
      if (this._heatmapPipeline) {
        this._heatmapPipeline.alertIntensity = clamp(alertAccum * 0.12, 0, 1);
      }

      if (dockSig !== this._dockSignature) {
        this._dockSignature = dockSig;
        this._redrawFoupRails(state, dim);
      }
    },

    _redrawFoupRails(state, dim) {
      const gfx = this._foupRailGfx;
      if (!gfx) return;
      gfx.clear();

      const machineType = state.machineType;
      const machineSub = state.machineSub;
      const waypoint = state.shuttleWaypoint;

      const pickups = [];
      const dropoffs = [];
      for (let gy = 0; gy < dim; gy++) {
        for (let gx = 0; gx < dim; gx++) {
          const i = gy * dim + gx;
          const m = machineType ? machineType[i] : 0;
          const wp = waypoint ? waypoint[i] : 0;
          if (m === 16 || wp > 0) {
            const isDrop = wp === 2 || (m === 16 && (machineSub?.[i] & 1) === 1);
            if (isDrop) dropoffs.push({ gx, gy });
            else pickups.push({ gx, gy });
          }
        }
      }

      if (pickups.length === 0 || dropoffs.length === 0) return;

      const railElevation = -34;
      for (let i = 0; i < pickups.length; i++) {
        const a = isoToScreen(pickups[i].gx, pickups[i].gy);
        const b = isoToScreen(dropoffs[i % dropoffs.length].gx, dropoffs[i % dropoffs.length].gy);
        // Overhead structural gantry beam
        gfx.lineStyle(4, 0x1A283C, 0.75);
        gfx.beginPath();
        gfx.moveTo(a.x, a.y + railElevation);
        gfx.lineTo(b.x, b.y + railElevation);
        gfx.strokePath();

        // Cyan maglev telemetry filament
        gfx.lineStyle(1.3, 0x00F0FF, 0.55);
        gfx.beginPath();
        gfx.moveTo(a.x, a.y + railElevation - 1);
        gfx.lineTo(b.x, b.y + railElevation - 1);
        gfx.strokePath();
      }
    },

    _syncShuttles(state) {
      const shuttles = state.shuttles;
      const count = Array.isArray(shuttles) ? Math.min(MAX_SHUTTLES, shuttles.length) : 0;
      const tNow = this._simTimeSec;

      for (let i = 0; i < MAX_SHUTTLES; i++) {
        const shSp = this._shuttlePool[i];
        const swSp = this._shuttleWaferPool[i];
        if (i >= count) {
          if (shSp.visible) shSp.setVisible(false);
          if (swSp.visible) swSp.setVisible(false);
          continue;
        }

        const sh = shuttles[i];
        const pt = isoToScreen(sh.x || 0, sh.y || 0);
        const bob = Math.sin(tNow * 5 + (sh.id || i)) * 1.5;
        const elevY = pt.y - 34 + bob;

        shSp.setPosition(pt.x, elevY);
        if (Number.isFinite(sh.targetX) && Number.isFinite(sh.targetY)) {
          const tgt = isoToScreen(sh.targetX, sh.targetY);
          shSp.setFlipX(tgt.x < pt.x);
        }
        if (!shSp.visible) shSp.setVisible(true);

        if (sh.carryingWafer > 0) {
          swSp.setTexture(getWaferTextureKey(sh.carryingWafer, Boolean(sh.carryingDefective)));
          swSp.setPosition(pt.x, elevY + 6);
          if (!swSp.visible) swSp.setVisible(true);
        } else if (swSp.visible) {
          swSp.setVisible(false);
        }
      }
    },

    _syncSectorPerimeter(dim, simState, econState) {
      const agents = simState?.sectorAgents;
      const crisis = econState?.activeCrisis?.type || '';
      const a0 = agents ? agents[0] : -1;
      const a1 = agents ? agents[1] : -1;
      const a2 = agents ? agents[2] : -1;
      const a3 = agents ? agents[3] : -1;
      const sig = `${dim}:${a0},${a1},${a2},${a3}:${crisis}`;
      if (sig === this._perimeterSignature) return;
      this._perimeterSignature = sig;

      const gfx = this._sectorGfx;
      if (!gfx) return;
      gfx.clear();

      // Cleanroom outer boundary diamond
      const cTL = isoToScreen(-0.5, -0.5);
      const cTR = isoToScreen(dim - 0.5, -0.5);
      const cBR = isoToScreen(dim - 0.5, dim - 0.5);
      const cBL = isoToScreen(-0.5, dim - 0.5);

      gfx.lineStyle(2, crisis ? 0xFF3B5C : 0x1F324B, crisis ? 0.8 : 0.9);
      gfx.beginPath();
      gfx.moveTo(cTL.x, cTL.y);
      gfx.lineTo(cTR.x, cTR.y);
      gfx.lineTo(cBR.x, cBR.y);
      gfx.lineTo(cBL.x, cBL.y);
      gfx.closePath();
      gfx.strokePath();

      // Quadrant sector division lines
      const half = dim * 0.5 - 0.5;
      const qN = isoToScreen(half, -0.5);
      const qS = isoToScreen(half, dim - 0.5);
      const qW = isoToScreen(-0.5, half);
      const qE = isoToScreen(dim - 0.5, half);

      const hasAnyAgent = a0 >= 0 || a1 >= 0 || a2 >= 0 || a3 >= 0;
      gfx.lineStyle(1, hasAnyAgent ? 0x00F0FF : 0x1A293D, hasAnyAgent ? 0.35 : 0.55);
      gfx.beginPath();
      gfx.moveTo(qN.x, qN.y);
      gfx.lineTo(qS.x, qS.y);
      gfx.moveTo(qW.x, qW.y);
      gfx.lineTo(qE.x, qE.y);
      gfx.strokePath();
    },

    _syncHoverReticle(simState, dim) {
      if (!this._hoverDiamond || !this._hoverGhost) return;
      const gx = this._hoverGx;
      const gy = this._hoverGy;
      if (gx < 0 || gx >= dim || gy < 0 || gy >= dim) {
        this._hoverDiamond.setVisible(false);
        this._hoverGhost.setVisible(false);
        return;
      }

      const pt = isoToScreen(gx, gy);
      const simIdx = gy * dim + gx;
      const existing = simState?.machineType ? simState.machineType[simIdx] : 0;
      const tool = this._toolState;

      let reticleTint = 0x00F0FF;
      let showGhost = false;

      if (tool.kind === 'ln2') {
        reticleTint = 0x38BDF8;
      } else if (tool.kind === 'power') {
        reticleTint = 0xFFB800;
      } else if (tool.kind === 'erase') {
        reticleTint = existing === 1 ? 0x5A6678 : 0xFF3B5C;
      } else if (tool.kind === 'machine' && tool.toolId > 0) {
        const blocked = existing === 1;
        reticleTint = blocked ? 0xFF3B5C : 0x00F0FF;
        const isBelt = tool.toolId >= 2 && tool.toolId <= 5;
        this._hoverGhost.setTexture(getMachineTextureKey(tool.toolId, tool.dir, tool.sub));
        this._hoverGhost.setOrigin(0.5, isBelt ? BELT_CANVAS_ORIGIN_Y : MACHINE_CANVAS_ORIGIN_Y);
        this._hoverGhost.setPosition(pt.x, pt.y);
        this._hoverGhost.setTint(blocked ? 0xFF3B5C : 0xB8F8FF);
        this._hoverGhost.setAlpha(blocked ? 0.45 : 0.62);
        showGhost = true;
      }

      this._hoverDiamond.setPosition(pt.x, pt.y);
      this._hoverDiamond.setTint(reticleTint);
      this._hoverDiamond.setVisible(true);
      this._hoverGhost.setVisible(showGhost);
    },

    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      if (this._onResize) {
        this.scale?.off?.('resize', this._onResize);
        this._onResize = null;
      }
      this._vfx?.destroy();
      this._vfx = null;
    },
  };

  Object.assign(targetProto, methods);
}

const BaseScene = globalThis.Phaser?.Scene || class FallbackPhaserScene {
  constructor() {}
};

/**
 * Isometric Cleanroom Scene (compatible with Phaser 3.87.0 & Node ESM smoke imports).
 */
export class IsoCleanroomScene extends BaseScene {
  constructor(hooks = {}) {
    super({ key: 'IsoCleanroomScene' });
    this._initCleanroomState(hooks);
  }
}

installCleanroomMethods(IsoCleanroomScene.prototype);

function createRuntimeScene(Phaser, hooks) {
  if (IsoCleanroomScene.prototype instanceof Phaser.Scene) {
    return new IsoCleanroomScene(hooks);
  }
  class DynamicIsoCleanroomScene extends Phaser.Scene {
    constructor() {
      super({ key: 'IsoCleanroomScene' });
      this._initCleanroomState(hooks);
    }
  }
  installCleanroomMethods(DynamicIsoCleanroomScene.prototype);
  return new DynamicIsoCleanroomScene();
}

/**
 * Boots the vendored Phaser 3 isometric cleanroom renderer inside containerEl.
 * Returns a safe controller handle exposing all SPEC Section 6 operations.
 */
export function createCleanroomGame(containerEl, hooks = {}) {
  const Phaser = globalThis.Phaser;
  if (!Phaser?.Game) {
    throw new Error('Phaser runtime missing. Load ./vendor/phaser.min.js before calling createCleanroomGame().');
  }

  const parent = typeof containerEl === 'string' && typeof document !== 'undefined'
    ? document.getElementById(containerEl)
    : containerEl;

  const scene = createRuntimeScene(Phaser, hooks);

  const width = parent?.clientWidth || 1280;
  const height = parent?.clientHeight || 720;

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: parent || undefined,
    width,
    height,
    backgroundColor: PALETTE.SLATE_DEEP,
    antialias: true,
    pixelArt: false,
    roundPixels: false,
    powerPreference: 'high-performance',
    fps: {
      target: 60,
      forceSetTimeOut: false,
    },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.NO_CENTER,
    },
    scene: [scene],
  });

  return {
    game,
    scene,
    setHeatmapMode(mode) {
      scene.setHeatmapMode(mode);
    },
    setToolState(tool) {
      scene.setToolState(tool);
    },
    syncGridSize() {
      scene.syncGridSize();
    },
    triggerPrestigeVfx() {
      scene.triggerPrestigeVfx();
    },
    centerCamera() {
      scene.centerCamera();
    },
    getMeasuredFps() {
      return scene.getMeasuredFps();
    },
    destroy() {
      scene.destroy();
      game.destroy(true);
    },
  };
}
