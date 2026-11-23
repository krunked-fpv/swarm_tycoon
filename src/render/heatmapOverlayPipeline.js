/**
 * 3-Mode Isometric Cleanroom Diagnostic Heatmap Shader & Per-Tile Style Solver
 * Modes:
 *   0 = Off
 *   1 = Thermal Kelvin (77K Frost Blue -> 295K Slate -> 335K Gold -> 390K+ Crimson)
 *   2 = Conveyor Backpressure (Green/Cyan -> Amber -> Crimson stall intensity)
 *   3 = Power Grid Draw & Brownout (Gold load -> Dim/Flicker shed)
 */

export const HEATMAP_MODES = Object.freeze({
  OFF: 0,
  THERMAL: 1,
  BACKPRESSURE: 2,
  POWER: 3,
});

export const HEATMAP_PIPELINE_KEY = 'HeatmapOverlayPipeline';

// Packed 24-bit RGB constants matching SPEC palette
const RGB_FROST = 0x38BDF8;
const RGB_CYAN = 0x00F0FF;
const RGB_EMERALD = 0x10F5A0;
const RGB_SLATE = 0x121B28;
const RGB_GOLD = 0xFFB800;
const RGB_CRIMSON = 0xFF3B5C;
const RGB_SHED_DIM = 0x3E111B;

function lerpRgb(c0, c1, t) {
  const f = Math.max(0, Math.min(1, t));
  const r0 = (c0 >> 16) & 0xFF;
  const g0 = (c0 >> 8) & 0xFF;
  const b0 = c0 & 0xFF;
  const r1 = (c1 >> 16) & 0xFF;
  const g1 = (c1 >> 8) & 0xFF;
  const b1 = c1 & 0xFF;
  const r = Math.round(r0 + (r1 - r0) * f);
  const g = Math.round(g0 + (g1 - g0) * f);
  const b = Math.round(b0 + (b1 - b0) * f);
  return (r << 16) | (g << 8) | b;
}

/**
 * Computes crisp per-tile tint & alpha for the active diagnostic heatmap mode.
 * @param {number} mode 0..3
 * @param {{ machineType: number, tempKelvin: number, scramActive: number, backpressureTicks: number, powerRatio: number, ln2Mask: number, powerMask: number }} cell
 * @param {number} timeSec
 * @returns {{ visible: boolean, tint: number, alpha: number }}
 */
