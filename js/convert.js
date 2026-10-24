import { rgbToLab, deltaE00 } from './color.js';

// Bild/Foto -> Raster aus Farbcodes (crop in 0–1 Bildkoordinaten).
export function imageToPattern(img, crop, w, h, colors, opts) {
  const S = Math.max(1, Math.min(24, Math.floor(1600 / Math.max(w, h))));
  return patternFromPixels(cropCanvas(img, crop, w * S, h * S), w, h, S, colors, opts);
}

// Jedes Feld (S×S Pixel) bekommt die Perlenfarbe, die die meisten seiner Pixel haben –
// ein Durchschnitt würde an Kanten Mischfarben erzeugen, die im Bild gar nicht vorkommen.
// Der Hintergrund wird pixelgenau vom Rand aus entfernt, so halten ihn auch dünne Umrisse auf.
// Ein Feld wird nur gesteckt, wenn mindestens die Hälfte seiner Pixel zum Motiv gehört.
export function patternFromPixels(data, w, h, S, colors, opts) {
  const PW = w * S, PH = h * S;
  const labCache = new Map(), codeCache = new Map();
  // 5 Bit je Kanal reichen für die Farbzuordnung und halten den Cache klein
  const keyOf = (i) => ((data[i * 4] >> 3) << 10) | ((data[i * 4 + 1] >> 3) << 5) | (data[i * 4 + 2] >> 3);
  const labOf = (key) => {
    let lab = labCache.get(key);
    if (!lab) {
      lab = rgbToLab(((key >> 10) & 31) * 8 + 4, ((key >> 5) & 31) * 8 + 4, (key & 31) * 8 + 4);
      labCache.set(key, lab);
    }
    return lab;
  };
  const opaque = (i) => data[i * 4 + 3] >= 128;
  const bg = opts.autoBg ? pixelBackground(data, PW, PH, opts.bgTol, keyOf, labOf) : null;

  const out = new Array(w * h).fill(null);
  const labs = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const counts = new Map();
      let fg = 0, L = 0, A = 0, B = 0;
      for (let dy = 0; dy < S; dy++) {
        for (let dx = 0; dx < S; dx++) {
          const i = (y * S + dy) * PW + x * S + dx;
          if (!opaque(i) || bg?.[i]) continue;
          const key = keyOf(i);
          const lab = labOf(key);
          let code = codeCache.get(key);
          if (code === undefined) {
            code = nearest(lab, colors);
            codeCache.set(key, code);
          }
          counts.set(code, (counts.get(code) || 0) + 1);
          fg++;
          L += lab[0];
          A += lab[1];
          B += lab[2];
        }
      }
      const c = y * w + x;
      labs[c] = fg ? [L / fg, A / fg, B / fg] : [0, 0, 0];
      if (fg < S * S * 0.5) continue;
      let best = null, bestN = -1;
      for (const [code, k] of counts) if (k > bestN) { bestN = k; best = code; }
      out[c] = best;
    }
  }
  if (opts.maxColors > 0) reduceColors(out, labs, colors, opts.maxColors);
  if (opts.smooth) smooth(out, w, h);
  return out;
}

