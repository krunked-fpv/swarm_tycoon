/**
 * Procedural 2:1 Isometric Cleanroom Texture Atlas
 * Generates crisp offscreen <canvas> equipment, floor, conduit, wafer, shuttle,
 * and VFX sprites registered into Phaser's TextureManager (100% offline, zero external images).
 */

export const PALETTE = Object.freeze({
  SLATE_DEEP: '#080C12',
  SLATE: '#121B28',
  SLATE_MID: '#1C2A3E',
  SLATE_LIGHT: '#2B3E59',
  STEEL_EDGE: '#3A506E',
  CYAN: '#00F0FF',
  FROST: '#38BDF8',
  GOLD: '#FFB800',
  CRIMSON: '#FF3B5C',
  EMERALD: '#10F5A0',
  WHITE: '#E6F4FF',
});

export const TEX_TILE_W = 64;
export const TEX_TILE_H = 32;

const HALF_W = TEX_TILE_W * 0.5;
const HALF_H = TEX_TILE_H * 0.5;

// Direction edge vectors in canonical grid space (0=N, 1=E, 2=S, 3=W)
const DIR_OFFSET = [
  [0, -0.5],  // N
  [0.5, 0],   // E
  [0, 0.5],   // S
  [-0.5, 0],  // W
];

function createCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function registerCanvas(scene, key, canvas) {
  if (!scene.textures.exists(key)) {
    scene.textures.addCanvas(key, canvas);
  }
}

/**
 * Rotate machine-local (fx forward, fy right) into grid-local (u along +X, v along +Y).
 */
function rotUV(fx, fy, dir) {
  switch (dir & 3) {
    case 0: return [fy, -fx];   // N: forward=-Y, right=+X
    case 1: return [fx, fy];    // E: forward=+X, right=+Y
    case 2: return [-fy, fx];   // S: forward=+Y, right=-X
    default: return [-fx, -fy]; // W: forward=-X, right=-Y
  }
}

function isoPt(cx, cy, u, v, zPx = 0) {
  return [cx + (u - v) * HALF_W, cy + (u + v) * HALF_H - zPx];
}

function isoLocal(cx, cy, dir, fx, fy, zPx = 0) {
  const [u, v] = rotUV(fx, fy, dir);
  return isoPt(cx, cy, u, v, zPx);
}

function tracePoly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i][0], pts[i][1]);
  }
  ctx.closePath();
}

function drawIsoDiamond(ctx, cx, cy, halfSpan = 0.5, zPx = 0) {
  const pts = [
    isoPt(cx, cy, -halfSpan, -halfSpan, zPx),
    isoPt(cx, cy, halfSpan, -halfSpan, zPx),
    isoPt(cx, cy, halfSpan, halfSpan, zPx),
    isoPt(cx, cy, -halfSpan, halfSpan, zPx),
  ];
  tracePoly(ctx, pts);
}

/**
 * Draws an extruded 2:1 isometric prism defined in machine-local (fx, fy) bounds.
 * Automatically resolves world-aligned (u, v) bounds so shading & occlusion stay exact across dirs 0..3.
 */