export function computeTileHeatmapStyle(mode, cell, timeSec = 0) {
  if (!mode) {
    return { visible: false, tint: RGB_SLATE, alpha: 0 };
  }

  const machineType = cell.machineType | 0;

  if (mode === HEATMAP_MODES.THERMAL) {
    const temp = Number.isFinite(cell.tempKelvin) ? cell.tempKelvin : 295;
    const scram = cell.scramActive ? 1 : 0;

    if (scram || temp >= 390) {
      const pulse = 0.65 + 0.25 * Math.sin(timeSec * 8.0);
      return { visible: true, tint: RGB_CRIMSON, alpha: pulse };
    }
    if (temp < 285) {
      // 77K Frost Blue -> 285K Slate-Frost
      const t = Math.max(0, Math.min(1, (temp - 77) / (285 - 77)));
      const tint = lerpRgb(RGB_FROST, 0x1B3954, t);
      const alpha = 0.72 - t * 0.42;
      return { visible: true, tint, alpha };
    }
    if (temp <= 305) {
      // 285K..305K Ambient Cleanroom Slate
      const t = (temp - 285) / 20;
      return {
        visible: true,
        tint: lerpRgb(0x1B3954, RGB_SLATE, t),
        alpha: 0.22,
      };
    }
    if (temp <= 335) {
      // 305K Slate -> 335K Gold
      const t = (temp - 305) / 30;
      return {
        visible: true,
        tint: lerpRgb(RGB_SLATE, RGB_GOLD, t),
        alpha: 0.26 + t * 0.34,
      };
    }
    // 335K Gold -> 390K Crimson
    const t = Math.max(0, Math.min(1, (temp - 335) / 55));
    return {
      visible: true,
      tint: lerpRgb(RGB_GOLD, RGB_CRIMSON, t),
      alpha: 0.58 + t * 0.22,
    };
  }

  if (mode === HEATMAP_MODES.BACKPRESSURE) {
    // Show belts (2..5) and processing machines (6..12, 16)
    const isFlowCell = (machineType >= 2 && machineType <= 12) || machineType === 16;
    if (!isFlowCell) {
      return { visible: false, tint: RGB_SLATE, alpha: 0 };
    }
    const ticks = cell.backpressureTicks || 0;
    if (ticks <= 0) {
      return { visible: true, tint: RGB_EMERALD, alpha: 0.28 };
    }
    if (ticks < 10) {
      const t = ticks / 10;
      return {
        visible: true,
        tint: lerpRgb(RGB_CYAN, RGB_GOLD, t),
        alpha: 0.38 + t * 0.25,
      };
    }
    const t = Math.min(1, (ticks - 10) / 18);
    const pulse = ticks >= 20 ? 0.08 * Math.sin(timeSec * 7.0) : 0;
    return {
      visible: true,
      tint: lerpRgb(RGB_GOLD, RGB_CRIMSON, t),
      alpha: Math.min(0.88, 0.63 + t * 0.18 + pulse),
    };
  }

  if (mode === HEATMAP_MODES.POWER) {
    const hasBusbar = (cell.powerMask & 0x10) !== 0;
    const isPoweredTool = machineType >= 2;
    if (!isPoweredTool && !hasBusbar) {
      return { visible: false, tint: RGB_SLATE, alpha: 0 };
    }
    // Generators / Capacitor banks glow Cyan-Gold
    if (machineType === 14 || machineType === 15) {
      return { visible: true, tint: RGB_CYAN, alpha: 0.56 };
    }
    if (machineType === 0 && hasBusbar) {
      return { visible: true, tint: RGB_GOLD, alpha: 0.26 };
    }
    const ratio = Number.isFinite(cell.powerRatio) ? cell.powerRatio : 1;
    if (ratio >= 0.99) {
      // High-load tools shine hotter gold than light belts
      const isHeavy = machineType === 8 || machineType === 9 || machineType === 17;
      return { visible: true, tint: RGB_GOLD, alpha: isHeavy ? 0.62 : 0.38 };
    }
    // Brownout / Load Shedding flicker!
    const flicker = Math.sin(timeSec * 22.0 + (cell.gx || 0) * 1.7 + (cell.gy || 0) * 2.3);
    if (ratio <= 0.05) {
      return {
        visible: true,
        tint: flicker > 0.2 ? RGB_CRIMSON : RGB_SHED_DIM,
        alpha: flicker > 0.2 ? 0.72 : 0.45,
      };
    }
    return {
      visible: true,
      tint: lerpRgb(RGB_CRIMSON, RGB_GOLD, ratio),
      alpha: 0.42 + (flicker > 0 ? 0.2 : 0),
    };
  }

  return { visible: false, tint: RGB_SLATE, alpha: 0 };
}

