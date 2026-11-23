/**
 * Swarm Tycoon: Silicon Foundry — Overflow-Proof BigSilicon Arithmetic.
 * Canonical plain-object wire format: { m: number, e: number }
 *   Zero:     { m: 0, e: 0 }
 *   Non-zero: 1 <= Math.abs(m) < 10, Number.isSafeInteger(e)
 *
 * Supports exponents far beyond IEEE-754 float64 limits (past 1e308 up to 1e100000+)
 * without Infinity or NaN propagation.
 *
 * Pure ES Module: zero DOM, Phaser, storage, or Node-runtime dependencies.
 */

const SI_PREFIXES = Object.freeze([
  '',
  'K',
  'M',
  'G',
  'T',
  'Peta',
  'Exa',
  'Zetta',
  'Yotta',
  'Ronna',
  'Quetta',
]);

const MAX_SAFE_EXP = Number.MAX_SAFE_INTEGER;
const MIN_SAFE_EXP = Number.MIN_SAFE_INTEGER;
const STRING_NUM_RE = /^([+-])?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;

/**
 * Scales a finite non-zero float by 10^pow10 without overflowing intermediate powers of 10.
 * @param {number} val
 * @param {number} pow10
 * @returns {number}
 */
function scaleByPow10(val, pow10) {
  let out = val;
  let rem = pow10;
  while (rem > 300) {
    out *= 1e300;
    rem -= 300;
  }
  while (rem < -300) {
    out /= 1e300;
    rem += 300;
  }
  if (rem > 0) {
    out *= Math.pow(10, rem);
  } else if (rem < 0) {
    out /= Math.pow(10, -rem);
  }
  return out;
}

/**
 * Returns canonical zero { m: 0, e: 0 }.
 * @returns {{ m: number, e: number }}
 */
export function bsZero() {
  return { m: 0, e: 0 };
}

/**
 * Normalizes mantissa m and exponent e into canonical { m, e }.
 * Rejects non-finite inputs gracefully to { m: 0, e: 0 }.
 * @param {number} m
 * @param {number} e
 * @returns {{ m: number, e: number }}
 */
export function bsNormalize(m, e = 0) {
  if (typeof m !== 'number' || typeof e !== 'number' || !Number.isFinite(m) || !Number.isFinite(e)) {
    return { m: 0, e: 0 };
  }
  if (m === 0) {
    return { m: 0, e: 0 };
  }

  let mant = m;
  let exp = Math.trunc(e);
  const fracExp = e - exp;
  if (fracExp !== 0) {
    // Fold fractional exponent cleanly into mantissa before integer normalization.
    mant *= Math.pow(10, fracExp);
    if (!Number.isFinite(mant) || mant === 0) {
      return { m: 0, e: 0 };
    }
  }

  const abs = Math.abs(mant);
  const shift = Math.floor(Math.log10(abs));
  if (Number.isFinite(shift) && shift !== 0) {
    mant = scaleByPow10(mant, -shift);
    exp += shift;
  }

  // Guard against boundary float rounding (e.g. 9.999999999999999 or 0.9999999999999999)
  let guard = 0;
  while (guard++ < 8 && mant !== 0) {
    const curAbs = Math.abs(mant);
    if (curAbs >= 10) {
      mant /= 10;
      exp += 1;
    } else if (curAbs < 1) {
      mant *= 10;
      exp -= 1;
    } else {
      break;
    }
  }

  if (!Number.isFinite(mant) || mant === 0) {
    return { m: 0, e: 0 };
  }
  if (exp < MIN_SAFE_EXP) {
    return { m: 0, e: 0 };
  }
  if (exp > MAX_SAFE_EXP) {
    exp = MAX_SAFE_EXP;
  }
  if (!Number.isSafeInteger(exp)) {
    return { m: 0, e: 0 };
  }

  return { m: mant, e: exp };
}

/**
 * Parses a decimal/scientific string directly into BigSilicon without float64 overflow.
 * @param {string} raw
 * @returns {{ m: number, e: number }}
 */
