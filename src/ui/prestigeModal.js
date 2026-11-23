/**
 * Interactive 3-Branch Prestige Rewrite Tech-Tree Modal.
 * Renders Branches A, B, C with all 9 PRESTIGE_NODES, live shard math, and Rewrite confirmation.
 */

import { bsFormat } from '../economy/bigSilicon.js';
import {
  PRESTIGE_BRANCHES,
  PRESTIGE_NODES,
  getNodeCost,
  getPrestigeEffects,
} from '../economy/prestigeProtocol.js';

function createEl(tag, className, text = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== '') el.textContent = text;
  return el;
}

export function createPrestigeModal({ modalEl, callbacks }) {
  modalEl.replaceChildren();

  let isModalOpen = false;
  let rewriteArmed = false;
  let armTimer = null;

  const card = createEl('div', 'modal-card');
  const header = createEl('div', 'modal-header');
  const title = createEl('h2', 'modal-title', 'Architecture Rewrite Protocol');
  title.id = 'prestige-modal-title';
  const closeBtn = createEl('button', 'modal-close-btn', '×');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close Prestige Modal');
  header.append(title, closeBtn);

  const body = createEl('div', 'modal-body');

  const statsRow = createEl('div', 'modal-stats-row');
  function makeStat(label) {
    const box = createEl('div', 'modal-stat-box');
    box.appendChild(createEl('span', 'metric-label', label));
    const val = createEl('span', 'metric-val num', '0');
    box.appendChild(val);
    statsRow.appendChild(box);
    return val;
  }

  const statFlops = makeStat('Lifetime FLOPs');
  const statShards = makeStat('Available Shards');
  const statPending = makeStat('Pending Shards');
  const statScram = makeStat('Scram Ceiling');
  body.appendChild(statsRow);

  const dailyWarn = createEl(
    'div',
    'notice-banner',
    'Daily Challenge isolation active — Exit Daily Mode before executing an Architecture Rewrite.'
  );
  dailyWarn.hidden = true;
  body.appendChild(dailyWarn);

  const treeGrid = createEl('div', 'prestige-tree');
  const nodeViews = new Array(PRESTIGE_NODES.length);

  for (const branchKey of ['A', 'B', 'C']) {
    const branchCol = createEl('div', 'prestige-branch');
    branchCol.appendChild(createEl('div', 'branch-title', PRESTIGE_BRANCHES[branchKey]));
    const nodesWrap = createEl('div', 'branch-nodes');

    const branchNodes = PRESTIGE_NODES.filter((n) => n.branch === branchKey);
    for (const node of branchNodes) {
      const nCard = createEl('div', 'prestige-node-card');
      const nHead = createEl('div', 'node-head');
      const code = createEl('span', 'node-code', node.code);
      const name = createEl('span', 'node-name', node.name);
      const lvl = createEl('span', 'node-lvl', 'Lv.0');
      nHead.append(code, name, lvl);

      const effect = createEl('div', 'node-effect', node.effectSummary);
      const satire = createEl('div', 'node-satire', node.satireNote);

      const buyBtn = createEl('button', 'btn-primary', 'Upgrade (1 Shard)');
      buyBtn.type = 'button';
      buyBtn.dataset.nodeIdx = String(node.id);
      buyBtn.addEventListener('click', () => {
        callbacks.onBuyNode?.(node.id);
      });

      nCard.append(nHead, effect, satire, buyBtn);
      nodesWrap.appendChild(nCard);
      nodeViews[node.id] = { card: nCard, lvl, buyBtn };
    }

    branchCol.appendChild(nodesWrap);
    treeGrid.appendChild(branchCol);
  }
  body.appendChild(treeGrid);

  const footer = createEl('div', 'rewrite-footer');
  const footerNote = createEl(
    'span',
    'metric-sub',
    'Rewriting converts pending FLOPs into permanent Photomask Shards and resets current Tier, Dies, and Grid.'
  );
  const rewriteBtn = createEl('button', 'btn-danger', 'Execute Architecture Rewrite (+0 Shards)');
  rewriteBtn.type = 'button';
  rewriteBtn.id = 'btn-prestige-rewrite';

  function resetArm() {
    rewriteArmed = false;
    if (armTimer) {
      clearTimeout(armTimer);
      armTimer = null;
    }
    rewriteBtn.classList.remove('is-armed');
  }

  rewriteBtn.addEventListener('click', () => {
    if (!rewriteArmed) {
      rewriteArmed = true;
      rewriteBtn.classList.add('is-armed');
      rewriteBtn.textContent = 'Confirm Rewrite? Click Again to Reset Run';
      if (armTimer) clearTimeout(armTimer);
      armTimer = setTimeout(() => {
        resetArm();
      }, 4500);
      return;
    }
    resetArm();
    callbacks.onRewriteArchitecture?.();
  });

  footer.append(footerNote, rewriteBtn);
  card.append(header, body, footer);
  modalEl.appendChild(card);

  function close() {
    if (!isModalOpen) return;
    isModalOpen = false;
    resetArm();
    modalEl.hidden = true;
    callbacks.onClose?.();
  }

  closeBtn.addEventListener('click', close);
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) close();
  });

  function open(snapshot) {
    isModalOpen = true;
    resetArm();
    modalEl.hidden = false;
    if (snapshot) update(snapshot);
  }

  function update(snapshot) {
    if (!isModalOpen) return;
    const econ = snapshot.economy;
    const dailyActive = Boolean(snapshot.daily?.active);
    const levels = econ.prestigeLevels || [];
    const effects = getPrestigeEffects(levels);

    statFlops.textContent = bsFormat(econ.lifetimeFlops, 'FLOPs');
    statShards.textContent = String(econ.shards || 0);
    statPending.textContent = `+${econ.pendingShards || 0}`;
    statScram.textContent = `${effects.scramCeilingK} K`;
    dailyWarn.hidden = !dailyActive;

    for (let i = 0; i < PRESTIGE_NODES.length; i++) {
      const nv = nodeViews[i];
      const lvl = levels[i] || 0;
      const cost = getNodeCost(i, lvl);
      nv.lvl.textContent = `Lv.${lvl}`;
      nv.card.classList.toggle('is-owned', lvl > 0);
      nv.buyBtn.textContent = `Upgrade (${cost} ${cost === 1 ? 'Shard' : 'Shards'})`;
      nv.buyBtn.disabled = dailyActive || (econ.shards || 0) < cost;
    }

    const pend = econ.pendingShards || 0;
    rewriteBtn.disabled = dailyActive || pend <= 0;
    if (!rewriteArmed) {
      rewriteBtn.textContent = `Execute Architecture Rewrite (+${pend} ${pend === 1 ? 'Shard' : 'Shards'})`;
    }
  }

  return {
    open,
    close,
    isOpen: () => isModalOpen,
    update,
  };
}