// Hintergrund-Pixel: vom Rand aus zusammenhängend in der häufigsten Randfarbe
function pixelBackground(data, PW, PH, tol, keyOf, labOf) {
  const n = PW * PH;
  const bg = new Uint8Array(n);
  const opaque = (i) => data[i * 4 + 3] >= 128;
  // Randstreifen statt nur der äußersten Pixelreihe – viele Bilder haben einen dünnen Rahmen
  const band = Math.max(3, Math.round(Math.min(PW, PH) * 0.02));
  const border = [];
  for (let y = 0; y < PH; y++) {
    for (let x = 0; x < PW; x++) {
      if (x < band || y < band || x >= PW - band || y >= PH - band) border.push(y * PW + x);
    }
  }

  // Häufigste Randfarbe grob zählen (4 Bit je Kanal), Bezug = deren mittleres Lab
  const buckets = new Map();
  let opaqueBorder = 0;
  for (const i of border) {
    if (!opaque(i)) continue;
    opaqueBorder++;
    const k = ((data[i * 4] >> 4) << 8) | ((data[i * 4 + 1] >> 4) << 4) | (data[i * 4 + 2] >> 4);
    const b = buckets.get(k) || { n: 0, L: 0, A: 0, B: 0 };
    const lab = labOf(keyOf(i));
    b.n++;
    b.L += lab[0];
    b.A += lab[1];
    b.B += lab[2];
    buckets.set(k, b);
  }
  let top = null;
  for (const b of buckets.values()) if (!top || b.n > top.n) top = b;
  // Füllt das Motiv den Rand fast komplett aus, gibt es keinen Hintergrund zu entfernen
  const useColor = top && top.n >= opaqueBorder * 0.2;
  const ref = useColor ? [top.L / top.n, top.A / top.n, top.B / top.n] : null;
  const isBg = (i) => {
    if (!opaque(i)) return true;
    if (!ref) return false;
    const l = labOf(keyOf(i));
    return Math.hypot(l[0] - ref[0], l[1] - ref[1], l[2] - ref[2]) < tol;
  };

  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  for (const i of border) {
    if (!seen[i] && isBg(i)) { seen[i] = 1; stack[sp++] = i; }
  }
  while (sp) {
    const i = stack[--sp];
    bg[i] = 1;
    const x = i % PW;
    if (x > 0 && !seen[i - 1] && isBg(i - 1)) { seen[i - 1] = 1; stack[sp++] = i - 1; }
    if (x < PW - 1 && !seen[i + 1] && isBg(i + 1)) { seen[i + 1] = 1; stack[sp++] = i + 1; }
    if (i >= PW && !seen[i - PW] && isBg(i - PW)) { seen[i - PW] = 1; stack[sp++] = i - PW; }
    if (i < n - PW && !seen[i + PW] && isBg(i + PW)) { seen[i + PW] = 1; stack[sp++] = i + PW; }
  }
  return bg;
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

const EDGE = 24; // Grauwert-Sprung, ab dem zwei Nachbarpixel als Kante zählen

function grayImage(img, crop, maxSide) {
  const iw = (img.naturalWidth || img.width) * crop.w;
  const ih = (img.naturalHeight || img.height) * crop.h;
  const s = Math.min(1, maxSide / Math.max(iw, ih));
  const w = Math.max(8, Math.round(iw * s)), h = Math.max(8, Math.round(ih * s));
  const data = cropCanvas(img, crop, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11;
  return { gray, w, h };
}

// Anteil der Zeilen y0..y1, in denen zwischen x und x+1 eine Kante liegt.
// Durchgehende Rasterlinien kommen auf fast 1, Schrift und Nummern bleiben niedrig.
function edgeProfileX({ gray, w }, y0, y1) {
  const p = new Float32Array(w - 1);
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < w - 1; x++) if (Math.abs(gray[y * w + x + 1] - gray[y * w + x]) > EDGE) p[x]++;
  }
  return p.map((v) => v / Math.max(1, y1 - y0));
}

function edgeProfileY({ gray, w, h }, x0, x1) {
  const p = new Float32Array(h - 1);
  for (let y = 0; y < h - 1; y++) {
    for (let x = x0; x < x1; x++) if (Math.abs(gray[(y + 1) * w + x] - gray[y * w + x]) > EDGE) p[y]++;
  }
  return p.map((v) => v / Math.max(1, x1 - x0));
}

// Anzahl der Felder in einem Ausschnitt, der genau das Raster umfasst
export function detectGrid(img, crop) {
  const g = grayImage(img, crop, 1000);
  const lx = period(edgeProfileX(g, 0, g.h)), ly = period(edgeProfileY(g, 0, g.w));
  const pitch = lx && ly ? (lx + ly) / 2 : lx || ly;
  if (!pitch) return null;
  return { cols: Math.max(1, Math.round(g.w / (lx || pitch))), rows: Math.max(1, Math.round(g.h / (ly || pitch))) };
}

