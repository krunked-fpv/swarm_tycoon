import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fnv1a32,
  fnv1aHex,
  base64UrlEncode,
  base64UrlDecode,
  encodeBlueprint,
  encodeBlueprintHash,
  decodeBlueprint,
} from '../src/persistence/blueprintCodec.js';
import {
  MIN_OFFLINE_MS,
  MAX_OFFLINE_MS,
  MAX_MACRO_SLICES,
  defaultCapByTier,
  solveOfflineCatchup,
} from '../src/persistence/offlineCatchupSolver.js';
import {
  PRIMARY_SAVE_KEY,
  DAILY_SAVE_KEY,
  COOKIE_VAULT_NAME,
  signPayload,
  verifyPayload,
  CookieVault,
} from '../src/persistence/cookieVault.js';
import {
  serializePortableSave,
  parsePortableSave,
} from '../src/persistence/portableSaveIo.js';

function makeEmptyLayout(gridSize, tier, agents = [-1, -1, -1, -1]) {
  const cells = new Array(gridSize * gridSize);
  for (let i = 0; i < cells.length; i++) {
    cells[i] = {
      machineType: 0,
      machineDir: 0,
      machineSub: 0,
      ln2Mask: 0,
      powerMask: 0,
      shuttleWaypoint: 0,
    };
  }
  return { gridSize, tier, agents: [...agents], cells };
}

function makeStarter8x8Layout() {
  const layout = makeEmptyLayout(8, 1, [0, -1, 3, -1]);
  const set = (x, y, patch) => {
    const idx = y * 8 + x;
    layout.cells[idx] = { ...layout.cells[idx], ...patch };
  };

  set(0, 1, { machineType: 13, machineDir: 1, ln2Mask: 0x16, powerMask: 0x14 }); // CRYO_CHILLER
  set(0, 2, { machineType: 6, machineDir: 1, ln2Mask: 0x17, powerMask: 0x17 });  // INGOT_SLICER
  set(1, 2, { machineType: 2, machineDir: 1, ln2Mask: 0x1a, powerMask: 0x1a });  // BELT_STRAIGHT
  set(2, 2, { machineType: 7, machineDir: 1, ln2Mask: 0x1a, powerMask: 0x1a });  // PHOTORESIST_COATER
  set(3, 2, { machineType: 8, machineDir: 1, ln2Mask: 0x1a, powerMask: 0x1a });  // EUV_SCANNER
  set(4, 2, { machineType: 9, machineDir: 1, ln2Mask: 0x1a, powerMask: 0x1a });  // PLASMA_ETCHER
  set(5, 2, { machineType: 3, machineDir: 1, machineSub: 0, ln2Mask: 0x1c, powerMask: 0x1c }); // BELT_CORNER
  set(5, 3, { machineType: 2, machineDir: 2, ln2Mask: 0x15, powerMask: 0x15 });
  set(4, 4, { machineType: 10, machineDir: 3, ln2Mask: 0x1a, powerMask: 0x1a }); // METROLOGY_QA
  set(1, 4, { machineType: 11, machineDir: 3, ln2Mask: 0x12, powerMask: 0x12 }); // WAFER_VAULT
  set(3, 3, { machineType: 12, machineDir: 0, ln2Mask: 0x14, powerMask: 0x14 }); // RECLAIM_GRINDER
  set(2, 5, { machineType: 16, machineDir: 0, machineSub: 0, shuttleWaypoint: 1 }); // FOUP pickup
  set(6, 5, { machineType: 16, machineDir: 2, machineSub: 1, shuttleWaypoint: 2 }); // FOUP dropoff
  set(7, 7, { machineType: 1, machineDir: 0 }); // PILLAR
  return layout;
}

