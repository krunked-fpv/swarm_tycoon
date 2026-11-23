/**
 * Thin-Film Silicon Wafer Diffraction & Iridescence PostFX Pipeline
 * Applies real-time optical grating shimmer across #00F0FF cyan & #FFB800 gold highlights
 * on WebGL targets, with a clean no-op guard for Canvas2D or headless Node environments.
 */

export const WAFER_IRIDESCENCE_KEY = 'WaferIridescencePipeline';

const WAFER_IRIDESCENCE_FRAG = `
#define SHADER_NAME WAFER_IRIDESCENCE_FS
precision mediump float;

uniform sampler2D uMainSampler;
uniform vec2 uResolution;
uniform float uTime;
uniform float uIntensity;

varying vec2 outTexCoord;

void main() {
    vec4 texel = texture2D(uMainSampler, outTexCoord);
    if (texel.a <= 0.005) {
        gl_FragColor = vec4(0.0);
        return;
    }

    vec2 res = max(uResolution, vec2(1.0));
    vec2 px = outTexCoord * res;

    // Fine silicon wafer grating interference + slow diagonal reticle reflection sweep
    float grating = sin(px.x * 0.48 + px.y * 0.24 - uTime * 3.4) * 0.5 + 0.5;
    float sweep = sin((px.x * 0.055 - px.y * 0.095) + uTime * 2.1) * 0.5 + 0.5;
    float harmonic = sin(px.x * 0.19 - px.y * 0.31 + uTime * 1.6) * 0.5 + 0.5;
    float phase = grating * 0.55 + sweep * 0.30 + harmonic * 0.15;

    // Signature palette: Silicon Cyan (#00F0FF), Cryo Frost (#38BDF8), Neon Gold (#FFB800)
    vec3 cyan = vec3(0.0, 0.941, 1.0);
    vec3 frost = vec3(0.220, 0.741, 0.973);
    vec3 gold = vec3(1.0, 0.722, 0.0);

    vec3 irid = mix(cyan, gold, smoothstep(0.28, 0.82, phase));
    irid = mix(irid, frost, 0.24 * harmonic);

    // Mask out red defect sparks so faulty dies stay crisply alert-crimson
    float luma = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
    float defectBias = clamp((texel.r - texel.b) * 1.45, 0.0, 1.0);
    float sheenMask = smoothstep(0.16, 0.92, luma) * (1.0 - defectBias * 0.7);

    float strength = clamp(uIntensity, 0.0, 1.5) * (0.26 + 0.24 * sweep);
    vec3 outRgb = texel.rgb + irid * texel.a * sheenMask * strength;
    gl_FragColor = vec4(min(outRgb, vec3(texel.a)), texel.a);
}
`;

let cachedPipelineClass = null;

/**
 * Checks whether Phaser WebGL PostFX pipelines are active on the scene renderer.
 */
export function isWebGLPostFXSupported(scene) {
  const Phaser = globalThis.Phaser;
  if (!Phaser?.Renderer?.WebGL?.Pipelines?.PostFXPipeline) return false;
  const renderer = scene?.sys?.renderer || scene?.game?.renderer;
  if (!renderer) return false;
  return renderer.type === Phaser.WEBGL && Boolean(renderer.pipelines);
}

/**
 * Dynamically builds (and caches) the Phaser WebGL PostFXPipeline subclass.
 * Returns null safely in Node or Canvas2D environments.
 */
export function getWaferIridescencePipelineClass() {
  if (cachedPipelineClass) return cachedPipelineClass;
  const Phaser = globalThis.Phaser;
  const PostFXPipeline = Phaser?.Renderer?.WebGL?.Pipelines?.PostFXPipeline;
  if (!PostFXPipeline) return null;

  class WaferIridescencePipeline extends PostFXPipeline {
    constructor(game) {
      super({
        game,
        name: WAFER_IRIDESCENCE_KEY,
        fragShader: WAFER_IRIDESCENCE_FRAG,
      });
      this.intensity = 0.85;
      this.timeOffset = 0;
    }

    onDraw(renderTarget) {
      const loopTimeSec = ((this.game?.loop?.time || 0) * 0.001) + this.timeOffset;
      const w = renderTarget?.width || this.renderer?.width || 1280;
      const h = renderTarget?.height || this.renderer?.height || 720;

      this.set1f('uTime', loopTimeSec);
      this.set1f('uIntensity', this.intensity);
      this.set2f('uResolution', w, h);
      this.bindAndDraw(renderTarget);
    }
  }

  cachedPipelineClass = WaferIridescencePipeline;
  return cachedPipelineClass;
}

/**
 * Registers the PostFXPipeline with Phaser's pipeline manager when WebGL is active.
 * Safe no-op in Canvas2D fallback.
 */
export function registerWaferIridescencePipeline(scene) {
  if (!isWebGLPostFXSupported(scene)) return false;
  const PipelineClass = getWaferIridescencePipelineClass();
  if (!PipelineClass) return false;

  const pipelines = scene.sys.renderer.pipelines;
  if (!pipelines.postPipelineClasses?.has(WAFER_IRIDESCENCE_KEY)) {
    pipelines.addPostPipeline(WAFER_IRIDESCENCE_KEY, PipelineClass);
  }
  return true;
}

/**
 * Attaches WaferIridescencePipeline to a Phaser Layer or Sprite when WebGL is active.
 * Returns true if attached, false if Canvas2D fallback (no-op).
 */
export function attachWaferIridescence(target, scene) {
  if (!target || typeof target.setPostPipeline !== 'function') return false;
  if (!registerWaferIridescencePipeline(scene)) return false;
  target.setPostPipeline(WAFER_IRIDESCENCE_KEY);
  return true;
}
