/**
 * Secret Cleanroom Laser Defense Minigame Modal.
 * Wraps `SecretLaserGame` in a responsive 640x400 Canvas2D arcade cabinet
 * with scaled tap/drag-fire, 60fps animation loop, kid-friendly burst controls,
 * and BigSilicon reward claiming.
 */

import { bsFormat } from '../economy/bigSilicon.js';
import {
  MINIGAME_HEIGHT,
  MINIGAME_WIDTH,
  SecretLaserGame,
  WAFER_CORE,
  computeMinigameReward,
} from '../sim/secretMinigame.js';

function createEl(tag, className, text = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== '') el.textContent = text;
  return el;
}

function drawRoundedRect(c, x, y, w, h, r) {
  if (typeof c.roundRect === 'function') {
    c.beginPath();
    c.roundRect(x, y, w, h, r);
    return;
  }
  const rad = Math.min(r, w * 0.5, h * 0.5);
  c.beginPath();
  c.moveTo(x + rad, y);
  c.lineTo(x + w - rad, y);
  c.quadraticCurveTo(x + w, y, x + w, y + rad);
  c.lineTo(x + w, y + h - rad);
  c.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  c.lineTo(x + rad, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - rad);
  c.lineTo(x, y + rad);
  c.quadraticCurveTo(x, y, x + rad, y);
  c.closePath();
}

