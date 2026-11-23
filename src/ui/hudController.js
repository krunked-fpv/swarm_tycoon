/**
 * Top Tactical Telemetry HUD Bar & Daily Mode Status Banner Controller.
 * Enforces tabular-nums on all numeric readouts and avoids unnecessary DOM thrashing.
 */

import { bsFormat } from '../economy/bigSilicon.js';

const HEATMAP_LABELS = [
  { mode: 0, label: '0: Off' },
  { mode: 1, label: '1: Thermal' },
  { mode: 2, label: '2: Queue' },
  { mode: 3, label: '3: Power' },
];

function createEl(tag, className, text = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== '') el.textContent = text;
  return el;
}

function formatYieldMult(mult) {
  if (!Number.isFinite(mult) || mult >= 1e9) {
    return bsFormat(mult);
  }
  if (mult >= 100) return mult.toFixed(0);
  if (mult >= 10) return mult.toFixed(1);
  return mult.toFixed(2);
}

function formatKwOrMw(kw) {
  const val = Math.max(0, Number(kw) || 0);
  if (val >= 1000) {
    return `${(val / 1000).toFixed(2)} MW`;
  }
  if (val >= 100) {
    return `${val.toFixed(0)} kW`;
  }
  return `${val.toFixed(1)} kW`;
}

