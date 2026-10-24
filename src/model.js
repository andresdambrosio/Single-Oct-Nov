// Modelo de ratings, tabla de posiciones y probabilidades. Sin dependencias del DOM: se testea con node --test.
import { PLAYOFF } from './sheet.js';

export const BASE_RATING = 1500;

// ---------------------------------------------------------------------------------------------
// Tenis "de manual": cada punto se gana con probabilidad fija e independiente (sin distinguir saque).
// De ahí salen game, tie-break, set y super tie-break, con el formato del torneo.
// ---------------------------------------------------------------------------------------------
const choose = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };

// Ganar una carrera a `n` puntos con diferencia de 2 (game: 4, tie-break: 7, super tie-break: 10).
export function raceProb(p, n) {
  const q = 1 - p;
  let win = 0;
  for (let k = 0; k <= n - 2; k++) win += choose(n - 1 + k, k) * p ** n * q ** k;
  const deuce = choose(2 * (n - 1), n - 1) * p ** (n - 1) * q ** (n - 1);
  return win + deuce * (p * p) / (p * p + q * q);
}

// Probabilidad de punto que da una probabilidad de game `g` (inversa por bisección).
function pointFromGame(g) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; raceProb(m, 4) < g ? (lo = m) : (hi = m); }
  return (lo + hi) / 2;
}

// Set a 6 games con tie-break a 7 en 6-6.
function setFromGame(g, tb) {
  const h = 1 - g;
  let win = 0;
  for (let k = 0; k <= 4; k++) win += choose(5 + k, k) * g ** 6 * h ** k;
  const fiveAll = choose(10, 5) * g ** 5 * h ** 5;
  return win + fiveAll * (g * g + 2 * g * h * tb);
}

// Del log-odds de ganar un game (diferencia de fuerzas) a todo lo demás: set, super tie-break y partido.
export function matchFromGameEdge(edge) {
  const g = 1 / (1 + Math.exp(-edge));
  const pt = pointFromGame(g);
  const s = setFromGame(g, raceProb(pt, 7));
  const t = raceProb(pt, 10);
  const p = s * s + 2 * s * (1 - s) * t;
  return { g, s, t, p };
}

// ---------------------------------------------------------------------------------------------
// Ranking: Bradley-Terry sobre games, con todos los partidos a la vez (retroactivo, sin importar orden).
// Cada jugador tiene una "fuerza" x; la chance de ganar un game contra otro es σ(x_a − x_b).
// - Arranca todo el mundo en 0 (= promedio) y un prior gaussiano frena a quien jugó poco.
// - Los games de un mismo partido no son independientes: cada game pesa GAME_WEIGHT.
// - El super tie-break cuenta como un game para el que lo gana.
// ---------------------------------------------------------------------------------------------
const PRIOR_SD = 0.3;
const GAME_WEIGHT = 0.4;

export function gamesOf(m) {
  let a = 0, b = 0;
  m.sets.forEach(([x, y], i) => {
    if (i === 2) (x > y ? a++ : b++); // super tie-break
    else { a += x; b += y; }
  });
  return [a, b];
}

export function fitStrengths(players, matches) {
  return fitPosterior(players, matches).mean;
}

// Fuerza estimada (media) y su incertidumbre (desvío, aproximación de Laplace) para cada jugador.
// Quien jugó poco tiene un desvío cercano al del prior; con cada partido se achica.
export function fitPosterior(players, matches) {
  const x = Object.fromEntries(players.map(p => [p.name, 0]));
  const sd = {};
  const obs = matches.filter(m => m.result && m.sets?.length).map(m => ({ a: m.p1, b: m.p2, games: gamesOf(m) }));
  const prec = 1 / PRIOR_SD ** 2;
  // Ascenso de Newton coordenada a coordenada: la log-posterior es cóncava, converge siempre.
  for (let iter = 0; iter < 500; iter++) {
    let maxStep = 0;
    for (const p of players) {
      const name = p.name;
      let grad = -prec * x[name], hess = prec;
      for (const o of obs) {
        if (o.a !== name && o.b !== name) continue;
        const [mine, theirs] = o.a === name ? o.games : [o.games[1], o.games[0]];
        const rival = o.a === name ? o.b : o.a;
        const n = (mine + theirs) * GAME_WEIGHT;
        const q = 1 / (1 + Math.exp(-(x[name] - x[rival])));
        grad += mine * GAME_WEIGHT - n * q;
        hess += n * q * (1 - q);
      }
      const step = grad / hess;
      x[name] += step;
      sd[name] = 1 / Math.sqrt(hess);
      maxStep = Math.max(maxStep, Math.abs(step));
    }
    if (maxStep < 1e-10) break;
  }
  return { mean: x, sd };
}

// Para mostrar: rating en escala tipo Elo según la chance de ganarle el partido a un jugador promedio.
const toRating = x => {
  const p = matchFromGameEdge(x).p;
  return Math.round((BASE_RATING + 400 * Math.log10(p / (1 - p))) * 1e6) / 1e6;
};

// computeRatings devuelve { nombre: rating }. Guarda la fuerza de cada rating para calcular
// probabilidades exactas entre dos jugadores (winProb / matchModel).
const strengthOfRating = new Map();
export function computeRatings(players, matches) {
  const x = fitStrengths(players, matches);
  return Object.fromEntries(players.map(p => {
    const r = toRating(x[p.name]);
    strengthOfRating.set(r, x[p.name]);
    return [p.name, r];
  }));
}