function makeComplex28x28Layout() {
  const layout = makeEmptyLayout(28, 6, [5, 2, 0, 4]);
  const set = (x, y, patch) => {
    const idx = y * 28 + x;
    layout.cells[idx] = { ...layout.cells[idx], ...patch };
  };

  // Structural pillars, cryo loop, power busbars, production spine, and FOUP docks
  for (let x = 2; x <= 25; x++) {
    set(x, 2, { machineType: 2, machineDir: 1, ln2Mask: 0x1a, powerMask: 0x1a });
    set(x, 25, { machineType: 2, machineDir: 3, ln2Mask: 0x1a, powerMask: 0x1a });
  }
  for (let y = 3; y <= 24; y++) {
    set(25, y, { machineType: 2, machineDir: 2, ln2Mask: 0x15, powerMask: 0x15 });
    set(2, y, { machineType: 2, machineDir: 0, ln2Mask: 0x15, powerMask: 0x15 });
  }
  set(2, 2, { machineType: 6, machineDir: 1, ln2Mask: 0x16, powerMask: 0x16 });
  set(6, 2, { machineType: 7, machineDir: 1, ln2Mask: 0x1a, powerMask: 0x1a });
  set(10, 2, { machineType: 8, machineDir: 1, ln2Mask: 0x1a, powerMask: 0x1a });
  set(14, 2, { machineType: 9, machineDir: 1, ln2Mask: 0x1a, powerMask: 0x1a });
  set(18, 2, { machineType: 10, machineDir: 1, ln2Mask: 0x1a, powerMask: 0x1a });
  set(25, 2, { machineType: 3, machineDir: 1, machineSub: 0, ln2Mask: 0x1c, powerMask: 0x1c });
  set(25, 25, { machineType: 3, machineDir: 2, machineSub: 1, ln2Mask: 0x19, powerMask: 0x19 });
  set(2, 25, { machineType: 3, machineDir: 3, machineSub: 0, ln2Mask: 0x13, powerMask: 0x13 });

  set(0, 0, { machineType: 14, machineDir: 1, powerMask: 0x16 }); // POWER_SOURCE
  set(1, 0, { machineType: 15, machineDir: 1, powerMask: 0x1a }); // CAPACITOR_BANK
  set(0, 1, { machineType: 13, machineDir: 2, ln2Mask: 0x14 });  // CRYO_CHILLER
  set(12, 12, { machineType: 1, machineDir: 0 });               // PILLAR
  set(13, 12, { machineType: 1, machineDir: 0 });               // PILLAR
  set(4, 10, { machineType: 16, machineDir: 1, machineSub: 0, shuttleWaypoint: 1 });
  set(22, 20, { machineType: 16, machineDir: 3, machineSub: 1, shuttleWaypoint: 2 });
  set(10, 16, { machineType: 17, machineDir: 2, powerMask: 0x1f, ln2Mask: 0x1f }); // COMPUTE_RACK
  set(15, 20, { machineType: 11, machineDir: 3, powerMask: 0x1a }); // WAFER_VAULT
  set(18, 3, { machineType: 12, machineDir: 2, powerMask: 0x15 });  // RECLAIM_GRINDER
  return layout;
}

function makeMockStorage() {
  const map = new Map();
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(String(k), String(v));
    },
    removeItem(k) {
      map.delete(String(k));
    },
    clear() {
      map.clear();
    },
    _map: map,
  };
}

function makeMockCookieStore() {
  const jar = new Map();
  return {
    getCookie(name) {
      return jar.has(name) ? jar.get(name) : null;
    },
    setCookie(name, value, maxAgeSec = 31536000) {
      if (maxAgeSec <= 0 || value === '') {
        jar.delete(name);
      } else {
        jar.set(name, String(value));
      }
    },
    removeCookie(name) {
      jar.delete(name);
    },
    clear() {
      jar.clear();
    },
    _jar: jar,
  };
}

function makeForgedBlueprintBytes(mutateFn) {
  const baseToken = encodeBlueprint(makeStarter8x8Layout());
  const rawBytes = base64UrlDecode(baseToken.slice(4));
  const nextBytes = mutateFn(new Uint8Array(rawBytes));
  const checksum = fnv1a32(nextBytes.subarray(0, nextBytes.length - 4));
  const view = new DataView(nextBytes.buffer);
  view.setUint32(nextBytes.length - 4, checksum, false);
  return 'BP1_' + base64UrlEncode(nextBytes);
}

