import { HAMA_MIDI } from './palette.js';
import { hexToRgb, rgbToLab } from './color.js';
import { sampleImage, sampleChart, detectGrid, findChart, buildPattern } from './convert.js';
import * as G from './grid.js';
import { drawBoard } from './render.js';
import { homography, project, compare, median } from './check.js';
import * as store from './storage.js';

const PEG = 29;
const MAX_PLATES = 6;
const RULER = 24;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const state = {
  step: 'colors',
  palette: store.loadPalette(HAMA_MIDI),
  board: { px: 1, py: 1 },
  // mode: 'photo' = beliebiges Bild umrechnen, 'chart' = fertige Vorlage mit cols × rows Feldern auslesen
  settings: { mode: 'photo', width: 999, autoBg: true, bgTol: 12, maxColors: 0, smooth: true, cols: 29, rows: 29 },
  crop: { x: 0, y: 0, w: 1, h: 1 },
  image: null,
  imageUrl: null,
  grid: null,
  lastPattern: null,
  edited: false,
  stale: false,
  tool: 'hand',
  penCode: null,
  zoom: 1,
  highlight: null,
  undo: [],
  redo: [],
  plate: -1,
  row: 0,
  done: new Set(),
  check: null,
};

const W = () => state.board.px * PEG;
const H = () => state.board.py * PEG;
const ownedColors = () => state.palette.filter((c) => c.owned);

function colorMap() {
  return new Map(state.palette.map((c) => [c.code, c]));
}

function colorLabel(code) {
  const c = colorMap().get(code);
  return c ? `${c.name} (${c.code})` : `Farbe ${code}`;
}

// ---------- Allgemein ----------

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
}

function go(step) {
  state.step = step;
  $$('.step').forEach((s) => (s.hidden = s.id !== 'step-' + step));
  $$('.steps button').forEach((b) => b.setAttribute('aria-current', b.dataset.step === step ? 'step' : 'false'));
  window.scrollTo(0, 0);
  render();
}

function render() {
  ({ colors: renderColors, image: renderImage, pattern: renderPattern, build: renderBuild })[state.step]();
}

function persist() {
  const ok = store.saveProject({
    board: state.board,
    settings: state.settings,
    crop: state.crop,
    image: state.imageUrl,
    grid: state.grid,
    edited: state.edited,
    done: [...state.done],
  });
  if (!ok) toast('Der Speicher ist voll – das Bild wird nicht gemerkt, die Vorlage schon.');
}

function snapshot() {
  return { grid: state.grid ? state.grid.slice() : null, board: { ...state.board } };
}

function pushUndo(snap = snapshot()) {
  state.undo.push(snap);
  if (state.undo.length > 60) state.undo.shift();
  state.redo = [];
}

function restore(from, to) {
  if (!from.length) return;
  to.push(snapshot());
  const s = from.pop();
  state.grid = s.grid;
  state.board = s.board;
  state.edited = true;
  persist();
  render();
}

// ---------- 1 · Farben ----------

function renderColors() {
  $('#color-list').replaceChildren(...state.palette.map(colorItem));
  updateOwnedCount();
}

function updateOwnedCount() {
  const n = ownedColors().length;
  $('#owned-count').textContent = n === 1 ? '1 Farbe ausgewählt' : `${n} Farben ausgewählt`;
}

function colorItem(c) {
  const el = document.createElement('div');
  el.className = 'color-item' + (c.owned ? ' owned' : '');
  el.innerHTML = `
    <label class="swatch" style="--c:${esc(c.hex)}" title="Farbton anpassen">
      <input type="color" value="${esc(c.hex.toLowerCase())}" aria-label="Farbton für ${esc(c.name)} anpassen">
    </label>
    <label class="color-check">
      <input type="checkbox" ${c.owned ? 'checked' : ''}>
      <span class="color-code">${esc(c.code)}</span>
      <span class="color-name">${esc(c.name)}</span>
    </label>
    ${c.custom ? '<button class="icon-btn" aria-label="Farbe löschen">×</button>' : ''}`;
  $('input[type=checkbox]', el).addEventListener('change', (e) => {
    c.owned = e.target.checked;
    el.classList.toggle('owned', c.owned);
    paletteChanged();
  });
  const picker = $('input[type=color]', el);
  picker.addEventListener('input', () => $('.swatch', el).style.setProperty('--c', picker.value));
  picker.addEventListener('change', () => {
    c.hex = picker.value.toUpperCase();
    paletteChanged();
  });
  $('.icon-btn', el)?.addEventListener('click', () => {
    if (!confirm(`„${c.name}“ wirklich löschen?`)) return;
    state.palette.splice(state.palette.indexOf(c), 1);
    paletteChanged();
    renderColors();
  });
  return el;
}

let paletteTimer;
function paletteChanged() {
  store.savePalette(state.palette);
  updateOwnedCount();
  clearTimeout(paletteTimer);
  paletteTimer = setTimeout(() => {
    if (!state.image) return;
    if (state.edited) state.stale = true;
    else generate();
  }, 400);
}

$('#all-on').addEventListener('click', () => { state.palette.forEach((c) => (c.owned = true)); paletteChanged(); renderColors(); });
$('#all-off').addEventListener('click', () => { state.palette.forEach((c) => (c.owned = false)); paletteChanged(); renderColors(); });

$('#custom-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const codes = new Set(state.palette.map((c) => c.code));
  let n = 1;
  while (codes.has('E' + n)) n++;
  const name = $('#custom-name').value.trim() || 'Eigene Farbe';
  state.palette.push({ code: 'E' + n, name, hex: $('#custom-hex').value.toUpperCase(), owned: true, custom: true });
  $('#custom-name').value = '';
  paletteChanged();
  renderColors();
  toast(`„${name}“ hinzugefügt.`);
});

$('#export-colors').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state.palette, null, 2)], { type: 'application/json' });
  download(blob, 'meine-perlenfarben.json');
});

$('#import-colors').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const ok = Array.isArray(data) && data.length && data.every((c) => c && typeof c.code === 'string' && typeof c.name === 'string' && /^#[0-9a-f]{6}$/i.test(c.hex));
    if (!ok) throw new Error();
    state.palette = data.map((c) => ({ code: c.code, name: c.name, hex: c.hex.toUpperCase(), owned: !!c.owned, custom: !!c.custom }));
    paletteChanged();
    renderColors();
    toast('Farben geladen.');
  } catch {
    toast('Diese Datei enthält keine Perlenfarben.');
  }
});

// ---------- 2 · Bild ----------

function patternSize() {
  if (state.settings.mode === 'chart') {
    return { w: state.settings.cols, h: state.settings.rows, maxW: state.settings.cols };
  }
  const img = state.image;
  const a = (state.crop.h * img.naturalHeight) / (state.crop.w * img.naturalWidth);
  const maxW = Math.max(1, Math.min(W(), Math.floor(H() / a)));
  const w = Math.max(1, Math.min(state.settings.width, maxW));
  const h = Math.max(1, Math.min(H(), Math.round(w * a)));
  return { w, h, maxW };
}

