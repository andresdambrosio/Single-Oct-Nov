// Descarga el Google Sheet del torneo y regenera data/tournament.json.
// Uso: npm run sync
import { readFile, writeFile } from 'node:fs/promises';
import { parseStandings, parseFixture, slug } from '../src/sheet.js';

const SHEET_ID = '1hQ_jrAQ1afHX7QEzM3namN13iiXOY62NSU-iyUpsphU';
const GIDS = { standings: 0, fixture: 1534315027 };
const OUT = new URL('../data/tournament.json', import.meta.url);

async function fetchCsv(gid) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo bajar la hoja ${gid}: HTTP ${res.status}`);
  return res.text();
}

const standings = parseStandings(await fetchCsv(GIDS.standings));
const players = [
  ...standings.A.map(p => ({ id: slug(p.name), name: p.name, zone: 'A' })),
  ...standings.B.map(p => ({ id: slug(p.name), name: p.name, zone: 'B' })),
];
const matches = parseFixture(await fetchCsv(GIDS.fixture), players.map(p => p.name));

// Chequeo de cordura: cada zona es un todos-contra-todos.
for (const zone of ['A', 'B']) {
  const n = players.filter(p => p.zone === zone).length;
  const expected = (n * (n - 1)) / 2;
  const got = matches.filter(m => m.zone === zone).length;
  if (got !== expected) console.warn(`⚠️  Zona ${zone}: ${got} partidos en el fixture, se esperaban ${expected}`);
}

// La planilla no tiene fechas: guardamos cuándo apareció cada resultado por primera vez
// (`firstSeen`) para poder ordenar "últimos resultados" por orden real de carga.
const previous = await readFile(OUT, 'utf8').then(JSON.parse).catch(() => null);
const seenBefore = Object.fromEntries((previous?.matches ?? []).filter(m => m.result && m.firstSeen).map(m => [m.id, m.firstSeen]));
const now = new Date().toISOString();
for (const m of matches) if (m.result) m.firstSeen = seenBefore[m.id] ?? now;

const data = {
  name: 'Single Oct-Nov',
  source: `https://docs.google.com/spreadsheets/d/${SHEET_ID}`,
  updatedAt: now,
  players,
  standings,
  matches,
};
await writeFile(OUT, JSON.stringify(data, null, 2) + '\n');
const played = matches.filter(m => m.result).length;
console.log(`✓ ${players.length} jugadores, ${matches.length} partidos (${played} jugados) → data/tournament.json`);