test('1. FNV-1a and Base64URL parity across Node Buffer and browser btoa/atob', () => {
  assert.equal(fnv1a32(''), 0x811c9dc5);
  assert.equal(fnv1aHex(''), '811c9dc5');
  assert.equal(fnv1aHex('foobar'), 'bf9cf968');

  const sample = Uint8Array.from([0, 1, 2, 127, 128, 254, 255, 66, 80, 48, 49]);
  const b64u = base64UrlEncode(sample);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(b64u), 'Base64URL output must be unpadded URL-safe');
  assert.deepEqual(base64UrlDecode(b64u), sample);

  // Verify browser btoa/atob implementation matches Buffer byte-for-byte
  const bin = String.fromCharCode(...sample);
  const browserB64u = globalThis.btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(b64u, browserB64u);

  // Exercise the actual browser btoa/atob code paths by temporarily hiding Buffer
  const savedBuffer = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined;
    const largeBytes = new Uint8Array(20000);
    for (let i = 0; i < largeBytes.length; i++) largeBytes[i] = (i * 37) & 0xff;
    const encNoBuf = base64UrlEncode(largeBytes);
    const decNoBuf = base64UrlDecode(encNoBuf);
    assert.deepEqual(decNoBuf, largeBytes);

    const bpNoBuf = encodeBlueprintHash(makeStarter8x8Layout());
    const decBpNoBuf = decodeBlueprint(bpNoBuf);
    assert.equal(decBpNoBuf.ok, true);
    assert.deepEqual(decBpNoBuf.cells, makeStarter8x8Layout().cells);
  } finally {
    globalThis.Buffer = savedBuffer;
  }

  assert.throws(() => base64UrlDecode('invalid!char'));
  assert.throws(() => base64UrlDecode('abcde')); // length % 4 === 1 is impossible in Base64
});

test('2. Lossless #blueprint= encode/decode across 8x8 starter and 28x28 complex fab layouts', () => {
  const starter = makeStarter8x8Layout();
  const bpStarter = encodeBlueprint(starter);
  assert.ok(bpStarter.startsWith('BP1_'));
  const hashStarter = encodeBlueprintHash(starter);
  assert.equal(hashStarter, `#blueprint=${bpStarter}`);

  const decStarter = decodeBlueprint(hashStarter);
  assert.equal(decStarter.ok, true);
  assert.equal(decStarter.gridSize, 8);
  assert.equal(decStarter.tier, 1);
  assert.deepEqual(decStarter.agents, [0, -1, 3, -1]);
  assert.deepEqual(decStarter.cells, starter.cells);

  // Ensure decoded cells do not share object references across RLE runs
  decStarter.cells[0].machineType = 17;
  assert.equal(decStarter.cells[1].machineType, 0);

  // Full URL extraction
  const fullUrl = `https://krunked-fpv.github.io/swarm_tycoon/${hashStarter}`;
  const decFromUrl = decodeBlueprint(fullUrl);
  assert.equal(decFromUrl.ok, true);
  assert.deepEqual(decFromUrl.cells, starter.cells);

  // Complex 28x28 with pipes, busbars, pillars, FOUP waypoints, and sector agents
  const complex28 = makeComplex28x28Layout();
  const bp28 = encodeBlueprint(complex28);
  const dec28 = decodeBlueprint(bp28);
  assert.equal(dec28.ok, true);
  assert.equal(dec28.gridSize, 28);
  assert.equal(dec28.tier, 6);
  assert.deepEqual(dec28.agents, [5, 2, 0, 4]);
  assert.deepEqual(dec28.cells, complex28.cells);
});