function parseBigSiliconString(raw) {
  const trimmed = raw.trim();
  const match = STRING_NUM_RE.exec(trimmed);
  if (!match) {
    return { m: 0, e: 0 };
  }

  const sign = match[1] === '-' ? -1 : 1;
  const intDigits = match[2] || '';
  const fracDigits = match[3] || match[4] || '';
  const expStr = match[5];

  let parsedExp = 0;
  if (expStr !== undefined) {
    parsedExp = Number.parseInt(expStr, 10);
    if (!Number.isFinite(parsedExp)) {
      return { m: 0, e: 0 };
    }
    if (parsedExp < MIN_SAFE_EXP) {
      return { m: 0, e: 0 };
    }
    if (parsedExp > MAX_SAFE_EXP) {
      parsedExp = MAX_SAFE_EXP;
    }
  }

  const combined = intDigits + fracDigits;
  let firstNonZero = -1;
  for (let i = 0; i < combined.length; i++) {
    if (combined.charCodeAt(i) !== 48) {
      firstNonZero = i;
      break;
    }
  }
  if (firstNonZero < 0) {
    return { m: 0, e: 0 };
  }

  const sigDigits = combined.slice(firstNonZero, firstNonZero + 17);
  const mantStr = sigDigits.length > 1 ? `${sigDigits[0]}.${sigDigits.slice(1)}` : sigDigits[0];
  const m = sign * Number(mantStr);
  const shift = intDigits.length - 1 - firstNonZero;
  return bsNormalize(m, parsedExp + shift);
}

/**
 * Converts a number, numeric string ("1.4e500"), or { m, e } object into canonical BigSilicon.
 * @param {number | string | { m: number, e: number }} input
 * @returns {{ m: number, e: number }}
 */
export function bsFrom(input) {
  if (input === null || input === undefined) {
    return { m: 0, e: 0 };
  }
  if (typeof input === 'number') {
    return bsNormalize(input, 0);
  }
  if (typeof input === 'string') {
    return parseBigSiliconString(input);
  }
  if (typeof input === 'object' && 'm' in input && 'e' in input) {
    return bsNormalize(input.m, input.e);
  }
  return { m: 0, e: 0 };
}

/**
 * Checks whether v is a strictly canonical, finite, safe BigSilicon struct.
 * @param {unknown} v
 * @returns {boolean}
 */
export function bsIsValid(v) {
  if (v === null || typeof v !== 'object') {
    return false;
  }
  const { m, e } = /** @type {{ m: unknown, e: unknown }} */ (v);
  if (typeof m !== 'number' || typeof e !== 'number') {
    return false;
  }
  if (!Number.isFinite(m) || !Number.isSafeInteger(e)) {
    return false;
  }
  if (m === 0) {
    return e === 0 && !Object.is(m, -0);
  }
  const abs = Math.abs(m);
  return abs >= 1 && abs < 10;
}

/**
 * Sanitizes arbitrary input into a canonical BigSilicon value, using fallback on invalid data.
 * @param {unknown} v
 * @param {{ m: number, e: number }} [fallback]
 * @returns {{ m: number, e: number }}
 */
export function bsSanitize(v, fallback = { m: 0, e: 0 }) {
  const safeFallback = bsIsValid(fallback) ? { m: fallback.m, e: fallback.e } : bsFrom(fallback);

  if (v === null || v === undefined) {
    return safeFallback;
  }
  if (typeof v === 'number') {
    return Number.isFinite(v) ? bsNormalize(v, 0) : safeFallback;
  }
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (!STRING_NUM_RE.test(trimmed)) {
      return safeFallback;
    }
    return parseBigSiliconString(trimmed);
  }
  if (typeof v === 'object' && 'm' in v && 'e' in v) {
    const obj = /** @type {{ m: unknown, e: unknown }} */ (v);
    if (typeof obj.m !== 'number' || typeof obj.e !== 'number') {
      return safeFallback;
    }
    if (!Number.isFinite(obj.m) || !Number.isFinite(obj.e)) {
      return safeFallback;
    }
    return bsNormalize(obj.m, obj.e);
  }
  return safeFallback;
}

/**
 * Coerces any accepted BigSilicon input quickly without reallocating valid canonical structs.
 * @param {number | string | { m: number, e: number }} v
 * @returns {{ m: number, e: number }}
 */
function coerce(v) {
  return bsIsValid(v) ? /** @type {{ m: number, e: number }} */ (v) : bsFrom(v);
}

/**
 * Adds two BigSilicon values: a + b.
 * @param {number | string | { m: number, e: number }} a
 * @param {number | string | { m: number, e: number }} b
 * @returns {{ m: number, e: number }}
 */
export function bsAdd(a, b) {
  let x = coerce(a);
  let y = coerce(b);
  if (x.m === 0) return { m: y.m, e: y.e };
  if (y.m === 0) return { m: x.m, e: x.e };

  if (y.e > x.e) {
    const tmp = x;
    x = y;
    y = tmp;
  }

  const diff = x.e - y.e;
  if (diff > 18) {
    return { m: x.m, e: x.e };
  }

  const sumMant = x.m + y.m / Math.pow(10, diff);
  return bsNormalize(sumMant, x.e);
}