// Fertige Vorlage im ganzen Bild finden: Rasterweite, Lage und Anzahl der Felder.
// Titel, Randnummern und Farblegende liegen außerhalb des längsten Linienzugs.
export function findChart(img) {
  const g = grayImage(img, { x: 0, y: 0, w: 1, h: 1 }, 1200);
  let yr = [0, g.h], gx = null, gy = null;
  for (let pass = 0; pass < 2; pass++) {
    const px = edgeProfileX(g, yr[0], yr[1]);
    const pitchX = period(px);
    if (!pitchX) return null;
    gx = findGrid(px, pitchX);
    const xr = [Math.max(0, Math.floor(gx.start)), Math.min(g.w, Math.ceil(gx.end) + 2)];
    const py = edgeProfileY(g, xr[0], xr[1]);
    const pitchY = period(py);
    if (!pitchY) return null;
    gy = findGrid(py, pitchY);
    yr = [Math.max(0, Math.floor(gy.start)), Math.min(g.h, Math.ceil(gy.end) + 2)];
  }
  if (gx.count < 2 || gy.count < 2) return null;
  // Profilindex i ist die Kante zwischen Pixel i und i+1, liegt also bei i + 1
  const x0 = gx.start + 1, x1 = gx.end + 1, y0 = gy.start + 1, y1 = gy.end + 1;
  return {
    crop: { x: x0 / g.w, y: y0 / g.h, w: (x1 - x0) / g.w, h: (y1 - y0) / g.h },
    cols: gx.count,
    rows: gy.count,
  };
}

// Lage der Rasterlinien bei ungefähr bekannter Rasterweite: Feldgröße (±6 %) und Phase
// mit der stärksten mittleren Kantenstärke, dann der längste Zug deutlicher Linien.
// Schon 2 % Fehler in der Feldgröße lassen das Raster über 40 Felder auseinanderlaufen.
export function findGrid(profile, roughPitch) {
  const sm = smoothProfile(profile);
  const n = sm.length;
  const at = (x) => {
    const i = Math.floor(x), f = x - i;
    return i < 0 || i >= n - 1 ? 0 : sm[i] * (1 - f) + sm[i + 1] * f;
  };
  let off = 0, pitch = roughPitch, best = -1;
  for (let p = roughPitch * 0.94; p <= roughPitch * 1.06; p += roughPitch * 0.002) {
    for (let o = 0; o < p; o += 0.25) {
      let s = 0, k = 0;
      for (let x = o; x < n; x += p, k++) s += at(x);
      if (s / k > best) { best = s / k; off = o; pitch = p; }
    }
  }
  // Linienstärke mit etwas Spielraum messen: gerenderte Linien springen um ±1 px
  const slack = Math.max(1.5, pitch * 0.08);
  const lines = [];
  for (let x = off; x < n; x += pitch) {
    let m = 0;
    for (let i = Math.ceil(x - slack); i <= x + slack; i++) if (i >= 0 && i < n) m = Math.max(m, sm[i]);
    lines.push(m);
  }
  const strong = [...lines].sort((a, b) => b - a).slice(0, Math.max(2, lines.length >> 1));
  const threshold = 0.45 * strong[strong.length >> 1];
  const ok = lines.map((v) => v >= threshold && v > 0);
  // Einzelne schwache Linie zwischen zwei starken ist eine Lücke im Bild, kein Rasterende
  for (let k = 1; k < ok.length - 1; k++) if (!ok[k] && ok[k - 1] && ok[k + 1] && lines[k] > 0) ok[k] = true;
  let runStart = 0, runLen = 0;
  for (let k = 0, s = -1; k < ok.length; k++) {
    if (!ok[k]) { s = -1; continue; }
    if (s < 0) s = k;
    if (k - s + 1 > runLen) { runLen = k - s + 1; runStart = s; }
  }
  return {
    start: off + runStart * pitch,
    end: off + (runStart + runLen - 1) * pitch,
    count: Math.max(0, runLen - 1),
    pitch,
  };
}

// Leicht weichzeichnen, damit Linien bei krummen Abständen (12/13/12 px) zusammenfallen
function smoothProfile(profile) {
  const n = profile.length;
  let sm = Array.from(profile);
  for (let pass = 0; pass < 2; pass++) {
    sm = sm.map((x, i) => (sm[Math.max(0, i - 1)] + 2 * x + sm[Math.min(n - 1, i + 1)]) / 4);
  }
  return sm;
}

// Grundperiode eines Profils per Autokorrelation (kleinster deutlicher Gipfel)
export function period(profile) {
  const n = profile.length;
  const sm = smoothProfile(profile);
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
