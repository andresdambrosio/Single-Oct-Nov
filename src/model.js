// Modelo de ratings, tabla de posiciones y cuotas. Sin dependencias del DOM: se testea con node --test.
import { PLAYOFF } from './sheet.js';

export const BASE_RATING = 1500;
const K = 48;
const MARGIN = 0.06; // margen de la "casa" para que las cuotas no sumen exactamente 100%

export const winProb = (ra, rb) => 1 / (1 + 10 ** ((rb - ra) / 400));

// Elo: todos arrancan en 1500 (50% contra cualquiera) y cada partido jugado mueve el rating
// según lo inesperado del resultado. Ganarle a alguien mejor rankeado suma más; ganar 2-0 mueve
// más que 2-1. Se recorren los partidos por semana.
export function computeRatings(players, matches) {
  return ratingHistory(players, matches).ratings;
}

// Igual que computeRatings pero guarda la evolución de cada jugador partido a partido.
export function ratingHistory(players, matches) {
  const r = Object.fromEntries(players.map(p => [p.name, BASE_RATING]));
  const history = Object.fromEntries(players.map(p => [p.name, [{ rating: BASE_RATING }]]));
  const played = matches.filter(m => m.result).sort((a, b) => a.week - b.week);
  for (const m of played) {
    const exp = winProb(r[m.p1], r[m.p2]);
    const score = m.result.winner === 1 ? 1 : 0;
    const dominance = Math.abs(m.result.setsP1 - m.result.setsP2) === 2 ? 1.25 : 0.85;
    const delta = K * dominance * (score - exp);
    r[m.p1] += delta;
    r[m.p2] -= delta;
    history[m.p1].push({ rating: r[m.p1], delta, vs: m.p2, matchId: m.id });
    history[m.p2].push({ rating: r[m.p2], delta: -delta, vs: m.p1, matchId: m.id });
  }
  return { ratings: r, history };
}

// Ranking general: rating, variación y probabilidad de ganarle a un rival promedio (1500).
export function ranking(players, matches) {
  const { ratings, history } = ratingHistory(players, matches);
  return players
    .map(p => ({
      ...p,
      rating: ratings[p.name],
      change: ratings[p.name] - BASE_RATING,
      vsAverage: winProb(ratings[p.name], BASE_RATING),
      played: history[p.name].length - 1,
      history: history[p.name],
    }))
    .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
}

// Probabilidad de ganar un set tal que ganar al mejor de 3 dé `p`: s²(3 - 2s) = p. Bisección.
export function setProb(p) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const s = (lo + hi) / 2;
    (s * s * (3 - 2 * s) < p ? (lo = s) : (hi = s));
  }
  return (lo + hi) / 2;
}

export function scoreProbs(p) {
  const s = setProb(p), t = 1 - s;
  return { '2-0': s * s, '2-1': 2 * s * s * t, '1-2': 2 * t * t * s, '0-2': t * t };
}

export const toOdds = p => Math.max(1.05, Math.round((1 / (p * (1 + MARGIN))) * 100) / 100);

export function matchMarkets(match, ratings) {
  const p = winProb(ratings[match.p1], ratings[match.p2]);
  const scores = scoreProbs(p);
  return {
    winner: { p1: { p, odds: toOdds(p) }, p2: { p: 1 - p, odds: toOdds(1 - p) } },
    score: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, { p: v, odds: toOdds(v) }])),
  };
}

