/**
 * @fileoverview Lossless bit-packed RLE + Base64URL cleanroom blueprint codec
 * and deterministic FNV-1a 32-bit checksum utilities.
 * Pure ES Module with zero dependencies on sim/economy/render/ui.
 */

export const BP_PREFIX = 'BP1_';
export const BP_HASH_PREFIX = '#blueprint=';
export const BP_VERSION = 1;
export const MIN_GRID_DIM = 8;
export const MAX_GRID_DIM = 28;
export const MIN_TIER = 1;
export const MAX_TIER = 6;

const FNV1A_OFFSET_BASIS = 0x811c9dc5;
const FNV1A_PRIME = 0x01000193;

const textEncoder = new TextEncoder();
const textDecoderFatal = new TextDecoder('utf-8', { fatal: true });

/**
 * Converts supported inputs into a Uint8Array byte view.
 * @param {Uint8Array | ArrayBuffer | ArrayLike<number> | string} input
 * @returns {Uint8Array}
 */
function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof input === 'string') return textEncoder.encode(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (Array.isArray(input)) return Uint8Array.from(input);
  throw new TypeError('Unsupported byte input for FNV-1a');
}

/**
 * Computes unsigned 32-bit FNV-1a checksum over bytes or UTF-8 string.
 * @param {Uint8Array | ArrayBuffer | ArrayLike<number> | string} input
 * @returns {number} Unsigned 32-bit integer
 */
export function fnv1a32(input) {
  const bytes = toBytes(input);
  let hash = FNV1A_OFFSET_BASIS;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, FNV1A_PRIME);
  }
  return hash >>> 0;
}

/**
 * Computes 8-character lowercase hexadecimal FNV-1a 32-bit digest.
 * @param {Uint8Array | ArrayBuffer | ArrayLike<number> | string} input
 * @returns {string}
 */
export function fnv1aHex(input) {
  return fnv1a32(input).toString(16).padStart(8, '0');
}

/**
 * Encodes a Uint8Array into unpadded Base64URL (works in both Browser & Node).
 * @param {Uint8Array | ArrayBuffer} bytes
 * @returns {string}
 */
export function base64UrlEncode(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64url');
  }
  let binary = '';
  const chunkSize = 0x2000;
  for (let i = 0; i < u8.length; i += chunkSize) {
    const chunk = u8.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return globalThis.btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Decodes a Base64URL string into a Uint8Array (works in both Browser & Node).
 * Rejects malformed characters or invalid lengths cleanly.
 * @param {string} str
 * @returns {Uint8Array}
 */
export function base64UrlDecode(str) {
  if (typeof str !== 'string') {
    throw new TypeError('Base64URL input must be a string');
  }
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(str)) {
    throw new Error('Invalid Base64URL characters');
  }
  const clean = str.replace(/=+$/, '');
  if (clean.length % 4 === 1) {
    throw new Error('Invalid Base64URL length');
  }
  if (clean.length === 0) {
    return new Uint8Array(0);
  }
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(clean, 'base64url'));
  }
  const padLen = (4 - (clean.length % 4)) % 4;
  const b64 = clean.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
  const binary = globalThis.atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Encodes a UTF-8 string into Base64URL.
 * @param {string} str
 * @returns {string}
 */
export function utf8ToBase64Url(str) {
  return base64UrlEncode(textEncoder.encode(str));
}

/**
 * Decodes a Base64URL string as strict UTF-8 text.
 * @param {string} b64url
 * @returns {string}
 */
export function base64UrlToUtf8(b64url) {
  return textDecoderFatal.decode(base64UrlDecode(b64url));
}

/**
 * Packs one cleanroom cell into its 32-bit bitfield representation (SPEC 5.3).
 * @param {Record<string, any> | null | undefined} cell
 * @returns {number}
 */
export function packCell(cell) {
  if (!cell || typeof cell !== 'object') return 0;
  const type = (cell.machineType ?? cell.type ?? 0) & 0x1f;
  const dir = (cell.machineDir ?? cell.dir ?? 0) & 0x3;
  const sub = (cell.machineSub ?? cell.sub ?? 0) & 0x3;
  const ln2Mask = (cell.ln2Mask ?? 0) & 0x1f;
  const powerMask = (cell.powerMask ?? 0) & 0x1f;
  const shuttleWaypoint = (cell.shuttleWaypoint ?? 0) & 0x3;
  return (
    type |
    (dir << 5) |
    (sub << 7) |
    (ln2Mask << 9) |
    (powerMask << 14) |
    (shuttleWaypoint << 19)
  ) >>> 0;
}

/**
 * Unpacks a 32-bit bitfield into canonical GridEngine cell snapshot shape.
 * @param {number} packed
 * @returns {{ machineType: number, machineDir: number, machineSub: number, ln2Mask: number, powerMask: number, shuttleWaypoint: number }}
 */
