// Raster: flaches Array der Länge W*H, Eintrag = Farbcode oder null.
// Verbunden sind Perlen nur über die Seiten (links/rechts/oben/unten),
// denn nur dort verschmelzen sie beim Bügeln.

export function neighbors(i, W, H) {
  const x = i % W, y = (i / W) | 0;
  const r = [];
  if (x > 0) r.push(i - 1);
  if (x < W - 1) r.push(i + 1);
  if (y > 0) r.push(i - W);
  if (y < H - 1) r.push(i + W);
  return r;
}

export function components(grid, W, H) {
  const seen = new Uint8Array(W * H);
  const comps = [];
  for (let s = 0; s < grid.length; s++) {
    if (grid[s] === null || seen[s]) continue;
    const comp = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop();
      comp.push(i);
      for (const j of neighbors(i, W, H)) {
        if (!seen[j] && grid[j] !== null) { seen[j] = 1; stack.push(j); }
      }
    }
    comps.push(comp);
  }
  return comps;
}

// Größtes zusammenhängendes Stück = Hauptstück, alles andere ist lose
export function connectivity(grid, W, H) {
  const comps = components(grid, W, H).sort((a, b) => b.length - a.length);
  const total = comps.reduce((s, c) => s + c.length, 0);
  const loose = comps.slice(1);
  return { total, main: comps[0] || [], loose, looseCount: total - (comps[0]?.length || 0) };
}

// Zusammenhängende Fläche gleicher Farbe ab start
export function floodSame(grid, W, H, start) {
  const code = grid[start];
  if (code === null) return [];
  const seen = new Uint8Array(W * H);
  const out = [];
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const i = stack.pop();
    out.push(i);
    for (const j of neighbors(i, W, H)) {
      if (!seen[j] && grid[j] === code) { seen[j] = 1; stack.push(j); }
    }
  }
  return out;
}

export function bbox(grid, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === null) continue;
    const x = i % W, y = (i / W) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

export function trim(grid, W, H) {
  const b = bbox(grid, W, H);
  if (!b) return null;
  const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
  const out = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = grid[(b.y0 + y) * W + b.x0 + x];
  }
  return { grid: out, w, h };
}

// Motiv zuschneiden und mittig auf die Bauplatte(n) setzen.
// null, wenn es nicht auf die Fläche passt.
export function place(src, sw, sh, W, H) {
  const out = new Array(W * H).fill(null);
  const t = trim(src, sw, sh);
  if (!t) return out;
  if (t.w > W || t.h > H) return null;
  const ox = Math.floor((W - t.w) / 2), oy = Math.floor((H - t.h) / 2);
  for (let y = 0; y < t.h; y++) {
    for (let x = 0; x < t.w; x++) out[(oy + y) * W + ox + x] = t.grid[y * t.w + x];
  }
  return out;
}

// Ganzes Motiv verschieben; null, wenn dabei Perlen über den Rand fallen würden
export function shift(grid, W, H, dx, dy) {
  const b = bbox(grid, W, H);
  if (!b) return grid.slice();
  if (b.x0 + dx < 0 || b.x1 + dx >= W || b.y0 + dy < 0 || b.y1 + dy >= H) return null;
  const out = new Array(W * H).fill(null);
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === null) continue;
    const x = i % W, y = (i / W) | 0;
    out[(y + dy) * W + x + dx] = grid[i];
  }
  return out;
}

export function center(grid, W, H) {
  return place(grid, W, H, W, H);
}

// Erste Perle in Leserichtung (oben -> unten, links -> rechts)
export function firstFilled(grid) {
  return grid.findIndex((c) => c !== null);
}

export function countColors(grid) {
  const m = new Map();
  for (const c of grid) if (c !== null) m.set(c, (m.get(c) || 0) + 1);
  return m;
}

// Gleichfarbige Abschnitte einer Reihe zwischen x0 und x1 (inklusive)
export function rowRuns(grid, W, y, x0, x1) {
  const runs = [];
  for (let x = x0; x <= x1; x++) {
    const c = grid[y * W + x];
    if (c === null) continue;
    const last = runs[runs.length - 1];
    if (last && last.code === c && last.to === x - 1) last.to = x;
    else runs.push({ code: c, from: x, to: x });
  }
  return runs;
}