test('3. Blueprint decoder rejects corrupted checksums, bad headers, truncation, and RLE zip-bombs', () => {
  const validHash = encodeBlueprintHash(makeStarter8x8Layout());

  // Single character flip in payload triggers checksum mismatch
  const lastChar = validHash.at(-1);
  const flippedChar = lastChar === 'A' ? 'B' : 'A';
  const corruptedChecksum = validHash.slice(0, -1) + flippedChar;
  assert.equal(decodeBlueprint(corruptedChecksum).ok, false);

  // Bad prefix & empty input
  assert.equal(decodeBlueprint('BP2_AAAA').ok, false);
  assert.equal(decodeBlueprint('#blueprint=BP1_').ok, false);
  assert.equal(decodeBlueprint(null).ok, false);

  // Bad magic header (with recomputed valid checksum)
  const badMagic = makeForgedBlueprintBytes((b) => {
    b[0] = 0x58; // 'X'
    return b;
  });
  assert.equal(decodeBlueprint(badMagic).ok, false);

  // Unsupported version
  const badVersion = makeForgedBlueprintBytes((b) => {
    b[4] = 99;
    return b;
  });
  assert.equal(decodeBlueprint(badVersion).ok, false);

  // Out-of-bounds gridSize / tier
  const badGrid = makeForgedBlueprintBytes((b) => {
    b[5] = 29;
    return b;
  });
  assert.equal(decodeBlueprint(badGrid).ok, false);

  const badTier = makeForgedBlueprintBytes((b) => {
    b[6] = 7;
    return b;
  });
  assert.equal(decodeBlueprint(badTier).ok, false);

  // RLE zip-bomb: 8x8 grid with valid FNV-1a checksum claiming 65,535 cells in 1 run
  const zipBomb = (() => {
    const buf = new Uint8Array(13 + 6 + 4);
    const view = new DataView(buf.buffer);
    buf.set([0x42, 0x50, 0x30, 0x31, 1, 8, 1]);
    view.setInt8(7, -1);
    view.setInt8(8, -1);
    view.setInt8(9, -1);
    view.setInt8(10, -1);
    view.setUint16(11, 1, false);
    view.setUint16(13, 65535, false); // Zip-bomb count!
    view.setUint32(15, 0, false);
    view.setUint32(19, fnv1a32(buf.subarray(0, 19)), false);
    return 'BP1_' + base64UrlEncode(buf);
  })();
  const zipRes = decodeBlueprint(zipBomb);
  assert.equal(zipRes.ok, false);

  // Zero-count RLE run rejected even with valid checksum
  const zeroRun = (() => {
    const buf = new Uint8Array(13 + 12 + 4);
    const view = new DataView(buf.buffer);
    buf.set([0x42, 0x50, 0x30, 0x31, 1, 8, 1]);
    view.setInt8(7, -1);
    view.setInt8(8, -1);
    view.setInt8(9, -1);
    view.setInt8(10, -1);
    view.setUint16(11, 2, false);
    view.setUint16(13, 0, false); // zero-count run
    view.setUint32(15, 0, false);
    view.setUint16(19, 64, false);
    view.setUint32(21, 0, false);
    view.setUint32(25, fnv1a32(buf.subarray(0, 25)), false);
    return 'BP1_' + base64UrlEncode(buf);
  })();
  assert.equal(decodeBlueprint(zeroRun).ok, false);

  // Cumulative cell sum < gridSize*gridSize rejected
  const shortSum = (() => {
    const buf = new Uint8Array(13 + 6 + 4);
    const view = new DataView(buf.buffer);
    buf.set([0x42, 0x50, 0x30, 0x31, 1, 8, 1]);
    view.setInt8(7, -1);
    view.setInt8(8, -1);
    view.setInt8(9, -1);
    view.setInt8(10, -1);
    view.setUint16(11, 1, false);
    view.setUint16(13, 63, false); // should be 64
    view.setUint32(15, 0, false);
    view.setUint32(19, fnv1a32(buf.subarray(0, 19)), false);
    return 'BP1_' + base64UrlEncode(buf);
  })();
  assert.equal(decodeBlueprint(shortSum).ok, false);
});

