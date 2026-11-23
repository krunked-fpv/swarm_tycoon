/**
 * Blueprint Sharing (#blueprint=BP1_...) & Portable Signed .json Save Export/Import Modal.
 */

import { decodeBlueprint } from '../persistence/blueprintCodec.js';
import { MACHINE_TYPES } from '../sim/gridEngine.js';

function createEl(tag, className, text = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== '') el.textContent = text;
  return el;
}

async function copyTextSafe(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return Boolean(ok);
  } catch {
    return false;
  }
}

export function createBlueprintModal({ modalEl, callbacks }) {
  modalEl.replaceChildren();

  let isModalOpen = false;
  let activeHashString = '';

  const card = createEl('div', 'modal-card is-narrow');
  const header = createEl('div', 'modal-header');
  const title = createEl('h2', 'modal-title', 'Blueprint Codec & Portable Vault');
  title.id = 'blueprint-modal-title';
  const closeBtn = createEl('button', 'modal-close-btn', '×');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close Blueprint Modal');
  header.append(title, closeBtn);

  const body = createEl('div', 'modal-body');

  // Section 1: Export #blueprint=
  const expSec = createEl('div', 'bp-section');
  expSec.appendChild(createEl('span', 'section-title', 'Export Active Cleanroom Blueprint'));
  const expMeta = createEl('span', 'bp-preview', '8×8 · Tier 01');
  const expInput = createEl('input', 'bp-input');
  expInput.type = 'text';
  expInput.readOnly = true;
  expInput.id = 'blueprint-export-output';
  expInput.setAttribute('aria-label', 'Exported blueprint hash');

  const expRow = createEl('div', 'bp-row');
  const copyHashBtn = createEl('button', 'btn-primary', 'Copy #blueprint=');
  copyHashBtn.type = 'button';
  copyHashBtn.id = 'btn-copy-blueprint';

  const copyUrlBtn = createEl('button', 'btn-secondary', 'Copy Share URL');
  copyUrlBtn.type = 'button';
  copyUrlBtn.id = 'btn-copy-share-url';

  expRow.append(copyHashBtn, copyUrlBtn);
  expSec.append(expMeta, expInput, expRow);

  // Section 2: Import #blueprint=
  const impSec = createEl('div', 'bp-section');
  impSec.appendChild(createEl('span', 'section-title', 'Import #blueprint= Hash'));
  const impInput = createEl('input', 'bp-input');
  impInput.type = 'text';
  impInput.id = 'blueprint-import-input';
  impInput.placeholder = 'Paste #blueprint=BP1_... or BP1_...';
  impInput.setAttribute('aria-label', 'Blueprint hash to import');

  const impPreview = createEl('div', 'bp-preview', 'Paste a BP1_ token or URL hash to inspect.');
  const impRow = createEl('div', 'bp-row');
  const impBtn = createEl('button', 'btn-primary', 'Load Blueprint');
  impBtn.type = 'button';
  impBtn.id = 'btn-import-blueprint';
  impBtn.disabled = true;
  impRow.appendChild(impBtn);
  impSec.append(impInput, impPreview, impRow);

  // Section 3: Portable .json Save
  const saveSec = createEl('div', 'bp-section');
  saveSec.appendChild(createEl('span', 'section-title', 'Portable Signed .json Save'));
  const saveNote = createEl(
    'span',
    'choice-summary',
    'Exports full signed campaign currency, prestige tree, and layout. Tampered saves are rejected.'
  );
  const saveRow = createEl('div', 'bp-row');
  const exportJsonBtn = createEl('button', 'btn-secondary', 'Download .json Save');
  exportJsonBtn.type = 'button';
  exportJsonBtn.id = 'btn-export-json';

  const importJsonLabel = createEl('label', 'btn-secondary');
  importJsonLabel.style.display = 'inline-flex';
  importJsonLabel.style.alignItems = 'center';
  importJsonLabel.textContent = 'Import .json Save';
  const importJsonInput = document.createElement('input');
  importJsonInput.type = 'file';
  importJsonInput.id = 'input-import-json';
  importJsonInput.accept = '.json,application/json';
  importJsonInput.hidden = true;
  importJsonLabel.appendChild(importJsonInput);

  const jsonStatus = createEl('div', 'bp-preview', '');
  saveRow.append(exportJsonBtn, importJsonLabel);
  saveSec.append(saveNote, saveRow, jsonStatus);

  // Section 4: krunked-cookie-vault-v1 Self-Healing & Runtime Diagnostics
  const diagSec = createEl('div', 'bp-section');
  diagSec.appendChild(createEl('span', 'section-title', 'krunked-cookie-vault-v1 Self-Healing & Runtime Diagnostics'));
  const diagSummary = createEl('div', 'bp-preview', 'Inspecting bidirectional vault status...');
  diagSummary.id = 'vault-diag-summary';

  const diagRow = createEl('div', 'bp-row');
  const wipePrimaryBtn = createEl('button', 'btn-secondary', 'Drill: Wipe LocalStorage & Reload');
  wipePrimaryBtn.type = 'button';
  wipePrimaryBtn.id = 'btn-drill-wipe-primary';

  const wipeCookieBtn = createEl('button', 'btn-secondary', 'Drill: Wipe Shadow Cookie & Reload');
  wipeCookieBtn.type = 'button';
  wipeCookieBtn.id = 'btn-drill-wipe-cookie';

  diagRow.append(wipePrimaryBtn, wipeCookieBtn);
  diagSec.append(diagSummary, diagRow);

  body.append(expSec, impSec, saveSec, diagSec);
  card.append(header, body);
  modalEl.appendChild(card);

  function updateImportPreview() {
    const raw = impInput.value.trim();
    if (!raw) {
      impPreview.className = 'bp-preview';
      impPreview.textContent = 'Paste a BP1_ token or URL hash to inspect.';
      impBtn.disabled = true;
      return;
    }
    const decoded = decodeBlueprint(raw);
    if (!decoded.ok) {
      impPreview.className = 'bp-preview is-error';
      impPreview.textContent = `Invalid blueprint: ${decoded.error}`;
      impBtn.disabled = true;
      return;
    }
    let activeMachines = 0;
    for (let i = 0; i < decoded.cells.length; i++) {
      if (decoded.cells[i].machineType > MACHINE_TYPES.PILLAR) {
        activeMachines++;
      }
    }
    impPreview.className = 'bp-preview is-valid';
    impPreview.textContent = `Valid BP01 · ${decoded.gridSize}×${decoded.gridSize} · Tier 0${decoded.tier} · ${activeMachines} machines`;
    impBtn.disabled = false;
  }

  function refresh() {
    const info = callbacks.onGetCurrentBlueprint?.();
    if (info) {
      activeHashString = info.hash || '';
      expInput.value = activeHashString;
      expMeta.textContent = `${info.gridSize}×${info.gridSize} · Tier 0${info.tier} · RLE + FNV-1a Checksum`;
    }
    const d = callbacks.onGetVaultDiagnostics?.();
    if (d) {
      diagSummary.className = d.selfHealed || d.cookieRegenerated ? 'bp-preview is-valid' : 'bp-preview';
      diagSummary.textContent =
        `Boot: source=${d.source} · selfHealed=${d.selfHealed} (${d.healedFrom || 'none'}) · cookieRegen=${d.cookieRegenerated} | ` +
        `PrimaryLS: ${d.hasPrimary ? 'PRESENT' : 'MISSING'} (${d.primaryBytes}B) | ` +
        `Cookie: ${d.hasCookie ? 'PRESENT' : 'MISSING'} (${d.cookieBytes}B) | ` +
        `SW: ${d.swState} | Audio: ${d.audioUnlocked ? 'UNLOCKED' : 'LOCKED'} (${d.audioContextState}) | 120f FPS: ${d.fps120}`;
    }
  }

  copyHashBtn.addEventListener('click', async () => {
    refresh();
    const ok = await copyTextSafe(activeHashString);
    copyHashBtn.textContent = ok ? 'Copied #blueprint=!' : 'Copy Failed';
    setTimeout(() => {
      copyHashBtn.textContent = 'Copy #blueprint=';
    }, 1800);
  });

  copyUrlBtn.addEventListener('click', async () => {
    refresh();
    const base = `${window.location.origin}${window.location.pathname}`;
    const fullUrl = `${base}${activeHashString}`;
    const ok = await copyTextSafe(fullUrl);
    copyUrlBtn.textContent = ok ? 'Copied Share URL!' : 'Copy Failed';
    setTimeout(() => {
      copyUrlBtn.textContent = 'Copy Share URL';
    }, 1800);
  });

  impInput.addEventListener('input', updateImportPreview);

  wipePrimaryBtn.addEventListener('click', () => {
    callbacks.onDrillWipePrimary?.();
  });

  wipeCookieBtn.addEventListener('click', () => {
    callbacks.onDrillWipeCookie?.();
  });

  impBtn.addEventListener('click', () => {
    const res = callbacks.onImportBlueprint?.(impInput.value);
    if (res?.ok) {
      impPreview.className = 'bp-preview is-valid';
      impPreview.textContent = `Loaded ${res.gridSize}×${res.gridSize} layout into cleanroom.`;
      refresh();
    } else {
      impPreview.className = 'bp-preview is-error';
      impPreview.textContent = res?.error || 'Failed to apply blueprint.';
    }
  });

  exportJsonBtn.addEventListener('click', () => {
    const out = callbacks.onExportJsonSave?.();
    if (!out?.jsonText) return;
    const blob = new Blob([out.jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = out.filename || 'swarm-tycoon-save.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    jsonStatus.className = 'bp-preview is-valid';
    jsonStatus.textContent = `Downloaded ${a.download}.`;
  });

  importJsonInput.addEventListener('change', async () => {
    const file = importJsonInput.files?.[0];
    importJsonInput.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const res = callbacks.onImportJsonSave?.(text);
      if (res?.ok) {
        jsonStatus.className = 'bp-preview is-valid';
        jsonStatus.textContent = 'Portable campaign save verified and restored.';
        refresh();
      } else {
        jsonStatus.className = 'bp-preview is-error';
        jsonStatus.textContent = `Import rejected: ${res?.error || 'Invalid save file'}`;
      }
    } catch {
      jsonStatus.className = 'bp-preview is-error';
      jsonStatus.textContent = 'Failed to read selected file.';
    }
  });

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

  function open(prefillHash = '') {
    isModalOpen = true;
    modalEl.hidden = false;
    jsonStatus.textContent = '';
    refresh();
    if (prefillHash) {
      impInput.value = prefillHash;
    }
    updateImportPreview();
  }

  return {
    open,
    close,
    refresh,
    isOpen: () => isModalOpen,
  };
}
