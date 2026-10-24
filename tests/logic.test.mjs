import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/grid.js';
import { buildPattern, period, findGrid, patternFromPixels } from '../js/convert.js';

// RGBA-Pixel für w×h Felder à S Pixel aus einer Funktion (px, py) -> [r, g, b]
function pixels(w, h, S, fn) {
  const data = new Uint8ClampedArray(w * S * h * S * 4);
  for (let py = 0; py < h * S; py++) {
    for (let px = 0; px < w * S; px++) {
      const p = (py * w * S + px) * 4;
      [data[p], data[p + 1], data[p + 2]] = fn(px, py);
      data[p + 3] = 255;
    }
  }
  return data;
}

test('Felder an Farbkanten bekommen die Mehrheitsfarbe statt einer Mischfarbe', () => {
  const lab = (hex) => rgbToLab(...hexToRgb(hex));
  const colors = [
    { code: '17', lab: lab('#83888A') },
    { code: '02', lab: lab('#F0E8B9') },
    { code: '21', lab: lab('#A5693F') }, // läge farblich zwischen Grau und Creme
  ];
  // 1 Feld, 10 px breit: 6 Spalten Grau, 4 Spalten Creme
  const data = pixels(1, 1, 10, (px) => (px < 6 ? [131, 136, 138] : [240, 232, 185]));
  const out = patternFromPixels(data, 1, 1, 10, colors, { autoBg: false, maxColors: 0, smooth: false });
  assert.deepEqual(out, ['17']);
});

test('Heller Bauch innerhalb eines Umrisses bleibt trotz weißem Hintergrund erhalten', () => {
  const lab = (hex) => rgbToLab(...hexToRgb(hex));
  const colors = [
    { code: '01', lab: lab('#ECEDED') },
    { code: '02', lab: lab('#F0E8B9') },
    { code: '18', lab: lab('#2E2F32') },
  ];
  // 7×7 Felder à 4 px: weißer Hintergrund mit grauem 1-px-Bildrahmen,
  // dünner schwarzer Ring (1 px), innen Creme
  const S = 4, c = 14, data = pixels(7, 7, S, (px, py) => {
    if (px === 0 || py === 0 || px === 27 || py === 27) return [190, 190, 190];
    const d = Math.hypot(px - c, py - c);
    if (d < 9) return [240, 232, 185];
    if (d < 10) return [30, 30, 30];
    return [255, 255, 255];
  });
  const out = patternFromPixels(data, 7, 7, S, colors, { autoBg: true, bgTol: 12, maxColors: 0, smooth: false });
  assert.equal(out[3 * 7 + 3], '02', 'Mitte ist Creme');
  assert.equal(out[0], null, 'Ecke ist Hintergrund');
  assert.ok(!out.includes('01'), 'keine weißen Perlen aus dem Hintergrund');
});

test('findGrid findet Lage und Anzahl der Felder trotz Schrift am Rand', () => {
  // 20 Felder à 12.5 px ab x = 40, Linien um ±1 px versetzt wie in verkleinerten Bildern,
  // davor und danach schwache „Schrift“-Kanten
  const n = 400;
  const profile = new Float32Array(n);
  for (let k = 0; k <= 20; k++) {
    const x = 40 + k * 12.5 + Math.round(Math.sin(k * k * 1.7));
    profile[Math.floor(x)] += 0.6;
    profile[Math.ceil(x)] += 0.4;
  }
  for (let x = 0; x < 30; x += 3) profile[x] += 0.12;
  for (let x = 300; x < n; x += 4) profile[x] += 0.15;
  const g = findGrid(profile, period(profile));
  assert.equal(g.count, 20);
  assert.ok(Math.abs(g.start - 40) < 1.5, `start ${g.start}`);
  assert.ok(Math.abs(g.end - 290) < 1.5, `end ${g.end}`);
});

test('Rasterweite einer Vorlage wird aus dem Kantenprofil erkannt', () => {
  // Rasterlinie alle 12.5 px, dazu etwas Rauschen von aufgedruckten Nummern
  const profile = Array.from({ length: 500 }, (_, x) => (Math.abs(((x + 3) % 12.5) - 0) < 1 ? 100 : 0) + ((x * 7919) % 13));
  const p = period(profile);
  assert.ok(Math.abs(p - 12.5) < 0.6, `bekam ${p}`);
});
import { rgbToLab, deltaE00, hexToRgb } from '../js/color.js';
import { homography, project, compare } from '../js/check.js';

test('Homographie bildet die 4 Ecken und die Mitte eines Vierecks ab', () => {
  const src = [[0, 0], [28, 0], [28, 28], [0, 28]];
  const dst = [[100, 50], [400, 80], [380, 390], [90, 360]];
  const h = homography(src, dst);
  for (let i = 0; i < 4; i++) {
    const [x, y] = project(h, ...src[i]);
    assert.ok(Math.hypot(x - dst[i][0], y - dst[i][1]) < 1e-6);
  }
});

