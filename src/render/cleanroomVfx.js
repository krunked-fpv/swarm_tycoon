/**
 * Object-Pooled Cleanroom VFX Engine
 * Zero per-frame allocations via pre-allocated sprite pools + TypedArray physics buffers.
 */

const MAX_PARTICLES = 360;
const MAX_RINGS = 24;

const TINT_CYAN = 0x00F0FF;
const TINT_FROST = 0x38BDF8;
const TINT_GOLD = 0xFFB800;
const TINT_CRIMSON = 0xFF3B5C;
const TINT_EMERALD = 0x10F5A0;

export class CleanroomVfxPool {
  constructor(scene, layer) {
    this.scene = scene;
    this.layer = layer;

    this._sprites = new Array(MAX_PARTICLES);
    this._x = new Float32Array(MAX_PARTICLES);
    this._y = new Float32Array(MAX_PARTICLES);
    this._vx = new Float32Array(MAX_PARTICLES);
    this._vy = new Float32Array(MAX_PARTICLES);
    this._ay = new Float32Array(MAX_PARTICLES);
    this._rot = new Float32Array(MAX_PARTICLES);
    this._vRot = new Float32Array(MAX_PARTICLES);
    this._drag = new Float32Array(MAX_PARTICLES);
    this._life = new Float32Array(MAX_PARTICLES);
    this._maxLife = new Float32Array(MAX_PARTICLES);
    this._scale0 = new Float32Array(MAX_PARTICLES);
    this._scale1 = new Float32Array(MAX_PARTICLES);
    this._alpha0 = new Float32Array(MAX_PARTICLES);
    this._active = new Uint8Array(MAX_PARTICLES);
    this._freeStack = new Int16Array(MAX_PARTICLES);
    this._freeTop = 0;

    this._ringSprites = new Array(MAX_RINGS);
    this._ringLife = new Float32Array(MAX_RINGS);
    this._ringMaxLife = new Float32Array(MAX_RINGS);
    this._ringScale0 = new Float32Array(MAX_RINGS);
    this._ringScale1 = new Float32Array(MAX_RINGS);
    this._ringAlpha0 = new Float32Array(MAX_RINGS);
    this._ringActive = new Uint8Array(MAX_RINGS);
    this._ringFreeStack = new Int16Array(MAX_RINGS);
    this._ringFreeTop = 0;

    this._rngState = 0x13579BDF;
    this._initPools();
  }

  _rand() {
    let x = this._rngState | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this._rngState = x;
    return ((x >>> 0) & 0xFFFFFF) / 0x1000000;
  }

  _initPools() {
    const scene = this.scene;
    const layer = this.layer;
    const Phaser = globalThis.Phaser;
    const addBlend = Phaser?.BlendModes?.ADD ?? 1;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const sp = scene.add.image(0, 0, 'vfx_puff');
      sp.setVisible(false);
      sp.setActive(false);
      sp.setBlendMode(addBlend);
      if (layer) layer.add(sp);
      this._sprites[i] = sp;
      this._freeStack[this._freeTop++] = MAX_PARTICLES - 1 - i;
    }