function drawIsoBox(ctx, cx, cy, dir, fx0, fy0, fx1, fy1, z0, z1, colors) {
  const p00 = rotUV(fx0, fy0, dir);
  const p10 = rotUV(fx1, fy0, dir);
  const p01 = rotUV(fx0, fy1, dir);
  const p11 = rotUV(fx1, fy1, dir);

  const uMin = Math.min(p00[0], p10[0], p01[0], p11[0]);
  const uMax = Math.max(p00[0], p10[0], p01[0], p11[0]);
  const vMin = Math.min(p00[1], p10[1], p01[1], p11[1]);
  const vMax = Math.max(p00[1], p10[1], p01[1], p11[1]);

  const { top, left, right, stroke = '#080C12' } = colors;

  // Front-left face (v = vMax)
  tracePoly(ctx, [
    isoPt(cx, cy, uMin, vMax, z1),
    isoPt(cx, cy, uMax, vMax, z1),
    isoPt(cx, cy, uMax, vMax, z0),
    isoPt(cx, cy, uMin, vMax, z0),
  ]);
  ctx.fillStyle = left;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Front-right face (u = uMax)
  tracePoly(ctx, [
    isoPt(cx, cy, uMax, vMin, z1),
    isoPt(cx, cy, uMax, vMax, z1),
    isoPt(cx, cy, uMax, vMax, z0),
    isoPt(cx, cy, uMax, vMin, z0),
  ]);
  ctx.fillStyle = right;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Top face (z = z1)
  tracePoly(ctx, [
    isoPt(cx, cy, uMin, vMin, z1),
    isoPt(cx, cy, uMax, vMin, z1),
    isoPt(cx, cy, uMax, vMax, z1),
    isoPt(cx, cy, uMin, vMax, z1),
  ]);
  ctx.fillStyle = top;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/**
 * Draws a multi-box machine assembly with automatic isometric painter's sorting.
 */
function drawSortedParts(ctx, cx, cy, dir, parts) {
  const decorated = parts.map((p) => {
    const [uA, vA] = rotUV(p.fx0, p.fy0, dir);
    const [uB, vB] = rotUV(p.fx1, p.fy1, dir);
    const uMid = (uA + uB) * 0.5;
    const vMid = (vA + vB) * 0.5;
    return { p, depth: uMid + vMid + p.z0 * 0.004 };
  });
  decorated.sort((a, b) => a.depth - b.depth);
  for (let i = 0; i < decorated.length; i++) {
    const { p } = decorated[i];
    drawIsoBox(ctx, cx, cy, dir, p.fx0, p.fy0, p.fx1, p.fy1, p.z0, p.z1, p.colors);
  }
}

function drawIsoArrow(ctx, cx, cy, dir, fx, fy, zPx, color, scale = 0.14) {
  const tip = isoLocal(cx, cy, dir, fx + scale, fy, zPx);
  const wL = isoLocal(cx, cy, dir, fx - scale * 0.7, fy - scale * 0.85, zPx);
  const tail = isoLocal(cx, cy, dir, fx - scale * 0.25, fy, zPx);
  const wR = isoLocal(cx, cy, dir, fx - scale * 0.7, fy + scale * 0.85, zPx);
  tracePoly(ctx, [tip, wL, tail, wR]);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawIsoRing(ctx, cx, cy, rx, ry, stroke, fill = null, lineWidth = 1.5) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function drawFloorTile(variant) {
  // 64x36 with diamond center at (32, 16) -> origin (0.5, 16/36)
  const canvas = createCanvas(64, 36);
  const ctx = canvas.getContext('2d');
  const cx = 32;
  const cy = 16;

  // Raised cleanroom floor slab edge (2px thickness)
  tracePoly(ctx, [
    isoPt(cx, cy, -0.5, 0.5, 0),
    isoPt(cx, cy, 0.5, 0.5, 0),
    isoPt(cx, cy, 0.5, 0.5, -3),
    isoPt(cx, cy, -0.5, 0.5, -3),
  ]);
  ctx.fillStyle = '#090E16';
  ctx.fill();

  tracePoly(ctx, [
    isoPt(cx, cy, 0.5, -0.5, 0),
    isoPt(cx, cy, 0.5, 0.5, 0),
    isoPt(cx, cy, 0.5, 0.5, -3),
    isoPt(cx, cy, 0.5, -0.5, -3),
  ]);
  ctx.fillStyle = '#070B11';
  ctx.fill();

  // Main raised floor diamond
  drawIsoDiamond(ctx, cx, cy, 0.495, 0);
  ctx.fillStyle = variant === 1 ? '#111A27' : '#0E1621';
  ctx.fill();
  ctx.strokeStyle = variant === 2 ? '#FFB800' : '#1E2C42';
  ctx.lineWidth = variant === 2 ? 1.3 : 1;
  ctx.stroke();

  // Subtle inner cleanroom laminar-airflow perforation dots
  ctx.fillStyle = variant === 2 ? 'rgba(255, 184, 0, 0.28)' : 'rgba(8, 12, 18, 0.65)';
  for (let u = -0.24; u <= 0.25; u += 0.16) {
    for (let v = -0.24; v <= 0.25; v += 0.16) {
      const [px, py] = isoPt(cx, cy, u, v, 0);
      ctx.fillRect(Math.round(px) - 0.5, Math.round(py) - 0.5, 1.4, 1);
    }
  }

  // Substation (0,0) corner pad marker
  if (variant === 2) {
    drawIsoDiamond(ctx, cx, cy, 0.34, 0);
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 184, 0, 0.15)';
    ctx.fill();
  }

  return canvas;
}

function drawConduitTile(kind, mask) {
  const canvas = createCanvas(64, 34);
  const ctx = canvas.getContext('2d');
  const cx = 32;
  const cy = 17;
  const isLn2 = kind === 'ln2';
  // Elevate LN2 cryo loops slightly (-2.5px) above recessed Power busbars (+0.5px)
  const zPx = isLn2 ? 2.5 : -0.5;

  const jacket = isLn2 ? '#12304A' : '#3A2607';
  const core = isLn2 ? PALETTE.FROST : PALETTE.GOLD;
  const highlight = isLn2 ? PALETTE.CYAN : '#FFE484';

  const [hx, hy] = isoPt(cx, cy, 0, 0, zPx);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let d = 0; d < 4; d++) {
    if ((mask & (1 << d)) === 0) continue;
    const [du, dv] = DIR_OFFSET[d];
    const [ex, ey] = isoPt(cx, cy, du, dv, zPx);

    ctx.strokeStyle = jacket;
    ctx.lineWidth = isLn2 ? 5.2 : 4.4;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    ctx.strokeStyle = core;
    ctx.lineWidth = isLn2 ? 2.8 : 2.2;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    ctx.strokeStyle = highlight;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(hx, hy - 0.5);
    ctx.lineTo(ex, ey - 0.5);
    ctx.stroke();
  }

  // Manifold junction hub
  drawIsoRing(ctx, hx, hy, isLn2 ? 4.2 : 3.6, isLn2 ? 2.3 : 2.0, jacket, core, 1.2);
  drawIsoRing(ctx, hx, hy - 0.5, 1.8, 1.0, null, highlight, 0);

  return canvas;
}