/**
 * Signed subtraction: a - b.
 * @param {number | string | { m: number, e: number }} a
 * @param {number | string | { m: number, e: number }} b
 * @returns {{ m: number, e: number }}
 */
export function bsSub(a, b) {
  const y = coerce(b);
  if (y.m === 0) {
    const x = coerce(a);
    return { m: x.m, e: x.e };
  }
  return bsAdd(a, { m: -y.m, e: y.e });
}

/**
 * Non-negative clamped subtraction: max(0, a - b).
 * @param {number | string | { m: number, e: number }} a
 * @param {number | string | { m: number, e: number }} b
 * @returns {{ m: number, e: number }}
 */
export function bsSubClamped(a, b) {
  const x = coerce(a);
  const y = coerce(b);
  if (bsCmp(x, y) <= 0) {
    return { m: 0, e: 0 };
  }
  const diff = bsSub(x, y);
  return diff.m <= 0 ? { m: 0, e: 0 } : diff;
}

/**
 * Multiplies two BigSilicon values: a * b.
 * @param {number | string | { m: number, e: number }} a
 * @param {number | string | { m: number, e: number }} b
 * @returns {{ m: number, e: number }}
 */
export function bsMul(a, b) {
  const x = coerce(a);
  const y = coerce(b);
  if (x.m === 0 || y.m === 0) {
    return { m: 0, e: 0 };
  }
  return bsNormalize(x.m * y.m, x.e + y.e);
}

/**
 * Divides two BigSilicon values: a / b. Guards division by zero to { m: 0, e: 0 }.
 * @param {number | string | { m: number, e: number }} a
 * @param {number | string | { m: number, e: number }} b
 * @returns {{ m: number, e: number }}
 */
export function bsDiv(a, b) {
  const x = coerce(a);
  const y = coerce(b);
  if (x.m === 0 || y.m === 0) {
    return { m: 0, e: 0 };
  }
  return bsNormalize(x.m / y.m, x.e - y.e);
}

/**
 * Three-way comparison: -1 (a < b), 0 (a == b), 1 (a > b).
 * @param {number | string | { m: number, e: number }} a
 * @param {number | string | { m: number, e: number }} b
 * @returns {-1 | 0 | 1}
 */
export function bsCmp(a, b) {
  const x = coerce(a);
  const y = coerce(b);

  if (x.m === 0 && y.m === 0) return 0;
  if (x.m === 0) return y.m > 0 ? -1 : 1;
  if (y.m === 0) return x.m > 0 ? 1 : -1;

  const xPos = x.m > 0;
  const yPos = y.m > 0;
  if (xPos !== yPos) {
    return xPos ? 1 : -1;
  }

  if (x.e !== y.e) {
    if (xPos) return x.e > y.e ? 1 : -1;
    return x.e > y.e ? -1 : 1;
  }

  if (x.m === y.m) return 0;
  return x.m > y.m ? 1 : -1;
}

/**
 * Returns the larger of two BigSilicon values.
 * @param {number | string | { m: number, e: number }} a
 * @param {number | string | { m: number, e: number }} b
 * @returns {{ m: number, e: number }}
 */
export function bsMax(a, b) {
  const x = coerce(a);
  const y = coerce(b);
  const winner = bsCmp(x, y) >= 0 ? x : y;
  return { m: winner.m, e: winner.e };
}

/**
 * Returns the smaller of two BigSilicon values.
 * @param {number | string | { m: number, e: number }} a
 * @param {number | string | { m: number, e: number }} b
 * @returns {{ m: number, e: number }}
 */
export function bsMin(a, b) {
  const x = coerce(a);
  const y = coerce(b);
  const winner = bsCmp(x, y) <= 0 ? x : y;
  return { m: winner.m, e: winner.e };
}

/**
 * Computes base-10 logarithm without float64 overflow: e + log10(m).
 * Returns -Infinity for zero and NaN for negative numbers.
 * @param {number | string | { m: number, e: number }} a
 * @returns {number}
 */
export function bsLog10(a) {
  const x = coerce(a);
  if (x.m === 0) return -Infinity;
  if (x.m < 0) return NaN;
  return x.e + Math.log10(x.m);
}

/**
 * Computes 10^expFloat as canonical BigSilicon without float64 overflow.
 * @param {number} expFloat
 * @returns {{ m: number, e: number }}
 */
