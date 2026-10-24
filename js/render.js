import { textColorFor } from './color.js';

const BOARD_BG = '#e7e1d6';
const PEG_DOT = '#cbc2b3';
const SEAM = '#7a6e5f';
const LOOSE = '#e0262f';
const START = '#0f8a6c';
const ROW = '#e8604c';

// Zeichnet einen Ausschnitt (x0, y0, w, h) des Rasters als Perlen auf einer Steckplatte.
// rulers: Nummern pro Platte (1–peg), damit sie zu den Platten-Koordinaten passen.
export function drawBoard(canvas, o) {
  const {
    grid, W, peg, colors, cell,
    x0 = 0, y0 = 0, w = W, h = grid.length / W,
    ruler = 0, loose = null, highlight = null, row = -1, done = null,
    start = -1, showCodes = false, dpr: fixedDpr, marks = null,
  } = o;

  const cssW = ruler + w * cell, cssH = ruler + h * cell;
  let dpr = fixedDpr ?? Math.min(window.devicePixelRatio || 1, 2);
  dpr = Math.min(dpr, 8000 / cssW, 8000 / cssH);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = '#fbf8f3';
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.fillStyle = BOARD_BG;
  ctx.fillRect(ruler, ruler, w * cell, h * cell);

  const r = cell * 0.47;
  const fontPx = Math.max(8, Math.round(cell * 0.36));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let yy = 0; yy < h; yy++) {
    const gy = y0 + yy;
    const rowDim = row >= 0 && gy !== row;
    const rowDone = done?.has(gy);
    for (let xx = 0; xx < w; xx++) {
      const gx = x0 + xx;
      const code = grid[gy * W + gx];
      const cx = ruler + xx * cell + cell / 2;
      const cy = ruler + yy * cell + cell / 2;
      if (code === null) {
        ctx.fillStyle = PEG_DOT;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(1, cell * 0.09), 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const hex = colors.get(code)?.hex ?? '#999999';
      const dim = (highlight && code !== highlight) || rowDim || rowDone;
      ctx.globalAlpha = dim ? (rowDone && !rowDim ? 0.35 : 0.2) : 1;
      ctx.fillStyle = hex;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      if (showCodes && cell >= 18 && !dim) {
        ctx.fillStyle = textColorFor(hex);
        ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
        ctx.fillText(code, cx, cy + 0.5);
      } else if (cell >= 7) {
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  // Hilfslinien alle 5 Stifte (wie beim Abzählen) und Plattennähte
  for (let xx = 0; xx <= w; xx++) {
    const local = (x0 + xx) % peg;
    const px = ruler + xx * cell;
    if (local === 0 && xx !== 0 && xx !== w) line(ctx, px, ruler, px, ruler + h * cell, SEAM, 2.5);
    else if (local % 5 === 0) line(ctx, px, ruler, px, ruler + h * cell, 'rgba(70,55,40,0.16)', 1);
  }
  for (let yy = 0; yy <= h; yy++) {
    const local = (y0 + yy) % peg;
    const py = ruler + yy * cell;
    if (local === 0 && yy !== 0 && yy !== h) line(ctx, ruler, py, ruler + w * cell, py, SEAM, 2.5);
    else if (local % 5 === 0) line(ctx, ruler, py, ruler + w * cell, py, 'rgba(70,55,40,0.16)', 1);
  }
  ctx.strokeStyle = SEAM;
  ctx.lineWidth = 2;
  ctx.strokeRect(ruler + 1, ruler + 1, w * cell - 2, h * cell - 2);

  const inView = (i) => {
    const x = i % W, y = (i / W) | 0;
    return x >= x0 && x < x0 + w && y >= y0 && y < y0 + h ? [ruler + (x - x0) * cell + cell / 2, ruler + (y - y0) * cell + cell / 2] : null;
  };

  if (loose) {
    ctx.strokeStyle = LOOSE;
    ctx.lineWidth = Math.max(2, cell * 0.14);
    for (const i of loose) {
      const p = inView(i);
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p[0], p[1], cell * 0.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Fehler aus dem Fortschritts-Check: Ring = falsche Farbe, Kreuz = Perle zu viel
  if (marks) {
    ctx.strokeStyle = LOOSE;
    ctx.lineWidth = Math.max(2.5, cell * 0.16);
    for (const [i, kind] of marks) {
      const p = inView(i);
      if (!p) continue;
      ctx.beginPath();
      if (kind === 'extra') {
        const d = cell * 0.36;
        ctx.moveTo(p[0] - d, p[1] - d);
        ctx.lineTo(p[0] + d, p[1] + d);
        ctx.moveTo(p[0] + d, p[1] - d);
        ctx.lineTo(p[0] - d, p[1] + d);
      } else {
        ctx.arc(p[0], p[1], cell * 0.52, 0, Math.PI * 2);
      }
      ctx.stroke();
    }
  }

  if (row >= y0 && row < y0 + h) {
    ctx.strokeStyle = ROW;
    ctx.lineWidth = 3;
    ctx.strokeRect(ruler + 1.5, ruler + (row - y0) * cell + 1.5, w * cell - 3, cell - 3);
  }

  if (start >= 0) {
    const p = inView(start);
    if (p) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(4, cell * 0.24);
      ctx.beginPath();
      ctx.arc(p[0], p[1], cell * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = START;
      ctx.lineWidth = Math.max(2.5, cell * 0.14);
      ctx.stroke();
    }
  }

  if (ruler) drawRulers(ctx, { x0, y0, w, h, cell, ruler, peg, row, done });
}

function drawRulers(ctx, { x0, y0, w, h, cell, ruler, peg, row, done }) {
  const size = Math.max(9, Math.min(13, Math.round(cell * 0.5)));
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const every = cell >= 16 ? 1 : cell >= 9 ? 5 : 10;

  for (let xx = 0; xx < w; xx++) {
    const n = ((x0 + xx) % peg) + 1;
    if (n !== 1 && n % every !== 0) continue;
    ctx.fillStyle = n === 1 ? SEAM : '#8c8173';
    ctx.fillText(String(n), ruler + xx * cell + cell / 2, ruler / 2);
  }
  for (let yy = 0; yy < h; yy++) {
    const gy = y0 + yy;
    const n = (gy % peg) + 1;
    const cy = ruler + yy * cell + cell / 2;
    if (gy === row) {
      ctx.fillStyle = ROW;
      roundRect(ctx, 2, cy - cell / 2 + 1, ruler - 4, cell - 2, 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(n), ruler / 2, cy);
      continue;
    }
    if (done?.has(gy)) {
      ctx.fillStyle = START;
      ctx.fillText('✓', ruler / 2, cy);
      continue;
    }
    if (n !== 1 && n % every !== 0) continue;
    ctx.fillStyle = n === 1 ? SEAM : '#8c8173';
    ctx.fillText(String(n), ruler / 2, cy);
  }
}

function line(ctx, x1, y1, x2, y2, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}