function generate() {
  if (!state.image) return;
  const owned = ownedColors();
  if (!owned.length) {
    toast('Wähle zuerst bei „Farben“ aus, welche Perlen du hast.');
    return;
  }
  const chart = state.settings.mode === 'chart';
  const { w, h } = patternSize();
  if (w > W() || h > H()) {
    // Nur bei fertigen Vorlagen möglich: Fläche passend vergrößern
    const px = Math.ceil(w / PEG), py = Math.ceil(h / PEG);
    if (px > MAX_PLATES || py > MAX_PLATES) {
      toast(`Die Vorlage ist ${w} × ${h} Perlen groß – das sind mehr als ${MAX_PLATES} × ${MAX_PLATES} Platten.`);
      return;
    }
    state.board = { px: Math.max(px, state.board.px), py: Math.max(py, state.board.py) };
    toast(`Die Vorlage ist ${w} × ${h} Perlen groß – Baufläche auf ${state.board.px} × ${state.board.py} Platten vergrößert.`);
  }
  if (!chart) state.settings.width = w;
  const cells = chart ? sampleChart(state.image, state.crop, w, h) : sampleImage(state.image, state.crop, w, h);
  const colors = owned.map((c) => ({ code: c.code, lab: rgbToLab(...hexToRgb(c.hex)) }));
  const opts = chart ? { ...state.settings, maxColors: 0, smooth: false } : state.settings;
  const pat = buildPattern(cells, w, h, colors, opts);
  const hadEdits = state.edited && state.grid;
  if (hadEdits) pushUndo();
  state.lastPattern = { pat, w, h };
  state.grid = G.place(pat, w, h, W(), H());
  state.edited = false;
  state.stale = false;
  state.done.clear();
  state.check = null;
  state.highlight = null;
  state.plate = -1;
  persist();
  if (hadEdits) toast('Vorlage neu erstellt. Mit ↶ holst du deine Änderungen zurück.');
}

function renderImage() {
  $('#bx').value = state.board.px;
  $('#by').value = state.board.py;
  $$('[data-board]').forEach((b) => {
    const v = state.board[b.dataset.board] + Number(b.dataset.delta);
    b.disabled = v < 1 || v > MAX_PLATES;
  });
  const map = $('#plate-map');
  map.style.gridTemplateColumns = `repeat(${state.board.px}, 28px)`;
  map.replaceChildren(...Array.from({ length: state.board.px * state.board.py }, () => document.createElement('span')));
  const n = state.board.px * state.board.py;
  $('#board-size').textContent = `${n} ${n === 1 ? 'Platte' : 'Platten'} · Baufläche ${W()} × ${H()} Perlen`;

  const chart = state.settings.mode === 'chart';
  document.body.dataset.mode = state.settings.mode;
  $$('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.settings.mode)));
  $('#mode-hint').textContent = chart
    ? 'Du hast schon eine Bügelperlen-Vorlage (z. B. aus dem Internet)? Die Seite liest das Raster aus und übersetzt die Farben in deine Perlen.'
    : 'Ein beliebiges Bild oder Foto wird in Perlen umgerechnet.';
  $('#crop-hint').textContent = chart
    ? 'Das Raster wird automatisch gesucht. Die roten Linien sollten auf den Feldgrenzen liegen. Wenn nicht: Ziehe an den Griffen am Rahmen (die Lupe hilft beim genauen Treffen) oder korrigiere die Anzahl mit − / +. Tipp: Sind leere Felder und Perlen beide weiß, schalte „Hintergrund entfernen“ aus und lösche den Rand in Schritt 3 mit „Fläche löschen“.'
    : 'Zieh mit dem Finger einen Rahmen um dein Motiv oder pass ihn an den Griffen an – alles außerhalb wird weggeschnitten.';

  const has = !!state.image;
  $('#crop-area').hidden = !has;
  $('#settings-card').hidden = !has;
  $('#preview-card').hidden = !has || !state.grid;
  $('#to-pattern').disabled = !state.grid;
  $('#upload-label').textContent = has ? 'Anderes Bild auswählen' : 'Bild auswählen oder Foto machen';
  if (!has) return;

  drawCrop();
  const { w, h, maxW } = patternSize();
  const width = $('#width');
  width.max = maxW;
  width.min = Math.min(4, maxW);
  width.value = w;
  $('#size-out').textContent = `${w} × ${h} Perlen`;
  $('#autobg').checked = state.settings.autoBg;
  $('#bgtol').value = state.settings.bgTol;
  $('#bgtol-out').textContent = state.settings.bgTol;
  $('#bgtol-field').hidden = !state.settings.autoBg;
  $('#maxcolors').value = state.settings.maxColors;
  $('#smooth').checked = state.settings.smooth;
  $('#chart-cols').value = state.settings.cols;
  $('#chart-rows').value = state.settings.rows;
  renderPreview();
}

function renderPreview() {
  if (!state.grid) return;
  const wrap = $('#preview-wrap');
  const cell = Math.max(3, Math.min(14, Math.floor((wrap.clientWidth - 4) / W())));
  drawBoard($('#preview-canvas'), { grid: state.grid, W: W(), peg: PEG, colors: colorMap(), cell });
  const con = G.connectivity(state.grid, W(), H());
  const b = G.bbox(state.grid, W(), H());
  let info = `${con.total} Perlen`;
  if (b) info += ` · Motiv ${b.x1 - b.x0 + 1} × ${b.y1 - b.y0 + 1}`;
  if (con.looseCount) info += ` · ⚠ ${con.looseCount} lose ${con.looseCount === 1 ? 'Perle' : 'Perlen'} (in Schritt 3 beheben)`;
  $('#preview-info').textContent = info;
}

function changeBoard(next) {
  const oW = W(), oH = H();
  const snap = snapshot();
  state.board = next;
  if (state.image) {
    state.settings.width = 999; // neue Fläche ausfüllen
    generate();
  } else if (state.grid) {
    const t = G.trim(state.grid, oW, oH);
    const placed = t ? G.place(t.grid, t.w, t.h, W(), H()) : new Array(W() * H()).fill(null);
    if (!placed) {
      state.board = snap.board;
      toast('Die Vorlage passt nicht auf diese Fläche.');
      return;
    }
    pushUndo(snap);
    state.grid = placed;
  }
  state.plate = -1;
  persist();
  render();
}

$$('[data-board]').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.board;
  const v = Math.min(MAX_PLATES, Math.max(1, state.board[k] + Number(b.dataset.delta)));
  if (v !== state.board[k]) changeBoard({ ...state.board, [k]: v });
}));

function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function loadImg(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// Große Fotos verkleinern: reicht für jede Perlenvorlage und passt in den Speicher
async function shrink(url) {
  const img = await loadImg(url);
  const s = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  let alpha = false;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 250) { alpha = true; break; }
  return alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9);
}

