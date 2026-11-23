/**
 * @fileoverview Portable `.json` campaign save export and hardened import validator.
 * Enforces canonical FNV-1a signature verification and full schema + blueprint checks.
 * Pure ES Module with zero dependencies on sim/economy/render/ui.
 */

import {
  signPayload,
  buildCanonicalCampaignRecord,
  validatePrimarySaveRecord,
} from './cookieVault.js';

export const MAX_PORTABLE_SAVE_BYTES = 2 * 1024 * 1024;

/**
 * Serializes a campaign state object into a signed, portable `.json` string.
 * @param {Record<string, any>} state
 * @returns {string}
 */
export function serializePortableSave(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('serializePortableSave expects a campaign state object');
  }
  const timestamp = typeof state.tClose === 'number' && Number.isFinite(state.tClose) && state.tClose >= 0
    ? state.tClose
    : Date.now();
  const canonical = buildCanonicalCampaignRecord(state, timestamp);
  const signed = signPayload(canonical);
  return JSON.stringify(signed, null, 2);
}

/**
 * Parses and strictly validates a portable `.json` campaign save string.
 * Rejects malformed JSON, broken schemas, invalid blueprints, or tampered signatures cleanly.
 * @param {string} jsonText
 * @returns {{ ok: true, state: Record<string, any> } | { ok: false, error: string }}
 */
export function parsePortableSave(jsonText) {
  if (typeof jsonText !== 'string') {
    return { ok: false, error: 'Portable save input must be a JSON string' };
  }
  const trimmed = jsonText.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Empty portable save payload' };
  }
  if (trimmed.length > MAX_PORTABLE_SAVE_BYTES) {
    return { ok: false, error: 'Portable save exceeds maximum allowed size' };
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: 'Malformed JSON syntax' };
  }

  return validatePrimarySaveRecord(parsed);
}