function drawBeltCanvas(type, dir, sub) {
  const canvas = createCanvas(64, 40);
  const ctx = canvas.getContext('2d');
  const cx = 32;
  const cy = 23;

  // Base conveyor chassis
  drawIsoBox(ctx, cx, cy, dir, -0.44, -0.34, 0.44, 0.34, 0, 4, {
    top: '#172334',
    left: '#0F1824',
    right: '#0A1019',
    stroke: '#24354E',
  });

  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';

  const drawTrackSegment = (fx0, fy0, fx1, fy1) => {
    const a = isoLocal(cx, cy, dir, fx0, fy0, 4.5);
    const b = isoLocal(cx, cy, dir, fx1, fy1, 4.5);
    ctx.strokeStyle = '#090E16';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();

    ctx.strokeStyle = '#1E2D44';
    ctx.lineWidth = 7.5;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  };

  if (type === 2) {
    // BELT_STRAIGHT
    drawTrackSegment(-0.48, 0, 0.48, 0);
    drawIsoArrow(ctx, cx, cy, dir, -0.15, 0, 5.0, PALETTE.CYAN, 0.12);
    drawIsoArrow(ctx, cx, cy, dir, 0.18, 0, 5.0, PALETTE.CYAN, 0.12);
  } else if (type === 3) {
    // BELT_CORNER: enters along dir (from -fx), exits CW (+fy, sub=0) or CCW (-fy, sub=1)
    const turnSign = sub === 1 ? -1 : 1;
    const pIn = isoLocal(cx, cy, dir, -0.48, 0, 4.5);
    const pMid = isoLocal(cx, cy, dir, 0, 0, 4.5);
    const pOut = isoLocal(cx, cy, dir, 0, 0.48 * turnSign, 4.5);

    ctx.strokeStyle = '#090E16';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(pIn[0], pIn[1]);
    ctx.quadraticCurveTo(pMid[0], pMid[1], pOut[0], pOut[1]);
    ctx.stroke();

    ctx.strokeStyle = '#1E2D44';
    ctx.lineWidth = 7.5;
    ctx.beginPath();
    ctx.moveTo(pIn[0], pIn[1]);
    ctx.quadraticCurveTo(pMid[0], pMid[1], pOut[0], pOut[1]);
    ctx.stroke();

    const outDir = (dir + (sub === 1 ? 3 : 1)) & 3;
    drawIsoArrow(ctx, cx, cy, dir, -0.18, 0, 5.0, PALETTE.FROST, 0.1);
    drawIsoArrow(ctx, cx, cy, outDir, 0.18, 0, 5.0, PALETTE.CYAN, 0.12);
  } else if (type === 4) {
    // BELT_SPLITTER
    drawTrackSegment(-0.48, 0, 0.48, 0);
    drawTrackSegment(0, -0.48, 0, 0.48);
    drawIsoBox(ctx, cx, cy, dir, -0.16, -0.18, 0.16, 0.18, 4, 11, {
      top: '#243854',
      left: '#152234',
      right: '#0F1927',
      stroke: PALETTE.CYAN,
    });
    drawIsoArrow(ctx, cx, cy, dir, 0.3, 0, 5.2, PALETTE.CYAN, 0.1);
    drawIsoArrow(ctx, cx, cy, (dir + 1) & 3, 0.3, 0, 5.2, PALETTE.FROST, 0.09);
    drawIsoArrow(ctx, cx, cy, (dir + 3) & 3, 0.3, 0, 5.2, PALETTE.FROST, 0.09);
  } else {
    // BELT_MERGER
    drawTrackSegment(-0.48, 0, 0.48, 0);
    drawTrackSegment(0, -0.48, 0, 0.48);
    drawIsoBox(ctx, cx, cy, dir, -0.16, -0.18, 0.16, 0.18, 4, 11, {
      top: '#2D3A4F',
      left: '#182436',
      right: '#111A28',
      stroke: PALETTE.GOLD,
    });
    drawIsoArrow(ctx, cx, cy, dir, 0.3, 0, 5.2, PALETTE.GOLD, 0.12);
  }

  return canvas;
}

