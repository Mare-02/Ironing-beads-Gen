import { rgbToLab, deltaE00 } from './color.js';

// Bildausschnitt (crop in 0–1 Bildkoordinaten) auf w×h Zellen herunterrechnen.
// Jede Zelle ist der alphagewichtete Mittelwert ihres Blocks.
export function sampleImage(img, crop, w, h) {
  const S = Math.max(1, Math.min(8, Math.floor(1600 / Math.max(w, h))));
  const data = cropCanvas(img, crop, w * S, h * S);

  const cells = new Array(w * h);
  const rowLen = w * S * 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < S; dy++) {
        let p = (y * S + dy) * rowLen + x * S * 4;
        for (let dx = 0; dx < S; dx++, p += 4) {
          const al = data[p + 3] / 255;
          r += data[p] * al;
          g += data[p + 1] * al;
          b += data[p + 2] * al;
          a += al;
        }
      }
      cells[y * w + x] = a > 0
        ? { r: r / a, g: g / a, b: b / a, a: a / (S * S) }
        : { r: 0, g: 0, b: 0, a: 0 };
    }
  }
  return cells;
}

function cropCanvas(img, crop, cw, ch) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, crop.x * iw, crop.y * ih, crop.w * iw, crop.h * ih, 0, 0, cw, ch);
  return ctx.getImageData(0, 0, cw, ch).data;
}

const med = (a) => {
  a.sort((x, y) => x - y);
  return a[a.length >> 1];
};

// Fertige Vorlage auslesen: je Feld der Median der Feldmitte,
// damit Rasterlinien, Löcher und aufgedruckte Nummern nicht stören.
export function sampleChart(img, crop, cols, rows) {
  const S = Math.max(5, Math.min(14, Math.floor(2000 / Math.max(cols, rows))));
  const data = cropCanvas(img, crop, cols * S, rows * S);
  const rowLen = cols * S * 4;
  const lo = Math.floor(S * 0.22), hi = Math.ceil(S * 0.78);
  const cells = new Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const rs = [], gs = [], bs = [];
      let a = 0;
      for (let dy = lo; dy < hi; dy++) {
        for (let dx = lo; dx < hi; dx++) {
          const p = (y * S + dy) * rowLen + (x * S + dx) * 4;
          rs.push(data[p]);
          gs.push(data[p + 1]);
          bs.push(data[p + 2]);
          a += data[p + 3] / 255;
        }
      }
      cells[y * cols + x] = { r: med(rs), g: med(gs), b: med(bs), a: a / rs.length };
    }
  }
  return cells;
}

// Rasterweite einer Vorlage schätzen: Kanten wiederholen sich im Abstand eines Feldes
export function detectGrid(img, crop) {
  const iw = (img.naturalWidth || img.width) * crop.w;
  const ih = (img.naturalHeight || img.height) * crop.h;
  const s = Math.min(1, 1000 / Math.max(iw, ih));
  const w = Math.max(8, Math.round(iw * s)), h = Math.max(8, Math.round(ih * s));
  const data = cropCanvas(img, crop, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11;
  const px = new Float32Array(w - 1), py = new Float32Array(h - 1);
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const g = gray[y * w + x];
      px[x] += Math.abs(gray[y * w + x + 1] - g);
      py[y] += Math.abs(gray[(y + 1) * w + x] - g);
    }
  }
  const lx = period(px), ly = period(py);
  const pitch = lx && ly ? (lx + ly) / 2 : lx || ly;
  if (!pitch) return null;
  return { cols: Math.max(1, Math.round(w / (lx || pitch))), rows: Math.max(1, Math.round(h / (ly || pitch))) };
}

// Grundperiode eines Profils per Autokorrelation (kleinster deutlicher Gipfel)
export function period(profile) {
  const n = profile.length;
  // Leicht weichzeichnen, damit Linien bei krummen Abständen (12/13/12 px) zusammenfallen
  let sm = Array.from(profile);
  for (let pass = 0; pass < 2; pass++) {
    sm = sm.map((x, i) => (sm[Math.max(0, i - 1)] + 2 * x + sm[Math.min(n - 1, i + 1)]) / 4);
  }
  const mean = sm.reduce((s, v) => s + v, 0) / n;
  const v = sm.map((x) => x - mean);
  const maxLag = Math.floor(n / 3);
  const ac = new Float32Array(maxLag + 2);
  for (let lag = 3; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += v[i] * v[i + lag];
    ac[lag] = s / (n - lag);
  }
  let best = 0;
  for (let lag = 4; lag <= maxLag; lag++) best = Math.max(best, ac[lag]);
  if (best <= 0) return null;
  for (let lag = 4; lag <= maxLag; lag++) {
    if (ac[lag] >= best * 0.7 && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) {
      // Teilschritt per Parabel für genauere Rasterweite
      const a = ac[lag - 1], b = ac[lag], c = ac[lag + 1];
      const d = a - 2 * b + c;
      return d ? lag + (0.5 * (a - c)) / d : lag;
    }
  }
  return null;
}

