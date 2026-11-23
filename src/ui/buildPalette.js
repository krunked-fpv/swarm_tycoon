/**
 * Cleanroom Build Palette, Fleet Network Control & 4-Sector AI Director Dock.
 * Renders tools directly from MACHINE_CATALOG and AGENT_CATALOG with zero DOM thrashing.
 */

import { MACHINE_CATALOG, MACHINE_TYPES } from '../sim/gridEngine.js';
import { AGENT_CATALOG } from '../economy/agentWorkers.js';
import { bsCmp, bsFormat, bsFrom } from '../economy/bigSilicon.js';
import { getFleetYieldRatio } from '../economy/scaleTiers.js';

const DIR_LABELS = ['N ↑', 'E →', 'S ↓', 'W ←'];
const SECTOR_NAMES = ['Bay 1 (NW)', 'Bay 2 (NE)', 'Bay 3 (SW)', 'Bay 4 (SE)'];

const MACHINE_GROUPS = [
  {
    label: 'Logistics & OHT',
    types: [
      MACHINE_TYPES.BELT_STRAIGHT,
      MACHINE_TYPES.BELT_CORNER,
      MACHINE_TYPES.BELT_SPLITTER,
      MACHINE_TYPES.BELT_MERGER,
      MACHINE_TYPES.FOUP_DOCK,
    ],
  },
  {
    label: 'Litho & Process',
    types: [
      MACHINE_TYPES.INGOT_SLICER,
      MACHINE_TYPES.PHOTORESIST_COATER,
      MACHINE_TYPES.EUV_SCANNER,
      MACHINE_TYPES.PLASMA_ETCHER,
      MACHINE_TYPES.METROLOGY_QA,
      MACHINE_TYPES.WAFER_VAULT,
      MACHINE_TYPES.RECLAIM_GRINDER,
    ],
  },
  {
    label: 'Cryo, Power & Compute',
    types: [
      MACHINE_TYPES.CRYO_CHILLER,
      MACHINE_TYPES.POWER_SOURCE,
      MACHINE_TYPES.CAPACITOR_BANK,
      MACHINE_TYPES.COMPUTE_RACK,
    ],
  },
];

function createEl(tag, className, text = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== '') el.textContent = text;
  return el;
}

function getMachineTag(entry) {
  if (entry.supplyKw > 0) return `+${entry.supplyKw}kW`;
  if (entry.coolKw > 0) return `-${entry.coolKw}kW`;
  if (entry.capacityKj > 0) return `${entry.capacityKj}kJ`;
  if (entry.priority >= 3) return `P3 ${entry.powerKw}kW`;
  return `${entry.powerKw}kW`;
}

function getSubModeLabel(toolId, sub) {
  if (toolId === MACHINE_TYPES.BELT_CORNER) {
    return (sub & 1) === 1 ? 'Mode: CCW Turn' : 'Mode: CW Turn';
  }
  if (toolId === MACHINE_TYPES.FOUP_DOCK) {
    return (sub & 1) === 1 ? 'Mode: Dropoff' : 'Mode: Pickup';
  }
  if (toolId === MACHINE_TYPES.BELT_MERGER) {
    const labels = ['Fair', 'Back', 'Left', 'Right'];
    return `Mode: ${labels[sub & 3]}`;
  }
  return 'Mode: Standard';
}

