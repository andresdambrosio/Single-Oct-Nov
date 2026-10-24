import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFixture, parseStandings, summarize } from '../src/sheet.js';
import { computeRatings, matchFromGameEdge, matchMarkets, raceProb, scoreProbs, simulateTournament, standings, winProb } from '../src/model.js';
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

test('summarize: si alguien abandona gana el rival y el set a medias no cuenta', () => {
  assert.deepEqual(summarize([[6, 4], [3, 2]], 1), { winner: 2, setsP1: 1, setsP2: 0, pointsP1: 1, pointsP2: 2, retired: 1 });
  assert.deepEqual(summarize([[4, 6], [6, 3], [5, 3]], 2), { winner: 1, setsP1: 1, setsP2: 1, pointsP1: 2, pointsP2: 1, retired: 2 });
  assert.deepEqual(summarize([], 2), { winner: 1, setsP1: 0, setsP2: 0, pointsP1: 2, pointsP2: 0, retired: 2 });
});

test('parseFixture lee "RET" como abandono de ese jugador', () => {
  const csv = [
    '2da Semana ,,,,,,2da Semana,,,,',
    'ZONA A,Set 1,Set 2,Set 3,Puntos,,ZONA B,Set 1,Set 2,Set 3,Puntos',
    'Ana,5,2,,2,,Caro,6,,,',
    'Bea,7,1,RET,1,,Dani,1,ret,,',
  ].join('\n');
  const [a, b] = parseFixture(csv, ['Ana', 'Bea', 'Caro', 'Dani']);
  assert.deepEqual(a.sets, [[5, 7], [2, 1]]);
  assert.deepEqual(a.result, { winner: 1, setsP1: 0, setsP2: 1, pointsP1: 2, pointsP2: 1, retired: 2 });
  assert.deepEqual(b.result, { winner: 1, setsP1: 1, setsP2: 0, pointsP1: 2, pointsP2: 0, retired: 2 });
});

test('parseStandings separa las dos zonas', () => {
  const csv = ',,,,\nJugador,Q,SG,SP,Pts\nAna,1,2,0,2\n,,,,\nJugador,Q,SG,SP,Pts\nCaro,0,0,0,0\n';
  const s = parseStandings(csv);
  assert.equal(s.A[0].name, 'Ana');
  assert.equal(s.B[0].name, 'Caro');
});

test('parseStandings lee las columnas por nombre aunque la planilla agregue columnas', () => {
  const before = 'Jugador,Q Partidos,Sets Ganados,Sets Perdidos,Puntos\nAna,2,4,1,4\n';
  const after = 'Jugador,Q Partidos,Par Ganados,Par Perdidos,Sets Ganados,Sets Perdidos,Puntos\nAna,2,2,0,4,1,4\n';
  assert.deepEqual(parseStandings(before).A[0], { name: 'Ana', played: 2, setsWon: 4, setsLost: 1, points: 4 });
  assert.deepEqual(parseStandings(after).A[0], { name: 'Ana', played: 2, won: 2, lost: 0, setsWon: 4, setsLost: 1, points: 4 });
  const renamed = after.replace('Par Ganados,Par Perdidos', 'P Ganados,P Perdidos');
  assert.deepEqual(parseStandings(renamed).A[0], parseStandings(after).A[0]);
});

test('el fixture sincronizado es todos-contra-todos en cada zona', () => {
  for (const zone of ['A', 'B']) {
    const names = data.players.filter(p => p.zone === zone).map(p => p.name);
    const pairs = new Set(data.matches.filter(m => m.zone === zone).map(m => [m.p1, m.p2].sort().join('|')));
    assert.equal(pairs.size, (names.length * (names.length - 1)) / 2);
  }
});

test('matchMarkets: probabilidades de ganador suman 1', () => {
  const mk = matchMarkets({ p1: 'a', p2: 'b' }, { a: 1550, b: 1450 });
  assert.ok(mk.winner.p1.p > 0.5);
  assert.ok(Math.abs(mk.winner.p1.p + mk.winner.p2.p - 1) < 1e-12);
});

