/**
 * 24-Node Cleanroom Expedition Contract Map Modal.
 * Displays all 24 LEVEL_POOL nodes grouped across Tiers 01..06,
 * live shuffle-bag Play Next Unseen launcher, cleared progress meter,
 * and lock/nope-shake feedback for higher-tier contracts.
 */

import { bsFormat } from '../economy/bigSilicon.js';
import { getTierSpec } from '../economy/scaleTiers.js';
import { LEVEL_POOL } from '../sim/levelPool.js';

function createEl(tag, className, text = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== '') el.textContent = text;
  return el;
}

function countBits24(mask) {
  let v = (Number(mask) | 0) & 0xffffff;
  let count = 0;
  while (v !== 0) {
    v &= v - 1;
    count++;
  }
  return count;
}

function triggerNopeShake(el) {
  if (!el) return;
  el.classList.remove('is-nope-shake');
  void el.offsetWidth;
  el.classList.add('is-nope-shake');
  clearTimeout(el._nopeTimer);
  el._nopeTimer = setTimeout(() => {
    el.classList.remove('is-nope-shake');
  }, 380);
}

export function createLevelsModal({ modalEl, callbacks }) {
  modalEl.replaceChildren();

  let isModalOpen = false;
  let latestSnapshot = null;

  const card = createEl('div', 'modal-card levels-modal-card');
  const header = createEl('div', 'modal-header');
  const title = createEl('h2', 'modal-title', 'Cleanroom Expedition Contracts (24 Nodes)');
  title.id = 'levels-modal-title';
  const closeBtn = createEl('button', 'modal-close-btn', '×');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close Expeditions Modal');
  header.append(title, closeBtn);

  const body = createEl('div', 'modal-body');

  // Top Hero: Shuffle-bag launcher + Progress Meter
  const hero = createEl('div', 'levels-hero');
  const heroInfo = createEl('div', 'levels-hero-info');
  const progressTitle = createEl('div', 'levels-progress-text num', 'Cleared 0 / 24 Contract Nodes');
  const progressBar = createEl('div', 'levels-progress-bar');
  const progressFill = createEl('div', 'levels-progress-fill');
  progressBar.appendChild(progressFill);
  const progressHint = createEl(
    'div',
    'choice-summary',
    'Isolated cleanroom contracts preserve your campaign untouched. Clear 3+ nodes to unlock Laser Arcade!'
  );
  heroInfo.append(progressTitle, progressBar, progressHint);

  const nextUnseenBtn = createEl('button', 'btn-primary levels-random-btn', '🎲 Play Next Unseen Node');
  nextUnseenBtn.type = 'button';
  nextUnseenBtn.id = 'btn-next-unseen-level';
  nextUnseenBtn.addEventListener('click', () => {
    callbacks.onLaunchNextUnseen?.();
    close();
  });

  hero.append(heroInfo, nextUnseenBtn);
  body.appendChild(hero);

  // Grouped Tiers 01..06
  const tiersWrap = createEl('div', 'levels-tiers-wrap');
  const nodeViews = new Array(LEVEL_POOL.length);
  const tierGroups = [];

  for (let tier = 1; tier <= 6; tier++) {
    const spec = getTierSpec(tier);
    const tierSec = createEl('section', 'levels-tier-group');
    const tierHead = createEl('div', 'levels-tier-head');
    const tierTitle = createEl(
      'span',
      'branch-title levels-tier-title',
      `Tier 0${tier} · ${spec.name} (${spec.gridSize}×${spec.gridSize})`
    );
    const tierLockBadge = createEl('span', 'tool-tag num', tier <= 2 ? 'UNLOCKED' : `REQ TIER 0${tier}`);
    tierHead.append(tierTitle, tierLockBadge);
    tierSec.appendChild(tierHead);

    const grid = createEl('div', 'levels-grid');
    const tierNodes = LEVEL_POOL.filter((n) => n.tier === tier);

    for (const node of tierNodes) {
      const lCard = createEl('article', 'level-card');
      lCard.dataset.nodeId = String(node.id);

      const top = createEl('div', 'level-card-head');
      const code = createEl('span', 'node-code', node.code);
      const gridBadge = createEl('span', 'level-grid-pill num', `${node.gridSize}×${node.gridSize}`);
      const statusBadge = createEl('span', 'level-badge-cleared', '★ CLEARED');
      statusBadge.hidden = true;
      top.append(code, gridBadge, statusBadge);

      const nTitle = createEl('div', 'level-card-title', node.title);
      const nSub = createEl('div', 'level-card-sub', node.subtitle);

      const archRow = createEl('div', 'level-card-tags');
      const archBadge = createEl('span', 'level-archetype-badge', node.archetype);
      const goalBadge = createEl('span', 'level-goal-pill num', `Goal: ${node.waferGoal} Wafers`);
      archRow.append(archBadge, goalBadge);

      const modsLine = createEl(
        'div',
        'level-modifiers num',
        `Power ×${node.modifiers.powerMult.toFixed(2)} · ${node.modifiers.ambientK}K · Belt ×${node.modifiers.beltSpeedMult.toFixed(2)}`
      );

      const rewardLine = createEl(
        'div',
        'level-reward num',
        `Reward: +${bsFormat(node.bonusDies, 'Dies')} · +${node.bonusShards} ${node.bonusShards === 1 ? 'Shard' : 'Shards'}`
      );

      const launchBtn = createEl('button', 'btn-primary level-launch-btn', 'Launch Node');
      launchBtn.type = 'button';
      launchBtn.dataset.nodeId = String(node.id);
      launchBtn.addEventListener('click', () => {
        const unlockedTier = getEffectiveUnlockedTier(latestSnapshot);
        if (node.tier > unlockedTier) {
          triggerNopeShake(lCard);
          triggerNopeShake(launchBtn);
          callbacks.onLockedNode?.(node);
          return;
        }
        callbacks.onLaunchNode?.(node.id);
        close();
      });

      lCard.append(top, nTitle, nSub, archRow, modsLine, rewardLine, launchBtn);
      grid.appendChild(lCard);
      nodeViews[node.id] = { card: lCard, statusBadge, launchBtn, node };
    }

    tierSec.appendChild(grid);
    tiersWrap.appendChild(tierSec);
    tierGroups.push({ tier, tierSec, tierLockBadge });
  }

  body.appendChild(tiersWrap);
  card.append(header, body);
  modalEl.appendChild(card);

  function getEffectiveUnlockedTier(snapshot) {
    const econTier = Number(snapshot?.economy?.tier) || 1;
    const expTier = Number(snapshot?.expedition?.unlockedTier) || econTier;
    return Math.max(2, econTier, expTier);
  }

  function close() {
    if (!isModalOpen) return;
    isModalOpen = false;
    modalEl.hidden = true;
    callbacks.onClose?.();
  }

  closeBtn.addEventListener('click', close);
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) close();
  });

  function open(snapshot) {
    isModalOpen = true;
    modalEl.hidden = false;
    if (snapshot) update(snapshot);
  }

  function update(snapshot) {
    if (!snapshot) return;
    latestSnapshot = snapshot;
    if (!isModalOpen) return;

    const exp = snapshot.expedition || {};
    const clearedMask = (Number(exp.clearedMask) || 0) & 0xffffff;
    const clearedCount = countBits24(clearedMask);
    const unlockedTier = getEffectiveUnlockedTier(snapshot);
    const activeLevelId = snapshot.level?.active ? snapshot.level.id : -1;

    progressTitle.textContent = `Cleared ${clearedCount} / ${LEVEL_POOL.length} Contract Nodes`;
    const pct = Math.min(100, Math.round((clearedCount / LEVEL_POOL.length) * 100));
    progressFill.style.width = `${pct}%`;

    for (const tg of tierGroups) {
      const unlocked = tg.tier <= unlockedTier;
      tg.tierSec.classList.toggle('is-tier-locked', !unlocked);
      tg.tierLockBadge.textContent = unlocked ? 'UNLOCKED' : `Requires Tier 0${tg.tier}`;
    }

    for (let i = 0; i < nodeViews.length; i++) {
      const nv = nodeViews[i];
      if (!nv) continue;
      const { card: lCard, statusBadge, launchBtn, node } = nv;
      const isCleared = (clearedMask & (1 << node.id)) !== 0;
      const isLocked = node.tier > unlockedTier;
      const isActive = activeLevelId === node.id;

      lCard.classList.toggle('is-cleared', isCleared);
      lCard.classList.toggle('is-locked', isLocked);
      lCard.classList.toggle('is-active-node', isActive);

      statusBadge.hidden = !(isCleared || isActive);
      statusBadge.textContent = isActive ? 'ACTIVE' : '★ CLEARED';

      if (isLocked) {
        launchBtn.textContent = `Requires Tier 0${node.tier}`;
        launchBtn.classList.add('is-locked');
        launchBtn.setAttribute('aria-disabled', 'true');
      } else if (isActive) {
        launchBtn.textContent = 'Restart Node';
        launchBtn.classList.remove('is-locked');
        launchBtn.setAttribute('aria-disabled', 'false');
      } else {
        launchBtn.textContent = 'Launch Node';
        launchBtn.classList.remove('is-locked');
        launchBtn.setAttribute('aria-disabled', 'false');
      }
    }
  }

  return {
    open,
    close,
    isOpen: () => isModalOpen,
    update,
  };
}