function formatTimerSec(sec) {
  const s = Math.max(0, Math.ceil(Number(sec) || 0));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export function createHudController({ hudEl, dailyBannerEl, callbacks }) {
  const cache = new Map();
  function setText(el, val) {
    const str = String(val);
    if (cache.get(el) !== str) {
      cache.set(el, str);
      el.textContent = str;
    }
  }

  // Build top HUD structure once
  hudEl.replaceChildren();

  const brandWrap = createEl('div', 'hud-brand');
  const brandMark = createEl('button', 'brand-mark');
  brandMark.type = 'button';
  brandMark.id = 'brand-secret-trigger';
  brandMark.title = 'Swarm Tycoon: Silicon Foundry';
  brandMark.appendChild(createEl('span', 'brand-dot'));
  brandMark.appendChild(createEl('span', '', 'SILICON FOUNDRY'));
  let secretTapTimer = null;
  brandMark.addEventListener('click', () => {
    brandMark.classList.remove('is-secret-tap');
    void brandMark.offsetWidth;
    brandMark.classList.add('is-secret-tap');
    clearTimeout(secretTapTimer);
    secretTapTimer = setTimeout(() => {
      brandMark.classList.remove('is-secret-tap');
    }, 220);
    callbacks.onTapSecretBrand?.();
  });
  const tierPill = createEl('span', 'tier-pill', 'T01 · 8×8');
  brandWrap.append(brandMark, tierPill);

  const telemetryWrap = createEl('div', 'hud-telemetry');

  function makeMetric(label, cls = '') {
    const cell = createEl('div', `metric-cell ${cls}`.trim());
    const lbl = createEl('span', 'metric-label', label);
    const row = createEl('div', 'metric-row');
    const val = createEl('span', 'metric-val num', '0');
    const sub = createEl('span', 'metric-sub num', '');
    row.append(val, sub);
    cell.append(lbl, row);
    telemetryWrap.appendChild(cell);
    return { cell, val, sub };
  }

  const mDies = makeMetric('Dies', 'is-cyan');
  const mWafers = makeMetric('Wafers/s', 'is-emerald');
  const mFlops = makeMetric('FLOPs', 'is-frost');
  const mYield = makeMetric('Yield Mult', 'is-gold');
  const mKelvin = makeMetric('LN2 Temp');
  const mPower = makeMetric('Grid Power');
  const mEntropy = makeMetric('Max Entropy');

  const controlsWrap = createEl('div', 'hud-controls');

  // Heatmap toggle buttons (0..3)
  const heatmapGroup = createEl('div', 'seg-group');
  heatmapGroup.setAttribute('role', 'group');
  heatmapGroup.setAttribute('aria-label', 'Diagnostic Heatmap Modes');
  const heatmapBtns = HEATMAP_LABELS.map((item) => {
    const btn = createEl('button', 'seg-btn', item.label);
    btn.type = 'button';
    btn.dataset.heatmapMode = String(item.mode);
    btn.addEventListener('click', () => callbacks.onSetHeatmap?.(item.mode));
    heatmapGroup.appendChild(btn);
    return btn;
  });

  const tierBtn = createEl('button', 'hud-btn', 'Tier 1/6');
  tierBtn.type = 'button';
  tierBtn.id = 'btn-upgrade-tier';
  tierBtn.addEventListener('click', () => callbacks.onUpgradeTier?.());

  const levelsBtn = createEl('button', 'hud-btn', 'Expeditions 0/24');
  levelsBtn.type = 'button';
  levelsBtn.id = 'btn-open-levels';
  levelsBtn.addEventListener('click', () => callbacks.onOpenLevels?.());

  const secretBtn = createEl('button', 'hud-btn is-secret-unlocked', '★ Laser Arcade');
  secretBtn.type = 'button';
  secretBtn.id = 'btn-secret-arcade';
  secretBtn.hidden = true;
  secretBtn.addEventListener('click', () => callbacks.onOpenSecretArcade?.());

  const dailyBtn = createEl('button', 'hud-btn', 'Reset Daily');
  dailyBtn.type = 'button';
  dailyBtn.id = 'btn-reset-daily';
  dailyBtn.addEventListener('click', () => callbacks.onResetDaily?.());

  const blueprintBtn = createEl('button', 'hud-btn', 'Blueprint');
  blueprintBtn.type = 'button';
  blueprintBtn.id = 'btn-open-blueprint';
  blueprintBtn.addEventListener('click', () => callbacks.onOpenBlueprint?.());

  const prestigeBtn = createEl('button', 'hud-btn', 'Prestige (0)');
  prestigeBtn.type = 'button';
  prestigeBtn.id = 'btn-open-prestige';
  prestigeBtn.addEventListener('click', () => callbacks.onOpenPrestige?.());

  const vaultPill = createEl('button', 'vault-pill', 'Vault: OK');
  vaultPill.type = 'button';
  vaultPill.id = 'vault-status-pill';
  vaultPill.title = 'Self-healing krunked-cookie-vault-v1 status';
  vaultPill.addEventListener('click', () => callbacks.onInspectVault?.());

  const audioBox = createEl('div', 'audio-box');
  const muteBtn = createEl('button', 'audio-mute-btn', 'SFX');
  muteBtn.type = 'button';
  muteBtn.id = 'btn-audio-mute';
  muteBtn.title = 'Toggle procedural WebAudio SFX';
  muteBtn.addEventListener('click', () => callbacks.onToggleMute?.());

  const volSlider = createEl('input', 'audio-slider');
  volSlider.type = 'range';
  volSlider.id = 'audio-volume-slider';
  volSlider.min = '0';
  volSlider.max = '100';
  volSlider.step = '1';
  volSlider.value = '60';
  volSlider.setAttribute('aria-label', 'Master Volume');
  volSlider.addEventListener('input', () => {
    const vol = Math.max(0, Math.min(1, Number(volSlider.value) / 100));
    callbacks.onVolumeChange?.(vol);
  });
  audioBox.append(muteBtn, volSlider);

  const installGroup = createEl('div', 'install-group');
  const installBtn = createEl('button', 'hud-btn install-btn', 'Install App');
  installBtn.type = 'button';
  installBtn.id = 'btn-install-app';
  installBtn.hidden = true;
  installBtn.addEventListener('click', () => callbacks.onInstallApp?.());

  const dismissInstallBtn = createEl('button', 'install-dismiss-btn', '×');
  dismissInstallBtn.type = 'button';
  dismissInstallBtn.id = 'btn-dismiss-install';
  dismissInstallBtn.title = 'Dismiss Install App button';
  dismissInstallBtn.setAttribute('aria-label', 'Dismiss Install App prompt');
  dismissInstallBtn.hidden = true;
  dismissInstallBtn.addEventListener('click', () => callbacks.onDismissInstall?.());
  installGroup.append(installBtn, dismissInstallBtn);

  controlsWrap.append(
    heatmapGroup,
    tierBtn,
    levelsBtn,
    secretBtn,
    dailyBtn,
    blueprintBtn,
    prestigeBtn,
    vaultPill,
    audioBox,
    installGroup
  );

  hudEl.append(brandWrap, telemetryWrap, controlsWrap);

  // Build Daily / Contract Sandbox status banner
  dailyBannerEl.replaceChildren();
  const dailyInfo = createEl('div', 'daily-info');
  const dailySeedBadge = createEl('span', 'daily-badge', 'DAILY SEED');
  const dailyModsText = createEl('span', 'daily-mods', '');
  dailyInfo.append(dailySeedBadge, dailyModsText);

  const dailyActions = createEl('div', 'daily-actions');
  const dailyTimerPill = createEl('span', 'daily-stat-pill timer-val', '15:00');
  const dailyScorePill = createEl('span', 'daily-stat-pill daily-score-val', 'Score: 0');
  const dailyBragBtn = createEl('button', 'hud-btn', 'Copy Daily Brag');
  dailyBragBtn.type = 'button';
  dailyBragBtn.id = 'btn-daily-brag';
  dailyBragBtn.addEventListener('click', () => callbacks.onCopyDailyBrag?.());

  const exitDailyBtn = createEl('button', 'hud-btn is-daily-active', 'Exit Daily');
  exitDailyBtn.type = 'button';
  exitDailyBtn.id = 'btn-exit-daily';
  exitDailyBtn.addEventListener('click', () => {
    if (callbacks.onExitSandbox) {
      callbacks.onExitSandbox();
    } else {
      callbacks.onExitDaily?.();
    }
  });

  dailyActions.append(dailyTimerPill, dailyScorePill, dailyBragBtn, exitDailyBtn);
  dailyBannerEl.append(dailyInfo, dailyActions);

  function update(snapshot) {
    const econ = snapshot.economy;
    const sim = snapshot.sim || {};
    const daily = snapshot.daily || { active: false };
    const level = snapshot.level || { active: false };
    const exp = snapshot.expedition || { clearedCount: 0, totalNodes: 24, secretUnlocked: false };
    const vaultStatus = snapshot.vaultStatus || {};
    const audioState = snapshot.audioState || { volume: 0.6, muted: false };
    const installPrompt = snapshot.installPrompt || { available: false, dismissed: false, installed: false };

    const gridW = snapshot.gridWidth || econ.tierSpec?.gridSize || 8;
    const tierTag = level.active
      ? `CONTRACT ${level.code || ''} · ${gridW}×${gridW}`
      : daily.active
        ? `DAILY · ${gridW}×${gridW}`
        : `${econ.tierSpec?.shortName || `T0${econ.tier}`} · ${gridW}×${gridW}`;
    setText(tierPill, tierTag);

    setText(levelsBtn, `Expeditions ${exp.clearedCount || 0}/${exp.totalNodes || 24}`);
    levelsBtn.classList.toggle('is-daily-active', Boolean(level.active));
    secretBtn.hidden = !Boolean(exp.secretUnlocked);

    // Counters (all tabular-nums)
    setText(mDies.val, bsFormat(econ.dies));
    setText(mDies.sub, `${bsFormat(econ.diesPerSec)}/s`);

    const wps = Number(snapshot.wafersPerSec) || 0;
    setText(mWafers.val, `${wps.toFixed(2)}/s`);
    setText(mWafers.sub, `Vault ${sim.vaultedGood || 0}`);

    setText(mFlops.val, bsFormat(econ.flops));
    setText(mFlops.sub, `${bsFormat(econ.flopsPerSec)}/s`);

    setText(mYield.val, `×${formatYieldMult(econ.yieldMultiplier)}`);
    setText(mYield.sub, econ.vcSurgeTimerSec > 0 && econ.vcQuotaRemaining <= 0 ? 'SURGE' : `Fleet ${econ.fleetLevel}`);

    const avgK = Number.isFinite(sim.avgKelvin) ? sim.avgKelvin : 295.0;
    const scrams = Number(sim.scramCount) || 0;
    setText(mKelvin.val, `${avgK.toFixed(1)} K`);
    setText(mKelvin.sub, scrams > 0 ? `SCRAM ×${scrams}` : avgK < 285 ? 'CRYO 1.15×' : 'NOMINAL');
    mKelvin.cell.className = `metric-cell ${
      scrams > 0 ? 'is-crimson' : avgK < 285 ? 'is-frost' : avgK > 335 ? 'is-gold' : ''
    }`.trim();

    const demandKw = Number(sim.powerDemandKw) || 0;
    const supplyKw = Number(sim.powerSupplyKw) || 0;
    const brownout = Number(sim.brownoutLevel) || 0;
    setText(mPower.val, `${formatKwOrMw(demandKw)} / ${formatKwOrMw(supplyKw)}`);
    if (brownout > 0) {
      setText(mPower.sub, `SHED P${4 - Math.min(3, brownout)}`);
    } else if ((sim.capacitorMaxKj || 0) > 0) {
      setText(mPower.sub, `${Math.round(sim.capacitorStoredKj || 0)}kJ`);
    } else {
      setText(mPower.sub, 'GRID OK');
    }
    mPower.cell.className = `metric-cell ${brownout > 0 ? 'is-crimson' : 'is-gold'}`;

    const entropies = Array.isArray(econ.entropies) ? econ.entropies : [0, 0, 0, 0];
    const maxEnt = Math.max(0, ...entropies);
    setText(mEntropy.val, `${Math.round(maxEnt)}%`);
    setText(mEntropy.sub, econ.activeCrisis ? 'CRISIS!' : maxEnt >= 75 ? 'HIGH' : 'CALM');
    mEntropy.cell.className = `metric-cell ${
      econ.activeCrisis || maxEnt >= 85 ? 'is-crimson' : maxEnt >= 55 ? 'is-gold' : ''
    }`.trim();

    // Heatmap active state
    const hm = snapshot.heatmapMode | 0;
    for (let i = 0; i < heatmapBtns.length; i++) {
      heatmapBtns[i].classList.toggle('is-active', i === hm);
    }

    // Tier Upgrade button
    if (daily.active) {
      setText(tierBtn, 'Tier Locked (Daily)');
      tierBtn.disabled = true;
      tierBtn.classList.remove('is-ready');
    } else if (level.active) {
      setText(tierBtn, 'Tier Locked (Contract)');
      tierBtn.disabled = true;
      tierBtn.classList.remove('is-ready');
    } else if (!econ.nextTierSpec) {
      setText(tierBtn, 'MAX TIER 06');
      tierBtn.disabled = true;
      tierBtn.classList.remove('is-ready');
    } else {
      setText(
        tierBtn,
        `Tier ${econ.tier}→${econ.nextTierSpec.tier} (${bsFormat(econ.nextTierCostDies, 'Dies')})`
      );
      tierBtn.disabled = !econ.canUpgradeTier;
      tierBtn.classList.toggle('is-ready', Boolean(econ.canUpgradeTier));
    }

    // Daily & Expedition Contract banner
    setText(dailyBtn, daily.active ? 'Restart Daily' : 'Reset Daily');
    dailyBtn.classList.toggle('is-daily-active', Boolean(daily.active));

    const showSandboxBanner = Boolean(daily.active || level.active);
    dailyBannerEl.hidden = !showSandboxBanner;
    dailyBannerEl.classList.toggle('is-contract-mode', Boolean(level.active));

    if (level.active) {
      setText(dailySeedBadge, `CONTRACT ${level.code || 'N01'}`);
      const m = level.modifiers || {};
      setText(
        dailyModsText,
        `${level.title || ''} · ${level.gridSize || gridW}×${level.gridSize || gridW} · Power ×${(m.powerMult ?? 1).toFixed(2)} · Ambient ${m.ambientK ?? 295}K`
      );
      dailyTimerPill.hidden = false;
      setText(
        dailyTimerPill,
        `Reward +${bsFormat(level.bonusDies || 0, 'Dies')} · +${level.bonusShards || 0}S`
      );
      const banked = Math.max(0, Number(level.vaultedGood) || 0);
      const goal = Math.max(1, Number(level.waferGoal) || 1);
      setText(
        dailyScorePill,
        `${banked} / ${goal} Wafers${level.clearedThisRun ? ' · ★ CLEARED' : ''}`
      );
      dailyBragBtn.hidden = true;
      setText(exitDailyBtn, 'Exit to Campaign');
    } else if (daily.active) {
      setText(dailySeedBadge, `DAILY ${daily.seedId || ''}`);
      const m = daily.modifiers || {};
      setText(
        dailyModsText,
        `Power ×${(m.powerMult ?? 1).toFixed(2)} · Ambient ${m.ambientK ?? 295}K · Defect +${Math.round((m.defectBias ?? 0) * 100)}%`
      );
      dailyTimerPill.hidden = false;
      setText(
        dailyTimerPill,
        daily.finished ? '00:00 DONE' : `T-${formatTimerSec(daily.remainingSec)}`
      );
      setText(
        dailyScorePill,
        `Score: ${daily.score || 0} (Target ${m.targetScore || 0} · Best ${daily.bestScore || 0})`
      );
      dailyBragBtn.hidden = false;
      setText(exitDailyBtn, 'Exit Daily');
    }

    // Prestige button
    const pend = econ.pendingShards || 0;
    setText(prestigeBtn, pend > 0 ? `Prestige (${econ.shards} +${pend})` : `Prestige (${econ.shards})`);
    prestigeBtn.classList.toggle('is-prestige-ready', pend > 0);

    // Vault status pill
    if (vaultStatus.selfHealed) {
      setText(vaultPill, 'HEALED: cookie-vault');
      vaultPill.classList.add('vault-healed');
    } else if (vaultStatus.cookieRegenerated) {
      setText(vaultPill, 'REGEN: cookie-vault');
      vaultPill.classList.add('vault-healed');
    } else {
      setText(vaultPill, vaultStatus.source === 'cookie' ? 'Vault: Cookie' : 'Vault: OK');
      vaultPill.classList.remove('vault-healed');
    }

    // Audio controls
    const muted = Boolean(audioState.muted);
    setText(muteBtn, muted ? 'MUTED' : 'SFX');
    muteBtn.classList.toggle('is-muted', muted);
    const volPct = String(Math.round((Number(audioState.volume) || 0) * 100));
    if (document.activeElement !== volSlider && volSlider.value !== volPct) {
      volSlider.value = volPct;
    }

    // Subtle dismissible Install App button
    const showInstall = Boolean(
      installPrompt.available && !installPrompt.dismissed && !installPrompt.installed
    );
    installBtn.hidden = !showInstall;
    dismissInstallBtn.hidden = !showInstall;
  }

  return { update };
}