$('#file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const url = await shrink(await readFile(file));
    state.image = await loadImg(url);
    state.imageUrl = url;
  } catch {
    toast('Dieses Bild konnte nicht geöffnet werden.');
    return;
  }
  if (state.edited && state.grid) pushUndo();
  state.edited = false;
  state.crop = { x: 0, y: 0, w: 1, h: 1 };
  state.settings.width = 999;
  locateChart();
  generate();
  render();
});

const clampCount = (n) => Math.max(1, Math.min(MAX_PLATES * PEG, n));

// Fertige Vorlage: Raster im ganzen Bild suchen und Rahmen + Anzahl setzen
function locateChart(manual = false) {
  if (state.settings.mode !== 'chart' || !state.image) return;
  const found = findChart(state.image);
  if (found) {
    state.crop = found.crop;
    state.settings.cols = clampCount(found.cols);
    state.settings.rows = clampCount(found.rows);
    toast(`Raster gefunden: ${found.cols} × ${found.rows} Perlen. Liegen die roten Linien auf den Feldern?`);
    return;
  }
  countChartCells();
  if (manual) toast('Kein Raster gefunden – zieh den Rahmen bitte selbst um die Felder.');
}

// Anzahl der Felder innerhalb des aktuellen Rahmens schätzen
function countChartCells() {
  const g = detectGrid(state.image, state.crop);
  if (!g) return;
  state.settings.cols = clampCount(g.cols);
  state.settings.rows = clampCount(g.rows);
}

$$('[data-mode]').forEach((b) => b.addEventListener('click', () => {
  if (state.settings.mode === b.dataset.mode) return;
  state.settings.mode = b.dataset.mode;
  state.settings.width = 999;
  locateChart();
  generate();
  render();
}));

$('#chart-detect').addEventListener('click', () => {
  locateChart(true);
  generate();
  render();
});

for (const [id, key] of [['#chart-cols', 'cols'], ['#chart-rows', 'rows']]) {
  $(id).addEventListener('change', (e) => {
    const v = Math.round(Number(e.target.value));
    if (!(v >= 1 && v <= MAX_PLATES * PEG)) {
      e.target.value = state.settings[key];
      return;
    }
    state.settings[key] = v;
    generate();
    render();
  });
}

$$('[data-chart]').forEach((b) => b.addEventListener('click', () => {
  const key = b.dataset.chart;
  state.settings[key] = clampCount(state.settings[key] + Number(b.dataset.delta));
  generate();
  render();
}));

// Rahmen: neu aufziehen, verschieben oder an Ecken/Kanten anpassen
const cropCanvas = $('#crop-canvas');
const GRIP = 24; // Fangbereich der Griffe in CSS-Pixeln
let cropDrag = null;

function drawCrop(rect = state.crop, counts = state.settings, loupeAt = null) {
  const img = state.image;
  const maxW = $('#crop-wrap').clientWidth || 300;
  const maxH = Math.min(window.innerHeight * 0.5, 480);
  const s = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
  const cw = Math.max(1, Math.round(img.naturalWidth * s));
  const ch = Math.max(1, Math.round(img.naturalHeight * s));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cropCanvas.width = cw * dpr;
  cropCanvas.height = ch * dpr;
  cropCanvas.style.width = cw + 'px';
  cropCanvas.style.height = ch + 'px';
  const ctx = cropCanvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Schachbrett zeigt transparente Bereiche
  for (let y = 0; y < ch; y += 10) {
    for (let x = 0; x < cw; x += 10) {
      ctx.fillStyle = (x + y) % 20 ? '#eee' : '#fff';
      ctx.fillRect(x, y, 10, 10);
    }
  }
  ctx.drawImage(img, 0, 0, cw, ch);
  const r = { x: rect.x * cw, y: rect.y * ch, w: rect.w * cw, h: rect.h * ch };
  ctx.fillStyle = 'rgba(30, 24, 18, 0.6)';
  ctx.beginPath();
  ctx.rect(0, 0, cw, ch);
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.fill('evenodd');
  if (state.settings.mode === 'chart' && cropDrag?.mode !== 'new') {
    // Feldgrenzen, wie sie ausgelesen werden
    const { cols, rows } = counts;
    ctx.strokeStyle = 'rgba(232, 40, 30, 0.75)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 1; k < cols; k++) {
      const x = r.x + (k * r.w) / cols;
      ctx.moveTo(x, r.y);
      ctx.lineTo(x, r.y + r.h);
    }
    for (let k = 1; k < rows; k++) {
      const y = r.y + (k * r.h) / rows;
      ctx.moveTo(r.x, y);
      ctx.lineTo(r.x + r.w, y);
    }
    ctx.stroke();
  }
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = '#e8604c';
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.setLineDash([]);

  // Griffe an Ecken und Kantenmitten
  for (const [gx, gy] of [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]]) {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#e8604c';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(r.x + gx * r.w, r.y + gy * r.h, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  if (loupeAt) drawLoupe(ctx, loupeAt, cw, dpr);
}