export function unpackCell(packed) {
  const p = packed >>> 0;
  return {
    machineType: p & 0x1f,
    machineDir: (p >>> 5) & 0x3,
    machineSub: (p >>> 7) & 0x3,
    ln2Mask: (p >>> 9) & 0x1f,
    powerMask: (p >>> 14) & 0x1f,
    shuttleWaypoint: (p >>> 19) & 0x3,
  };
}

function inferTierFromGridSize(gridSize) {
  if (gridSize <= 8) return 1;
  if (gridSize <= 12) return 2;
  if (gridSize <= 16) return 3;
  if (gridSize <= 20) return 4;
  if (gridSize <= 24) return 5;
  return 6;
}

/**
 * Normalizes and validates a layout snapshot before RLE encoding.
 * @param {{ gridSize?: number, tier?: number, agents?: number[], cells?: any[] }} snapshot
 */
function normalizeSnapshotForEncode(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Blueprint snapshot must be an object');
  }
  const cells = snapshot.cells;
  if (!Array.isArray(cells)) {
    throw new Error('Blueprint snapshot requires a cells array');
  }
  const gridSize = snapshot.gridSize ?? Math.sqrt(cells.length);
  if (!Number.isInteger(gridSize) || gridSize < MIN_GRID_DIM || gridSize > MAX_GRID_DIM) {
    throw new RangeError(`gridSize must be an integer in [${MIN_GRID_DIM}, ${MAX_GRID_DIM}]`);
  }
  const expectedCells = gridSize * gridSize;
  if (cells.length !== expectedCells) {
    throw new RangeError(`cells.length (${cells.length}) must equal gridSize*gridSize (${expectedCells})`);
  }

  const tier = snapshot.tier ?? inferTierFromGridSize(gridSize);
  if (!Number.isInteger(tier) || tier < MIN_TIER || tier > MAX_TIER) {
    throw new RangeError(`tier must be an integer in [${MIN_TIER}, ${MAX_TIER}]`);
  }

  const agents = [-1, -1, -1, -1];
  if (snapshot.agents !== undefined) {
    if (!Array.isArray(snapshot.agents) && !ArrayBuffer.isView(snapshot.agents)) {
      throw new TypeError('agents must be an array of 4 integers in [-1, 5]');
    }
    for (let i = 0; i < 4; i++) {
      const a = snapshot.agents[i] ?? -1;
      if (!Number.isInteger(a) || a < -1 || a > 5) {
        throw new RangeError(`agents[${i}] must be an integer in [-1, 5]`);
      }
      agents[i] = a;
    }
  }

  return { gridSize, tier, agents, cells, expectedCells };
}

/**
 * Encodes a cleanroom layout snapshot into `"BP1_<base64url>"`.
 * @param {{ gridSize?: number, tier?: number, agents?: number[], cells: any[] }} snapshot
 * @returns {string}
 */
export function encodeBlueprint(snapshot) {
  const { gridSize, tier, agents, cells, expectedCells } = normalizeSnapshotForEncode(snapshot);

  const runs = [];
  let currentPacked = packCell(cells[0]);
  let currentCount = 1;

  for (let i = 1; i < expectedCells; i++) {
    const nextPacked = packCell(cells[i]);
    if (nextPacked === currentPacked) {
      currentCount++;
    } else {
      runs.push([currentCount, currentPacked]);
      currentPacked = nextPacked;
      currentCount = 1;
    }
  }
  runs.push([currentCount, currentPacked]);

  const runCount = runs.length;
  const totalBytes = 13 + runCount * 6 + 4;
  const bytes = new Uint8Array(totalBytes);
  const view = new DataView(bytes.buffer);

  // Header: "BP01" + version + gridSize + tier + 4x Int8 agents + Uint16 BE runCount
  bytes[0] = 0x42; // 'B'
  bytes[1] = 0x50; // 'P'
  bytes[2] = 0x30; // '0'
  bytes[3] = 0x31; // '1'
  bytes[4] = BP_VERSION;
  bytes[5] = gridSize;
  bytes[6] = tier;
  for (let i = 0; i < 4; i++) {
    view.setInt8(7 + i, agents[i]);
  }
  view.setUint16(11, runCount, false);

  // RLE run table
  let offset = 13;
  for (let r = 0; r < runCount; r++) {
    view.setUint16(offset, runs[r][0], false);
    view.setUint32(offset + 2, runs[r][1], false);
    offset += 6;
  }

  // Trailing Uint32 BE FNV-1a checksum over all preceding bytes
  const checksum = fnv1a32(bytes.subarray(0, totalBytes - 4));
  view.setUint32(totalBytes - 4, checksum, false);

  return BP_PREFIX + base64UrlEncode(bytes);
}