function drawMachineCanvas(type, dir, sub) {
  if (type >= 2 && type <= 5) {
    return drawBeltCanvas(type, dir, sub);
  }

  // Tall cleanroom equipment canvas: 64x68, ground diamond center at (32, 51)
  // Phaser origin = (0.5, 51 / 68) = (0.5, 0.75)
  const canvas = createCanvas(64, 68);
  const ctx = canvas.getContext('2d');
  const cx = 32;
  const cy = 51;

  // Base isolation plinth shadow
  drawIsoDiamond(ctx, cx, cy, 0.48, 0);
  ctx.fillStyle = 'rgba(4, 7, 11, 0.65)';
  ctx.fill();

  switch (type) {
    case 1: {
      // PILLAR: Structural cleanroom column
      drawIsoBox(ctx, cx, cy, 1, -0.34, -0.34, 0.34, 0.34, 0, 6, {
        top: '#263448', left: '#182334', right: '#111926', stroke: '#3A506E',
      });
      drawIsoBox(ctx, cx, cy, 1, -0.24, -0.24, 0.24, 0.24, 6, 36, {
        top: '#324560', left: '#1D2B40', right: '#141E2E', stroke: '#0A0F18',
      });
      // Hazard gold-cyan trim band
      drawIsoBox(ctx, cx, cy, 1, -0.26, -0.26, 0.26, 0.26, 26, 29, {
        top: PALETTE.GOLD, left: '#B88400', right: '#855E00', stroke: '#080C12',
      });
      break;
    }

    case 6: {
      // INGOT_SLICER: Boule cradle + diamond wire gantry
      drawSortedParts(ctx, cx, cy, dir, [
        { fx0: -0.4, fy0: -0.4, fx1: 0.4, fy1: 0.4, z0: 0, z1: 9, colors: { top: '#1E2D42', left: '#131E2D', right: '#0D1520', stroke: '#344A68' } },
        { fx0: -0.32, fy0: -0.3, fx1: 0.0, fy1: 0.3, z0: 9, z1: 28, colors: { top: '#2E4360', left: '#1A283C', right: '#121D2D', stroke: '#080C12' } },
        // Silicon crystal boule cylinder stack
        { fx0: -0.24, fy0: -0.14, fx1: -0.02, fy1: 0.14, z0: 28, z1: 38, colors: { top: PALETTE.FROST, left: '#1D5E8C', right: '#134263', stroke: '#080C12' } },
        // Output wafer stage
        { fx0: 0.05, fy0: -0.2, fx1: 0.38, fy1: 0.2, z0: 9, z1: 13, colors: { top: '#243750', left: '#162336', right: '#0F1826', stroke: PALETTE.CYAN } },
      ]);
      drawIsoArrow(ctx, cx, cy, dir, 0.24, 0, 14, PALETTE.CYAN, 0.1);
      break;
    }

    case 7: {
      // PHOTORESIST_COATER: Spin-coater hood + dispense nozzle
      drawSortedParts(ctx, cx, cy, dir, [
        { fx0: -0.4, fy0: -0.4, fx1: 0.4, fy1: 0.4, z0: 0, z1: 10, colors: { top: '#1B293D', left: '#121C2A', right: '#0C141E', stroke: '#2F4460' } },
        { fx0: -0.3, fy0: -0.3, fx1: 0.3, fy1: 0.3, z0: 10, z1: 22, colors: { top: '#273A54', left: '#172538', right: '#101A28', stroke: PALETTE.FROST } },
        { fx0: -0.22, fy0: -0.22, fx1: 0.05, fy1: 0.05, z0: 22, z1: 30, colors: { top: '#183C5E', left: '#112A44', right: '#0B1D30', stroke: PALETTE.CYAN } },
      ]);
      const [bx, by] = isoLocal(cx, cy, dir, 0, 0, 23);
      drawIsoRing(ctx, bx, by, 8, 4.2, PALETTE.CYAN, '#133A68', 1.2);
      drawIsoArrow(ctx, cx, cy, dir, 0.26, 0, 11, PALETTE.FROST, 0.09);
      break;
    }

    case 8: {
      // EUV_SCANNER: Signature high-NA ASML-grade cleanroom lithography monolith
      drawSortedParts(ctx, cx, cy, dir, [
        { fx0: -0.44, fy0: -0.44, fx1: 0.44, fy1: 0.44, z0: 0, z1: 11, colors: { top: '#1E2C40', left: '#121B28', right: '#0C131D', stroke: '#3D5372' } },
        // Rear vacuum optics column
        { fx0: -0.38, fy0: -0.36, fx1: 0.12, fy1: 0.36, z0: 11, z1: 36, colors: { top: '#283B56', left: '#172436', right: '#101927', stroke: '#080C12' } },
        // Upper EUV laser projection crown
        { fx0: -0.3, fy0: -0.24, fx1: 0.26, fy1: 0.24, z0: 36, z1: 45, colors: { top: '#334B6E', left: '#1D2D44', right: '#152133', stroke: PALETTE.GOLD } },
        // Gold EUV plasma emitter cap
        { fx0: -0.14, fy0: -0.14, fx1: 0.14, fy1: 0.14, z0: 45, z1: 50, colors: { top: PALETTE.GOLD, left: '#C48A00', right: '#8E6200', stroke: '#080C12' } },
        // Front wafer inspection stage
        { fx0: 0.12, fy0: -0.26, fx1: 0.4, fy1: 0.26, z0: 11, z1: 16, colors: { top: '#182A3F', left: '#101D2D', right: '#0A1420', stroke: PALETTE.CYAN } },
      ]);
      // Laser beam glow in front optics bay
      const topOpt = isoLocal(cx, cy, dir, 0.22, 0, 36);
      const stagePt = isoLocal(cx, cy, dir, 0.24, 0, 16.5);
      ctx.strokeStyle = PALETTE.GOLD;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(topOpt[0], topOpt[1]);
      ctx.lineTo(stagePt[0], stagePt[1]);
      ctx.stroke();
      drawIsoArrow(ctx, cx, cy, dir, 0.28, 0, 17, PALETTE.GOLD, 0.1);
      break;
    }

    case 9: {
      // PLASMA_ETCHER: Twin RF plasma chamber + matching network
      drawSortedParts(ctx, cx, cy, dir, [
        { fx0: -0.4, fy0: -0.4, fx1: 0.4, fy1: 0.4, z0: 0, z1: 10, colors: { top: '#1A273A', left: '#101927', right: '#0B111C', stroke: '#334865' } },
        { fx0: -0.34, fy0: -0.34, fx1: 0.18, fy1: -0.02, z0: 10, z1: 28, colors: { top: '#243B57', left: '#15253A', right: '#0E1B2B', stroke: PALETTE.CYAN } },
        { fx0: -0.34, fy0: 0.02, fx1: 0.18, fy1: 0.34, z0: 10, z1: 28, colors: { top: '#243B57', left: '#15253A', right: '#0E1B2B', stroke: PALETTE.CYAN } },
        // Top RF coil box
        { fx0: -0.24, fy0: -0.18, fx1: 0.12, fy1: 0.18, z0: 28, z1: 35, colors: { top: PALETTE.GOLD, left: '#AA7800', right: '#785400', stroke: '#080C12' } },
      ]);
      drawIsoArrow(ctx, cx, cy, dir, 0.28, 0, 11, PALETTE.CYAN, 0.1);
      break;
    }

    case 10: {
      // METROLOGY_QA: Optical bridge + reject diverter arm
      drawSortedParts(ctx, cx, cy, dir, [
        { fx0: -0.4, fy0: -0.4, fx1: 0.4, fy1: 0.4, z0: 0, z1: 7, colors: { top: '#18263A', left: '#101A28', right: '#0B121D', stroke: '#2F4462' } },
        { fx0: -0.28, fy0: -0.36, fx1: 0.08, fy1: -0.2, z0: 7, z1: 26, colors: { top: '#273C58', left: '#17263A', right: '#101B2B', stroke: '#080C12' } },
        { fx0: -0.28, fy0: 0.2, fx1: 0.08, fy1: 0.36, z0: 7, z1: 26, colors: { top: '#273C58', left: '#17263A', right: '#101B2B', stroke: '#080C12' } },
        // Optical scan bridge
        { fx0: -0.28, fy0: -0.38, fx1: 0.08, fy1: 0.38, z0: 26, z1: 32, colors: { top: PALETTE.EMERALD, left: '#0A9A68', right: '#07704B', stroke: '#080C12' } },
      ]);
      // Forward GOOD output & CW defect reject arrow
      drawIsoArrow(ctx, cx, cy, dir, 0.28, 0, 8, PALETTE.EMERALD, 0.1);
      drawIsoArrow(ctx, cx, cy, (dir + 1) & 3, 0.28, 0, 8, PALETTE.CRIMSON, 0.09);
      break;
    }

    case 11: {
      // WAFER_VAULT: Armored FOUP storage vault
      drawSortedParts(ctx, cx, cy, dir, [
        { fx0: -0.42, fy0: -0.42, fx1: 0.42, fy1: 0.42, z0: 0, z1: 12, colors: { top: '#1F2F44', left: '#131F2E', right: '#0C1520', stroke: PALETTE.GOLD } },
        { fx0: -0.34, fy0: -0.34, fx1: 0.34, fy1: 0.34, z0: 12, z1: 34, colors: { top: '#283D58', left: '#18273B', right: '#111C2B', stroke: '#080C12' } },
        { fx0: -0.2, fy0: -0.2, fx1: 0.2, fy1: 0.2, z0: 34, z1: 39, colors: { top: PALETTE.CYAN, left: '#0099AA', right: '#006B77', stroke: '#080C12' } },
      ]);
      break;
    }

    case 12: {
      // RECLAIM_GRINDER: Diamond slurry reclamation unit
      drawSortedParts(ctx, cx, cy, dir, [
        { fx0: -0.4, fy0: -0.4, fx1: 0.4, fy1: 0.4, z0: 0, z1: 10, colors: { top: '#1B2534', left: '#111924', right: '#0C121B', stroke: PALETTE.CRIMSON } },
        { fx0: -0.32, fy0: -0.3, fx1: 0.22, fy1: 0.3, z0: 10, z1: 24, colors: { top: '#27354A', left: '#182231', right: '#111824', stroke: PALETTE.GOLD } },
        { fx0: -0.18, fy0: -0.18, fx1: 0.08, fy1: 0.18, z0: 24, z1: 30, colors: { top: PALETTE.CRIMSON, left: '#A41D36', right: '#781427', stroke: '#080C12' } },
      ]);
      break;
    }

    case 13: {
      // CRYO_CHILLER: 77K LN2 condenser & cryogenic frost fins
      drawSortedParts(ctx, cx, cy, dir, [
        { fx0: -0.42, fy0: -0.42, fx1: 0.42, fy1: 0.42, z0: 0, z1: 9, colors: { top: '#142B42', left: '#0D1E2E', right: '#091521', stroke: PALETTE.FROST } },
        // LN2 Dewar tank
        { fx0: -0.34, fy0: -0.32, fx1: 0.02, fy1: 0.06, z0: 9, z1: 37, colors: { top: PALETTE.FROST, left: '#1B78A8', right: '#125478', stroke: '#080C12' } },
        // Heat-exchanger fin stack
        { fx0: 0.04, fy0: -0.32, fx1: 0.36, fy1: 0.32, z0: 9, z1: 27, colors: { top: '#22466B', left: '#15304A', right: '#0F2336', stroke: PALETTE.CYAN } },
      ]);
      break;
    }

    case 14: {
      // POWER_SOURCE: GIS cleanroom transformer substation
      drawSortedParts(ctx, cx, cy, dir, [
        { fx0: -0.42, fy0: -0.42, fx1: 0.42, fy1: 0.42, z0: 0, z1: 10, colors: { top: '#242936', left: '#171B24', right: '#10131A', stroke: PALETTE.GOLD } },
        { fx0: -0.32, fy0: -0.32, fx1: 0.32, fy1: 0.32, z0: 10, z1: 26, colors: { top: '#2E3647', left: '#1C222F', right: '#131722', stroke: '#080C12' } },
        // Twin gold HV bushings
        { fx0: -0.22, fy0: -0.22, fx1: -0.04, fy1: -0.04, z0: 26, z1: 38, colors: { top: PALETTE.GOLD, left: '#B37F00', right: '#7D5800', stroke: '#080C12' } },
        { fx0: 0.04, fy0: 0.04, fx1: 0.22, fy1: 0.22, z0: 26, z1: 38, colors: { top: PALETTE.GOLD, left: '#B37F00', right: '#7D5800', stroke: '#080C12' } },
      ]);
      break;
    }

    case 15: {
      // CAPACITOR_BANK: High-kJ energy storage rack
      drawSortedParts(ctx, cx, cy, dir, [
        { fx0: -0.4, fy0: -0.4, fx1: 0.4, fy1: 0.4, z0: 0, z1: 8, colors: { top: '#1E2A3C', left: '#121B28', right: '#0C131D', stroke: PALETTE.GOLD } },
        { fx0: -0.3, fy0: -0.3, fx1: -0.04, fy1: 0.3, z0: 8, z1: 31, colors: { top: PALETTE.CYAN, left: '#155068', right: '#0F384A', stroke: '#080C12' } },
        { fx0: 0.04, fy0: -0.3, fx1: 0.3, fy1: 0.3, z0: 8, z1: 31, colors: { top: PALETTE.GOLD, left: '#9E7000', right: '#6B4C00', stroke: '#080C12' } },
      ]);
      break;
    }

    case 16: {
      // FOUP_DOCK: sub 0 = pickup (cyan), sub 1 = dropoff (gold)
      const accent = sub === 1 ? PALETTE.GOLD : PALETTE.CYAN;
      drawSortedParts(ctx, cx, cy, dir, [
        { fx0: -0.38, fy0: -0.38, fx1: 0.38, fy1: 0.38, z0: 0, z1: 9, colors: { top: '#1C2B40', left: '#121D2C', right: '#0C1420', stroke: accent } },
        // Hoist gantry tower on back edge
        { fx0: -0.36, fy0: -0.34, fx1: -0.14, fy1: 0.34, z0: 9, z1: 38, colors: { top: '#2A3F5C', left: '#18273B', right: '#111C2B', stroke: '#080C12' } },
        { fx0: -0.36, fy0: -0.2, fx1: 0.2, fy1: 0.2, z0: 34, z1: 39, colors: { top: accent, left: '#18273B', right: '#111C2B', stroke: '#080C12' } },
      ]);
      const [dx, dy] = isoLocal(cx, cy, dir, 0.1, 0, 10);
      drawIsoRing(ctx, dx, dy, 7, 3.8, accent, 'rgba(0, 240, 255, 0.18)', 1.3);
      drawIsoArrow(ctx, cx, cy, dir, 0.28, 0, 10.5, accent, 0.09);
      break;
    }

    case 17:
    default: {
      // COMPUTE_RACK: Priority-3 AI compute node
      drawSortedParts(ctx, cx, cy, dir, [
        { fx0: -0.38, fy0: -0.38, fx1: 0.38, fy1: 0.38, z0: 0, z1: 7, colors: { top: '#152234', left: '#0E1724', right: '#091019', stroke: PALETTE.CYAN } },
        { fx0: -0.28, fy0: -0.28, fx1: 0.28, fy1: 0.28, z0: 7, z1: 40, colors: { top: '#223650', left: '#111D2D', right: '#0B131F', stroke: PALETTE.FROST } },
        { fx0: -0.22, fy0: -0.22, fx1: 0.22, fy1: 0.22, z0: 40, z1: 43, colors: { top: PALETTE.GOLD, left: '#9E7000', right: '#6B4C00', stroke: '#080C12' } },
      ]);
      // Vertical server blade LED ticks
      for (let z = 12; z <= 35; z += 5) {
        const pL = isoPt(cx, cy, -0.08, 0.285, z);
        const pR = isoPt(cx, cy, 0.285, 0.04, z);
        ctx.fillStyle = z % 10 === 2 ? PALETTE.CYAN : PALETTE.FROST;
        ctx.fillRect(pL[0] - 1, pL[1] - 1, 3, 1.5);
        ctx.fillStyle = PALETTE.GOLD;
        ctx.fillRect(pR[0] - 1, pR[1] - 1, 3, 1.5);
      }
      break;
    }
  }

  return canvas;
}

