/**
 * Swarm Tycoon: Silicon Foundry — Secret Cleanroom Laser Defense Minigame.
 * 30-second kid-friendly EUV laser party defending the central Wafer Core
 * against dust particles, rogue paperclips, cryo frost orbs, and golden EUV reticles.
 *
 * Pure ES Module: zero DOM, Phaser, storage, or Node-runtime dependencies.
 */

import { bsFrom, bsMul, bsZero } from '../economy/bigSilicon.js';
import { getTierSpec } from '../economy/scaleTiers.js';

export const MINIGAME_WIDTH = 640;
export const MINIGAME_HEIGHT = 400;
export const ROUND_DURATION_SEC = 30;
export const WAFER_CORE = Object.freeze({ x: 320, y: 355 });

const EMITTER_ORIGIN = Object.freeze({ x: 320, y: 382 });
const BLAST_RADIUS = 58;
const CORE_HIT_RADIUS = 22;
const MAX_ACTIVE_TARGETS = 18;
const MAX_COMBO_MULT = 12;
const FEVER_COMBO_THRESHOLD = 5;
const CRYO_FREEZE_DURATION_SEC = 4.0;
const CRYO_SLOW_FACTOR = 0.45;

const TARGET_SPECS = Object.freeze({
  dust: Object.freeze({
    kind: 'dust',
    basePoints: 100,
    radius: 22,
    speedMin: 46,
    speedMax: 64,
    color: '#FF3B5C',
    amp: 0,
  }),
  clip: Object.freeze({
    kind: 'clip',
    basePoints: 180,
    radius: 24,
    speedMin: 50,
    speedMax: 68,
    color: '#A78BFA',
    amp: 58,
  }),
  cryo: Object.freeze({
    kind: 'cryo',
    basePoints: 150,
    radius: 24,
    speedMin: 42,
    speedMax: 56,
    color: '#38BDF8',
    amp: 0,
  }),
  star: Object.freeze({
    kind: 'star',
    basePoints: 450,
    radius: 26,
    speedMin: 54,
    speedMax: 72,
    color: '#FFB800',
    amp: 0,
  }),
});

function pickWeightedKind(rng) {
  const r = rng();
  if (r < 0.52) return 'dust';
  if (r < 0.78) return 'clip';
  if (r < 0.91) return 'cryo';
  return 'star';
}

export class SecretLaserGame {
  /**
   * @param {{ rng?: () => number }} [options={}]
   */
  constructor(options = {}) {
    this._rng = typeof options?.rng === 'function' ? options.rng : Math.random;
    this.reset();
  }

  _nextRand() {
    const raw = Number(this._rng());
    if (!Number.isFinite(raw)) return Math.random();
    const frac = raw - Math.floor(raw);
    return frac < 0 ? frac + 1 : frac;
  }

  /**
   * Resets all round state to a fresh 30-second laser defense party.
   */
  reset() {
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.hits = 0;
    this.misses = 0;
    this.timeLeft = ROUND_DURATION_SEC;
    this.finished = false;
    this.freezeTimer = 0;
    this.feverActive = false;
    this.shield = 100;
    this.targets = [];
    this.beams = [];
    this.bursts = [];
    this.floatingTexts = [];
    this._nextTargetId = 1;
    this._spawnTimer = 0;
  }

  /**
   * Spawns a hazard or power-up target near the top or upper sides drifting toward `WAFER_CORE`.
   * @param {'dust' | 'clip' | 'cryo' | 'star' | null} [kindOverride=null]
   */
  spawnTarget(kindOverride = null) {
    const kind =
      kindOverride && Object.prototype.hasOwnProperty.call(TARGET_SPECS, kindOverride)
        ? kindOverride
        : pickWeightedKind(() => this._nextRand());
    const spec = TARGET_SPECS[kind];

    const fromSide = this._nextRand() >= 0.76;
    let x;
    let y;
    if (fromSide) {
      const left = this._nextRand() < 0.5;
      x = left ? 28 : MINIGAME_WIDTH - 28;
      y = 40 + this._nextRand() * 130;
    } else {
      x = 48 + this._nextRand() * (MINIGAME_WIDTH - 96);
      y = 24 + this._nextRand() * 40;
    }

    const dx = WAFER_CORE.x - x;
    const dy = WAFER_CORE.y - y;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = spec.speedMin + this._nextRand() * (spec.speedMax - spec.speedMin);

    const target = {
      id: this._nextTargetId++,
      kind: spec.kind,
      x,
      y,
      vx: (dx / dist) * speed,
      vy: (dy / dist) * speed,
      radius: spec.radius,
      basePoints: spec.basePoints,
      color: spec.color,
      amp: spec.amp,
      phase: this._nextRand() * Math.PI * 2,
      age: 0,
    };

    this.targets.push(target);
    return target;
  }