/**
 * Encodes a cleanroom layout snapshot into `"#blueprint=BP1_<base64url>"`.
 * @param {{ gridSize?: number, tier?: number, agents?: number[], cells: any[] }} snapshot
 * @returns {string}
 */
export function encodeBlueprintHash(snapshot) {
  return BP_HASH_PREFIX + encodeBlueprint(snapshot);
}

/**
 * Extracts the `"BP1_..."` token from a raw token, `#blueprint=` hash, or full URL.
 * @param {string} input
 * @returns {string}
 */
function extractBlueprintToken(input) {
  const trimmed = input.trim();
  const hashIdx = trimmed.indexOf(BP_HASH_PREFIX);
  if (hashIdx >= 0) {
    return trimmed.slice(hashIdx + BP_HASH_PREFIX.length).trim();
  }
  return trimmed;
}

/**
 * Decodes and strictly validates a `#blueprint=BP1_...`, `BP1_...`, or full URL string.
 * Neutralizes corrupted checksums, bad headers, truncated buffers, and RLE zip-bombs.
 * @param {string} input
 * @returns {{ ok: true, gridSize: number, tier: number, agents: number[], cells: any[] } | { ok: false, error: string }}
 */
export function decodeBlueprint(input) {
  if (typeof input !== 'string') {
    return { ok: false, error: 'Blueprint input must be a string' };
  }

  const token = extractBlueprintToken(input);
  if (!token.startsWith(BP_PREFIX)) {
    return { ok: false, error: 'Missing BP1_ prefix' };
  }

  const encoded = token.slice(BP_PREFIX.length);
  if (encoded.length === 0) {
    return { ok: false, error: 'Empty blueprint payload' };
  }

  let bytes;
  try {
    bytes = base64UrlDecode(encoded);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Base64URL decode failed' };
  }

  // Minimum valid frame: 13B header + 1*6B run + 4B checksum = 23B
  if (bytes.length < 23) {
    return { ok: false, error: 'Truncated blueprint payload' };
  }

  if (bytes[0] !== 0x42 || bytes[1] !== 0x50 || bytes[2] !== 0x30 || bytes[3] !== 0x31) {
    return { ok: false, error: 'Invalid blueprint magic header' };
  }

  if (bytes[4] !== BP_VERSION) {
    return { ok: false, error: `Unsupported blueprint version: ${bytes[4]}` };
  }

  const gridSize = bytes[5];
  if (gridSize < MIN_GRID_DIM || gridSize > MAX_GRID_DIM) {
    return { ok: false, error: `Invalid gridSize: ${gridSize}` };
  }

  const tier = bytes[6];
  if (tier < MIN_TIER || tier > MAX_TIER) {
    return { ok: false, error: `Invalid tier: ${tier}` };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const agents = [
    view.getInt8(7),
    view.getInt8(8),
    view.getInt8(9),
    view.getInt8(10),
  ];
  for (let i = 0; i < 4; i++) {
    if (agents[i] < -1 || agents[i] > 5) {
      return { ok: false, error: `Invalid agent index at slot ${i}: ${agents[i]}` };
    }
  }

  const expectedTotalCells = gridSize * gridSize;
  const runCount = view.getUint16(11, false);
  if (runCount < 1 || runCount > expectedTotalCells) {
    return { ok: false, error: `Invalid runCount: ${runCount}` };
  }

  const expectedByteLen = 13 + runCount * 6 + 4;
  if (bytes.length !== expectedByteLen) {
    return { ok: false, error: 'Blueprint byte length mismatch' };
  }

  const storedChecksum = view.getUint32(expectedByteLen - 4, false);
  const actualChecksum = fnv1a32(bytes.subarray(0, expectedByteLen - 4));
  if (storedChecksum !== actualChecksum) {
    return { ok: false, error: 'Blueprint checksum mismatch' };
  }

  const cells = new Array(expectedTotalCells);
  let cursor = 0;
  let offset = 13;

  for (let r = 0; r < runCount; r++) {
    const count = view.getUint16(offset, false);
    const packed = view.getUint32(offset + 2, false);
    offset += 6;

    if (count === 0) {
      return { ok: false, error: 'Zero-count RLE run rejected' };
    }
    if (cursor + count > expectedTotalCells) {
      return { ok: false, error: 'RLE cumulative cell count exceeds grid capacity' };
    }

    const template = unpackCell(packed);
    for (let k = 0; k < count; k++) {
      cells[cursor++] = {
        machineType: template.machineType,
        machineDir: template.machineDir,
        machineSub: template.machineSub,
        ln2Mask: template.ln2Mask,
        powerMask: template.powerMask,
        shuttleWaypoint: template.shuttleWaypoint,
      };
    }
  }

  if (cursor !== expectedTotalCells) {
    return { ok: false, error: 'RLE cumulative cell count does not fill grid' };
  }

  return {
    ok: true,
    gridSize,
    tier,
    agents,
    cells,
  };
}