// Lupe: zeigt vergrößert, was unter dem Finger liegt
function drawLoupe(ctx, [px, py], cw, dpr) {
  const R = 58, Z = 3;
  const cx = px < cw / 2 ? cw - R - 8 : R + 8, cy = R + 8;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
  const src = (2 * R) / Z;
  ctx.drawImage(cropCanvas, (px - src / 2) * dpr, (py - src / 2) * dpr, src * dpr, src * dpr, cx - R, cy - R, 2 * R, 2 * R);
  ctx.restore();
  ctx.strokeStyle = '#2b2622';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(43, 38, 34, 0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy);
  ctx.lineTo(cx + 10, cy);
  ctx.moveTo(cx, cy - 10);
  ctx.lineTo(cx, cy + 10);
  ctx.stroke();
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function cropPoint(e) {
  const r = cropCanvas.getBoundingClientRect();
  return {
    x: clamp01((e.clientX - r.left) / r.width),
    y: clamp01((e.clientY - r.top) / r.height),
    px: e.clientX - r.left,
    py: e.clientY - r.top,
    cw: r.width,
    ch: r.height,
  };
}

// Was liegt unter dem Finger: ein Griff (resize), der Rahmen (move) oder nichts (new)?
function cropHit(p) {
  const c = state.crop;
  const l = c.x * p.cw, t = c.y * p.ch, rr = (c.x + c.w) * p.cw, b = (c.y + c.h) * p.ch;
  const inX = p.px > l - GRIP && p.px < rr + GRIP;
  const inY = p.py > t - GRIP && p.py < b + GRIP;
  const dl = Math.abs(p.px - l), dr = Math.abs(p.px - rr), dt = Math.abs(p.py - t), db = Math.abs(p.py - b);
  const edges = {
    l: inY && dl < GRIP && dl <= dr,
    r: inY && dr < GRIP && dr < dl,
    t: inX && dt < GRIP && dt <= db,
    b: inX && db < GRIP && db < dt,
  };
  if (edges.l || edges.r || edges.t || edges.b) return { mode: 'resize', edges };
  if (p.px > l && p.px < rr && p.py > t && p.py < b) return { mode: 'move' };
  return { mode: 'new' };
}

function dragRect(d, p) {
  const o = d.orig, dx = p.x - d.start.x, dy = p.y - d.start.y, min = 0.02;
  if (d.mode === 'new') {
    return { x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) };
  }
  if (d.mode === 'move') {
    return { ...o, x: Math.min(1 - o.w, Math.max(0, o.x + dx)), y: Math.min(1 - o.h, Math.max(0, o.y + dy)) };
  }
  let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
  if (d.edges.l) x0 = Math.min(x1 - min, clamp01(o.x + dx));
  if (d.edges.r) x1 = Math.max(x0 + min, clamp01(o.x + o.w + dx));
  if (d.edges.t) y0 = Math.min(y1 - min, clamp01(o.y + dy));
  if (d.edges.b) y1 = Math.max(y0 + min, clamp01(o.y + o.h + dy));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Beim Anpassen bleibt die Feldgröße gleich – größerer Rahmen = mehr Felder
function dragCounts(d, rect) {
  if (d.mode !== 'resize') return state.settings;
  return {
    cols: clampCount(Math.round(rect.w / (d.orig.w / state.settings.cols))),
    rows: clampCount(Math.round(rect.h / (d.orig.h / state.settings.rows))),
  };
}

cropCanvas.addEventListener('pointerdown', (e) => {
  cropCanvas.setPointerCapture(e.pointerId);
  const p = cropPoint(e);
  cropDrag = { ...cropHit(p), start: p, orig: { ...state.crop } };
  drawCrop(state.crop, state.settings, [p.px, p.py]);
});
cropCanvas.addEventListener('pointermove', (e) => {
  if (!cropDrag) return;
  const p = cropPoint(e);
  const rect = dragRect(cropDrag, p);
  drawCrop(rect, dragCounts(cropDrag, rect), [p.px, p.py]);
});
cropCanvas.addEventListener('pointerup', (e) => {
  if (!cropDrag) return;
  const d = cropDrag;
  const rect = dragRect(d, cropPoint(e));
  const counts = dragCounts(d, rect);
  cropDrag = null;
  if (rect.w < 0.03 || rect.h < 0.03 || (d.mode === 'move' && rect.x === d.orig.x && rect.y === d.orig.y)) {
    drawCrop();
    return;
  }
  state.crop = rect;
  state.settings.width = 999;
  if (state.settings.mode === 'chart') {
    if (d.mode === 'new') countChartCells();
    else Object.assign(state.settings, { cols: counts.cols, rows: counts.rows });
  }
  generate();
  render();
});
cropCanvas.addEventListener('pointercancel', () => { cropDrag = null; drawCrop(); });

$('#reset-crop').addEventListener('click', () => {
  state.crop = { x: 0, y: 0, w: 1, h: 1 };
  state.settings.width = 999;
  if (state.settings.mode === 'chart') countChartCells();
  generate();
  render();
});

// Ausschnitt auf das Motiv (ohne entfernten Hintergrund) verkleinern
$('#fit-motif').addEventListener('click', () => {
  const lp = state.lastPattern;
  const b = lp && G.bbox(lp.pat, lp.w, lp.h);
  if (!b) {
    toast('Kein Motiv gefunden.');
    return;
  }
  if (b.x0 === 0 && b.y0 === 0 && b.x1 === lp.w - 1 && b.y1 === lp.h - 1) {
    toast(state.settings.autoBg
      ? 'Es gibt keinen Rand zum Abschneiden. Erhöhe ggf. „Wie ähnlich muss der Hintergrund sein?“.'
      : 'Schalte zuerst „Hintergrund entfernen“ ein.');
    return;
  }
  const c = state.crop;
  state.crop = {
    x: c.x + (b.x0 / lp.w) * c.w,
    y: c.y + (b.y0 / lp.h) * c.h,
    w: ((b.x1 - b.x0 + 1) / lp.w) * c.w,
    h: ((b.y1 - b.y0 + 1) / lp.h) * c.h,
  };
  state.settings.width = 999;
  generate();
  render();
  toast('Rand abgeschnitten – das Motiv nutzt jetzt die ganze Fläche.');
});

let settingsTimer;
function settingsChanged() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    generate();
    render();
  }, 120);
}

$('#width').addEventListener('input', (e) => {
  state.settings.width = Number(e.target.value);
  const { w, h } = patternSize();
  $('#size-out').textContent = `${w} × ${h} Perlen`;
  settingsChanged();
});
$('#autobg').addEventListener('change', (e) => { state.settings.autoBg = e.target.checked; settingsChanged(); });
$('#bgtol').addEventListener('input', (e) => {
  state.settings.bgTol = Number(e.target.value);
  $('#bgtol-out').textContent = e.target.value;
  settingsChanged();
});
$('#maxcolors').addEventListener('change', (e) => { state.settings.maxColors = Number(e.target.value); settingsChanged(); });
$('#smooth').addEventListener('change', (e) => { state.settings.smooth = e.target.checked; settingsChanged(); });

$('#maxcolors').replaceChildren(
  new Option('Alle meine Farben', 0),
  ...[2, 3, 4, 5, 6, 8, 10, 12, 15, 20].map((n) => new Option(`${n} Farben`, n)),
);

// ---------- 3 · Vorlage ----------

const boardCanvas = $('#board-canvas');
let boardCell = 12;