test('4. Offline catch-up solver: bounds, 7-day clamping, clock rollback, anti-tamper ceiling, and <5ms speed', () => {
  assert.equal(MIN_OFFLINE_MS, 0);
  assert.equal(MAX_OFFLINE_MS, 604800000);
  assert.equal(MAX_MACRO_SLICES, 28);

  const baseParams = {
    tClose: 1_795_000_000_000,
    hwmDiesPerMin: 120,
    fleetLevel: 3,
    tier: 2,
    prestigeLevels: [2, 1, 0, 0, 0, 0, 0, 0, 0],
    agents: [0, 2, -1, -1],
  };

  // 0ms
  const zeroRes = solveOfflineCatchup({ ...baseParams, tOpen: baseParams.tClose });
  assert.equal(zeroRes.validDeltaMs, 0);
  assert.equal(zeroRes.clockRollback, false);
  assert.equal(zeroRes.capped, false);
  assert.equal(zeroRes.slicesSimulated, 0);
  assert.deepEqual(zeroRes.diesEarned, { m: 0, e: 0 });
  assert.deepEqual(zeroRes.flopsEarned, { m: 0, e: 0 });

  // 1 hour
  const oneHourRes = solveOfflineCatchup({ ...baseParams, tOpen: baseParams.tClose + 3_600_000 });
  assert.equal(oneHourRes.validDeltaMs, 3_600_000);
  assert.equal(oneHourRes.clockRollback, false);
  assert.equal(oneHourRes.capped, false);
  assert.ok(oneHourRes.slicesSimulated >= 1 && oneHourRes.slicesSimulated <= 28);
  assert.ok(oneHourRes.diesEarned.m >= 1 && oneHourRes.diesEarned.m < 10);
  assert.ok(oneHourRes.flopsEarned.m >= 1 && oneHourRes.flopsEarned.m < 10);
  assert.ok(oneHourRes.elapsedMs < 5, `1h solve took ${oneHourRes.elapsedMs}ms`);

  // 7 days (604,800,000 ms)
  const sevenDayRes = solveOfflineCatchup({ ...baseParams, tOpen: baseParams.tClose + MAX_OFFLINE_MS });
  assert.equal(sevenDayRes.validDeltaMs, MAX_OFFLINE_MS);
  assert.equal(sevenDayRes.clockRollback, false);
  assert.equal(sevenDayRes.capped, false);
  assert.equal(sevenDayRes.slicesSimulated, 28);
  assert.ok(sevenDayRes.elapsedMs < 5, `7d solve took ${sevenDayRes.elapsedMs}ms`);
  assert.ok(
    sevenDayRes.diesEarned.e > oneHourRes.diesEarned.e ||
      (sevenDayRes.diesEarned.e === oneHourRes.diesEarned.e && sevenDayRes.diesEarned.m > oneHourRes.diesEarned.m),
    '7-day yield must strictly exceed 1-hour yield'
  );

  // 50 years clamped deterministically to 7 days
  const fiftyYearsMs = 50 * 365 * 24 * 60 * 60 * 1000;
  const fiftyYearRes = solveOfflineCatchup({ ...baseParams, tOpen: baseParams.tClose + fiftyYearsMs });
  assert.equal(fiftyYearRes.validDeltaMs, MAX_OFFLINE_MS);
  assert.equal(fiftyYearRes.clockRollback, false);
  assert.equal(fiftyYearRes.capped, true);
  assert.equal(fiftyYearRes.slicesSimulated, 28);
  assert.deepEqual(fiftyYearRes.diesEarned, sevenDayRes.diesEarned);
  assert.deepEqual(fiftyYearRes.flopsEarned, sevenDayRes.flopsEarned);
  assert.ok(fiftyYearRes.elapsedMs < 5, `50y solve took ${fiftyYearRes.elapsedMs}ms`);

  // Negative -500,000ms clock rollback returns zero yield + clockRollback: true
  const rollbackRes = solveOfflineCatchup({ ...baseParams, tOpen: baseParams.tClose - 500_000 });
  assert.equal(rollbackRes.validDeltaMs, 0);
  assert.equal(rollbackRes.clockRollback, true);
  assert.equal(rollbackRes.capped, false);
  assert.equal(rollbackRes.slicesSimulated, 0);
  assert.deepEqual(rollbackRes.diesEarned, { m: 0, e: 0 });
  assert.deepEqual(rollbackRes.flopsEarned, { m: 0, e: 0 });

  // Tampered hwmDiesPerMin, fleetLevel, and prestigeLevels strictly clamped to theoretical ceiling
  const maxAllowedRate = defaultCapByTier(1) * 60;
  const legitimateCapRun = solveOfflineCatchup({
    tClose: 1_000_000,
    tOpen: 1_000_000 + MAX_OFFLINE_MS,
    hwmDiesPerMin: maxAllowedRate,
    fleetLevel: 500,
    tier: 1,
    prestigeLevels: new Array(9).fill(1000),
    agents: [0, 1, 2, 3],
  });
  const tamperedRun = solveOfflineCatchup({
    tClose: 1_000_000,
    tOpen: 1_000_000 + MAX_OFFLINE_MS,
    hwmDiesPerMin: 1e35,
    fleetLevel: 999999,
    tier: 1,
    prestigeLevels: new Array(9).fill(999999),
    agents: [0, 1, 2, 3],
  });
  assert.equal(tamperedRun.tamperClamped, true);
  assert.deepEqual(tamperedRun.diesEarned, legitimateCapRun.diesEarned);
  assert.deepEqual(tamperedRun.flopsEarned, legitimateCapRun.flopsEarned);
  assert.ok(tamperedRun.elapsedMs < 5);
});

