const KEY_PALETTE = 'perlenwerk.palette.v1';
const KEY_PROJECT = 'perlenwerk.project.v1';

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// Gespeicherte Palette; neue Standardfarben werden ergänzt
export function loadPalette(defaults) {
  const saved = read(KEY_PALETTE);
  if (!Array.isArray(saved)) return defaults.map((c) => ({ ...c, owned: false }));
  const codes = new Set(saved.map((c) => c.code));
  for (const d of defaults) if (!codes.has(d.code)) saved.push({ ...d, owned: false });
  return saved;
}

export function savePalette(palette) {
  write(KEY_PALETTE, palette);
}

export function loadProject() {
  return read(KEY_PROJECT);
}

// false, wenn der Speicher voll war (dann ohne Bild gespeichert)
export function saveProject(project) {
  if (write(KEY_PROJECT, project)) return true;
  write(KEY_PROJECT, { ...project, image: null });
  return false;
}