const HEATMAP_OVERLAY_FRAG = `
#define SHADER_NAME CLEANROOM_HEATMAP_FS
precision mediump float;

uniform sampler2D uMainSampler;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMode;
uniform float uAlert;

varying vec2 outTexCoord;

void main() {
    vec4 texel = texture2D(uMainSampler, outTexCoord);
    if (texel.a <= 0.004 || uMode < 0.5) {
        gl_FragColor = texel;
        return;
    }

    vec2 res = max(uResolution, vec2(1.0));
    vec2 px = outTexCoord * res;

    // Crisp isometric holographic scanlines & contour interference
    float scan = 0.88 + 0.12 * sin(px.y * 0.85 - uTime * 4.5);
    float diagSweep = 0.92 + 0.08 * sin((px.x + px.y * 2.0) * 0.06 - uTime * 2.4);

    vec3 outRgb = texel.rgb * scan * diagSweep;
    float outA = texel.a;

    // Mode 1: Thermal heat shimmer boost on high-kelvin crimson/gold cells
    if (uMode < 1.5) {
        float heat = clamp((texel.r - texel.b) * 1.2, 0.0, 1.0);
        float pulse = 1.0 + heat * (0.14 * sin(uTime * 6.0) + 0.14);
        outRgb *= pulse;
    }
    // Mode 2: Backpressure flow-pulse along stalled red/amber conveyors
    else if (uMode < 2.5) {
        float stall = clamp(texel.r * 1.15 - texel.g * 0.45, 0.0, 1.0);
        outRgb += vec3(0.22, 0.04, 0.08) * texel.a * stall * (0.5 + 0.5 * sin(uTime * 7.5));
    }
    // Mode 3: Power brownout electrical strobe
    else {
        float strobe = 0.90 + 0.10 * sin(uTime * 19.0 + px.x * 0.04);
        outRgb *= mix(1.0, strobe, clamp(0.35 + uAlert * 0.65, 0.0, 1.0));
    }

    gl_FragColor = vec4(min(outRgb, vec3(outA)), outA);
}
`;

let cachedHeatmapPipelineClass = null;

export function getHeatmapOverlayPipelineClass() {
  if (cachedHeatmapPipelineClass) return cachedHeatmapPipelineClass;
  const Phaser = globalThis.Phaser;
  const PostFXPipeline = Phaser?.Renderer?.WebGL?.Pipelines?.PostFXPipeline;
  if (!PostFXPipeline) return null;

  class HeatmapOverlayPipeline extends PostFXPipeline {
    constructor(game) {
      super({
        game,
        name: HEATMAP_PIPELINE_KEY,
        fragShader: HEATMAP_OVERLAY_FRAG,
      });
      this.mode = HEATMAP_MODES.OFF;
      this.alertIntensity = 0;
    }

    onDraw(renderTarget) {
      const timeSec = (this.game?.loop?.time || 0) * 0.001;
      const w = renderTarget?.width || this.renderer?.width || 1280;
      const h = renderTarget?.height || this.renderer?.height || 720;

      this.set1f('uTime', timeSec);
      this.set1f('uMode', this.mode);
      this.set1f('uAlert', this.alertIntensity);
      this.set2f('uResolution', w, h);
      this.bindAndDraw(renderTarget);
    }
  }

  cachedHeatmapPipelineClass = HeatmapOverlayPipeline;
  return cachedHeatmapPipelineClass;
}

export function registerHeatmapOverlayPipeline(scene) {
  const Phaser = globalThis.Phaser;
  if (!Phaser?.Renderer?.WebGL?.Pipelines?.PostFXPipeline) return false;
  const renderer = scene?.sys?.renderer || scene?.game?.renderer;
  if (!renderer || renderer.type !== Phaser.WEBGL || !renderer.pipelines) {
    return false;
  }

  const PipelineClass = getHeatmapOverlayPipelineClass();
  if (!PipelineClass) return false;

  if (!renderer.pipelines.postPipelineClasses?.has(HEATMAP_PIPELINE_KEY)) {
    renderer.pipelines.addPostPipeline(HEATMAP_PIPELINE_KEY, PipelineClass);
  }
  return true;
}

export function attachHeatmapOverlayPipeline(target, scene) {
  if (!target || typeof target.setPostPipeline !== 'function') return null;
  if (!registerHeatmapOverlayPipeline(scene)) return null;
  target.setPostPipeline(HEATMAP_PIPELINE_KEY);
  const inst = target.getPostPipeline?.(HEATMAP_PIPELINE_KEY);
  return Array.isArray(inst) ? inst[0] : inst;
}
