/**
 * Operations Status, VC Surge Countdown, Active Crisis Mitigation Cards & Satirical Incident Feed.
 */

import { bsCmp, bsFormat } from '../economy/bigSilicon.js';
import { CRISIS_TYPES } from '../economy/chaosIncidents.js';

const MAX_FEED_ITEMS = 24;

function createEl(tag, className, text = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== '') el.textContent = text;
  return el;
}

function formatClock() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export function createCrisisTicker({ containerEl, callbacks }) {
  containerEl.replaceChildren();

  // Section 1: Cleanroom Ops & QA Warning Status
  const opsSec = createEl('section', 'panel-section');
  const opsHead = createEl('div', 'section-header');
  opsHead.appendChild(createEl('span', 'section-title', 'Cleanroom Operations'));
  const opsBadge = createEl('span', 'tool-tag', 'NOMINAL');
  opsHead.appendChild(opsBadge);
  opsSec.appendChild(opsHead);

  const opsCard = createEl('div', 'ops-status-card');
  const statusLine1 = createEl('div', 'ops-status-line');
  const entropyReadout = createEl('span', 'num', 'Peak Entropy: 0%');
  const scramReadout = createEl('span', 'num', 'SCRAMs: 0');
  statusLine1.append(entropyReadout, scramReadout);

  const statusLine2 = createEl('div', 'ops-status-line');
  const warnText = createEl('span', 'choice-summary', 'QA line flowing nominally.');
  const stressBtn = createEl('button', 'stress-btn', 'Simulate QA Stress');
  stressBtn.type = 'button';
  stressBtn.id = 'btn-qa-stress';
  stressBtn.title = 'Inject synthetic QA buffer pressure (+50% Sector 1 Entropy)';
  stressBtn.addEventListener('click', () => callbacks.onSimulateQaStress?.());
  statusLine2.append(warnText, stressBtn);

  opsCard.append(statusLine1, statusLine2);
  opsSec.appendChild(opsCard);

  // VC Surge / Freeze Countdown Badge
  const surgeBanner = createEl('div', 'surge-banner', '');
  surgeBanner.id = 'vc-surge-badge';
  surgeBanner.hidden = true;

  // Active Crisis Mitigation Card
  const crisisCard = createEl('div', 'crisis-card');
  crisisCard.id = 'active-crisis-card';
  crisisCard.hidden = true;

  const crisisTitle = createEl('div', 'crisis-title', '');
  const crisisHeadline = createEl('div', 'crisis-headline', '');
  const crisisDesc = createEl('div', 'crisis-desc', '');
  const crisisMeta = createEl('div', 'crisis-meta');
  const crisisSector = createEl('span', 'num', 'Bay 1');
  const crisisExtra = createEl('span', 'num', '');
  const crisisTimer = createEl('span', 'num', '45s');
  crisisMeta.append(crisisSector, crisisExtra, crisisTimer);
  const crisisChoicesWrap = createEl('div', 'crisis-choices');
  crisisCard.append(crisisTitle, crisisHeadline, crisisDesc, crisisMeta, crisisChoicesWrap);

  // Section 2: Live Satirical Incident Feed
  const feedSec = createEl('section', 'panel-section');
  const feedHead = createEl('div', 'section-header');
  feedHead.appendChild(createEl('span', 'section-title', 'Incident & Telemetry Feed'));
  const feedCount = createEl('span', 'tool-tag num', '0');
  feedHead.appendChild(feedCount);
  feedSec.appendChild(feedHead);

  const feedList = createEl('div', 'feed-list');
  feedList.id = 'crisis-feed-list';
  feedSec.appendChild(feedList);

  containerEl.append(opsSec, surgeBanner, crisisCard, feedSec);

  let renderedCrisisKey = '';
  let choiceViews = [];
  let totalLogs = 0;

  function pushLog(message, kind = 'info') {
    const item = createEl('div', `feed-item is-${kind}`);
    const timeEl = createEl('span', 'feed-time', `[${formatClock()}]`);
    const msgEl = document.createElement('span');
    msgEl.textContent = String(message);
    item.append(timeEl, msgEl);

    feedList.prepend(item);
    while (feedList.children.length > MAX_FEED_ITEMS) {
      feedList.lastElementChild?.remove();
    }
    totalLogs++;
    feedCount.textContent = String(feedList.children.length);
  }

  function buildCrisisButtons(crisis) {
    crisisChoicesWrap.replaceChildren();
    choiceViews = crisis.choices.map((choice) => {
      const btn = createEl('button', 'crisis-choice-btn');
      btn.type = 'button';
      btn.dataset.choiceId = choice.id;

      const head = createEl('div', 'choice-head');
      const labelEl = createEl('span', '', choice.label);
      const costText = choice.costDies?.m > 0 ? bsFormat(choice.costDies, 'Dies') : 'FREE';
      const costEl = createEl('span', 'cost-pill', costText);
      head.append(labelEl, costEl);

      const summaryEl = createEl('div', 'choice-summary', choice.effectSummary);
      btn.append(head, summaryEl);

      btn.addEventListener('click', () => {
        callbacks.onMitigateCrisis?.(choice.id);
      });

      crisisChoicesWrap.appendChild(btn);
      return { btn, choice };
    });
  }

  function update(snapshot) {
    const econ = snapshot.economy;
    const sim = snapshot.sim || {};
    const entropies = Array.isArray(econ.entropies) ? econ.entropies : [0, 0, 0, 0];
    const maxEnt = Math.max(0, ...entropies);
    const scrams = Number(sim.scramCount) || 0;
    const brownout = Number(sim.brownoutLevel) || 0;

    entropyReadout.textContent = `Peak Entropy: ${Math.round(maxEnt)}%`;
    scramReadout.textContent = `SCRAMs: ${scrams}`;

    if (econ.activeCrisis) {
      opsBadge.textContent = 'INCIDENT';
      opsBadge.style.color = '#FF3B5C';
      warnText.textContent = 'Active bay anomaly requires operator mitigation.';
    } else if (scrams > 0) {
      opsBadge.textContent = 'SCRAM';
      opsBadge.style.color = '#FF3B5C';
      warnText.textContent = 'Thermal scram latched — route 77K LN2 loops!';
    } else if (brownout > 0) {
      opsBadge.textContent = 'BROWNOUT';
      opsBadge.style.color = '#FFB800';
      warnText.textContent = `Power deficit shedding Priority-${4 - Math.min(3, brownout)} loads.`;
    } else if (maxEnt >= 65) {
      opsBadge.textContent = 'HIGH ENTROPY';
      opsBadge.style.color = '#FFB800';
      warnText.textContent = 'QA backpressure elevating AI director drift.';
    } else {
      opsBadge.textContent = 'NOMINAL';
      opsBadge.style.color = '#10F5A0';
      warnText.textContent = 'Cleanroom telemetry within nominal tolerances.';
    }

    stressBtn.disabled = Boolean(econ.activeCrisis);

    // VC Surge / Freeze Countdown
    if ((econ.vcSurgeTimerSec || 0) > 0) {
      surgeBanner.hidden = false;
      if ((econ.vcQuotaRemaining || 0) > 0) {
        surgeBanner.classList.add('is-frozen');
        surgeBanner.textContent = `VC FREEZE (-40% Yield) · Ship ${econ.vcQuotaRemaining} Good Wafers in ${Math.ceil(econ.vcSurgeTimerSec)}s`;
      } else {
        surgeBanner.classList.remove('is-frozen');
        surgeBanner.textContent = `VIRAL HYPE SURGE +150% YIELD · ${econ.vcSurgeTimerSec.toFixed(1)}s`;
      }
    } else {
      surgeBanner.hidden = true;
    }

    // Active Crisis Card
    const crisis = econ.activeCrisis;
    if (!crisis) {
      crisisCard.hidden = true;
      renderedCrisisKey = '';
      choiceViews = [];
      return;
    }

    crisisCard.hidden = false;
    const key = `${crisis.id}:${crisis.choices.map((c) => c.id).join(',')}`;
    if (key !== renderedCrisisKey) {
      renderedCrisisKey = key;
      crisisTitle.textContent = crisis.title;
      crisisHeadline.textContent = crisis.headline;
      crisisDesc.textContent = crisis.description;
      buildCrisisButtons(crisis);
    }

    const remSec = Math.max(0, Math.ceil((crisis.durationSec || 0) - (crisis.elapsedSec || 0)));
    crisisSector.textContent = `Bay ${(crisis.sectorIdx || 0) + 1}`;
    crisisTimer.textContent = `Auto-clear ${remSec}s`;

    if (crisis.type === CRISIS_TYPES.PAPERCLIP_PANIC) {
      crisisExtra.textContent = `Clips: ${econ.paperclips || 0}`;
    } else if (crisis.type === CRISIS_TYPES.MEME_PR_MELTDOWN) {
      crisisExtra.textContent = `Quota: ${econ.vcQuotaRemaining || 0} wafers`;
    } else {
      crisisExtra.textContent = 'Splitters scrambled';
    }

    for (const cv of choiceViews) {
      const cost = cv.choice.costDies;
      const canAfford = !cost || cost.m <= 0 || bsCmp(econ.dies, cost) >= 0;
      cv.btn.disabled = !canAfford;
    }
  }

  return {
    update,
    pushLog,
    getLogCount: () => totalLogs,
  };
}