test('5. CookieVault bidirectional self-healing, corruption rejection, <3800B budget, and Daily isolation', () => {
  const ls = makeMockStorage();
  const cookieStore = makeMockCookieStore();
  const idbWrites = [];
  const indexedDb = {
    put(key, val) {
      idbWrites.push({ key, val });
    },
  };

  const vault = new CookieVault({ localStorage: ls, cookieStore, indexedDb });
  const complex28 = makeComplex28x28Layout();
  const tSave = 1_795_414_700_000;

  const campaignState = {
    tier: 6,
    dies: { m: 4.25, e: 14 },
    flops: { m: 9.1, e: 18 },
    lifetimeFlops: { m: 2.5, e: 21 },
    shards: 42,
    hwmDiesPerMin: 185000,
    fleetLevel: 24,
    prestige: [3, 2, 1, 4, 0, 2, 1, 0, 5],
    agents: [5, 2, 0, 4],
    entropies: [1.5, 0, 3.2, 0.4],
    paperclips: 12,
    audio: { vol: 0.75, mute: false },
    layout: complex28,
  };

  const saveRes = vault.saveCampaign(campaignState, tSave);
  assert.equal(saveRes.ok, true);
  assert.ok(
    saveRes.cookieBytes < 3800,
    `Expected cookieBytes < 3800 on full 28x28 layout, got ${saveRes.cookieBytes}`
  );
  assert.ok(ls.getItem(PRIMARY_SAVE_KEY) !== null);
  assert.ok(cookieStore.getCookie(COOKIE_VAULT_NAME) !== null);
  assert.equal(idbWrites.length, 1);

  // Baseline hydrate when both stores agree
  const baseline = vault.hydrateCampaign(tSave + 10_000);
  assert.equal(baseline.source, 'localStorage');
  assert.equal(baseline.selfHealed, false);
  assert.equal(baseline.cookieRegenerated, false);
  assert.deepEqual(baseline.state.layout.cells, complex28.cells);
  assert.deepEqual(baseline.state.agents, [5, 2, 0, 4]);

  // 1) Wipe localStorage -> self-heal from krunked-cookie-vault-v1 + restore PRIMARY_SAVE_KEY
  ls.clear();
  assert.equal(ls.getItem(PRIMARY_SAVE_KEY), null);
  const healedFromCookie = vault.hydrateCampaign(tSave + 20_000);
  assert.equal(healedFromCookie.source, 'cookie');
  assert.equal(healedFromCookie.selfHealed, true);
  assert.equal(healedFromCookie.healedFrom, 'cookie');
  assert.equal(healedFromCookie.cookieRegenerated, false);
  assert.deepEqual(healedFromCookie.state.dies, { m: 4.25, e: 14 });
  assert.deepEqual(healedFromCookie.state.lifetimeFlops, { m: 2.5, e: 21 });
  assert.equal(healedFromCookie.state.shards, 42);
  assert.deepEqual(healedFromCookie.state.layout.cells, complex28.cells);
  assert.ok(ls.getItem(PRIMARY_SAVE_KEY) !== null, 'PRIMARY_SAVE_KEY must be restored in localStorage');

  // 2) Clear cookie -> regenerate krunked-cookie-vault-v1 from localStorage
  cookieStore.clear();
  assert.equal(cookieStore.getCookie(COOKIE_VAULT_NAME), null);
  const healedCookie = vault.hydrateCampaign(tSave + 30_000);
  assert.equal(healedCookie.source, 'localStorage');
  assert.equal(healedCookie.selfHealed, false);
  assert.equal(healedCookie.healedFrom, 'localStorage');
  assert.equal(healedCookie.cookieRegenerated, true);
  assert.ok(cookieStore.getCookie(COOKIE_VAULT_NAME) !== null, 'Cookie must be regenerated');

  // 3) Corrupt krunked-cookie-vault-v1 checksum -> rejected cleanly, repaired from valid localStorage
  const validCookieStr = cookieStore.getCookie(COOKIE_VAULT_NAME);
  const decodedCookieJson = JSON.parse(Buffer.from(validCookieStr, 'base64url').toString('utf8'));
  decodedCookieJson.shards = 999999; // tamper without updating sig
  cookieStore.setCookie(
    COOKIE_VAULT_NAME,
    Buffer.from(JSON.stringify(decodedCookieJson), 'utf8').toString('base64url')
  );
  const afterCorruptCookie = vault.hydrateCampaign(tSave + 40_000);
  assert.equal(afterCorruptCookie.source, 'localStorage');
  assert.equal(afterCorruptCookie.cookieRegenerated, true);
  assert.equal(afterCorruptCookie.state.shards, 42);

  // Confirm cookie itself was repaired with authentic data
  ls.clear();
  const verifyRepairedCookie = vault.hydrateCampaign(tSave + 50_000);
  assert.equal(verifyRepairedCookie.source, 'cookie');
  assert.equal(verifyRepairedCookie.state.shards, 42);

  // 4) Forged future timestamp (> nowMs + 60s) rejected when non-future alternative exists
  const forgedPrimary = JSON.parse(ls.getItem(PRIMARY_SAVE_KEY));
  const reSignedForged = signPayload({
    ...forgedPrimary,
    tClose: tSave + 5_000_000,
    lifetimeFlops: { m: 9.9, e: 999 },
  });
  ls.setItem(PRIMARY_SAVE_KEY, JSON.stringify(reSignedForged));
  const rejectFuture = vault.hydrateCampaign(tSave + 60_000);
  assert.equal(rejectFuture.source, 'cookie');
  assert.equal(rejectFuture.selfHealed, true);
  assert.deepEqual(rejectFuture.state.lifetimeFlops, { m: 2.5, e: 21 });

  // 5) Daily save isolation verified
  const dailyOk = vault.saveDailyState({
    seedId: 123456,
    dateStr: '2026-11-23',
    bestScore: 9850,
  });
  assert.equal(dailyOk, true);
  assert.equal(vault.loadDailyState().bestScore, 9850);
  assert.equal(JSON.parse(ls.getItem(PRIMARY_SAVE_KEY)).shards, 42);

  // Tampered daily state rejected
  const rawDaily = JSON.parse(ls.getItem(DAILY_SAVE_KEY));
  rawDaily.bestScore = 9999999;
  ls.setItem(DAILY_SAVE_KEY, JSON.stringify(rawDaily));
  assert.equal(vault.loadDailyState(), null);

  // Both corrupted -> fresh state
  ls.setItem(PRIMARY_SAVE_KEY, '{corrupt');
  cookieStore.setCookie(COOKIE_VAULT_NAME, 'not-valid-cookie');
  const fresh = vault.hydrateCampaign(tSave + 70_000);
  assert.deepEqual(fresh, {
    state: null,
    source: 'fresh',
    selfHealed: false,
    cookieRegenerated: false,
  });
});