// Fuerza a partir de un rating cualquiera (si no lo calculamos nosotros, se invierte por bisección).
function strengthOf(rating) {
  if (strengthOfRating.has(rating)) return strengthOfRating.get(rating);
  if (rating === BASE_RATING) return 0;
  let lo = -5, hi = 5;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; toRating(m) < rating ? (lo = m) : (hi = m); }
  const x = (lo + hi) / 2;
  strengthOfRating.set(rating, x);
  return x;
}

const modelCache = new Map();
export function matchModel(ra, rb) {
  const key = `${ra}|${rb}`;
  if (!modelCache.has(key)) modelCache.set(key, matchFromGameEdge(strengthOf(ra) - strengthOf(rb)));
  return modelCache.get(key);
}

// Tabla precalculada de matchFromGameEdge para la simulación (interpolación lineal, error < 1e-4).
const EDGE_MAX = 4, EDGE_STEP = 0.01;
let edgeTable = null;
function fastMatch(edge) {
  edgeTable ??= Array.from({ length: Math.round((2 * EDGE_MAX) / EDGE_STEP) + 1 }, (_, i) => matchFromGameEdge(-EDGE_MAX + i * EDGE_STEP));
  const pos = (Math.max(-EDGE_MAX, Math.min(EDGE_MAX, edge)) + EDGE_MAX) / EDGE_STEP;
  const i = Math.min(Math.floor(pos), edgeTable.length - 2), f = pos - i;
  const a = edgeTable[i], b = edgeTable[i + 1];
  return { s: a.s + (b.s - a.s) * f, t: a.t + (b.t - a.t) * f, p: a.p + (b.p - a.p) * f };
}

export const winProb = (ra, rb) => (ra === rb ? 0.5 : matchModel(ra, rb).p);

// Probabilidad de cada resultado exacto en sets (desde el punto de vista de a).
export function scoreProbs(ra, rb) {
  const { s, t } = matchModel(ra, rb);
  const u = 1 - s;
  return { '2-0': s * s, '2-1': 2 * s * u * t, '1-2': 2 * s * u * (1 - t), '0-2': u * u };
}

// Ranking general: rating y probabilidad de ganarle a un rival promedio.
export function ranking(players, matches) {
  const ratings = computeRatings(players, matches);
  const played = name => matches.filter(m => m.result && (m.p1 === name || m.p2 === name)).length;
  return players
    .map(p => ({
      ...p,
      rating: ratings[p.name],
      vsAverage: winProb(ratings[p.name], BASE_RATING),
      played: played(p.name),
    }))
    .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
}

// Probabilidades de un partido: quién gana y cada resultado exacto en sets (desde p1).
export function matchMarkets(match, ratings) {
  const p = winProb(ratings[match.p1], ratings[match.p2]);
  const scores = scoreProbs(ratings[match.p1], ratings[match.p2]);
  return {
    winner: { p1: { p }, p2: { p: 1 - p } },
    score: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, { p: v }])),
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
// En cada corrida se sortea el nivel de cada jugador dentro de su incertidumbre (fitPosterior):
// así alguien que jugó un solo partido no queda como favorito seguro.
// Devuelve, por jugador, probabilidad de clasificar y de salir campeón.
export function simulateTournament(players, matches, runs = 4000, rng = Math.random) {
  const out = Object.fromEntries(players.map(p => [p.name, { qualify: 0, champion: 0 }]));
  const { mean, sd } = fitPosterior(players, matches);
  const pending = matches.filter(m => !m.result);
  const played = matches.filter(m => m.result);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

  for (let i = 0; i < runs; i++) {
    const x = Object.fromEntries(players.map(p => [p.name, mean[p.name] + sd[p.name] * gauss()]));
    const simulated = pending.map(m => {
      const { s, t } = fastMatch(x[m.p1] - x[m.p2]);
      let w1 = 0, w2 = 0;
      while (w1 < 2 && w2 < 2) rng() < (w1 + w2 === 2 ? t : s) ? w1++ : w2++; // 3er set = super tie-break
      const winner = w1 > w2 ? 1 : 2;
      return { ...m, result: { winner, setsP1: w1, setsP2: w2, pointsP1: winner === 1 ? 2 : Math.min(w1, 1), pointsP2: winner === 2 ? 2 : Math.min(w2, 1) } };
    });
    const all = [...played, ...simulated];
    const coin = Object.fromEntries(players.map(p => [p.name, rng()]));
    const random = (a, b) => coin[a.name] - coin[b.name];
    const seed = { A: standings(players, all, 'A', random), B: standings(players, all, 'B', random) };
    for (const z of ['A', 'B']) seed[z].slice(0, 4).forEach(r => out[r.name].qualify++);
    const winners = {};
    for (const round of PLAYOFF) {
      const [a, b] = round.from
        ? round.from.map(id => winners[id])
        : [seed[round.a[0]][round.a[1] - 1].name, seed[round.b[0]][round.b[1] - 1].name];
      winners[round.id] = rng() < fastMatch(x[a] - x[b]).p ? a : b;
    }
    out[winners.F].champion++;
  }
  for (const v of Object.values(out)) { v.qualify /= runs; v.champion /= runs; }
  return out;
}

// Favoritos al título: el de más chances y quienes estén a menos de `margin` de él. Con 20.000
// simulaciones, una diferencia menor a 1 punto es ruido, así que se toman como empatados y se
// ordenan por rating.
export function titleFavorites(sim, ratings, margin = 0.01) {
  const best = Math.max(...Object.values(sim).map(v => v.champion));
  return Object.keys(sim)
    .filter(name => best - sim[name].champion < margin)
    .sort((a, b) => ratings[b] - ratings[a] || sim[b].champion - sim[a].champion);
}
