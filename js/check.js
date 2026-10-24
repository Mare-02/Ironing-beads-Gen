import { deltaE00 } from './color.js';

// Projektive Abbildung (Homographie) aus 4 Punktpaaren: src[i] -> dst[i].
// Ergebnis h = [h0..h7] mit x = (h0 u + h1 v + h2) / (h6 u + h7 v + 1) usw.
export function homography(src, dst) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = src[i], [x, y] = dst[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
  }
  // Gauß-Elimination mit Pivotsuche
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row, i) => row[8] / row[i]);
}

export function project(h, u, v) {
  const d = h[6] * u + h[7] * v + 1;
  return [(h[0] * u + h[1] * v + h[2]) / d, (h[3] * u + h[4] * v + h[5]) / d];
}

export function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function medianLab(labs) {
  return [0, 1, 2].map((k) => median(labs.map((l) => l[k])));
}

// Vergleicht die Farbproben jedes Stifts (Lab) mit der Vorlage.
// expected: Farbcode oder null je Stift, colors: alle Perlenfarben [{ code, lab }].
// Status je Stift: ok | missing (fehlt noch) | wrong (falsche Farbe) |
// extra (Perle, wo keine hingehört) | empty (leer, soll leer sein) | unsure
export function compare(samples, expected, colors) {
  const labOf = new Map(colors.map((c) => [c.code, c.lab]));

  // Plattenfarbe aus den Stiften schätzen, die leer bleiben sollen
  const emptyIdx = expected.map((e, i) => (e === null ? i : -1)).filter((i) => i >= 0);
  const ref = emptyIdx.length >= 8 ? emptyIdx.map((i) => samples[i]) : samples;
  const plate = medianLab(ref);
  const noise = median(ref.map((s) => deltaE00(s, plate)));
  const beadThreshold = Math.max(10, noise * 2.5);

  const cells = samples.map((s, i) => {
    const want = expected[i];
    const dPlate = deltaE00(s, plate);
    let seen = null, dSeen = Infinity;
    for (const c of colors) {
      const d = deltaE00(s, c.lab);
      if (d < dSeen) { dSeen = d; seen = c.code; }
    }
    const isBead = dPlate > beadThreshold;

    if (want === null) {
      return isBead && dPlate > beadThreshold * 1.3 ? { status: 'extra', seen } : { status: 'empty' };
    }
    const wantLab = labOf.get(want);
    // Perle kaum von der Platte zu unterscheiden (z. B. weiß auf weiß)
    if (wantLab && deltaE00(wantLab, plate) < beadThreshold) return { status: 'unsure' };
    if (!isBead) return { status: 'missing' };
    if (seen === want || !wantLab) return { status: 'ok' };
    // Erst bei deutlichem Abstand als Fehler werten – Licht verfälscht Farben
    return deltaE00(s, wantLab) - dSeen > 8 ? { status: 'wrong', seen } : { status: 'ok' };
  });
  return { cells, plate };
}