export function createSecretMinigameModal({ modalEl, callbacks }) {
  modalEl.replaceChildren();

  const game = new SecretLaserGame();
  let isModalOpen = false;
  let rafId = 0;
  let lastFrameMs = 0;
  let activeTier = 1;
  let bestScore = 0;
  let rewardClaimed = false;
  let isPointerDown = false;
  let lastDragShotMs = 0;
  let lastShotX = WAFER_CORE.x;
  let lastShotY = 200;
  let coreAngle = 0;

  const card = createEl('div', 'modal-card secret-modal-card');
  const header = createEl('div', 'modal-header');
  const titleWrap = createEl('div', 'secret-title-wrap');
  const title = createEl('h2', 'modal-title', '★ EUV Laser Arcade: Wafer Core Defense');
  title.id = 'secret-modal-title';
  const subtitle = createEl(
    'span',
    'choice-summary',
    'Tap or swipe targets before they smudge the 300mm core · Chain 5+ hits for 2× FEVER!'
  );
  titleWrap.append(title, subtitle);

  const closeBtn = createEl('button', 'modal-close-btn', '×');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close Laser Arcade');
  header.append(titleWrap, closeBtn);

  const body = createEl('div', 'modal-body secret-modal-body');

  // Compact HUD pills above canvas
  const hudRow = createEl('div', 'secret-hud-row');
  function makePill(label, cls = '') {
    const box = createEl('div', `secret-stat-pill ${cls}`.trim());
    box.appendChild(createEl('span', 'metric-label', label));
    const val = createEl('span', 'metric-val num', '0');
    box.appendChild(val);
    hudRow.appendChild(box);
    return val;
  }

  const scoreVal = makePill('Score', 'is-cyan');
  const comboVal = makePill('Combo', 'is-gold');
  const timeVal = makePill('Timer', 'is-frost');
  const bestVal = makePill('Best', 'is-emerald');
  const rewardPreviewVal = makePill('Reward Preview');
  body.appendChild(hudRow);

  // Responsive Canvas Container
  const canvasWrap = createEl('div', 'secret-canvas-wrap');
  const canvas = document.createElement('canvas');
  canvas.id = 'secret-laser-canvas';
  canvas.width = MINIGAME_WIDTH;
  canvas.height = MINIGAME_HEIGHT;
  canvas.setAttribute('aria-label', 'Photolithography Laser Defense Arena');
  canvasWrap.appendChild(canvas);
  body.appendChild(canvasWrap);

  const ctx = canvas.getContext('2d');

  // Footer Action Bar
  const footer = createEl('div', 'rewrite-footer secret-controls-bar');
  const burstBtn = createEl('button', 'btn-secondary', '⚡ Fire Center Burst');
  burstBtn.type = 'button';
  burstBtn.id = 'btn-secret-burst';

  const replayBtn = createEl('button', 'btn-secondary', 'Play Again');
  replayBtn.type = 'button';
  replayBtn.id = 'btn-secret-replay';

  const claimBtn = createEl('button', 'btn-primary', 'Claim Reward & Close');
  claimBtn.type = 'button';
  claimBtn.id = 'btn-secret-claim';

  const actionGroup = createEl('div', 'secret-action-group');
  actionGroup.append(burstBtn, replayBtn, claimBtn);
  footer.append(actionGroup);

  card.append(header, body, footer);
  modalEl.appendChild(card);

  function mapPointerToCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return { x: WAFER_CORE.x, y: 200 };
    }
    const x = ((e.clientX - rect.left) * MINIGAME_WIDTH) / rect.width;
    const y = ((e.clientY - rect.top) * MINIGAME_HEIGHT) / rect.height;
    return {
      x: Math.max(0, Math.min(MINIGAME_WIDTH, x)),
      y: Math.max(0, Math.min(MINIGAME_HEIGHT, y)),
    };
  }

  function fireShot(x, y) {
    if (game.finished) return null;
    lastShotX = x;
    lastShotY = y;
    const res = game.fireAt(x, y);
    if (res && res.hitCount > 0) {
      callbacks.onLaserHit?.(res);
    }
    syncHud();
    return res;
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    isPointerDown = true;
    try {
      canvas.setPointerCapture?.(e.pointerId);
    } catch {
      // Ignore synthetic event capture errors
    }
    const pt = mapPointerToCanvas(e);
    lastDragShotMs = performance.now();
    fireShot(pt.x, pt.y);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!isPointerDown || game.finished) return;
    const now = performance.now();
    if (now - lastDragShotMs < 110) return;
    const pt = mapPointerToCanvas(e);
    const nearTarget = game.targets.some((t) => Math.hypot(t.x - pt.x, t.y - pt.y) <= 58);
    const movedFar = Math.hypot(pt.x - lastShotX, pt.y - lastShotY) >= 56;
    if (nearTarget || movedFar) {
      lastDragShotMs = now;
      fireShot(pt.x, pt.y);
    }
  });

  const endPointer = () => {
    isPointerDown = false;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  burstBtn.addEventListener('click', () => {
    if (game.finished) return;
    // Aim toward target closest to center-core or default center burst
    if (game.targets.length > 0) {
      let best = game.targets[0];
      let bestDist = Infinity;
      for (const t of game.targets) {
        const d = Math.hypot(t.x - WAFER_CORE.x, t.y - 230);
        if (d < bestDist) {
          bestDist = d;
          best = t;
        }
      }
      fireShot(best.x, best.y);
    } else {
      fireShot(WAFER_CORE.x, 200);
    }
  });

  replayBtn.addEventListener('click', () => {
    resetRound();
    callbacks.onReplay?.();
  });

  function claimAndClose() {
    if (!isModalOpen) return;
    if (!rewardClaimed && game.score > 0) {
      rewardClaimed = true;
      const reward = computeMinigameReward(game.score, activeTier);
      callbacks.onClaimReward?.({ score: game.score, reward });
    } else {
      callbacks.onClose?.();
    }
    isModalOpen = false;
    isPointerDown = false;
    modalEl.hidden = true;
    stopLoop();
  }

  claimBtn.addEventListener('click', claimAndClose);
  closeBtn.addEventListener('click', claimAndClose);
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) claimAndClose();
  });

  function resetRound() {
    game.reset();
    rewardClaimed = false;
    lastShotX = WAFER_CORE.x;
    lastShotY = 200;
    game.spawnTarget('dust');
    game.spawnTarget('clip');
    syncHud();
  }

  function syncHud() {
    const st = game.getState();
    const reward = computeMinigameReward(st.score, activeTier);
    const displayedBest = Math.max(bestScore, st.score);

    scoreVal.textContent = st.score.toLocaleString();
    comboVal.textContent = st.feverActive
      ? `${st.combo}× FEVER!`
      : `${st.combo}×`;
    timeVal.textContent = st.finished ? '0.0s DONE' : `${st.timeLeft.toFixed(1)}s`;
    bestVal.textContent = displayedBest.toLocaleString();
    rewardPreviewVal.textContent = st.score > 0
      ? `${reward.medal} · +${bsFormat(reward.diesReward, 'Dies')}`
      : 'Hit targets!';

    canvasWrap.classList.toggle('is-fever', st.feverActive);
    canvasWrap.classList.toggle('is-frozen', st.frozen);

    burstBtn.disabled = st.finished;
    claimBtn.textContent = st.score > 0
      ? `Claim ${reward.medal} (+${bsFormat(reward.diesReward, 'Dies')})`
      : 'Close Arcade';
  }

  function drawTarget(c, t, nowSec) {
    c.save();
    c.translate(t.x, t.y);

    if (t.kind === 'dust') {
      c.rotate(nowSec * 2.1 + t.id);
      c.fillStyle = '#FF3B5C';
      c.strokeStyle = '#FFA3B5';
      c.lineWidth = 1.6;
      c.beginPath();
      const spikes = 10;
      for (let i = 0; i < spikes * 2; i++) {
        const ang = (i * Math.PI) / spikes;
        const r = i % 2 === 0 ? t.radius : t.radius * 0.52;
        const px = Math.cos(ang) * r;
        const py = Math.sin(ang) * r;
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.closePath();
      c.fill();
      c.stroke();

      c.fillStyle = '#4C0519';
      c.beginPath();
      c.arc(0, 0, t.radius * 0.28, 0, Math.PI * 2);
      c.fill();
    } else if (t.kind === 'clip') {
      c.rotate(Math.sin(nowSec * 5 + t.phase) * 0.32);
      c.strokeStyle = '#C4B5FD';
      c.lineWidth = 3.6;
      c.lineCap = 'round';
      c.lineJoin = 'round';

      // Paperclip double-loop silhouette
      drawRoundedRect(c, -10, -16, 20, 32, 10);
      c.stroke();
      c.strokeStyle = '#7C3AED';
      c.lineWidth = 2.2;
      drawRoundedRect(c, -5, -10, 10, 22, 5);
      c.stroke();

      // Glowing rogue drone eyes
      c.fillStyle = '#00F0FF';
      c.beginPath();
      c.arc(-3.5, -2, 2.2, 0, Math.PI * 2);
      c.arc(3.5, -2, 2.2, 0, Math.PI * 2);
      c.fill();
    } else if (t.kind === 'cryo') {
      c.rotate(nowSec * 1.4);
      const grad = c.createRadialGradient(0, 0, 2, 0, 0, t.radius);
      grad.addColorStop(0, 'rgba(224, 242, 254, 0.95)');
      grad.addColorStop(0.6, 'rgba(56, 189, 248, 0.55)');
      grad.addColorStop(1, 'rgba(56, 189, 248, 0.08)');
      c.fillStyle = grad;
      c.beginPath();
      c.arc(0, 0, t.radius, 0, Math.PI * 2);
      c.fill();

      c.strokeStyle = '#E0F2FE';
      c.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        c.beginPath();
        c.moveTo(Math.cos(a) * -(t.radius - 3), Math.sin(a) * -(t.radius - 3));
        c.lineTo(Math.cos(a) * (t.radius - 3), Math.sin(a) * (t.radius - 3));
        c.stroke();
      }
      c.strokeStyle = '#38BDF8';
      c.lineWidth = 1.6;
      c.beginPath();
      c.arc(0, 0, t.radius * 0.65, 0, Math.PI * 2);
      c.stroke();
    } else if (t.kind === 'star') {
      c.rotate(nowSec * 2.8);
      c.strokeStyle = 'rgba(255, 184, 0, 0.72)';
      c.lineWidth = 1.8;
      c.beginPath();
      c.arc(0, 0, t.radius, 0, Math.PI * 2);
      c.stroke();

      c.fillStyle = '#FFB800';
      c.strokeStyle = '#FEF3C7';
      c.lineWidth = 1.5;
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const ang = (i * Math.PI) / 4;
        const r = i % 2 === 0 ? t.radius * 0.92 : t.radius * 0.34;
        const px = Math.cos(ang) * r;
        const py = Math.sin(ang) * r;
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.closePath();
      c.fill();
      c.stroke();
    }

    c.restore();
  }

  function renderFrame(nowMs) {
    if (!ctx) return;
    const st = game.getState();
    const nowSec = nowMs * 0.001;

    // 1. Cleanroom void backdrop + blueprint grid
    ctx.fillStyle = '#080C12';
    ctx.fillRect(0, 0, MINIGAME_WIDTH, MINIGAME_HEIGHT);

    ctx.strokeStyle = st.feverActive ? 'rgba(255, 184, 0, 0.10)' : 'rgba(56, 189, 248, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 32; x < MINIGAME_WIDTH; x += 32) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, MINIGAME_HEIGHT);
    }
    for (let y = 32; y < MINIGAME_HEIGHT; y += 32) {
      ctx.moveTo(0, y);
      ctx.lineTo(MINIGAME_WIDTH, y);
    }
    ctx.stroke();

    // Freeze frost overlay tint
    if (st.frozen) {
      const fGrad = ctx.createRadialGradient(
        WAFER_CORE.x,
        MINIGAME_HEIGHT * 0.5,
        40,
        WAFER_CORE.x,
        MINIGAME_HEIGHT * 0.5,
        360
      );
      fGrad.addColorStop(0, 'rgba(56, 189, 248, 0.04)');
      fGrad.addColorStop(1, 'rgba(56, 189, 248, 0.24)');
      ctx.fillStyle = fGrad;
      ctx.fillRect(0, 0, MINIGAME_WIDTH, MINIGAME_HEIGHT);
    }

    // Golden fever border glow inside canvas
    if (st.feverActive) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 184, 0, 0.72)';
      ctx.lineWidth = 5;
      ctx.strokeRect(2.5, 2.5, MINIGAME_WIDTH - 5, MINIGAME_HEIGHT - 5);
      ctx.restore();
    }

    // 2. Spinning cyan/gold 300mm Wafer Core
    ctx.save();
    ctx.translate(WAFER_CORE.x, WAFER_CORE.y);

    // Core aura
    const coreGlow = ctx.createRadialGradient(0, 0, 8, 0, 0, 56);
    coreGlow.addColorStop(0, st.feverActive ? 'rgba(255, 184, 0, 0.45)' : 'rgba(0, 240, 255, 0.35)');
    coreGlow.addColorStop(1, 'rgba(0, 240, 255, 0)');
    ctx.fillStyle = coreGlow;
    ctx.beginPath();
    ctx.arc(0, 0, 56, 0, Math.PI * 2);
    ctx.fill();

    // Shield ring arc
    ctx.strokeStyle = st.shield > 40 ? '#10F5A0' : '#FF3B5C';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 32, -Math.PI * 0.5, -Math.PI * 0.5 + (Math.PI * 2 * st.shield) / 100);
    ctx.stroke();

    // Spinning silicon wafer core
    ctx.save();
    ctx.rotate(coreAngle);
    ctx.fillStyle = '#0F1C2E';
    ctx.strokeStyle = st.feverActive ? '#FFB800' : '#00F0FF';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 184, 0, 0.65)';
    ctx.lineWidth = 1.2;
    for (let d = -12; d <= 12; d += 8) {
      ctx.beginPath();
      ctx.moveTo(d, -16);
      ctx.lineTo(d, 16);
      ctx.moveTo(-16, d);
      ctx.lineTo(16, d);
      ctx.stroke();
    }
    ctx.restore();

    // Twin EUV Emitter Turret pointing toward last shot
    const aimAng = Math.atan2(lastShotY - WAFER_CORE.y, lastShotX - WAFER_CORE.x);
    ctx.rotate(aimAng);
    ctx.fillStyle = '#E2E8F0';
    ctx.fillRect(10, -7, 14, 4);
    ctx.fillRect(10, 3, 14, 4);
    ctx.restore();

    // 3. Active Targets
    for (let i = 0; i < st.targets.length; i++) {
      drawTarget(ctx, st.targets[i], nowSec);
    }

    // 4. Twin Glowing Laser Beams
    for (let i = 0; i < st.beams.length; i++) {
      const b = st.beams[i];
      const alpha = Math.max(0, Math.min(1, b.ttl / (b.maxTtl || 0.18)));
      const ang = Math.atan2(b.y2 - b.y1, b.x2 - b.x1);
      const nx = -Math.sin(ang);
      const ny = Math.cos(ang);

      ctx.save();
      for (const offset of [-5, 5]) {
        const sx = b.x1 + nx * offset;
        const sy = b.y1 + ny * offset;

        ctx.globalAlpha = alpha * 0.35;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(b.x2, b.y2);
        ctx.stroke();

        ctx.globalAlpha = alpha * 0.95;
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(b.x2, b.y2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 5. Expanding Hit Rings
    for (let i = 0; i < st.bursts.length; i++) {
      const br = st.bursts[i];
      const p = 1 - Math.max(0, br.ttl / (br.maxTtl || 0.35));
      const r = Math.max(4, br.radius * (0.28 + 0.85 * p));
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p);
      ctx.strokeStyle = br.color;
      ctx.lineWidth = 3 * (1 - p * 0.5);
      ctx.beginPath();
      ctx.arc(br.x, br.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 6. Floating Score / FEVER! Texts
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < st.floatingTexts.length; i++) {
      const ft = st.floatingTexts[i];
      const alpha = Math.max(0, Math.min(1, ft.ttl / (ft.maxTtl || 0.75)));
      ctx.globalAlpha = alpha;
      ctx.font = ft.text.includes('FEVER') || ft.text.includes('SUPERNOVA') || ft.text.includes('CRYO')
        ? '800 15px monospace'
        : '700 13px monospace';
      ctx.strokeStyle = '#080C12';
      ctx.lineWidth = 3;
      ctx.strokeText(ft.text, ft.x, ft.y);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
    }
    ctx.restore();

    // 7. Round Complete Canvas Overlay
    if (st.finished) {
      const reward = computeMinigameReward(st.score, activeTier);
      ctx.save();
      ctx.fillStyle = 'rgba(8, 12, 18, 0.76)';
      ctx.fillRect(0, 0, MINIGAME_WIDTH, MINIGAME_HEIGHT);

      ctx.strokeStyle = '#FFB800';
      ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(18, 27, 40, 0.95)';
      drawRoundedRect(ctx, 140, 108, 360, 168, 12);
      ctx.fill();
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = '#00F0FF';
      ctx.font = '800 20px sans-serif';
      ctx.fillText(`ROUND COMPLETE · ${reward.medal}`, MINIGAME_WIDTH * 0.5, 148);

      ctx.fillStyle = '#FFB800';
      ctx.font = '800 24px monospace';
      ctx.fillText(`${st.score.toLocaleString()} PTS`, MINIGAME_WIDTH * 0.5, 184);

      ctx.fillStyle = '#E7F1FF';
      ctx.font = '600 13px monospace';
      ctx.fillText(
        `+${bsFormat(reward.diesReward, 'Dies')} · +${bsFormat(reward.flopsReward, 'FLOPs')}`,
        MINIGAME_WIDTH * 0.5,
        218
      );

      ctx.fillStyle = '#9FB3CC';
      ctx.font = '500 12px sans-serif';
      ctx.fillText('Tap Claim Reward & Close or Play Again below', MINIGAME_WIDTH * 0.5, 248);
      ctx.restore();
    }
  }

  function loop(nowMs) {
    if (!isModalOpen) return;
    const dtSec = lastFrameMs > 0 ? Math.min(0.05, Math.max(0.001, (nowMs - lastFrameMs) * 0.001)) : 0.016;
    lastFrameMs = nowMs;

    coreAngle = (coreAngle + dtSec * (game.feverActive ? 2.6 : 1.0)) % (Math.PI * 2);
    game.step(dtSec);
    syncHud();
    renderFrame(nowMs);

    rafId = requestAnimationFrame(loop);
  }

  function startLoop() {
    stopLoop();
    lastFrameMs = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function open(snapshot) {
    activeTier = Math.max(1, Math.min(6, Number(snapshot?.economy?.tier) || 1));
    bestScore = Math.max(0, Number(snapshot?.expedition?.secretBest) || 0);
    isModalOpen = true;
    modalEl.hidden = false;
    resetRound();
    renderFrame(performance.now());
    startLoop();
  }

  function close() {
    claimAndClose();
  }

  return {
    open,
    close,
    isOpen: () => isModalOpen,
    getGame: () => game,
  };
}