    for (let i = 0; i < MAX_RINGS; i++) {
      const ring = scene.add.image(0, 0, 'vfx_ring');
      ring.setVisible(false);
      ring.setActive(false);
      ring.setBlendMode(addBlend);
      if (layer) layer.add(ring);
      this._ringSprites[i] = ring;
      this._ringFreeStack[this._ringFreeTop++] = MAX_RINGS - 1 - i;
    }
  }

  _emitParticle(texKey, x, y, vx, vy, drag, maxLife, scale0, scale1, alpha0, tint, ay = 0, rot0 = 0, vRot = 0) {
    if (this._freeTop <= 0) return;
    const idx = this._freeStack[--this._freeTop];
    const sp = this._sprites[idx];

    if (sp.texture?.key !== texKey) {
      sp.setTexture(texKey);
    }
    sp.setPosition(x, y);
    sp.setScale(scale0);
    sp.setAlpha(alpha0);
    sp.setTint(tint);
    sp.setRotation?.(rot0);
    sp.setVisible(true);
    sp.setActive(true);

    this._x[idx] = x;
    this._y[idx] = y;
    this._vx[idx] = vx;
    this._vy[idx] = vy;
    this._ay[idx] = ay;
    this._rot[idx] = rot0;
    this._vRot[idx] = vRot;
    this._drag[idx] = drag;
    this._life[idx] = 0;
    this._maxLife[idx] = maxLife;
    this._scale0[idx] = scale0;
    this._scale1[idx] = scale1;
    this._alpha0[idx] = alpha0;
    this._active[idx] = 1;
  }

  _emitRing(x, y, maxLife, scale0, scale1, alpha0, tint) {
    if (this._ringFreeTop <= 0) return;
    const idx = this._ringFreeStack[--this._ringFreeTop];
    const ring = this._ringSprites[idx];

    ring.setPosition(x, y);
    ring.setScale(scale0);
    ring.setAlpha(alpha0);
    ring.setTint(tint);
    ring.setVisible(true);
    ring.setActive(true);

    this._ringLife[idx] = 0;
    this._ringMaxLife[idx] = maxLife;
    this._ringScale0[idx] = scale0;
    this._ringScale1[idx] = scale1;
    this._ringAlpha0[idx] = alpha0;
    this._ringActive[idx] = 1;
  }

  /**
   * High-Energy Neon-Gold (#FFB800) EUV lithography laser pulse.
   */
  spawnEuvFlash(wx, wy) {
    this._emitParticle('vfx_laser', wx, wy - 20, 0, 2, 0.9, 0.22, 0.85, 0.35, 0.95, TINT_GOLD);
    this._emitRing(wx, wy - 6, 0.32, 0.22, 0.72, 0.85, TINT_GOLD);
    for (let i = 0; i < 3; i++) {
      const ang = this._rand() * Math.PI * 2;
      const spd = 22 + this._rand() * 28;
      this._emitParticle(
        'vfx_spark',
        wx,
        wy - 12,
        Math.cos(ang) * spd,
        Math.sin(ang) * spd * 0.5 - 12,
        0.92,
        0.28,
        0.55,
        0.1,
        0.9,
        i === 0 ? TINT_CYAN : TINT_GOLD
      );
    }
  }

  /**
   * Cryo Frost (#38BDF8) LN2 vapor plume drifting from chillers/cryo conduits.
   */
  spawnCryoVapor(wx, wy) {
    const ox = (this._rand() - 0.5) * 16;
    const oy = (this._rand() - 0.5) * 8 - 10;
    const vx = (this._rand() - 0.5) * 10;
    const vy = -14 - this._rand() * 14;
    this._emitParticle('vfx_puff', wx + ox, wy + oy, vx, vy, 0.96, 0.85, 0.32, 1.05, 0.42, TINT_FROST);
  }

  /**
   * Defective wafer / thermal scram arc spark burst (#FF3B5C & #FFB800).
   */
  spawnDefectSpark(wx, wy) {
    this._emitRing(wx, wy - 6, 0.36, 0.18, 0.68, 0.8, TINT_CRIMSON);
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + this._rand() * 0.4;
      const spd = 30 + this._rand() * 38;
      this._emitParticle(
        'vfx_spark',
        wx,
        wy - 10,
        Math.cos(ang) * spd,
        Math.sin(ang) * spd * 0.55 - 16,
        0.9,
        0.38,
        0.65,
        0.08,
        0.95,
        i % 3 === 0 ? TINT_GOLD : TINT_CRIMSON
      );
    }
  }

  /**
   * Prestige Architecture Rewrite shockwave pulse radiating from cleanroom center.
   */
  triggerPrestigeVfx(wx, wy) {
    this._emitRing(wx, wy, 0.95, 0.4, 9.5, 0.95, TINT_CYAN);
    this._emitRing(wx, wy, 0.80, 0.3, 6.8, 0.90, TINT_GOLD);
    this._emitRing(wx, wy, 1.15, 0.5, 11.5, 0.75, TINT_FROST);

    for (let i = 0; i < 28; i++) {
      const ang = (i / 28) * Math.PI * 2 + (this._rand() - 0.5) * 0.12;
      const spd = 75 + this._rand() * 140;
      const tint = i % 3 === 0 ? TINT_GOLD : i % 2 === 0 ? TINT_CYAN : TINT_FROST;
      this._emitParticle(
        'vfx_spark',
        wx,
        wy - 8,
        Math.cos(ang) * spd,
        Math.sin(ang) * spd * 0.5 - 18,
        0.95,
        0.85,
        1.1,
        0.15,
        0.95,
        tint
      );
    }
  }

  /**
   * Snappy expanding cyan ring + 8 crisp cyan/gold sparks when a tile/machine/pipe is placed.
   */
  spawnPlacementBurst(wx, wy) {
    this._emitRing(wx, wy - 4, 0.28, 0.2, 0.9, 0.9, TINT_CYAN);
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + (this._rand() - 0.5) * 0.22;
      const spd = 34 + this._rand() * 34;
      this._emitParticle(
        'vfx_spark',
        wx,
        wy - 8,
        Math.cos(ang) * spd,
        Math.sin(ang) * spd * 0.52 - 14,
        0.9,
        0.28 + this._rand() * 0.08,
        0.62,
        0.08,
        0.95,
        i % 3 === 0 ? TINT_GOLD : TINT_CYAN,
        35
      );
    }
  }

  /**
   * Bright golden flare star + 4 upward confetti shards when a finished wafer enters WAFER_VAULT.
   */
  spawnVaultJackpot(wx, wy) {
    this._emitParticle(
      'vfx_star',
      wx,
      wy - 28,
      0,
      -12,
      0.92,
      0.46,
      1.3,
      0.18,
      1.0,
      TINT_GOLD,
      0,
      0,
      2.6
    );
    for (let i = 0; i < 4; i++) {
      const vx = (this._rand() - 0.5) * 72;
      const vy = -68 - this._rand() * 48;
      this._emitParticle(
        'vfx_confetti',
        wx + (this._rand() - 0.5) * 10,
        wy - 20,
        vx,
        vy,
        0.965,
        0.72 + this._rand() * 0.22,
        0.85,
        0.3,
        0.98,
        i % 2 === 0 ? TINT_GOLD : TINT_CYAN,
        185,
        this._rand() * Math.PI * 2,
        (this._rand() - 0.5) * 10
      );
    }
  }

  /**
   * Exuberant celebration shockwave + 3 vertical light pillars + 64-96 arcing confetti & star particles.
   */
  triggerCelebrationVfx(wx, wy, intensity = 1) {
    const k = Math.max(0.5, Math.min(2.0, Number.isFinite(Number(intensity)) ? Number(intensity) : 1));
    const ringScale = 0.8 + 0.25 * k;

    this._emitRing(wx, wy, 0.90, 0.35, 8.0 * ringScale, 0.96, TINT_CYAN);
    this._emitRing(wx, wy, 0.75, 0.28, 6.2 * ringScale, 0.92, TINT_GOLD);
    this._emitRing(wx, wy, 1.15, 0.45, 10.5 * ringScale, 0.80, TINT_FROST);

    // 3 vertical light beam pillars
    this._emitParticle('vfx_beam', wx, wy - 44, 0, -18, 0.96, 0.95, 1.45 * k, 0.4, 0.95, TINT_GOLD, 0, 0, 0);
    this._emitParticle('vfx_beam', wx - 56, wy - 28, -6, -14, 0.96, 0.85, 1.15 * k, 0.32, 0.86, TINT_CYAN, 0, 0, 0);
    this._emitParticle('vfx_beam', wx + 56, wy - 28, 6, -14, 0.96, 0.85, 1.15 * k, 0.32, 0.86, TINT_FROST, 0, 0, 0);

    // 64..96 arcing confetti shards & star flares radiating across the cleanroom
    const count = Math.round(64 + 32 * ((k - 0.5) / 1.5));
    for (let i = 0; i < count; i++) {
      const isStar = (i & 3) === 0;
      const texKey = isStar ? 'vfx_star' : 'vfx_confetti';
      const ang = (i / count) * Math.PI * 2 + (this._rand() - 0.5) * 0.28;
      const spd = (55 + this._rand() * 145) * (0.85 + 0.25 * k);
      const vx = Math.cos(ang) * spd;
      const vy = Math.sin(ang) * spd * 0.42 - (95 + this._rand() * 125);
      const ay = isStar ? 140 : 210 + this._rand() * 90;
      const maxLife = (isStar ? 0.85 : 1.15) + this._rand() * 0.55;
      const tint = (i & 3) === 0 ? TINT_GOLD : (i & 3) === 1 ? TINT_CYAN : (i & 3) === 2 ? TINT_FROST : TINT_EMERALD;
      const scale0 = isStar ? 0.85 + this._rand() * 0.45 : 0.95 + this._rand() * 0.45;
      const scale1 = isStar ? 0.14 : 0.35;

      this._emitParticle(
        texKey,
        wx + (this._rand() - 0.5) * 24,
        wy - 10 + (this._rand() - 0.5) * 12,
        vx,
        vy,
        0.975,
        maxLife,
        scale0,
        scale1,
        0.98,
        tint,
        ay,
        this._rand() * Math.PI * 2,
        (this._rand() - 0.5) * 9
      );
    }
  }

  update(dtSec) {
    const dt = Math.min(0.05, Math.max(0, dtSec));
    if (dt <= 0) return;

    const dragPow = dt * 60;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this._active[i] === 0) continue;

      const life = this._life[i] + dt;
      const maxLife = this._maxLife[i];
      if (life >= maxLife) {
        this._active[i] = 0;
        const sp = this._sprites[i];
        sp.setVisible(false);
        sp.setActive(false);
        this._freeStack[this._freeTop++] = i;
        continue;
      }

      this._life[i] = life;
      const t = life / maxLife;
      const damp = Math.pow(this._drag[i], dragPow);
      const vx = this._vx[i] * damp;
      const vy = (this._vy[i] + this._ay[i] * dt) * damp;
      this._vx[i] = vx;
      this._vy[i] = vy;

      const x = this._x[i] + vx * dt;
      const y = this._y[i] + vy * dt;
      this._x[i] = x;
      this._y[i] = y;

      const sp = this._sprites[i];
      sp.setPosition(x, y);
      if (this._vRot[i] !== 0) {
        const rot = this._rot[i] + this._vRot[i] * dt;
        this._rot[i] = rot;
        sp.setRotation?.(rot);
      }
      sp.setScale(this._scale0[i] + (this._scale1[i] - this._scale0[i]) * t);
      sp.setAlpha(this._alpha0[i] * (1 - t));
    }

    for (let i = 0; i < MAX_RINGS; i++) {
      if (this._ringActive[i] === 0) continue;

      const life = this._ringLife[i] + dt;
      const maxLife = this._ringMaxLife[i];
      if (life >= maxLife) {
        this._ringActive[i] = 0;
        const ring = this._ringSprites[i];
        ring.setVisible(false);
        ring.setActive(false);
        this._ringFreeStack[this._ringFreeTop++] = i;
        continue;
      }

      this._ringLife[i] = life;
      const t = life / maxLife;
      const easeOut = 1 - (1 - t) * (1 - t);
      const ring = this._ringSprites[i];
      ring.setScale(this._ringScale0[i] + (this._ringScale1[i] - this._ringScale0[i]) * easeOut);
      ring.setAlpha(this._ringAlpha0[i] * (1 - t));
    }
  }

  destroy() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this._sprites[i]?.destroy();
      this._sprites[i] = null;
    }
    for (let i = 0; i < MAX_RINGS; i++) {
      this._ringSprites[i]?.destroy();
      this._ringSprites[i] = null;
    }
  }
}
