// Parser del Google Sheet del torneo (hojas "Posiciones" y "Fixture" exportadas como CSV).
// Funciones puras: reciben texto CSV y devuelven objetos planos. Se usan desde scripts/sync.mjs.

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(s => s.trim()));
}

export const slug = name =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Hoja "Posiciones": dos bloques que empiezan con la fila "Jugador,...". El primero es Zona A.
// Las columnas se buscan por nombre en esa fila, porque la planilla fue sumando columnas
// (ej. "Par Ganados" / "Par Perdidos", después renombradas "P Ganados" / "P Perdidos") y las
// posiciones no son fijas.
const STANDINGS_COLUMNS = {
  played: /partidos/i,
  won: /^p(ar\w*)?\.? ganados/i,
  lost: /^p(ar\w*)?\.? perdidos/i,
  setsWon: /sets ganados/i,
  setsLost: /sets perdidos/i,
  points: /puntos/i,
};

export function parseStandings(csv) {
  const rows = parseCsv(csv);
  const zones = [];
  let current = null;
  let cols = null;
  for (const r of rows) {
    if (r[0] === 'Jugador') {
      cols = Object.fromEntries(Object.entries(STANDINGS_COLUMNS).map(([key, re]) => [key, r.findIndex(h => re.test(h))]));
      current = [];
      zones.push(current);
      continue;
    }
    if (!r[0]) { current = null; continue; }
    if (!current) continue;
    const row = { name: r[0] };
    for (const [key, i] of Object.entries(cols)) if (i >= 0) row[key] = +r[i] || 0;
    current.push(row);
  }
  return { A: zones[0] ?? [], B: zones[1] ?? [] };
}

const isHeader = s => !s || /semana|^zona|^libre/i.test(s);
const num = s => (s === '' || s == null || isNaN(+s) ? null : +s);
// "RET" (o "abandono") en la fila de un jugador: ese jugador abandonó el partido.
const isRetired = s => /^(ret|abandon)/i.test(s ?? '');

// Hoja "Fixture": cada semana tiene bloques de 2 filas consecutivas (jugador vs jugador) para
// Zona A (columnas 0-4) y Zona B (columnas 6-10). La semana se toma de la columna 0.
// La planilla no es perfectamente regular (ej. Zona B de semanas 6-7 está corrida), así que
// en vez de usar posiciones fijas se emparejan filas consecutivas con nombre en cada columna.
export function parseFixture(csv, knownPlayers) {
  const rows = parseCsv(csv);
  const known = new Set(knownPlayers);
  const matches = [];
  for (const [zone, col] of [['A', 0], ['B', 6]]) {
    let week = 0;
    let pending = null;
    rows.forEach((r, i) => {
      const weekLabel = r[0]?.match(/^(\d+)\S*\s+semana/i);
      if (weekLabel) week = +weekLabel[1];
      const name = r[col];
      if (isHeader(name) || !known.has(name)) { pending = null; return; }
      const cells = [r[col + 1], r[col + 2], r[col + 3]];
      const line = { name, sets: cells.map(num), retired: cells.some(isRetired), row: i };
      if (pending && pending.row === i - 1) {
        matches.push(buildMatch(zone, week, pending, line));
        pending = null;
      } else pending = line;
    });
  }
  return matches;
}

function buildMatch(zone, week, a, b) {
  const sets = [];
  for (let k = 0; k < 3; k++) {
    if (a.sets[k] != null && b.sets[k] != null) sets.push([a.sets[k], b.sets[k]]);
  }
  const retired = a.retired === b.retired ? 0 : a.retired ? 1 : 2;
  const result = sets.length || retired ? summarize(sets, retired) : null;
  return {
    id: `${zone}-${[slug(a.name), slug(b.name)].sort().join('-vs-')}`,
    zone,
    week,
    p1: a.name,
    p2: b.name,
    sets,
    result,
  };
}

// Devuelve ganador y puntos si el partido está completo (alguien ganó 2 sets) o si un jugador
// abandonó (`retired` = 1 o 2): gana el otro y sólo cuentan los sets terminados. El que abandona
// suma 1 punto si había ganado un set, como cualquier perdedor.
export function summarize(sets, retired = 0) {
  let s1 = 0, s2 = 0;
  sets.forEach(([a, b], i) => {
    if (retired && !setFinished(a, b, i)) return;
    a > b ? s1++ : s2++;
  });
  if (!retired && s1 < 2 && s2 < 2) return null;
  const winner = retired ? 3 - retired : s1 > s2 ? 1 : 2;
  return {
    winner, setsP1: s1, setsP2: s2, pointsP1: winner === 1 ? 2 : Math.min(s1, 1), pointsP2: winner === 2 ? 2 : Math.min(s2, 1),
    ...(retired && { retired }),
  };
}

// Set terminado: 6 con 2 de diferencia, 7-5 o 7-6. El tercero es super tie-break a 10.
function setFinished(a, b, i) {
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return i === 2 ? hi >= 10 && hi - lo >= 2 : (hi === 6 && lo <= 4) || (hi === 7 && lo >= 5);
}

// Reglas del playoff según la hoja "Modalidad".
export const PLAYOFF = [
  { id: 'QF1', a: ['A', 1], b: ['B', 4] },
  { id: 'QF2', a: ['B', 2], b: ['A', 3] },
  { id: 'QF3', a: ['B', 1], b: ['A', 4] },
  { id: 'QF4', a: ['A', 2], b: ['B', 3] },
  { id: 'SF1', from: ['QF1', 'QF2'] },
  { id: 'SF2', from: ['QF3', 'QF4'] },
  { id: 'F', from: ['SF1', 'SF2'] },
];