function drawWaferDisc(waferState, defective) {
  const canvas = createCanvas(20, 14);
  const ctx = canvas.getContext('2d');
  const cx = 10;
  const cy = 7;

  // Isometric circular wafer = 2:1 ellipse
  const baseFill = defective
    ? '#5C1324'
    : ['#475569', '#64748B', '#1D4ED8', '#0284C7', '#0891B2', '#06B6D4'][waferState] || '#64748B';
  const rimCol = defective
    ? PALETTE.CRIMSON
    : waferState >= 5
      ? PALETTE.GOLD
      : waferState >= 3
        ? PALETTE.CYAN
        : waferState === 2
          ? PALETTE.FROST
          : '#CBD5E1';

  // Drop shadow
  drawIsoRing(ctx, cx, cy + 1.5, 7.6, 4.1, null, 'rgba(4, 7, 11, 0.65)', 0);
  // Wafer thickness edge
  drawIsoRing(ctx, cx, cy + 0.8, 7.5, 4.0, '#080C12', '#1E293B', 0.9);
  // Top silicon face
  drawIsoRing(ctx, cx, cy - 0.3, 7.5, 4.0, rimCol, baseFill, 1.2);

  if (defective) {
    // Fracture glitch line
    ctx.strokeStyle = PALETTE.CRIMSON;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx - 4.5, cy - 2);
    ctx.lineTo(cx, cy + 0.5);
    ctx.lineTo(cx + 4.5, cy - 1.5);
    ctx.stroke();
  } else if (waferState >= 3) {
    // Micro-die lithography grid lines
    ctx.strokeStyle = waferState === 3 ? PALETTE.GOLD : PALETTE.CYAN;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy - 1.2);
    ctx.lineTo(cx + 4, cy + 0.8);
    ctx.moveTo(cx - 4, cy + 0.8);
    ctx.lineTo(cx + 4, cy - 1.2);
    ctx.stroke();
    if (waferState >= 5) {
      drawIsoRing(ctx, cx, cy - 0.3, 2.5, 1.4, PALETTE.GOLD, PALETTE.WHITE, 0.7);
    }
  } else {
    // Specular glint
    ctx.fillStyle = 'rgba(230, 244, 255, 0.55)';
    ctx.fillRect(cx - 3, cy - 1.8, 3, 1);
  }

  return canvas;
}

