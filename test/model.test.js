import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFixture, parseStandings, summarize } from '../src/sheet.js';
import { computeRatings, scoreProbs, settle, simulateTournament, standings, winProb } from '../src/model.js';
import data from '../data/tournament.json' with { type: 'json' };

test('summarize aplica el reglamento de puntos', () => {
  assert.deepEqual(summarize([[6, 4], [6, 3]]), { winner: 1, setsP1: 2, setsP2: 0, pointsP1: 2, pointsP2: 0 });
  assert.deepEqual(summarize([[4, 6], [6, 3], [8, 10]]), { winner: 2, setsP1: 1, setsP2: 2, pointsP1: 1, pointsP2: 2 });
  assert.equal(summarize([[6, 4]]), null);
});

test('parseFixture empareja filas consecutivas y lee los sets', () => {
  const csv = [
    '1er Semana ,,Libre: X,,,,1er Semana,,,,',
    'ZONA A,Set 1,Set 2,Set 3,Puntos,,ZONA B,Set 1,Set 2,Set 3,Puntos',
    'Ana,6,3,10,,,Caro,,,,',
    'Bea,4,6,7,,,Dani,,,,',
  ].join('\n');
  const [a, b] = parseFixture(csv, ['Ana', 'Bea', 'Caro', 'Dani']);
  assert.equal(a.zone, 'A');
  assert.equal(a.week, 1);
  assert.deepEqual(a.result, { winner: 1, setsP1: 2, setsP2: 1, pointsP1: 2, pointsP2: 1 });
  assert.equal(b.zone, 'B');
  assert.equal(b.result, null);
});

test('parseStandings separa las dos zonas', () => {
  const csv = ',,,,\nJugador,Q,SG,SP,Pts\nAna,1,2,0,2\n,,,,\nJugador,Q,SG,SP,Pts\nCaro,0,0,0,0\n';
  const s = parseStandings(csv);
  assert.equal(s.A[0].name, 'Ana');
  assert.equal(s.B[0].name, 'Caro');
});

test('el fixture sincronizado es todos-contra-todos en cada zona', () => {
  for (const zone of ['A', 'B']) {
    const names = data.players.filter(p => p.zone === zone).map(p => p.name);
    const pairs = new Set(data.matches.filter(m => m.zone === zone).map(m => [m.p1, m.p2].sort().join('|')));
    assert.equal(pairs.size, (names.length * (names.length - 1)) / 2);
  }
});

test('las probabilidades de resultado exacto suman la de ganar', () => {
  const p = 0.63;
  const s = scoreProbs(p);
  assert.ok(Math.abs(s['2-0'] + s['2-1'] - p) < 1e-6);
  assert.ok(Math.abs(Object.values(s).reduce((a, b) => a + b) - 1) < 1e-9);
});

test('ganar sube el rating y la tabla calcula puntos', () => {
  // Datos fijos (no la planilla real, que cambia con cada resultado).
  const players = ['Ana', 'Bea', 'Caro'].map(name => ({ name, zone: 'A' }));
  const matches = [
    { id: 'm1', zone: 'A', week: 1, p1: 'Ana', p2: 'Bea', result: summarize([[6, 3], [6, 4]]) },
    { id: 'm2', zone: 'A', week: 2, p1: 'Caro', p2: 'Bea', result: summarize([[6, 3], [3, 6], [10, 8]]) },
  ];
  const r = computeRatings(players, matches);
  assert.ok(r.Ana > 1500 && r.Bea < 1500);
  assert.ok(winProb(r.Ana, r.Bea) > 0.5);
  const table = standings(players, matches, 'A');
  assert.deepEqual(table.map(t => [t.name, t.points]), [['Ana', 2], ['Caro', 2], ['Bea', 1]]);
});

test('la simulación reparte 100% de probabilidad de campeón', () => {
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const r = computeRatings(data.players, data.matches);
  const sim = simulateTournament(data.players, data.matches, r, 300, rng);
  const total = Object.values(sim).reduce((a, v) => a + v.champion, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  const qualified = Object.values(sim).reduce((a, v) => a + v.qualify, 0);
  assert.ok(Math.abs(qualified - 8) < 1e-9);
});

test('settle liquida apuestas de ganador y resultado exacto', () => {
  const m = data.matches.find(m => m.result);
  const won = m.result.winner === 1 ? 'p1' : 'p2';
  assert.equal(settle({ market: 'winner', matchId: m.id, pick: won }, data.matches), 'won');
  assert.equal(settle({ market: 'score', matchId: m.id, pick: '1-2' }, data.matches), 'lost');
  const open = data.matches.find(m => !m.result);
  assert.equal(settle({ market: 'winner', matchId: open.id, pick: 'p1' }, data.matches), 'open');
});

test('ranking: sin partidos todos arrancan iguales (50%)', async () => {
  const { ranking } = await import('../src/model.js');
  const r = ranking(data.players, data.matches.map(m => ({ ...m, result: null })));
  assert.ok(r.every(p => p.rating === 1500 && p.vsAverage === 0.5));
});

test('sin resultados, todos los de una zona tienen la misma chance de clasificar (sin sesgo de desempate)', () => {
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const fresh = data.matches.map(m => ({ ...m, result: null }));
  const r = computeRatings(data.players, fresh);
  const sim = simulateTournament(data.players, fresh, r, 20000, rng);
  const expected = 4 / 7;
  for (const p of data.players) assert.ok(Math.abs(sim[p.name].qualify - expected) < 0.015, `${p.name}: ${sim[p.name].qualify}`);
});