function renderPattern() {
  const has = !!state.grid;
  $('#pattern-empty').hidden = has;
  $('#pattern-main').hidden = !has;
  if (!has) return;

  const stale = $('#stale');
  stale.hidden = !state.stale;
  if (state.stale) {
    stale.innerHTML = '<span class="grow">Deine Farben haben sich geändert. Die Vorlage nutzt noch die alten.</span><button class="btn" id="regen">Neu berechnen</button>';
    $('#regen').onclick = () => { generate(); render(); };
  }

  $$('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === state.tool)));
  boardCanvas.style.touchAction = state.tool === 'hand' ? 'auto' : 'none';
  boardCanvas.style.cursor = state.tool === 'hand' ? 'default' : 'crosshair';
  $('#undo').disabled = !state.undo.length;
  $('#redo').disabled = !state.redo.length;

  renderPenColors();
  const con = G.connectivity(state.grid, W(), H());
  drawPatternBoard(con);
  renderConnectivity(con);
  renderLegend();
  renderMargins();
}

function drawPatternBoard(con = G.connectivity(state.grid, W(), H())) {
  const wrap = $('#board-wrap');
  const base = Math.max(6, Math.min(26, Math.floor((wrap.clientWidth - 18 - RULER) / W())));
  boardCell = Math.max(4, Math.round(base * state.zoom));
  drawBoard(boardCanvas, {
    grid: state.grid,
    W: W(),
    peg: PEG,
    colors: colorMap(),
    cell: boardCell,
    ruler: RULER,
    loose: con.loose.flat(),
    highlight: state.highlight,
    start: G.firstFilled(state.grid),
    showCodes: boardCell >= 22,
  });
}

function renderConnectivity(con) {
  const el = $('#connect-status');
  if (!con.total) {
    el.className = 'status warn';
    el.textContent = 'Die Vorlage ist leer.';
    return;
  }
  if (!con.loose.length) {
    el.className = 'status ok';
    el.textContent = `✓ Alles hängt zusammen – ${con.total} Perlen in einem Stück.`;
    return;
  }
  const groups = con.loose.length;
  el.className = 'status warn';
  el.innerHTML = `
    <span class="grow">⚠ ${groups} ${groups === 1 ? 'Teil hängt' : 'Teile hängen'} nicht am Hauptstück
    (${con.looseCount} ${con.looseCount === 1 ? 'Perle' : 'Perlen'}, rot umrandet). Diagonal reicht nicht – Perlen halten nur seitlich.</span>
    <button class="btn" id="show-loose">Zeigen</button>
    <button class="btn danger" id="remove-loose">Lose Teile löschen</button>`;
  $('#show-loose').onclick = () => {
    const i = con.loose[0][0];
    const wrap = $('#board-wrap');
    wrap.scrollTo({
      left: RULER + (i % W()) * boardCell - wrap.clientWidth / 2,
      top: RULER + Math.floor(i / W()) * boardCell - wrap.clientHeight / 2,
      behavior: 'smooth',
    });
    wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  $('#remove-loose').onclick = () => {
    pushUndo();
    for (const i of con.loose.flat()) state.grid[i] = null;
    state.grid = G.center(state.grid, W(), H());
    afterEdit();
    toast(`${con.looseCount} lose ${con.looseCount === 1 ? 'Perle' : 'Perlen'} gelöscht.`);
  };
}

function renderLegend() {
  const counts = [...G.countColors(state.grid)].sort((a, b) => b[1] - a[1]);
  const total = counts.reduce((s, [, n]) => s + n, 0);
  $('#bead-total').textContent = `· ${total} Perlen, ${counts.length} ${counts.length === 1 ? 'Farbe' : 'Farben'}`;
  const map = colorMap();
  $('#legend').replaceChildren(...counts.map(([code, n]) => {
    const b = document.createElement('button');
    b.setAttribute('aria-pressed', String(state.highlight === code));
    b.innerHTML = `<i style="--c:${esc(map.get(code)?.hex ?? '#999')}"></i>${esc(colorLabel(code))} <b>${n}×</b>`;
    b.onclick = () => {
      state.highlight = state.highlight === code ? null : code;
      renderPattern();
    };
    return b;
  }));
}

function renderPenColors() {
  const el = $('#pen-colors');
  el.hidden = state.tool !== 'pen';
  if (el.hidden) return;
  const owned = ownedColors();
  if (!owned.some((c) => c.code === state.penCode)) state.penCode = owned[0]?.code ?? null;
  el.replaceChildren(...owned.map((c) => {
    const b = document.createElement('button');
    b.style.setProperty('--c', c.hex);
    b.title = `${c.name} (${c.code})`;
    b.setAttribute('aria-label', b.title);
    b.setAttribute('aria-pressed', String(c.code === state.penCode));
    b.onclick = () => { state.penCode = c.code; renderPenColors(); };
    return b;
  }));
}

function renderMargins() {
  const b = G.bbox(state.grid, W(), H());
  $('#margins').textContent = b
    ? `Freier Rand: oben ${b.y0}, unten ${H() - 1 - b.y1}, links ${b.x0}, rechts ${W() - 1 - b.x1} Stifte.`
    : '';
}

function afterEdit() {
  state.edited = true;
  state.check = null;
  state.done.clear();
  persist();
  renderPattern();
}

$$('[data-tool]').forEach((b) => b.addEventListener('click', () => {
  state.tool = b.dataset.tool;
  renderPattern();
}));
$('#undo').addEventListener('click', () => restore(state.undo, state.redo));
$('#redo').addEventListener('click', () => restore(state.redo, state.undo));
$('#zoom-in').addEventListener('click', () => { state.zoom = Math.min(4, state.zoom * 1.4); drawPatternBoard(); });
$('#zoom-out').addEventListener('click', () => { state.zoom = Math.max(0.4, state.zoom / 1.4); drawPatternBoard(); });

$$('[data-move]').forEach((b) => b.addEventListener('click', () => {
  const [dx, dy] = b.dataset.move.split(',').map(Number);
  const moved = G.shift(state.grid, W(), H(), dx, dy);
  if (!moved) {
    toast('Weiter geht es nicht – sonst ragt das Motiv über die Platte.');
    return;
  }
  pushUndo();
  state.grid = moved;
  afterEdit();
}));
$('#center').addEventListener('click', () => {
  pushUndo();
  state.grid = G.center(state.grid, W(), H());
  afterEdit();
});

function cellAt(e) {
  const r = boardCanvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left - RULER) / boardCell);
  const y = Math.floor((e.clientY - r.top - RULER) / boardCell);
  return x < 0 || y < 0 || x >= W() || y >= H() ? -1 : y * W() + x;
}

let stroke = null;
let frame = 0;

function paint(i) {
  if (i < 0) return;
  const g = state.grid;
  if (state.tool === 'erase' && g[i] !== null) { g[i] = null; stroke.changed = true; }
  if (state.tool === 'pen' && state.penCode && g[i] !== state.penCode) { g[i] = state.penCode; stroke.changed = true; }
  if (stroke.changed && !frame) {
    frame = requestAnimationFrame(() => { frame = 0; drawPatternBoard(); });
  }
}

boardCanvas.addEventListener('pointerdown', (e) => {
  if (state.tool === 'hand') return;
  const i = cellAt(e);
  if (i < 0) return;
  e.preventDefault();
  if (state.tool === 'pick') {
    if (state.grid[i] === null) return;
    state.penCode = state.grid[i];
    state.tool = 'pen';
    renderPattern();
    toast(`Stift malt jetzt mit ${colorLabel(state.penCode)}.`);
    return;
  }
  if (state.tool === 'wand') {
    const area = G.floodSame(state.grid, W(), H(), i);
    if (!area.length) return;
    pushUndo();
    for (const j of area) state.grid[j] = null;
    afterEdit();
    return;
  }
  boardCanvas.setPointerCapture(e.pointerId);
  stroke = { snap: snapshot(), changed: false };
  paint(i);
});
boardCanvas.addEventListener('pointermove', (e) => {
  if (stroke) paint(cellAt(e));
});
function endStroke() {
  if (!stroke) return;
  if (stroke.changed) {
    pushUndo(stroke.snap);
    afterEdit();
  }
  stroke = null;
}
boardCanvas.addEventListener('pointerup', endStroke);
boardCanvas.addEventListener('pointercancel', endStroke);

$('#export-png').addEventListener('click', exportPng);