test('las probabilidades de resultado exacto suman la de ganar', () => {
  const s = scoreProbs(1600, 1450);
  assert.ok(Math.abs(s['2-0'] + s['2-1'] - winProb(1600, 1450)) < 1e-9);
  assert.ok(Math.abs(Object.values(s).reduce((a, b) => a + b) - 1) < 1e-9);
});

test('tenis de manual: parejos es 50% y ganar más games da más chance de partido', () => {
  assert.ok(Math.abs(raceProb(0.5, 4) - 0.5) < 1e-12);
  assert.ok(Math.abs(raceProb(0.5, 10) - 0.5) < 1e-12);
  assert.ok(Math.abs(matchFromGameEdge(0).p - 0.5) < 1e-9);
  const a = matchFromGameEdge(0.2).p, b = matchFromGameEdge(0.4).p;
  assert.ok(a > 0.5 && b > a && b < 1);
  assert.ok(Math.abs(matchFromGameEdge(-0.4).p - (1 - b)) < 1e-9);
});

const P3 = ['Ana', 'Bea', 'Caro', 'Dani'].map(name => ({ name, zone: 'A' }));
const match = (id, p1, p2, sets, week = 1) => ({ id, zone: 'A', week, p1, p2, sets, result: summarize(sets) });

test('el ranking cuenta los games: 6-0 6-0 vale más que 7-6 7-6', () => {
  const big = computeRatings(P3, [match('m', 'Ana', 'Bea', [[6, 0], [6, 0]])]);
  const close = computeRatings(P3, [match('m', 'Ana', 'Bea', [[7, 6], [7, 6]])]);
  assert.ok(big.Ana > close.Ana && close.Ana > 1500);
  assert.ok(big.Bea < close.Bea && close.Bea < 1500);
});

test('el ranking es retroactivo y no depende del orden de los partidos', () => {
  // Ana y Caro le ganan igual a Bea, pero a Bea después le gana Dani: no cambia nada entre Ana y Caro.
  // En cambio, si el rival de Ana después gana, la victoria de Ana vale más que la de Caro.
  const ms = [
    match('1', 'Ana', 'Bea', [[6, 3], [6, 3]], 1),
    match('2', 'Caro', 'Dani', [[6, 3], [6, 3]], 2),
    match('3', 'Bea', 'Dani', [[6, 2], [6, 2]], 3),
  ];
  const r = computeRatings(P3, ms);
  assert.ok(r.Ana > r.Caro, 'ganarle a quien después gana vale más');
  const reversed = computeRatings(P3, ms.map((m, i) => ({ ...m, week: 10 - i })).reverse());
  for (const p of P3) assert.ok(Math.abs(r[p.name] - reversed[p.name]) < 1e-6);
});

test('ganar sube el rating y la tabla calcula puntos', () => {
  // Datos fijos (no la planilla real, que cambia con cada resultado).
  const players = ['Ana', 'Bea', 'Caro'].map(name => ({ name, zone: 'A' }));
  const matches = [
    { id: 'm1', zone: 'A', week: 1, p1: 'Ana', p2: 'Bea', sets: [[6, 3], [6, 4]], result: summarize([[6, 3], [6, 4]]) },
    { id: 'm2', zone: 'A', week: 2, p1: 'Caro', p2: 'Bea', sets: [[6, 3], [3, 6], [10, 8]], result: summarize([[6, 3], [3, 6], [10, 8]]) },
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
  const sim = simulateTournament(data.players, data.matches, 300, rng);
  const total = Object.values(sim).reduce((a, v) => a + v.champion, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  const qualified = Object.values(sim).reduce((a, v) => a + v.qualify, 0);
  assert.ok(Math.abs(qualified - 8) < 1e-9);
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
  const sim = simulateTournament(data.players, fresh, 20000, rng);
  for (const p of data.players) {
    const expected = 4 / data.players.filter(o => o.zone === p.zone).length;
    assert.ok(Math.abs(sim[p.name].qualify - expected) < 0.015, `${p.name}: ${sim[p.name].qualify}`);
  }
});