test('6. CookieVault works seamlessly with plain document.cookie style adapter', () => {
  const ls = makeMockStorage();
  const mockDoc = { cookie: '' };
  const vault = new CookieVault({ localStorage: ls, cookieStore: mockDoc });

  const starter = makeStarter8x8Layout();
  const saveRes = vault.saveCampaign({
    tier: 1,
    dies: { m: 2.5, e: 3 },
    flops: { m: 5, e: 5 },
    lifetimeFlops: { m: 5, e: 5 },
    layout: starter,
  }, 1_795_414_700_000);

  assert.equal(saveRes.ok, true);
  assert.ok(mockDoc.cookie.includes(`${COOKIE_VAULT_NAME}=`));

  ls.clear();
  const healed = vault.hydrateCampaign(1_795_414_710_000);
  assert.equal(healed.source, 'cookie');
  assert.equal(healed.selfHealed, true);
  assert.deepEqual(healed.state.layout.cells, starter.cells);
});

test('7. Portable .json export/import round-trip and malformed/tampered JSON rejection', () => {
  const state = {
    tClose: 1_795_414_700_000,
    tier: 6,
    dies: { m: 3.14, e: 12 },
    flops: { m: 7.77, e: 16 },
    lifetimeFlops: { m: 9.2, e: 18 },
    shards: 15,
    hwmDiesPerMin: 84000,
    fleetLevel: 18,
    prestige: [1, 1, 2, 0, 3, 1, 0, 2, 1],
    agents: [5, 2, 0, 4],
    entropies: [0.5, 1.2, 0, 0],
    paperclips: 3,
    audio: { vol: 0.5, mute: true },
    layout: makeComplex28x28Layout(),
  };

  const json = serializePortableSave(state);
  const imported = parsePortableSave(json);
  assert.equal(imported.ok, true);
  assert.equal(imported.state.tier, 6);
  assert.equal(imported.state.shards, 15);
  assert.deepEqual(imported.state.dies, { m: 3.14, e: 12 });
  assert.deepEqual(imported.state.layout.cells, state.layout.cells);
  assert.equal(verifyPayload(imported.state), true);

  // Broken JSON / wrong types / missing fields
  assert.equal(parsePortableSave('{broken json').ok, false);
  assert.equal(parsePortableSave('').ok, false);
  assert.equal(parsePortableSave('[]').ok, false);
  assert.equal(parsePortableSave('{}').ok, false);
  assert.equal(parsePortableSave(null).ok, false);

  // Tampered value with original sig
  const tamperedObj = JSON.parse(json);
  tamperedObj.shards = 999999;
  assert.equal(parsePortableSave(JSON.stringify(tamperedObj)).ok, false);

  // Re-signed payload with invalid schema bounds (tier = 99)
  const badSchemaSigned = signPayload({ ...tamperedObj, shards: 15, tier: 99 });
  assert.equal(parsePortableSave(JSON.stringify(badSchemaSigned)).ok, false);
});