// Vorlage mit Linealen, Farbnummern und Farbliste als PNG
function exportPng() {
  const board = document.createElement('canvas');
  const cell = 22;
  drawBoard(board, { grid: state.grid, W: W(), peg: PEG, colors: colorMap(), cell, ruler: 26, showCodes: true, start: G.firstFilled(state.grid), dpr: 1 });
  const counts = [...G.countColors(state.grid)].sort((a, b) => b[1] - a[1]);
  const map = colorMap();
  const pad = 24, lineH = 30;
  const cols = Math.max(1, Math.floor((board.width) / 240));
  const legendH = Math.ceil(counts.length / cols) * lineH + 40;
  const out = document.createElement('canvas');
  out.width = board.width + pad * 2;
  out.height = board.height + legendH + pad * 2;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(board, pad, pad);
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#2b2622';
  const total = counts.reduce((s, [, n]) => s + n, 0);
  ctx.fillText(`${total} Perlen · ${state.board.px} × ${state.board.py} Platten · grüner Ring = Start`, pad, board.height + pad + 20);
  counts.forEach(([code, n], k) => {
    const x = pad + (k % cols) * 240;
    const y = board.height + pad + 40 + Math.floor(k / cols) * lineH + lineH / 2;
    ctx.fillStyle = map.get(code)?.hex ?? '#999';
    ctx.beginPath();
    ctx.arc(x + 11, y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b2622';
    ctx.font = '500 14px system-ui, sans-serif';
    ctx.fillText(`${colorLabel(code)} – ${n}×`, x + 30, y);
  });
  out.toBlob((blob) => download(blob, 'buegelperlen-vorlage.png'));
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- 4 · Bauen ----------

const plateCanvas = $('#plate-canvas');
const PLATE_RULER = 28;
let plateCell = 20;

function plateOrigin(p) {
  return { x0: (p % state.board.px) * PEG, y0: Math.floor(p / state.board.px) * PEG };
}

function plateOf(i) {
  const x = i % W(), y = Math.floor(i / W());
  return Math.floor(y / PEG) * state.board.px + Math.floor(x / PEG);
}

function plateName(p) {
  const { px, py } = state.board;
  if (px * py === 1) return 'deine Platte';
  const cx = p % px, cy = Math.floor(p / px);
  const vert = py === 1 ? '' : cy === 0 ? 'oben' : cy === py - 1 ? 'unten' : `${cy + 1}. Reihe`;
  const horiz = px === 1 ? '' : cx === 0 ? 'links' : cx === px - 1 ? 'rechts' : `${cx + 1}. von links`;
  return `Platte ${p + 1} (${[vert, horiz].filter(Boolean).join(' ')})`;
}

function plateRowHasBeads(p, r) {
  const { x0, y0 } = plateOrigin(p);
  for (let x = x0; x < x0 + PEG; x++) if (state.grid[(y0 + r) * W() + x] !== null) return true;
  return false;
}

function plateBeads(p) {
  const { x0, y0 } = plateOrigin(p);
  let n = 0;
  for (let y = y0; y < y0 + PEG; y++) for (let x = x0; x < x0 + PEG; x++) if (state.grid[y * W() + x] !== null) n++;
  return n;
}

function selectPlate(p) {
  if (p !== state.plate) photo.points = [];
  state.plate = p;
  state.row = 0;
  while (state.row < PEG - 1 && !plateRowHasBeads(p, state.row)) state.row++;
}

function renderBuild() {
  const start = state.grid ? G.firstFilled(state.grid) : -1;
  $('#build-empty').hidden = start >= 0;
  $('#build-main').hidden = start < 0;
  if (start < 0) return;

  const con = G.connectivity(state.grid, W(), H());
  const warn = $('#build-warning');
  warn.hidden = !con.loose.length;
  if (con.loose.length) {
    warn.innerHTML = `⚠ ${con.looseCount} ${con.looseCount === 1 ? 'Perle hängt' : 'Perlen hängen'} nicht am Hauptstück und würden abfallen. <button class="btn" data-go="pattern">Beheben</button>`;
    $('[data-go]', warn).onclick = () => go('pattern');
  }

  if (state.plate < 0 || state.plate >= state.board.px * state.board.py) {
    selectPlate(plateOf(start));
  }
  renderStartCard(start);
  renderPlatePicker(start);
  renderRow();
  drawPlate(start);
  renderCheck();
}

function renderStartCard(start) {
  const sx = start % W(), sy = Math.floor(start / W());
  const p = plateOf(start);
  const { x0, y0 } = plateOrigin(p);
  const b = G.bbox(state.grid, W(), H());
  const code = state.grid[start];
  const multi = state.board.px * state.board.py > 1;
  $('#start-card').innerHTML = `
    <div class="flag" style="--c:${esc(colorMap().get(code)?.hex ?? '#999')}"></div>
    <h2>Hier beginnst du</h2>
    <div class="big">Erste Perle: ${multi ? `<mark>${esc(plateName(p))}</mark>, ` : ''}<mark>Reihe ${sy - y0 + 1}</mark> von oben, <mark>Stift ${sx - x0 + 1}</mark> von links – ${esc(colorLabel(code))}</div>
    <div class="sub">
      Zähle immer ab der <b>oberen linken Ecke</b> ${multi ? 'der jeweiligen Platte' : 'der Platte'}.
      So viele Stifte bleiben frei:
      <span class="margins-fig"><span>oben ${b.y0}</span><span>links ${b.x0}</span><span>rechts ${W() - 1 - b.x1}</span><span>unten ${H() - 1 - b.y1}</span></span>
    </div>`;
}

function renderPlatePicker(start) {
  const { px, py } = state.board;
  $('#plate-picker-card').hidden = px * py === 1;
  if (px * py === 1) return;
  const startPlate = plateOf(start);
  const picker = $('#plate-picker');
  picker.style.gridTemplateColumns = `repeat(${px}, 1fr)`;
  picker.replaceChildren(...Array.from({ length: px * py }, (_, p) => {
    const n = plateBeads(p);
    const b = document.createElement('button');
    b.innerHTML = `Platte ${p + 1}<small>${n ? `${n} Perlen` : 'leer'}${p === startPlate ? ' · Start' : ''}</small>`;
    b.setAttribute('aria-pressed', String(p === state.plate));
    b.classList.toggle('start', p === startPlate);
    b.disabled = !n;
    b.onclick = () => { selectPlate(p); renderBuild(); };
    return b;
  }));
}

function renderRow() {
  const p = state.plate;
  const { x0, y0 } = plateOrigin(p);
  const gy = y0 + state.row;
  $('#row-plate').textContent = state.board.px * state.board.py > 1 ? plateName(p) : 'Deine Platte';
  $('#row-label').textContent = `Reihe ${state.row + 1} von ${PEG}`;
  $('#row-prev').disabled = state.row === 0;
  $('#row-next').disabled = state.row === PEG - 1;

  const runs = G.rowRuns(state.grid, W(), gy, x0, x0 + PEG - 1);
  const map = colorMap();
  $('#row-runs').replaceChildren(...(runs.length ? runs.map((r) => {
    const li = document.createElement('li');
    const n = r.to - r.from + 1;
    const pos = n === 1 ? `Stift ${r.from - x0 + 1}` : `Stift ${r.from - x0 + 1}–${r.to - x0 + 1}`;
    li.innerHTML = `<span class="pos">${pos}</span><span class="run-dot" style="--c:${esc(map.get(r.code)?.hex ?? '#999')}"></span><span><b>${n}×</b> ${esc(colorLabel(r.code))}</span>`;
    return li;
  }) : [Object.assign(document.createElement('li'), { className: 'empty', textContent: 'In dieser Reihe kommen keine Perlen.' })]));

  const done = state.done.has(doneKey(p, state.row));
  const btn = $('#row-done');
  btn.textContent = done ? '✓ Reihe ist fertig (rückgängig)' : 'Reihe fertig – weiter';
  btn.classList.toggle('primary', !done);
  btn.disabled = !runs.length;

  let rows = 0, finished = 0;
  for (let r = 0; r < PEG; r++) {
    if (!plateRowHasBeads(p, r)) continue;
    rows++;
    if (state.done.has(doneKey(p, r))) finished++;
  }
  $('#progress').textContent = `${finished} von ${rows} Reihen auf dieser Platte erledigt.`;
}

function drawPlate(start) {
  const wrap = $('#plate-wrap');
  plateCell = Math.max(12, Math.min(34, Math.floor((wrap.clientWidth - PLATE_RULER - 2) / PEG)));
  const { x0, y0 } = plateOrigin(state.plate);
  drawBoard(plateCanvas, {
    grid: state.grid,
    W: W(),
    peg: PEG,
    colors: colorMap(),
    cell: plateCell,
    x0, y0, w: PEG, h: PEG,
    ruler: PLATE_RULER,
    row: y0 + state.row,
    done: doneRows(),
    start,
    showCodes: plateCell >= 20,
    marks: state.check?.plate === state.plate ? state.check.marks : null,
  });
}

// Fertig-Markierungen sind pro Platte gespeichert ("platte:reihe"),
// gezeichnet wird mit Rasterzeilen der aktuellen Platte
const doneKey = (p, r) => `${p}:${r}`;

function doneRows() {
  const { y0 } = plateOrigin(state.plate);
  const rows = new Set();
  for (let r = 0; r < PEG; r++) if (state.done.has(doneKey(state.plate, r))) rows.add(y0 + r);
  return rows;
}

function moveRow(dir) {
  let r = state.row + dir;
  while (r >= 0 && r < PEG && !plateRowHasBeads(state.plate, r)) r += dir;
  if (r < 0 || r >= PEG) r = Math.min(PEG - 1, Math.max(0, state.row + dir));
  state.row = r;
  renderRow();
  drawPlate(G.firstFilled(state.grid));
}

$('#row-prev').addEventListener('click', () => moveRow(-1));
$('#row-next').addEventListener('click', () => moveRow(1));
$('#row-done').addEventListener('click', () => {
  const key = doneKey(state.plate, state.row);
  if (state.done.has(key)) {
    state.done.delete(key);
    persist();
    renderRow();
    drawPlate(G.firstFilled(state.grid));
    return;
  }
  state.done.add(key);
  persist();
  moveRow(1);
});
plateCanvas.addEventListener('click', (e) => {
  const r = plateCanvas.getBoundingClientRect();
  const row = Math.floor((e.clientY - r.top - PLATE_RULER) / plateCell);
  if (row < 0 || row >= PEG) return;
  state.row = row;
  renderRow();
  drawPlate(G.firstFilled(state.grid));
});

// ---------- Fortschritt per Foto prüfen ----------

const checkCanvas = $('#check-canvas');
const GRID_CORNERS = [[0, 0], [PEG - 1, 0], [PEG - 1, PEG - 1], [0, PEG - 1]];
const CORNER_NAMES = [
  'oben links (Reihe 1, Stift 1)',
  'oben rechts (Reihe 1, Stift 29)',
  'unten rechts (Reihe 29, Stift 29)',
  'unten links (Reihe 29, Stift 1)',
];
// Foto in voller Auflösung; points in Foto-Pixeln
const photo = { canvas: null, data: null, points: [], scale: 1, drag: -1 };

function renderCheck() {
  const multi = state.board.px * state.board.py > 1;
  $('#check-intro').textContent = `Fotografiere ${multi ? plateName(state.plate) : 'deine Platte'} möglichst gerade von oben und bei gutem Licht. Dann tippst du die vier Eck-Stifte an, und die Seite vergleicht jeden Stift mit der Vorlage.`;
  $('#check-upload-label').textContent = photo.canvas ? 'Neues Foto machen' : 'Foto von der Platte machen';
  $('#check-area').hidden = !photo.canvas;
  if (photo.canvas) drawCheck();
  renderCheckResult();
}

function drawCheck() {
  const pw = photo.canvas.width, ph = photo.canvas.height;
  const maxW = $('#check-wrap').clientWidth || 300;
  const s = Math.min(maxW / pw, (window.innerHeight * 0.7) / ph);
  photo.scale = s;
  const cw = Math.round(pw * s), ch = Math.round(ph * s);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  checkCanvas.width = cw * dpr;
  checkCanvas.height = ch * dpr;
  checkCanvas.style.width = cw + 'px';
  checkCanvas.style.height = ch + 'px';
  const ctx = checkCanvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.drawImage(photo.canvas, 0, 0, cw, ch);

  const pts = photo.points;
  if (pts.length === 4) {
    const h = homography(GRID_CORNERS, pts);
    if (h) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeStyle = 'rgba(232,96,76,0.95)';
      ctx.lineWidth = 1.5;
      for (let r = 0; r < PEG; r++) {
        for (let c = 0; c < PEG; c++) {
          const [x, y] = project(h, c, r);
          ctx.beginPath();
          ctx.arc(x * s, y * s, 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }
  }
  pts.forEach(([x, y], k) => {
    ctx.fillStyle = '#e8604c';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x * s, y * s, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(k + 1), x * s, y * s + 0.5);
  });

  $('#check-step').textContent = pts.length < 4
    ? `${pts.length + 1}/4 · Tippe auf den Stift ${CORNER_NAMES[pts.length]}.`
    : 'Liegen die kleinen Punkte auf den Stiften? Sonst die Ecken etwas verschieben. Dann „Prüfen“.';
  $('#check-run').disabled = pts.length < 4;
}

function photoPoint(e) {
  const r = checkCanvas.getBoundingClientRect();
  return [(e.clientX - r.left) / photo.scale, (e.clientY - r.top) / photo.scale];
}

checkCanvas.addEventListener('pointerdown', (e) => {
  const p = photoPoint(e);
  checkCanvas.setPointerCapture(e.pointerId);
  if (photo.points.length < 4) {
    photo.points.push(p);
    photo.drag = photo.points.length - 1;
  } else {
    let best = -1, bestD = 44 / photo.scale;
    photo.points.forEach(([x, y], k) => {
      const d = Math.hypot(x - p[0], y - p[1]);
      if (d < bestD) { bestD = d; best = k; }
    });
    photo.drag = best;
  }
  drawCheck();
});
checkCanvas.addEventListener('pointermove', (e) => {
  if (photo.drag < 0) return;
  photo.points[photo.drag] = photoPoint(e);
  drawCheck();
});
const endPhotoDrag = () => { photo.drag = -1; };
checkCanvas.addEventListener('pointerup', endPhotoDrag);
checkCanvas.addEventListener('pointercancel', endPhotoDrag);

$('#check-reset').addEventListener('click', () => {
  photo.points = [];
  state.check = null;
  renderBuild();
});

$('#check-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const img = await loadImg(await readFile(file));
    const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s);
    c.height = Math.round(img.naturalHeight * s);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, c.width, c.height);
    photo.canvas = c;
    photo.data = ctx.getImageData(0, 0, c.width, c.height);
    photo.points = [];
    state.check = null;
    renderBuild();
    $('#check-area').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch {
    toast('Dieses Foto konnte nicht geöffnet werden.');
  }
});