function drawShuttlePod() {
  const canvas = createCanvas(40, 28);
  const ctx = canvas.getContext('2d');
  const cx = 20;
  const cy = 16;

  // Overhead FOUP carriage hull
  drawIsoBox(ctx, cx, cy, 1, -0.32, -0.22, 0.32, 0.22, 0, 10, {
    top: '#2B3F5C',
    left: '#182538',
    right: '#101927',
    stroke: PALETTE.CYAN,
  });
  // Clamping hoist grip
  drawIsoBox(ctx, cx, cy, 1, -0.14, -0.14, 0.14, 0.14, 10, 14, {
    top: PALETTE.GOLD,
    left: '#9E7000',
    right: '#6E4E00',
    stroke: '#080C12',
  });
  return canvas;
}

function drawUtilityTextures(scene) {
  // White diamond for tintable isometric heatmap cells
  const heat = createCanvas(64, 32);
  const hctx = heat.getContext('2d');
  drawIsoDiamond(hctx, 32, 16, 0.48, 0);
  hctx.fillStyle = '#FFFFFF';
  hctx.fill();
  hctx.strokeStyle = 'rgba(255,255,255,0.55)';
  hctx.lineWidth = 1;
  hctx.stroke();
  registerCanvas(scene, 'heatmap_tile', heat);

  // Hover outline diamond (tintable white)
  const hover = createCanvas(64, 32);
  const vctx = hover.getContext('2d');
  drawIsoDiamond(vctx, 32, 16, 0.49, 0);
  vctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  vctx.fill();
  vctx.strokeStyle = '#FFFFFF';
  vctx.lineWidth = 2;
  vctx.stroke();
  registerCanvas(scene, 'hover_diamond', hover);

  // Crisp beacon dot
  const beacon = createCanvas(12, 12);
  const bctx = beacon.getContext('2d');
  const bg = bctx.createRadialGradient(6, 6, 1, 6, 6, 6);
  bg.addColorStop(0, '#FFFFFF');
  bg.addColorStop(0.55, 'rgba(255,255,255,0.75)');
  bg.addColorStop(1, 'rgba(255,255,255,0)');
  bctx.fillStyle = bg;
  bctx.fillRect(0, 0, 12, 12);
  registerCanvas(scene, 'machine_beacon', beacon);

  // VFX soft puff
  const puff = createCanvas(24, 24);
  const pctx = puff.getContext('2d');
  const pg = pctx.createRadialGradient(12, 12, 1, 12, 12, 12);
  pg.addColorStop(0, 'rgba(255,255,255,0.95)');
  pg.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  pg.addColorStop(1, 'rgba(255,255,255,0)');
  pctx.fillStyle = pg;
  pctx.fillRect(0, 0, 24, 24);
  registerCanvas(scene, 'vfx_puff', puff);

  // VFX spark streak
  const spark = createCanvas(16, 16);
  const sctx = spark.getContext('2d');
  const sg = sctx.createRadialGradient(8, 8, 0.5, 8, 8, 7.5);
  sg.addColorStop(0, '#FFFFFF');
  sg.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  sg.addColorStop(1, 'rgba(255,255,255,0)');
  sctx.fillStyle = sg;
  sctx.fillRect(0, 0, 16, 16);
  registerCanvas(scene, 'vfx_spark', spark);

  // VFX radial shockwave ring
  const ring = createCanvas(64, 32);
  const rctx = ring.getContext('2d');
  rctx.strokeStyle = '#FFFFFF';
  rctx.lineWidth = 3;
  rctx.beginPath();
  rctx.ellipse(32, 16, 29, 14.5, 0, 0, Math.PI * 2);
  rctx.stroke();
  rctx.strokeStyle = 'rgba(255,255,255,0.45)';
  rctx.lineWidth = 6;
  rctx.beginPath();
  rctx.ellipse(32, 16, 28, 14, 0, 0, Math.PI * 2);
  rctx.stroke();
  registerCanvas(scene, 'vfx_ring', ring);

  // VFX vertical EUV laser beam
  const laser = createCanvas(12, 42);
  const lctx = laser.getContext('2d');
  const lg = lctx.createLinearGradient(0, 0, 12, 0);
  lg.addColorStop(0, 'rgba(255,255,255,0)');
  lg.addColorStop(0.5, 'rgba(255,255,255,1)');
  lg.addColorStop(1, 'rgba(255,255,255,0)');
  lctx.fillStyle = lg;
  lctx.fillRect(0, 0, 12, 42);
  registerCanvas(scene, 'vfx_laser', laser);
}