test('8. Dual-valid arbitration selects higher lifetimeFlops or latest non-future tClose', () => {
  const ls = makeMockStorage();
  const cookieStore = makeMockCookieStore();
  const vault = new CookieVault({ localStorage: ls, cookieStore });
  const t0 = 1_795_414_700_000;

  // Save baseline to both
  vault.saveCampaign({
    tier: 1,
    dies: { m: 1, e: 2 },
    flops: { m: 1, e: 3 },
    lifetimeFlops: { m: 2, e: 4 },
    shards: 1,
    layout: makeStarter8x8Layout(),
  }, t0);

  // Advance primary with higher lifetimeFlops while cookie lags behind
  const oldCookie = cookieStore.getCookie(COOKIE_VAULT_NAME);
  vault.saveCampaign({
    tier: 1,
    dies: { m: 5, e: 3 },
    flops: { m: 8, e: 4 },
    lifetimeFlops: { m: 9, e: 5 },
    shards: 5,
    layout: makeStarter8x8Layout(),
  }, t0 + 10_000);
  cookieStore.setCookie(COOKIE_VAULT_NAME, oldCookie);

  const primaryWins = vault.hydrateCampaign(t0 + 20_000);
  assert.equal(primaryWins.source, 'localStorage');
  assert.equal(primaryWins.cookieRegenerated, true);
  assert.equal(primaryWins.state.shards, 5);

  // Now put strictly higher lifetimeFlops in cookie than primary -> cookie wins & heals localStorage
  const newerCookie = cookieStore.getCookie(COOKIE_VAULT_NAME);
  vault.saveCampaign({
    tier: 1,
    dies: { m: 1, e: 2 },
    flops: { m: 1, e: 3 },
    lifetimeFlops: { m: 2, e: 4 },
    shards: 1,
    layout: makeStarter8x8Layout(),
  }, t0 + 25_000);
  cookieStore.setCookie(COOKIE_VAULT_NAME, newerCookie);

  const cookieWins = vault.hydrateCampaign(t0 + 30_000);
  assert.equal(cookieWins.source, 'cookie');
  assert.equal(cookieWins.selfHealed, true);
  assert.equal(cookieWins.healedFrom, 'cookie');
  assert.equal(cookieWins.state.shards, 5);

  // Equal lifetimeFlops: latest non-future tClose wins
  vault.saveCampaign({
    tier: 1,
    dies: { m: 1, e: 2 },
    flops: { m: 1, e: 3 },
    lifetimeFlops: { m: 9, e: 5 },
    shards: 7,
    layout: makeStarter8x8Layout(),
  }, t0 + 40_000);
  const t40Cookie = cookieStore.getCookie(COOKIE_VAULT_NAME);

  vault.saveCampaign({
    tier: 1,
    dies: { m: 1, e: 2 },
    flops: { m: 1, e: 3 },
    lifetimeFlops: { m: 9, e: 5 },
    shards: 6,
    layout: makeStarter8x8Layout(),
  }, t0 + 35_000);
  cookieStore.setCookie(COOKIE_VAULT_NAME, t40Cookie);

  const tieBreak = vault.hydrateCampaign(t0 + 50_000);
  assert.equal(tieBreak.source, 'cookie');
  assert.equal(tieBreak.selfHealed, true);
  assert.equal(tieBreak.state.shards, 7);
});