// Zellen -> Raster aus Farbcodes (null = keine Perle).
// colors: [{ code, lab }], opts: { autoBg, bgTol, maxColors, smooth }
export function buildPattern(cells, w, h, colors, opts) {
  const labs = cells.map((c) => rgbToLab(c.r, c.g, c.b));
  const bg = opts.autoBg
    ? backgroundMask(labs, cells, w, h, opts.bgTol)
    : Uint8Array.from(cells, (c) => (c.a < 0.5 ? 1 : 0));

  const out = new Array(w * h).fill(null);
  for (let i = 0; i < out.length; i++) {
    if (!bg[i]) out[i] = nearest(labs[i], colors);
  }
  if (opts.maxColors > 0) reduceColors(out, labs, colors, opts.maxColors);
  if (opts.smooth) smooth(out, w, h);
  return out;
}

export function nearest(lab, colors) {
  let best = null, bestD = Infinity;
  for (const c of colors) {
    const d = deltaE00(lab, c.lab);
    if (d < bestD) { bestD = d; best = c.code; }
  }
  return best;
}

// Hintergrund = vom Rand aus zusammenhängende Fläche in der häufigsten Randfarbe.
// Transparente Pixel sind immer Hintergrund.
export function backgroundMask(labs, cells, w, h, tol) {
  const n = w * h;
  const bg = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (cells[i].a < 0.5) bg[i] = 1;

  const border = [];
  for (let i = 0; i < n; i++) {
    const x = i % w, y = (i / w) | 0;
    if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && cells[i].a >= 0.5) border.push(i);
  }
  if (!border.length) return bg;

  let ref = -1, refCount = -1;
  for (const i of border) {
    let c = 0;
    for (const j of border) if (deltaE00(labs[i], labs[j]) < tol) c++;
    if (c > refCount) { refCount = c; ref = i; }
  }
  // Füllt das Motiv den Rand fast komplett aus, gibt es keinen Hintergrund zu entfernen
  if (refCount < border.length * 0.2) return bg;

  const refLab = labs[ref];
  const seen = new Uint8Array(n);
  const stack = border.filter((i) => deltaE00(labs[i], refLab) < tol);
  while (stack.length) {
    const i = stack.pop();
    if (seen[i]) continue;
    seen[i] = 1;
    if (cells[i].a >= 0.5 && deltaE00(labs[i], refLab) >= tol) continue;
    bg[i] = 1;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  return bg;
}

// Seltenste Farben nacheinander streichen, bis höchstens max übrig sind
export function reduceColors(out, labs, colors, max) {
  for (;;) {
    const counts = new Map();
    for (const c of out) if (c !== null) counts.set(c, (counts.get(c) || 0) + 1);
    if (counts.size <= max) return;
    let least = null, leastN = Infinity;
    for (const [code, k] of counts) if (k < leastN) { leastN = k; least = code; }
    const remaining = colors.filter((c) => c.code !== least && counts.has(c.code));
    for (let i = 0; i < out.length; i++) {
      if (out[i] === least) out[i] = nearest(labs[i], remaining);
    }
  }
}

// Einzelne Ausreißer-Perlen an die Farbe ihrer Umgebung angleichen
export function smooth(out, w, h) {
  const src = out.slice();
  for (let i = 0; i < src.length; i++) {
    const code = src[i];
    if (code === null) continue;
    const x = i % w, y = (i / w) | 0;
    const nb = [];
    if (x > 0) nb.push(src[i - 1]);
    if (x < w - 1) nb.push(src[i + 1]);
    if (y > 0) nb.push(src[i - w]);
    if (y < h - 1) nb.push(src[i + w]);
    if (nb.includes(code)) continue;
    const counts = new Map();
    for (const c of nb) if (c !== null) counts.set(c, (counts.get(c) || 0) + 1);
    for (const [c, k] of counts) if (k >= 3) out[i] = c;
  }
}