  /**
   * Fires an EUV laser beam from the emitter to `(x, y)` using a kid-friendly 58px blast radius.
   * @param {number} x
   * @param {number} y
   */
  fireAt(x, y) {
    if (this.finished) {
      return {
        hitCount: 0,
        scoreDelta: 0,
        combo: this.combo,
        feverActive: this.feverActive,
        triggeredCryo: false,
        triggeredStar: false,
      };
    }

    const tx = Number.isFinite(x) ? Math.max(0, Math.min(MINIGAME_WIDTH, x)) : WAFER_CORE.x;
    const ty = Number.isFinite(y) ? Math.max(0, Math.min(MINIGAME_HEIGHT, y)) : 200;

    this.beams.push({
      x1: EMITTER_ORIGIN.x,
      y1: EMITTER_ORIGIN.y,
      x2: tx,
      y2: ty,
      ttl: 0.18,
      maxTtl: 0.18,
      color: this.feverActive ? '#FFB800' : '#00F0FF',
    });

    const blastSq = BLAST_RADIUS * BLAST_RADIUS;
    const directHits = [];
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i];
      const dx = t.x - tx;
      const dy = t.y - ty;
      if (dx * dx + dy * dy <= blastSq) {
        directHits.push(t);
      }
    }

    if (directHits.length === 0) {
      this.misses += 1;
      this.combo = 0;
      this.feverActive = false;
      this.bursts.push({
        x: tx,
        y: ty,
        radius: 18,
        ttl: 0.22,
        maxTtl: 0.22,
        color: '#64748B',
      });
      return {
        hitCount: 0,
        scoreDelta: 0,
        combo: 0,
        feverActive: false,
        triggeredCryo: false,
        triggeredStar: false,
      };
    }

    let triggeredStar = directHits.some((t) => t.kind === 'star');
    const destroyIds = new Set(directHits.map((t) => t.id));
    const orderedHits = [...directHits];

    if (triggeredStar) {
      for (let i = 0; i < this.targets.length; i++) {
        const t = this.targets[i];
        if (!destroyIds.has(t.id)) {
          destroyIds.add(t.id);
          orderedHits.push(t);
        }
      }
    }

    let triggeredCryo = false;
    let scoreDelta = 0;

    for (let i = 0; i < orderedHits.length; i++) {
      const target = orderedHits[i];
      this.hits += 1;
      this.combo += 1;
      if (this.combo > this.maxCombo) {
        this.maxCombo = this.combo;
      }
      this.feverActive = this.combo >= FEVER_COMBO_THRESHOLD;

      const comboMult = Math.min(MAX_COMBO_MULT, Math.max(1, this.combo));
      const feverMult = this.feverActive ? 2 : 1;
      const pts = target.basePoints * comboMult * feverMult;

      this.score += pts;
      scoreDelta += pts;
      this.shield = Math.min(100, this.shield + 6);

      if (target.kind === 'cryo') {
        triggeredCryo = true;
        this.freezeTimer = CRYO_FREEZE_DURATION_SEC;
      }
      if (target.kind === 'star') {
        triggeredStar = true;
      }

      this.bursts.push({
        x: target.x,
        y: target.y,
        radius: target.kind === 'star' ? 76 : 44,
        ttl: 0.35,
        maxTtl: 0.35,
        color: target.color,
      });
      this.floatingTexts.push({
        x: target.x,
        y: target.y - 8,
        text: `+${pts}${this.feverActive ? ' FEVER!' : ''}`,
        color: target.kind === 'star' ? '#FFB800' : target.kind === 'cryo' ? '#38BDF8' : '#00F0FF',
        ttl: 0.75,
        maxTtl: 0.75,
        vy: -36,
      });
    }

    if (triggeredCryo) {
      this.floatingTexts.push({
        x: WAFER_CORE.x,
        y: 120,
        text: 'CRYO FREEZE 0.45x!',
        color: '#38BDF8',
        ttl: 1.0,
        maxTtl: 1.0,
        vy: -18,
      });
    }

    if (triggeredStar) {
      this.floatingTexts.push({
        x: WAFER_CORE.x,
        y: 155,
        text: 'EUV SUPERNOVA CLEAR!',
        color: '#FFB800',
        ttl: 1.1,
        maxTtl: 1.1,
        vy: -20,
      });
    }

    this.targets = this.targets.filter((t) => !destroyIds.has(t.id));

    return {
      hitCount: orderedHits.length,
      scoreDelta,
      combo: this.combo,
      feverActive: this.feverActive,
      triggeredCryo,
      triggeredStar,
    };
  }

  _decayParticles(dt) {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      this.beams[i].ttl -= dt;
      if (this.beams[i].ttl <= 0) this.beams.splice(i, 1);
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      this.bursts[i].ttl -= dt;
      if (this.bursts[i].ttl <= 0) this.bursts.splice(i, 1);
    }
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const f = this.floatingTexts[i];
      f.ttl -= dt;
      f.y += f.vy * dt;
      if (f.ttl <= 0) this.floatingTexts.splice(i, 1);
    }
  }

  _stepSlice(dt) {
    this._decayParticles(dt);

    if (this.finished) {
      return;
    }

    const speedScale = this.freezeTimer > 0 ? CRYO_SLOW_FACTOR : 1.0;

    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.freezeTimer = Math.max(0, this.freezeTimer - dt);

    // Move active targets toward WAFER_CORE and handle gentle core impact
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i];
      t.age += dt;
      t.x += t.vx * speedScale * dt;
      t.y += t.vy * speedScale * dt;
      if (t.amp > 0) {
        t.x += Math.sin(t.age * 5.5 + t.phase) * t.amp * speedScale * dt;
        if (t.x < 22) t.x = 22;
        if (t.x > MINIGAME_WIDTH - 22) t.x = MINIGAME_WIDTH - 22;
      }

      const distToCore = Math.hypot(t.x - WAFER_CORE.x, t.y - WAFER_CORE.y);
      if (distToCore <= t.radius + CORE_HIT_RADIUS) {
        this.targets.splice(i, 1);
        // Gentle shield bounce: never ends the 30s round early
        this.shield = Math.max(10, this.shield - 8);
        this.bursts.push({
          x: WAFER_CORE.x,
          y: WAFER_CORE.y,
          radius: 36,
          ttl: 0.25,
          maxTtl: 0.25,
          color: '#FF3B5C',
        });
      }
    }

    // Auto-spawn targets (~0.65s baseline, faster during combos / fever)
    const spawnInterval = this.feverActive
      ? 0.44
      : Math.max(0.45, 0.65 - this.combo * 0.015);
    this._spawnTimer += dt;
    while (this._spawnTimer >= spawnInterval) {
      this._spawnTimer -= spawnInterval;
      if (this.targets.length < MAX_ACTIVE_TARGETS) {
        this.spawnTarget();
      }
    }

    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.finished = true;
    }
  }

  /**
   * Advances minigame physics, spawning, timers, and visual particles by `dtSec`.
   * Sub-steps large deltas safely so fixed-step test advances match real-time play.
   * @param {number} dtSec
   */
  step(dtSec) {
    const totalDt = Number.isFinite(dtSec) && dtSec > 0 ? dtSec : 0;
    if (totalDt <= 0) return;

    let rem = totalDt;
    const maxSlice = 0.1;
    while (rem > 1e-9) {
      const slice = rem > maxSlice ? maxSlice : rem;
      this._stepSlice(slice);
      rem -= slice;
    }
  }

  /**
   * Returns a read-safe snapshot of all renderable entities and scoring state.
   */
  getState() {
    return {
      width: MINIGAME_WIDTH,
      height: MINIGAME_HEIGHT,
      core: WAFER_CORE,
      score: this.score,
      combo: this.combo,
      maxCombo: this.maxCombo,
      hits: this.hits,
      misses: this.misses,
      timeLeft: this.timeLeft,
      durationSec: ROUND_DURATION_SEC,
      finished: this.finished,
      freezeTimer: this.freezeTimer,
      frozen: this.freezeTimer > 0,
      feverActive: this.feverActive,
      shield: this.shield,
      targets: this.targets.map((t) => ({ ...t })),
      beams: this.beams.map((b) => ({ ...b })),
      bursts: this.bursts.map((b) => ({ ...b })),
      floatingTexts: this.floatingTexts.map((f) => ({ ...f })),
    };
  }
}