test('Fortschritts-Vergleich erkennt falsche Farbe, Perle zu viel und fehlende', () => {
  const lab = (hex) => rgbToLab(...hexToRgb(hex));
  const colors = [
    { code: '05', lab: lab('#B63136') },
    { code: '09', lab: lab('#305CB0') },
    { code: '03', lab: lab('#F0B901') },
  ];
  const plate = lab('#D8D8D8');
  // 10 leere Stifte für die Plattenfarbe, dann: richtig, falsch, fehlt, zu viel
  const expected = [...Array(10).fill(null), '05', '05', '09', null];
  const samples = [...Array(10).fill(plate), lab('#B83338'), lab('#F0B901'), plate, lab('#305CB0')];
  const { cells } = compare(samples, expected, colors);
  assert.deepEqual(cells.slice(10).map((c) => c.status), ['ok', 'wrong', 'missing', 'extra']);
  assert.equal(cells[11].seen, '03');
});

const _ = null;

test('Perlen, die nur diagonal anliegen, gelten als lose', () => {
  const grid = [
    'A', 'A', _,
    _, _, 'B',
    _, _, 'B',
  ];
  const con = G.connectivity(grid, 3, 3);
  assert.equal(con.total, 4);
  assert.equal(con.loose.length, 1);
  assert.equal(con.looseCount, 2);
});

test('Seitlich verbundene Perlen bilden ein Stück, Löcher sind erlaubt', () => {
  const grid = [
    'A', 'A', 'A',
    'A', _, 'B',
    'A', 'A', 'B',
  ];
  assert.equal(G.connectivity(grid, 3, 3).loose.length, 0);
});

test('place zentriert das zugeschnittene Motiv und lehnt zu große ab', () => {
  const src = [_, _, _, _, 'A', 'A', _, _, _];
  const out = G.place(src, 3, 3, 4, 3);
  assert.deepEqual(out, [_, _, _, _, _, 'A', 'A', _, _, _, _, _]);
  assert.equal(G.place(['A', 'A', 'A'], 3, 1, 2, 2), null);
});

test('shift verweigert Verschieben über den Rand', () => {
  const grid = ['A', _, _, _];
  assert.equal(G.shift(grid, 2, 2, -1, 0), null);
  assert.deepEqual(G.shift(grid, 2, 2, 1, 1), [_, _, _, 'A']);
});

test('Startperle ist die erste in Leserichtung', () => {
  assert.equal(G.firstFilled([_, _, _, 'A', 'B', _]), 3);
});

test('rowRuns fasst gleiche Farben zusammen und überspringt Lücken', () => {
  const grid = ['A', 'A', _, 'A', 'B'];
  assert.deepEqual(G.rowRuns(grid, 5, 0, 0, 4), [
    { code: 'A', from: 0, to: 1 },
    { code: 'A', from: 3, to: 3 },
    { code: 'B', from: 4, to: 4 },
  ]);
});

test('floodSame löscht nur die zusammenhängende Fläche gleicher Farbe', () => {
  const grid = ['A', 'A', 'B', 'A'];
  assert.deepEqual(G.floodSame(grid, 4, 1, 0).sort(), [0, 1]);
});

test('CIEDE2000 stimmt mit Referenzwert überein', () => {
  // Sharma et al., Testpaar 1
  const d = deltaE00([50, 2.6772, -79.7751], [50, 0, -82.7485]);
  assert.ok(Math.abs(d - 2.0425) < 1e-3, `bekam ${d}`);
});

test('Hintergrund am Rand wird entfernt, Motiv bleibt in nächster Farbe', () => {
  const W = 5, H = 5;
  const cells = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inside = x >= 1 && x <= 3 && y >= 1 && y <= 3;
      cells.push(inside ? { r: 200, g: 30, b: 40, a: 1 } : { r: 250, g: 250, b: 250, a: 1 });
    }
  }
  const colors = [
    { code: '01', lab: rgbToLab(...hexToRgb('#ECEDED')) },
    { code: '05', lab: rgbToLab(...hexToRgb('#B63136')) },
  ];
  const out = buildPattern(cells, W, H, colors, { autoBg: true, bgTol: 12, maxColors: 0, smooth: false });
  assert.equal(out.filter((c) => c === null).length, 16);
  assert.equal(out.filter((c) => c === '05').length, 9);
});

test('maxColors reduziert auf die gewünschte Anzahl', () => {
  const cells = [
    { r: 255, g: 255, b: 255, a: 1 }, { r: 250, g: 250, b: 250, a: 1 },
    { r: 0, g: 0, b: 0, a: 1 }, { r: 200, g: 30, b: 40, a: 1 },
  ];
  const colors = ['#ECEDED', '#2E2F32', '#B63136'].map((h, i) => ({ code: String(i), lab: rgbToLab(...hexToRgb(h)) }));
  const out = buildPattern(cells, 4, 1, colors, { autoBg: false, maxColors: 2, smooth: false });
  assert.equal(new Set(out).size, 2);
});