export function createBuildPalette({ containerEl, callbacks }) {
  containerEl.replaceChildren();

  // Section 1: Tools & Machines
  const buildSec = createEl('section', 'panel-section section-build');
  const buildHead = createEl('div', 'section-header');
  buildHead.appendChild(createEl('span', 'section-title', 'Fabrication Deck'));
  const dirPill = createEl('span', 'tool-tag', 'E →');
  buildHead.appendChild(dirPill);
  buildSec.appendChild(buildHead);

  // Orientation & Sub-Mode controls
  const orientBar = createEl('div', 'orient-bar');
  const rotateBtn = createEl('button', 'orient-btn', 'Rotate [R]');
  rotateBtn.type = 'button';
  rotateBtn.id = 'btn-rotate-tool';
  rotateBtn.addEventListener('click', () => callbacks.onRotate?.());

  const subBtn = createEl('button', 'orient-btn', 'Mode: Standard');
  subBtn.type = 'button';
  subBtn.id = 'btn-sub-tool';
  subBtn.addEventListener('click', () => callbacks.onToggleSub?.());
  orientBar.append(rotateBtn, subBtn);
  buildSec.appendChild(orientBar);

  // Utility & Conduit Tools
  const utilityTools = [
    { toolId: -1, kind: 'select', name: 'Inspect', meta: 'Tile Info', cost: 'FREE', tag: 'INFO' },
    { toolId: 0, kind: 'erase', name: 'Erase', meta: '50% Salvage', cost: 'DEMOLISH', tag: 'R-CLK' },
    { toolId: 'ln2', kind: 'ln2', name: 'LN2 Pipe', meta: '77K Cryo Loop', cost: 'FREE', tag: 'PIPE' },
    { toolId: 'power', kind: 'power', name: 'Power Busbar', meta: 'Grid Bus', cost: 'FREE', tag: 'BUS' },
  ];

  const utilGrid = createEl('div', 'utility-grid');
  const toolButtonRecords = [];

  for (const ut of utilityTools) {
    const btn = createEl('button', 'tool-btn');
    btn.type = 'button';
    btn.dataset.toolKey = String(ut.toolId);
    const top = createEl('div', 'tool-top');
    top.append(createEl('span', 'tool-name', ut.name), createEl('span', 'tool-tag', ut.tag));
    const meta = createEl('div', 'tool-meta');
    meta.append(createEl('span', '', ut.meta), createEl('span', 'cost-pill', ut.cost));
    btn.append(top, meta);
    btn.addEventListener('click', () => callbacks.onSelectTool?.({ toolId: ut.toolId, kind: ut.kind }));
    utilGrid.appendChild(btn);
    toolButtonRecords.push({ btn, toolId: ut.toolId, costDies: 0 });
  }
  buildSec.appendChild(utilGrid);

  // Machine Groups from MACHINE_CATALOG
  for (const grp of MACHINE_GROUPS) {
    buildSec.appendChild(createEl('div', 'machine-group-label', grp.label));
    const mGrid = createEl('div', 'machine-grid');
    for (const typeId of grp.types) {
      const entry = MACHINE_CATALOG[typeId];
      if (!entry) continue;
      const btn = createEl('button', 'tool-btn');
      btn.type = 'button';
      btn.dataset.toolKey = String(entry.id);
      btn.title = `${entry.name}: ${entry.description}`;

      const top = createEl('div', 'tool-top');
      top.append(
        createEl('span', 'tool-name', entry.shortName),
        createEl('span', 'tool-tag', getMachineTag(entry))
      );

      const meta = createEl('div', 'tool-meta');
      meta.append(
        createEl('span', '', entry.name.split(' ')[0]),
        createEl('span', 'cost-pill', `${entry.costDies}D`)
      );

      btn.append(top, meta);
      btn.addEventListener('click', () =>
        callbacks.onSelectTool?.({ toolId: entry.id, kind: 'machine' })
      );
      mGrid.appendChild(btn);
      toolButtonRecords.push({ btn, toolId: entry.id, costDies: entry.costDies });
    }
    buildSec.appendChild(mGrid);
  }

  // Section 2: Fleet & 4-Sector AI Directors
  const sectorSec = createEl('section', 'panel-section section-sectors');
  const fleetHead = createEl('div', 'section-header');
  fleetHead.appendChild(createEl('span', 'section-title', 'OHT Fleet & AI Bays'));
  const fleetBadge = createEl('span', 'tool-tag', 'Lv.1');
  fleetHead.appendChild(fleetBadge);
  sectorSec.appendChild(fleetHead);

  const fleetCard = createEl('div', 'fleet-card');
  const fleetRow = createEl('div', 'fleet-row');
  const fleetRatioLabel = createEl('span', 'metric-sub num', 'Passive: 25% HWM');
  const fleetNextLabel = createEl('span', 'metric-sub num', 'Next: 36%');
  fleetRow.append(fleetRatioLabel, fleetNextLabel);

  const fleetBtn = createEl('button', 'fleet-btn', 'Upgrade Fleet (120 Dies)');
  fleetBtn.type = 'button';
  fleetBtn.id = 'btn-upgrade-fleet';
  fleetBtn.addEventListener('click', () => callbacks.onUpgradeFleet?.());
  fleetCard.append(fleetRow, fleetBtn);
  sectorSec.appendChild(fleetCard);

  const sectorList = createEl('div', 'sector-list');
  const sectorViews = [];
  let cachedTierForOptions = -1;

  for (let s = 0; s < 4; s++) {
    const card = createEl('div', 'sector-card');
    const head = createEl('div', 'sector-head');
    const label = createEl('span', 'sector-label', SECTOR_NAMES[s]);
    const mult = createEl('span', 'sector-mult', '×1.00');
    head.append(label, mult);

    const select = createEl('select', 'sector-select');
    select.setAttribute('aria-label', `${SECTOR_NAMES[s]} AI Director`);
    select.dataset.sectorIdx = String(s);

    const emptyOpt = document.createElement('option');
    emptyOpt.value = '-1';
    emptyOpt.textContent = 'Unassigned (Manual)';
    select.appendChild(emptyOpt);

    const agentOpts = AGENT_CATALOG.map((ag) => {
      const opt = document.createElement('option');
      opt.value = String(ag.id);
      opt.textContent = `${ag.name} (+${Math.round(ag.yieldBonus * 100)}%)`;
      select.appendChild(opt);
      return { opt, spec: ag };
    });

    select.addEventListener('change', () => {
      const agentIdx = Number.parseInt(select.value, 10);
      callbacks.onAssignAgent?.(s, Number.isInteger(agentIdx) ? agentIdx : -1);
    });

    const entRow = createEl('div', 'entropy-row');
    const entBar = createEl('div', 'entropy-bar');
    const entFill = createEl('div', 'entropy-fill');
    entBar.appendChild(entFill);
    const entPct = createEl('span', 'entropy-pct', '0%');
    entRow.append(entBar, entPct);

    const bio = createEl('div', 'choice-summary', 'No AI Director assigned.');
    card.append(head, select, entRow, bio);
    sectorList.appendChild(card);

    sectorViews.push({ select, agentOpts, mult, entFill, entPct, bio });
  }
  sectorSec.appendChild(sectorList);

  containerEl.append(buildSec, sectorSec);

  function update(snapshot) {
    const econ = snapshot.economy;
    const tool = snapshot.toolState || { toolId: -1, dir: 1, sub: 0, kind: 'select' };
    const dailyActive = Boolean(snapshot.daily?.active);

    const dirIdx = (tool.dir || 0) & 3;
    const subVal = (tool.sub || 0) & 3;
    dirPill.textContent = DIR_LABELS[dirIdx];
    rotateBtn.textContent = `Rotate [R] · ${DIR_LABELS[dirIdx]}`;

    const hasSubModes =
      tool.toolId === MACHINE_TYPES.BELT_CORNER ||
      tool.toolId === MACHINE_TYPES.FOUP_DOCK ||
      tool.toolId === MACHINE_TYPES.BELT_MERGER;
    subBtn.textContent = getSubModeLabel(tool.toolId, subVal);
    subBtn.disabled = !hasSubModes;

    // Highlight active tool & affordability
    for (const rec of toolButtonRecords) {
      const isSelected = String(rec.toolId) === String(tool.toolId);
      rec.btn.classList.toggle('is-active', isSelected);
      if (rec.costDies > 0) {
        const canAfford = bsCmp(econ.dies, bsFrom(rec.costDies)) >= 0;
        rec.btn.classList.toggle('is-unaffordable', !canAfford);
      }
    }

    // Fleet card
    const ratioCur = Math.round(getFleetYieldRatio(econ.fleetLevel) * 100);
    const ratioNext = Math.round(getFleetYieldRatio(econ.fleetLevel + 1) * 100);
    fleetBadge.textContent = `Lv.${econ.fleetLevel}`;
    fleetRatioLabel.textContent = `Passive: ${ratioCur}% HWM`;
    fleetNextLabel.textContent = `Next: ${ratioNext}%`;

    const canBuyFleet = !dailyActive && bsCmp(econ.dies, econ.fleetCost) >= 0;
    fleetBtn.textContent = dailyActive
      ? 'Fleet Locked (Daily)'
      : `Upgrade Fleet (${bsFormat(econ.fleetCost, 'Dies')})`;
    fleetBtn.disabled = !canBuyFleet;
    fleetBtn.classList.toggle('is-ready', canBuyFleet);

    // Sectors & AI Directors
    const tierChanged = cachedTierForOptions !== econ.tier;
    cachedTierForOptions = econ.tier;
    const agents = econ.agents || [-1, -1, -1, -1];
    const entropies = econ.entropies || [0, 0, 0, 0];

    for (let s = 0; s < 4; s++) {
      const sv = sectorViews[s];
      const agIdx = agents[s];
      const ent = Math.max(0, Math.min(100, Number(entropies[s]) || 0));

      if (tierChanged) {
        for (const entry of sv.agentOpts) {
          const locked = econ.tier < entry.spec.unlockTier;
          entry.opt.disabled = locked;
          entry.opt.textContent = locked
            ? `[T0${entry.spec.unlockTier}] ${entry.spec.name}`
            : `${entry.spec.name} (+${Math.round(entry.spec.yieldBonus * 100)}%)`;
        }
      }

      if (document.activeElement !== sv.select && sv.select.value !== String(agIdx)) {
        sv.select.value = String(agIdx);
      }

      const spec = agIdx >= 0 ? AGENT_CATALOG[agIdx] : null;
      const multEst = spec
        ? Math.max(0.5, (1 + spec.yieldBonus) * (1 - 0.25 * (ent / 100)))
        : 1.0;
      sv.mult.textContent = `×${multEst.toFixed(2)}`;
      sv.bio.textContent = spec ? `${spec.title} · Entropy +${spec.entropyRate}/s on stall` : 'Manual cleanroom operation.';

      sv.entFill.style.width = `${ent.toFixed(1)}%`;
      sv.entFill.className = `entropy-fill ${ent >= 80 ? 'is-crit' : ent >= 50 ? 'is-warn' : ''}`.trim();
      sv.entPct.textContent = `${Math.round(ent)}%`;
    }
  }

  return { update };
}