// Tabla de una zona. Desempate según reglamento: puntos y luego partido entre ambos.
// Si empatan 3 o más, se arma una mini-tabla con los partidos entre ellos. Después, diferencia
// de sets y por último `tiebreak` (alfabético en la web; al azar en las simulaciones).
export function standings(players, matches, zone, tiebreak = (a, b) => a.name.localeCompare(b.name)) {
  const rows = Object.fromEntries(
    players.filter(p => p.zone === zone).map(p => [p.name, { name: p.name, played: 0, won: 0, setsWon: 0, setsLost: 0, points: 0 }]),
  );
  const zoneMatches = matches.filter(m => m.zone === zone && m.result);
  for (const m of zoneMatches) {
    const a = rows[m.p1], b = rows[m.p2], res = m.result;
    a.played++; b.played++;
    a.setsWon += res.setsP1; a.setsLost += res.setsP2;
    b.setsWon += res.setsP2; b.setsLost += res.setsP1;
    a.points += res.pointsP1; b.points += res.pointsP2;
    (res.winner === 1 ? a : b).won++;
  }
  // Agrupa por puntos y ordena cada grupo empatado por sus partidos entre sí.
  const groups = {};
  for (const r of Object.values(rows)) (groups[r.points] ??= []).push(r);
  return Object.keys(groups).map(Number).sort((a, b) => b - a).flatMap(pts => {
    const tied = groups[pts];
    if (tied.length === 1) return tied;
    const names = new Set(tied.map(r => r.name));
    const mini = Object.fromEntries(tied.map(r => [r.name, 0]));
    for (const m of zoneMatches) {
      if (names.has(m.p1) && names.has(m.p2)) {
        mini[m.p1] += m.result.pointsP1;
        mini[m.p2] += m.result.pointsP2;
      }
    }
    return tied.sort((x, y) => mini[y.name] - mini[x.name] || (y.setsWon - y.setsLost) - (x.setsWon - x.setsLost) || tiebreak(x, y));
  });
}

// Simulación Monte Carlo del resto de la fase de grupos + playoff.
// Devuelve, por jugador, probabilidad de clasificar y de salir campeón.
export function simulateTournament(players, matches, ratings, runs = 4000, rng = Math.random) {
  const out = Object.fromEntries(players.map(p => [p.name, { qualify: 0, champion: 0 }]));
  const pending = matches.filter(m => !m.result);
  const played = matches.filter(m => m.result);
  const playOne = (a, b) => (rng() < winProb(ratings[a], ratings[b]) ? a : b);

  for (let i = 0; i < runs; i++) {
    const simulated = pending.map(m => {
      const s = setProb(winProb(ratings[m.p1], ratings[m.p2]));
      let w1 = 0, w2 = 0;
      while (w1 < 2 && w2 < 2) rng() < s ? w1++ : w2++;
      const winner = w1 > w2 ? 1 : 2;
      return { ...m, result: { winner, setsP1: w1, setsP2: w2, pointsP1: winner === 1 ? 2 : Math.min(w1, 1), pointsP2: winner === 2 ? 2 : Math.min(w2, 1) } };
    });
    const all = [...played, ...simulated];
    const coin = Object.fromEntries(players.map(p => [p.name, rng()]));
    const random = (x, y) => coin[x.name] - coin[y.name];
    const seed = { A: standings(players, all, 'A', random), B: standings(players, all, 'B', random) };
    for (const z of ['A', 'B']) seed[z].slice(0, 4).forEach(r => out[r.name].qualify++);
    const winners = {};
    for (const round of PLAYOFF) {
      const [a, b] = round.from
        ? round.from.map(id => winners[id])
        : [seed[round.a[0]][round.a[1] - 1].name, seed[round.b[0]][round.b[1] - 1].name];
      winners[round.id] = playOne(a, b);
    }
    out[winners.F].champion++;
  }
  for (const v of Object.values(out)) { v.qualify /= runs; v.champion /= runs; }
  return out;
}

// Liquida una apuesta contra los datos actuales. Devuelve 'won' | 'lost' | 'open'.
export function settle(bet, matches, championName = null) {
  if (bet.market === 'champion') {
    if (!championName) return 'open';
    return bet.pick === championName ? 'won' : 'lost';
  }
  const m = matches.find(m => m.id === bet.matchId);
  if (!m?.result) return 'open';
  const { winner, setsP1, setsP2 } = m.result;
  if (bet.market === 'winner') return (bet.pick === 'p1') === (winner === 1) ? 'won' : 'lost';
  if (bet.market === 'score') return bet.pick === `${setsP1}-${setsP2}` ? 'won' : 'lost';
  return 'open';
}