// Farbe eines Stifts: Median über einen Ring auf dem Perlenkörper (das Loch zeigt die Platte)
function samplePeg(h, c, r) {
  const [x, y] = project(h, c, r);
  const [xn, yn] = project(h, c + 1, r);
  const [xd, yd] = project(h, c, r + 1);
  const pitch = (Math.hypot(xn - x, yn - y) + Math.hypot(xd - x, yd - y)) / 2;
  const { data, width, height } = photo.data;
  const rs = [], gs = [], bs = [];
  for (const f of [0.26, 0.36]) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const px = Math.min(width - 1, Math.max(0, Math.round(x + Math.cos(a) * pitch * f)));
      const py = Math.min(height - 1, Math.max(0, Math.round(y + Math.sin(a) * pitch * f)));
      const p = (py * width + px) * 4;
      rs.push(data[p]);
      gs.push(data[p + 1]);
      bs.push(data[p + 2]);
    }
  }
  return rgbToLab(median(rs), median(gs), median(bs));
}

$('#check-run').addEventListener('click', () => {
  const h = homography(GRID_CORNERS, photo.points);
  if (!h) {
    toast('Die Ecken liegen ungünstig – bitte neu setzen.');
    return;
  }
  const { x0, y0 } = plateOrigin(state.plate);
  const idx = [], expected = [], samples = [];
  for (let r = 0; r < PEG; r++) {
    for (let c = 0; c < PEG; c++) {
      const i = (y0 + r) * W() + x0 + c;
      idx.push(i);
      expected.push(state.grid[i]);
      samples.push(samplePeg(h, c, r));
    }
  }
  const used = new Set(expected);
  const colors = state.palette
    .filter((c) => c.owned || used.has(c.code))
    .map((c) => ({ code: c.code, lab: rgbToLab(...hexToRgb(c.hex)) }));
  const { cells } = compare(samples, expected, colors);

  const check = { plate: state.plate, marks: new Map(), errors: [], ok: 0, missing: 0, unsure: 0 };
  const rowHasError = new Set(), rowIncomplete = new Set();
  cells.forEach((cell, k) => {
    const r = Math.floor(k / PEG), c = k % PEG;
    if (cell.status === 'ok') check.ok++;
    if (cell.status === 'unsure') check.unsure++;
    if (cell.status === 'missing') { check.missing++; rowIncomplete.add(r); }
    if (cell.status === 'wrong' || cell.status === 'extra') {
      check.marks.set(idx[k], cell.status);
      check.errors.push({ r, c, kind: cell.status, want: expected[k], seen: cell.seen });
      rowHasError.add(r);
    }
  });
  // Fehlerfreie, vollständige Reihen gleich als fertig abhaken
  for (let r = 0; r < PEG; r++) {
    if (plateRowHasBeads(state.plate, r) && !rowHasError.has(r) && !rowIncomplete.has(r)) {
      state.done.add(doneKey(state.plate, r));
    }
  }
  state.check = check;
  persist();
  renderBuild();
  $('#check-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

function renderCheckResult() {
  const el = $('#check-result');
  const c = state.check;
  if (!c || c.plate !== state.plate) {
    el.replaceChildren();
    return;
  }
  const unsure = c.unsure
    ? `<p class="muted small">${c.unsure} ${c.unsure === 1 ? 'Perle hebt' : 'Perlen heben'} sich auf dem Foto kaum von der Platte ab (z. B. Weiß auf heller Platte) – die bitte selbst kurz anschauen.</p>`
    : '';
  if (!c.errors.length) {
    el.innerHTML = `<div class="status ok">✓ Keine Fehler gefunden – ${c.ok} Perlen sitzen richtig${c.missing ? `, ${c.missing} fehlen noch` : '. Fertig!'}.</div>${unsure}`;
    return;
  }
  el.innerHTML = `
    <div class="status warn">⚠ ${c.errors.length} ${c.errors.length === 1 ? 'mögliche Fehlerstelle' : 'mögliche Fehlerstellen'} · ${c.ok} richtig · ${c.missing} fehlen noch</div>
    <p class="muted small">In der Platte rot markiert: Ring = falsche Farbe, Kreuz = hier gehört keine Perle hin. Tippe auf einen Eintrag, um zur Reihe zu springen.</p>
    ${unsure}
    <ul class="check-list"></ul>`;
  const list = $('.check-list', el);
  for (const err of c.errors.slice(0, 40)) {
    const li = document.createElement('li');
    const what = err.kind === 'extra'
      ? `Hier gehört keine Perle hin${err.seen ? ` (sieht aus wie ${esc(colorLabel(err.seen))})` : ''}.`
      : `Sollte ${esc(colorLabel(err.want))} sein – sieht aus wie ${esc(colorLabel(err.seen))}.`;
    li.innerHTML = `<span class="pos">Reihe ${err.r + 1} · Stift ${err.c + 1}</span><span>${what}</span>`;
    li.onclick = () => {
      state.row = err.r;
      renderRow();
      drawPlate(G.firstFilled(state.grid));
      $('#plate-wrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    list.append(li);
  }
}

// ---------- Start ----------

$$('.steps button').forEach((b) => b.addEventListener('click', () => go(b.dataset.step)));
$$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 150);
});

async function init() {
  const p = store.loadProject();
  if (p) {
    if (p.board) state.board = p.board;
    if (p.settings) Object.assign(state.settings, p.settings);
    if (p.crop) state.crop = p.crop;
    if (Array.isArray(p.grid) && p.grid.length === W() * H()) state.grid = p.grid;
    state.edited = !!p.edited;
    state.done = new Set(p.done || []);
    if (p.image) {
      try {
        state.image = await loadImg(p.image);
        state.imageUrl = p.image;
        const { w, h } = patternSize();
        const cells = sampleImage(state.image, state.crop, w, h);
        const colors = ownedColors().map((c) => ({ code: c.code, lab: rgbToLab(...hexToRgb(c.hex)) }));
        if (colors.length && state.settings.mode === 'photo') state.lastPattern = { pat: buildPattern(cells, w, h, colors, state.settings), w, h };
      } catch { /* Bild nicht mehr lesbar – Vorlage bleibt */ }
    }
  }
  go(!ownedColors().length ? 'colors' : state.grid ? 'pattern' : 'image');
}

init();