export function bsPow10(expFloat) {
  if (typeof expFloat !== 'number' || !Number.isFinite(expFloat)) {
    return { m: 0, e: 0 };
  }
  if (expFloat < MIN_SAFE_EXP) {
    return { m: 0, e: 0 };
  }
  const e = Math.floor(expFloat);
  const frac = expFloat - e;
  const m = Math.pow(10, frac);
  return bsNormalize(m, e);
}

/**
 * Converts BigSilicon to native JS number (returns +/-Infinity beyond float64 range).
 * @param {number | string | { m: number, e: number }} a
 * @returns {number}
 */
export function bsToNumber(a) {
  const x = coerce(a);
  if (x.m === 0) return 0;
  if (x.e > 308) return x.m > 0 ? Infinity : -Infinity;
  if (x.e < -325) return 0;
  return Number(`${x.m}e${x.e}`);
}

/**
 * Formats a scaled mantissa (< 1000) to 3 significant digits.
 * @param {number} scaled
 * @returns {string}
 */
function formatEngineeringMantissa(scaled) {
  if (scaled < 10) return scaled.toFixed(2);
  if (scaled < 100) return scaled.toFixed(1);
  return scaled.toFixed(0);
}

/**
 * Formats a BigSilicon value using SI/engineering notation up to Quetta (1e30)
 * and crisp scientific notation ("1.42e450") at 1e33 and above.
 * Examples:
 *   bsFormat({ m: 1.42, e: 16 }, 'Dies')  -> "14.2 Peta-Dies"
 *   bsFormat({ m: 3.8, e: 21 }, 'FLOPs')  -> "3.80 Zetta-FLOPs"
 *   bsFormat({ m: 1.42, e: 450 })         -> "1.42e450"
 * @param {number | string | { m: number, e: number }} v
 * @param {string} [unit='']
 * @returns {string}
 */
export function bsFormat(v, unit = '') {
  const x = coerce(v);
  const cleanUnit = unit ? String(unit).trim() : '';

  if (x.m === 0) {
    return cleanUnit ? `0 ${cleanUnit}` : '0';
  }

  const signStr = x.m < 0 ? '-' : '';
  const absM = Math.abs(x.m);
  const exp = x.e;

  if (exp >= 33) {
    const numStr = `${signStr}${absM.toFixed(2)}e${exp}`;
    return cleanUnit ? `${numStr} ${cleanUnit}` : numStr;
  }

  if (exp < 0) {
    if (exp >= -2) {
      const val = absM * Math.pow(10, exp);
      const numStr = `${signStr}${val.toFixed(2)}`;
      return cleanUnit ? `${numStr} ${cleanUnit}` : numStr;
    }
    const numStr = `${signStr}${absM.toFixed(2)}e${exp}`;
    return cleanUnit ? `${numStr} ${cleanUnit}` : numStr;
  }

  if (exp < 3) {
    const val = absM * Math.pow(10, exp);
    if (val >= 999.5) {
      return cleanUnit ? `${signStr}1.00K ${cleanUnit}` : `${signStr}1.00K`;
    }
    const roundedInt = Math.round(val);
    let numStr;
    if (Math.abs(val - roundedInt) < 1e-9) {
      numStr = `${signStr}${roundedInt}`;
    } else {
      numStr = `${signStr}${formatEngineeringMantissa(val)}`;
    }
    return cleanUnit ? `${numStr} ${cleanUnit}` : numStr;
  }

  let tier = Math.floor(exp / 3);
  let rem = exp - tier * 3;
  let scaled = absM * Math.pow(10, rem);

  // Prevent rounding to "1000" within a prefix tier (e.g. 999.9K -> 1.00M)
  if (scaled >= 999.5) {
    tier += 1;
    scaled /= 1000;
  }

  if (tier >= SI_PREFIXES.length) {
    const bumpedExp = tier * 3;
    const numStr = `${signStr}${scaled.toFixed(2)}e${bumpedExp}`;
    return cleanUnit ? `${numStr} ${cleanUnit}` : numStr;
  }

  const prefix = SI_PREFIXES[tier];
  const numStr = `${signStr}${formatEngineeringMantissa(scaled)}`;

  if (prefix.length === 1) {
    return cleanUnit ? `${numStr}${prefix} ${cleanUnit}` : `${numStr}${prefix}`;
  }
  return cleanUnit ? `${numStr} ${prefix}-${cleanUnit}` : `${numStr} ${prefix}`;
}
