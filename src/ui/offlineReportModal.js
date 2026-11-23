/**
 * Analytical Offline Catch-Up Telemetry Report Modal.
 * Reports elapsed offline duration, 7-day regulatory cap / clock-rollback guards,
 * macro-slices evaluated, and synthesized Dies & FLOPs.
 */

import { bsFormat } from '../economy/bigSilicon.js';

function createEl(tag, className, text = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== '') el.textContent = text;
  return el;
}

function formatDurationMs(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${String(hours).padStart(2, '0')}h`);
  parts.push(`${String(mins).padStart(2, '0')}m`);
  parts.push(`${String(secs).padStart(2, '0')}s`);
  return parts.join(' ');
}

export function createOfflineReportModal({ modalEl, callbacks }) {
  modalEl.replaceChildren();

  let isModalOpen = false;

  const card = createEl('div', 'modal-card is-narrow');
  const header = createEl('div', 'modal-header');
  const title = createEl('h2', 'modal-title', 'Autonomous Foundry Offline Report');
  title.id = 'offline-modal-title';
  const closeBtn = createEl('button', 'modal-close-btn', '×');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close Offline Report');
  header.append(title, closeBtn);

  const body = createEl('div', 'modal-body');
  const noticeEl = createEl('div', 'notice-banner', '');
  noticeEl.hidden = true;

  const statsRow = createEl('div', 'modal-stats-row');
  function makeStat(label, cls = '') {
    const box = createEl('div', 'modal-stat-box');
    box.appendChild(createEl('span', 'metric-label', label));
    const val = createEl('span', `metric-val num ${cls}`.trim(), '0');
    box.appendChild(val);
    statsRow.appendChild(box);
    return val;
  }

  const statDuration = makeStat('Elapsed Offline');
  const statSlices = makeStat('Macro-Slices');
  const statDies = makeStat('Dies Synthesized');
  const statFlops = makeStat('FLOPs Computed');
  const statShards = makeStat('Est. Shard Hint');
  body.append(noticeEl, statsRow);

  const footer = createEl('div', 'rewrite-footer');
  const footNote = createEl('span', 'metric-sub num', 'Analytical steady-state catch-up complete.');
  const ackBtn = createEl('button', 'btn-primary', 'Acknowledge & Resume');
  ackBtn.type = 'button';
  ackBtn.id = 'btn-close-offline';
  footer.append(footNote, ackBtn);

  card.append(header, body, footer);
  modalEl.appendChild(card);

  function close() {
    if (!isModalOpen) return;
    isModalOpen = false;
    modalEl.hidden = true;
    callbacks.onClose?.();
  }

  closeBtn.addEventListener('click', close);
  ackBtn.addEventListener('click', close);
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) close();
  });

  function show(report) {
    if (!report) return;
    isModalOpen = true;
    modalEl.hidden = false;

    if (report.clockRollback) {
      noticeEl.hidden = false;
      noticeEl.className = 'notice-banner is-crimson';
      noticeEl.textContent =
        'Clock rollback detected (tOpen < tClose) — offline progression suspended for vault integrity.';
      statDuration.textContent = '00m 00s';
      statSlices.textContent = '0 / 28';
      statDies.textContent = '+0 Dies';
      statFlops.textContent = '+0 FLOPs';
      statShards.textContent = '+0 Shards';
      footNote.textContent = 'System clock regression rejected.';
      return;
    }

    if (report.capped) {
      noticeEl.hidden = false;
      noticeEl.className = 'notice-banner';
      noticeEl.textContent =
        'Absence exceeded 7 days — simulation clamped to the 604,800s regulatory maximum.';
    } else if (report.tamperClamped) {
      noticeEl.hidden = false;
      noticeEl.className = 'notice-banner';
      noticeEl.textContent = 'Offline throughput rate clamped to current tier physical ceiling.';
    } else {
      noticeEl.hidden = true;
    }

    statDuration.textContent = formatDurationMs(report.validDeltaMs || 0);
    statSlices.textContent = `${report.slicesSimulated || 0} / 28`;
    statDies.textContent = `+${bsFormat(report.diesEarned, 'Dies')}`;
    statFlops.textContent = `+${bsFormat(report.flopsEarned, 'FLOPs')}`;
    statShards.textContent = `+${report.shardsHint || 0} hint`;
    footNote.textContent = `Solved in ${(report.elapsedMs || 0).toFixed(2)} ms.`;
  }

  return {
    show,
    close,
    isOpen: () => isModalOpen,
  };
}