export function getConduitTextureKey(kind, mask) {
  return `${kind}_mask_${mask & 0x0F}`;
}

export function getWaferTextureKey(waferState, defective) {
  if (defective) return 'wafer_defective';
  return `wafer_${Math.max(1, Math.min(5, waferState | 0))}`;
}

export function getMachineTextureKey(type, dir = 0, sub = 0) {
  const t = type | 0;
  if (t === 1) return 'machine_1_0_0';
  const d = dir & 3;
  const s = (t === 3 || t === 16) ? (sub & 1) : 0;
  return `machine_${t}_${d}_${s}`;
}

/**
 * Populates Phaser's TextureManager once with all cleanroom procedural textures.
 */
export function createProceduralTextures(scene) {
  if (!scene?.textures || typeof document === 'undefined') return false;

  registerCanvas(scene, 'floor_0', drawFloorTile(0));
  registerCanvas(scene, 'floor_1', drawFloorTile(1));
  registerCanvas(scene, 'floor_substation', drawFloorTile(2));

  for (let mask = 0; mask < 16; mask++) {
    registerCanvas(scene, getConduitTextureKey('ln2', mask), drawConduitTile('ln2', mask));
    registerCanvas(scene, getConduitTextureKey('power', mask), drawConduitTile('power', mask));
  }

  registerCanvas(scene, getMachineTextureKey(1, 0, 0), drawMachineCanvas(1, 0, 0));

  for (let t = 2; t <= 17; t++) {
    const maxSub = (t === 3 || t === 16) ? 2 : 1;
    for (let dir = 0; dir < 4; dir++) {
      for (let sub = 0; sub < maxSub; sub++) {
        registerCanvas(scene, getMachineTextureKey(t, dir, sub), drawMachineCanvas(t, dir, sub));
      }
    }
  }

  for (let state = 1; state <= 5; state++) {
    registerCanvas(scene, getWaferTextureKey(state, false), drawWaferDisc(state, false));
  }
  registerCanvas(scene, getWaferTextureKey(1, true), drawWaferDisc(1, true));

  registerCanvas(scene, 'shuttle_pod', drawShuttlePod());
  drawUtilityTextures(scene);

  return true;
}