/**
 * Computes normalized BigSilicon Dies/FLOPs rewards and medal tier from round score & fab tier.
 * @param {number} score
 * @param {number} [tier=1]
 * @returns {{ diesReward: { m: number, e: number }, flopsReward: { m: number, e: number }, medal: 'BRONZE' | 'SILVER' | 'GOLD' | 'PRISMATIC' }}
 */
export function computeMinigameReward(score, tier = 1) {
  const safeScore = Number.isFinite(score) && score > 0 ? Math.floor(score) : 0;
  const tierSpec = getTierSpec(tier);

  let medal = 'BRONZE';
  let medalMult = 1.0;
  if (safeScore >= 15000) {
    medal = 'PRISMATIC';
    medalMult = 2.2;
  } else if (safeScore >= 7000) {
    medal = 'GOLD';
    medalMult = 1.6;
  } else if (safeScore >= 2500) {
    medal = 'SILVER';
    medalMult = 1.25;
  }

  if (safeScore === 0) {
    return {
      diesReward: bsZero(),
      flopsReward: bsZero(),
      medal,
    };
  }

  const tierScale = tierSpec.tierYieldMult * Math.pow(10, tierSpec.tier - 1);
  const baseDies = Math.max(10, Math.round(safeScore * 0.1 * medalMult));
  const diesReward = bsMul(bsFrom(baseDies), bsFrom(tierScale));
  const flopsReward = bsMul(diesReward, bsFrom(tierSpec.baseFlopsPerDie));

  return {
    diesReward,
    flopsReward,
    medal,
  };
}
