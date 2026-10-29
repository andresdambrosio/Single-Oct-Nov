import { computeRatings, matchFromGameEdge, matchMarkets, ranking, simulateTournament, standings, titleFavorites, winProb } from './model.js';
import { PLAYOFF } from './sheet.js';

const $ = sel => document.querySelector(sel);
const fmt = n => Math.round(n).toLocaleString('es-AR');
const pct = p => `${Math.round(p * 100)}%`;
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

const [data, profiles] = await Promise.all([
  fetch('data/tournament.json', { cache: 'no-cache' }).then(r => r.json()),
  fetch('data/profiles.json', { cache: 'no-cache' }).then(r => r.json()).then(j => j.players).catch(() => ({})),
]);
const ratings = computeRatings(data.players, data.matches);
// Semilla fija: las probabilidades no cambian al recargar, sólo cuando entra un resultado.
let seed = 20261004;
const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const SIM_RUNS = 20000;
const sim = simulateTournament(data.players, data.matches, SIM_RUNS, rng);

const rank = ranking(data.players, data.matches);
// Empates comparten posición (ej. todos en 1500 al arrancar).
rank.forEach(r => { r.position = 1 + rank.filter(o => Math.round(o.rating) > Math.round(r.rating)).length; });
const byName = Object.fromEntries(rank.map(r => [r.name, r]));
const playerLink = name => `<a href="#jugador/${byName[name].id}" class="plink">${esc(name)}</a>`;
const played = data.matches.filter(m => m.result);
const pending = data.matches.filter(m => !m.result).sort((a, b) => a.week - b.week);
// Jugadores que se bajaron con el torneo empezado: ya no están en la planilla, pero cuentan
// para el armado original de las zonas.
const withdrawn = data.withdrawn ?? [];
const withdrawnText = w => `${esc(w.name)} se bajó por ${w.reason}`;
const zoneSizes = ['A', 'B'].map(z => [...data.players, ...withdrawn].filter(p => p.zone === z).length);
const zonesText = zoneSizes[0] === zoneSizes[1]
  ? `Dos zonas de ${zoneSizes[0]} jugadores`
  : `Dos zonas: la A de ${zoneSizes[0]} jugadores y la B de ${zoneSizes[1]}`;

// Sets desde el punto de vista del ganador: "6-4 6-2".
// Más reciente primero según cuándo apareció en la planilla; si empatan, la semana del fixture.
const byRecent = (a, b) => (b.firstSeen ?? '').localeCompare(a.firstSeen ?? '') || b.week - a.week;
// Si alguien abandonó se agrega "ret." (el último set puede haber quedado sin terminar).
// Si no se llegó a jugar ningún set, es un W.O.
const isWalkover = m => m.result.retired && !m.sets.length;
const retTag = m => (isWalkover(m) ? 'W.O.' : m.result.retired ? ' ret.' : '');
const winnerSets = m => m.sets.map(([a, b]) => (m.result.winner === 1 ? `${a}-${b}` : `${b}-${a}`)).join(' ') + retTag(m);
const winnerOf = m => (m.result.winner === 1 ? m.p1 : m.p2);
const loserOf = m => (m.result.winner === 1 ? m.p2 : m.p1);

// ---------- vistas ----------
const views = { home: renderHome, table: renderTable, bracket: renderBracket, matches: renderMatches, ranking: renderRanking, players: renderPlayers, outlook: renderOutlook, simulator: renderSimulator, help: renderHelp };
let tab = 'home';
let selectedPlayer = null; // id del jugador abierto en la pestaña Jugadores

function render() {
  document.querySelectorAll('[role=tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
  document.querySelector('[role=tab][aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  $('#view').innerHTML = views[tab]();
  if (tab === 'ranking') { $('#h2h-b').selectedIndex = 1; updateH2H(); }
}

// "A", "A y B", "A, B y C".
const joinList = xs => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}` : xs[0]);

// Tarjeta de favorito. Si varios están a menos de 1 punto se muestran como parejos (por apellido,
// para que entren); si son más de 3, no hay favorito.
function favoriteStat(favs) {
  const chance = name => pct(sim[name].champion);
  if (favs.length === 1) return `<strong>${esc(favs[0])}</strong><span>favorito al título según el modelo (${chance(favs[0])})</span>`;
  if (favs.length > 3) return '<strong>Muy parejo</strong><span>nadie se despega al título según el modelo</span>';
  const chances = favs.map(chance);
  const detail = new Set(chances).size === 1 ? `${chances[0]} cada uno` : joinList(chances);
  return `<strong>${esc(joinList(favs.map(n => n.split(' ').at(-1))))}</strong><span>parejos al título según el modelo (${detail})</span>`;
}

// Portada: resultados y rankings primero, con links a cada pestaña.
function renderHome() {
  const total = data.matches.length;
  const nextWeek = pending[0]?.week;
  const upcoming = pending.filter(m => m.week === nextWeek).slice(0, 4);
  const lastResults = [...played].sort(byRecent).slice(0, 5);
  const leaders = ['A', 'B'].map(z => {
    const rows = standings(data.players, data.matches, z).slice(0, 4);
    return `<div><h4>Zona ${z}</h4><ol class="list">${rows.map((r, i) => `<li><span class="pos">${i + 1}</span>${playerLink(r.name)}<span class="muted">${r.points} pts</span></li>`).join('')}</ol></div>`;
  }).join('');

  return `<section class="hero">
    <p class="eyebrow">Torneo de singles · Oct-Nov 2026</p>
    <h2>Resultados, tabla y ranking del torneo 🎾</h2>
    <p class="lead">${data.players.length + withdrawn.length} jugadores en 2 zonas${withdrawn.map(w => `; ${withdrawnText(w)}`).join('')}. Pasan los 4 mejores de cada una a cuartos, después semis y la final a fin de noviembre.</p>
    <div class="hero-cta"><a class="light big" href="#" data-goto="table">Ver la tabla</a><a class="ghost big" href="#" data-goto="matches">Ver resultados</a></div>
  </section>

  <section class="stats">
    <a class="stat" href="#" data-goto="matches"><strong>${played.length}<span class="muted">/${total}</span></strong><span>partidos jugados</span>
      <span class="bar wide" style="--w:${pct(played.length / total)}"></span></a>
    ${nextWeek ? `<a class="stat" href="#" data-goto="matches"><strong>Semana ${nextWeek}</strong><span>${pending.filter(m => m.week === nextWeek).length} partidos por jugar</span></a>` : ''}
    <a class="stat" href="#" data-goto="outlook">${favoriteStat(titleFavorites(sim, ratings))}</a>
  </section>

  <div class="home-grid">
    <section class="panel"><h3>Últimos resultados</h3>
      ${lastResults.length ? `<ul class="list results">${lastResults.map(m => `<li><span>${playerLink(winnerOf(m))} le ganó a ${playerLink(loserOf(m))}</span><span class="muted">${winnerSets(m)}</span></li>`).join('')}</ul>`
        : '<p class="muted">Todavía no hay partidos jugados.</p>'}
      <a class="more" href="#" data-goto="matches">Ver todos los partidos →</a></section>
    <section class="panel wide"><h3>Tabla <span class="muted">· clasifican 4 por zona</span></h3>
      <div class="two-col">${leaders}</div>
      <a class="more" href="#" data-goto="table">Ver la tabla completa →</a></section>
    <section class="panel"><h3>Ranking</h3>
      <ol class="list">${rank.slice(0, 5).map(r => `<li><span class="pos">${r.position}</span>${playerLink(r.name)}<span class="muted">${fmt(r.rating)}</span></li>`).join('')}</ol>
      <a class="more" href="#" data-goto="ranking">Ver ranking completo →</a></section>
    ${upcoming.length ? `<section class="panel wide"><h3>Próximos partidos <span class="muted">· semana ${nextWeek}</span></h3>
      <div class="mini-grid">${upcoming.map(miniMatch).join('')}</div>
      <a class="more" href="#" data-goto="matches">Ver el fixture →</a></section>` : ''}
  </div>`;
}

function miniMatch(m) {
  const p = winProb(ratings[m.p1], ratings[m.p2]);
  return `<a class="mini-match" href="#" data-goto="matches"><span class="zone z${m.zone}">${m.zone}</span>
    <span class="mm-p">${esc(m.p1)}</span><strong>${pct(p)}</strong>
    <span class="mm-p">${esc(m.p2)}</span><strong>${pct(1 - p)}</strong></a>`;
}

function renderTable() {
  return ['A', 'B'].map(z => {
    const rows = standings(data.players, data.matches, z);
    return `<section><h2>Zona ${z}</h2><div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Jugador</th><th>PJ</th><th>PG</th><th>Sets</th><th>Pts</th><th title="Probabilidad de entrar a cuartos según el modelo">Clasifica</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr class="${i < 4 ? 'in' : ''}">
        <td>${i + 1}</td><td>${playerLink(r.name)}</td><td>${r.played}</td><td>${r.won}</td><td>${r.setsWon}-${r.setsLost}</td><td><strong>${r.points}</strong></td>
        <td><span class="bar" style="--w:${pct(sim[r.name].qualify)}"></span>${pct(sim[r.name].qualify)}</td></tr>`).join('')}
      </tbody></table></div>${withdrawn.filter(w => w.zone === z).map(w => `<p class="muted note">${withdrawnText(w)} con el torneo empezado; sus partidos se sacaron del fixture.</p>`).join('')}</section>`;
  }).join('') + `<p class="muted note">Pasan a cuartos los 4 primeros de cada zona. Ganar suma 2 puntos; perder ganando un set suma 1. Desempate: partido entre ambos.</p>`;
}

// Partidos: primero los resultados (más recientes arriba), después lo que falta por semana.
function renderMatches() {
  const results = [...played].sort(byRecent);
  const weeks = [...new Set(pending.map(m => m.week))];
  return `<section><h2>Resultados <span class="muted">· ${played.length} de ${data.matches.length}</span></h2>
    ${results.length ? `<div class="grid">${results.map(resultCard).join('')}</div>` : '<p class="muted">Todavía no hay partidos jugados.</p>'}</section>
    ${weeks.map(w => `<section class="week"><h2>Semana ${w} <span class="muted">· por jugar</span></h2>
      <div class="grid">${pending.filter(m => m.week === w).map(pendingCard).join('')}</div></section>`).join('')}`;
}

function resultCard(m) {
  const w = m.result.winner;
  const row = (name, side) => `<div class="res-row${w === side ? ' win' : ''}"><span>${playerLink(name)}</span>
    <span class="sets">${m.sets.map(s => `<b class="${s[side - 1] > s[2 - side] ? 'won' : ''}">${s[side - 1]}</b>`).join('')}</span></div>`;
  return `<article class="card done"><div class="card-head"><span class="zone z${m.zone}">Zona ${m.zone}</span><span class="muted">Semana ${m.week}${isWalkover(m) ? ' · W.O.' : m.result.retired ? ' · abandono' : ''}</span></div>
    ${row(m.p1, 1)}${row(m.p2, 2)}</article>`;
}

function pendingCard(m) {
  const mk = matchMarkets(m, ratings);
  const p = mk.winner.p1.p;
  const s = mk.score;
  return `<article class="card"><span class="zone z${m.zone}">Zona ${m.zone}</span>
    <div class="prob-row"><span>${playerLink(m.p1)}</span><strong>${pct(p)}</strong></div>
    <div class="split thin"><span style="flex:${p}"></span><span style="flex:${1 - p}"></span></div>
    <div class="prob-row"><span>${playerLink(m.p2)}</span><strong>${pct(1 - p)}</strong></div>
    <details><summary>Resultado más probable</summary>
      <p class="muted scores">${esc(m.p1.split(' ')[0])} 2-0: ${pct(s['2-0'].p)} · 2-1: ${pct(s['2-1'].p)} · ${esc(m.p2.split(' ')[0])} 2-1: ${pct(s['1-2'].p)} · 2-0: ${pct(s['0-2'].p)}</p>
    </details></article>`;
}

function renderOutlook() {
  const list = data.players.map(p => ({ ...p, ...sim[p.name] })).sort((a, b) => b.champion - a.champion || b.qualify - a.qualify);
  return `<section><h2>¿Quién sale campeón?</h2>
    <p class="muted">Probabilidades de ${fmt(SIM_RUNS)} simulaciones del resto del torneo según el rendimiento hasta ahora.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Jugador</th><th>Zona</th><th>Clasifica</th><th>Campeón</th></tr></thead>
      <tbody>${list.map(p => `<tr><td>${playerLink(p.name)}</td><td><span class="zone z${p.zone}">${p.zone}</span></td>
        <td>${pct(p.qualify)}</td><td><span class="bar" style="--w:${Math.min(100, p.champion * 400)}%"></span>${pct(p.champion)}</td></tr>`).join('')}
      </tbody></table></div></section>`;
}

// ---------- playoff ----------
const ROUND_NAMES = { QF1: 'Cuartos 1', QF2: 'Cuartos 2', QF3: 'Cuartos 3', QF4: 'Cuartos 4', SF1: 'Semifinal 1', SF2: 'Semifinal 2', F: 'Final' };
const ROUNDS = [['Cuartos', ['QF1', 'QF2', 'QF3', 'QF4']], ['Semis', ['SF1', 'SF2']], ['Final', ['F']]];
const seedTag = ([z, n]) => `${n}°${z}`;
// Los 4 primeros de cada zona según la tabla de hoy.
const currentSeeds = () => Object.fromEntries(['A', 'B'].map(z => [z, standings(data.players, data.matches, z).slice(0, 4).map(r => r.name)]));

// Arma el cuadro: quién juega cada cruce y quién lo ganó (sólo si `picks` lo eligió y sigue en ese cruce).
function resolveBracket(seeds, picks = {}) {
  const b = {};
  for (const r of PLAYOFF) {
    const players = r.from ? r.from.map(id => b[id].winner) : [r.a, r.b].map(([z, n]) => seeds[z][n - 1]);
    const tags = r.from ? r.from.map(id => `Ganador ${b[id].label}`) : [seedTag(r.a), seedTag(r.b)];
    const label = r.from ? ROUND_NAMES[r.id] : `${tags[0]} vs ${tags[1]}`;
    b[r.id] = { ...r, players, tags, label, winner: players.every(Boolean) && players.includes(picks[r.id]) ? picks[r.id] : null };
  }
  return b;
}

// Cuadro en 3 columnas (cuartos, semis, final). `row(match, i)` dibuja cada uno de los dos lados.
const bracketHtml = (b, row) => `<div class="bracket">${ROUNDS.map(([title, ids]) => `<div class="round"><h4>${title}</h4>
  <div class="round-body">${ids.map(id => `<article class="bm"><span class="muted bm-title">${ROUND_NAMES[id]}</span>${row(b[id], 0)}${row(b[id], 1)}</article>`).join('')}</div></div>`).join('')}</div>`;

function renderBracket() {
  const b = resolveBracket(currentSeeds());
  const left = pending.length;
  const row = (m, i) => {
    const [a, c] = m.players;
    if (!a || !c) return `<div class="bm-row"><span class="muted">${m.tags[i]}</span></div>`;
    const p = winProb(ratings[a], ratings[c]);
    return `<div class="bm-row"><span class="seed">${m.tags[i]}</span><span class="bm-name">${playerLink(m.players[i])}</span><strong>${pct(i ? 1 - p : p)}</strong></div>`;
  };
  const list = data.players.map(p => ({ ...p, ...sim[p.name] })).filter(p => p.qualify > 0.005).sort((a, c) => c.champion - a.champion || c.final - a.final || c.qualify - a.qualify);
  return `<section><h2>Cuadro del playoff</h2>
    <p class="muted">Pasan los 4 primeros de cada zona. Cuartos: 1°A vs 4°B, 2°B vs 3°A, 1°B vs 4°A y 2°A vs 3°B.
    Los ganadores de los dos primeros cruces juegan la Semifinal 1, los otros dos la Semifinal 2, y después la final.</p>
    ${left ? `<p class="note provisional">Cruces <strong>por ahora</strong>, con la tabla de hoy. Faltan ${left} partidos de zona, así que todavía pueden cambiar.</p>` : ''}
    ${bracketHtml(b, row)}
    <p class="muted note">El porcentaje es la chance de ganar ese cruce según el ranking. <a href="#simulador">Probá otros resultados en el simulador →</a></p></section>
  <section><h2>Chances por ronda</h2>
    <p class="muted">De ${fmt(SIM_RUNS)} simulaciones del resto de la zona y del playoff.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Jugador</th><th>Zona</th><th>Cuartos</th><th>Semis</th><th>Final</th><th>Campeón</th></tr></thead>
      <tbody>${list.map(p => `<tr><td>${playerLink(p.name)}</td><td><span class="zone z${p.zone}">${p.zone}</span></td>
        <td>${pct(p.qualify)}</td><td>${pct(p.semi)}</td><td>${pct(p.final)}</td><td><strong>${pct(p.champion)}</strong></td></tr>`).join('')}
      </tbody></table></div></section>`;
}

// Simulador: arranca con los cruces de hoy; se puede cambiar quién clasifica en cada puesto y elegir
// el ganador de cada partido hasta la final.
let simSeeds = null;
let simPicks = {};

function renderSimulator() {
  simSeeds ??= currentSeeds();
  const b = resolveBracket(simSeeds, simPicks);
  for (const id of Object.keys(simPicks)) if (b[id].winner !== simPicks[id]) delete simPicks[id];
  const seedPickers = ['A', 'B'].map(z => {
    const table = standings(data.players, data.matches, z);
    return `<div><h4>Zona ${z}</h4>${simSeeds[z].map((name, i) => `<label class="seed-pick"><span class="seed">${i + 1}°${z}</span>
      <select data-seed="${z}-${i + 1}">${table.map(r => `<option${r.name === name ? ' selected' : ''} value="${esc(r.name)}">${esc(r.name)} · ${r.points} pts</option>`).join('')}</select></label>`).join('')}</div>`;
  }).join('');
  const row = (m, i) => {
    const [a, c] = m.players;
    if (!a || !c) return `<div class="bm-row"><span class="muted">${m.tags[i]}</span></div>`;
    const p = winProb(ratings[a], ratings[c]);
    const name = m.players[i];
    const state = !m.winner ? '' : m.winner === name ? ' won' : ' lost';
    return `<button type="button" class="bm-row pick${state}" data-pick="${m.id}" data-name="${esc(name)}" aria-pressed="${m.winner === name}">
      <span class="seed">${m.tags[i].startsWith('Ganador') ? '' : m.tags[i]}</span><span class="bm-name">${esc(name)}</span><strong>${pct(i ? 1 - p : p)}</strong></button>`;
  };
  // Chance según el modelo de que salgan todos los ganadores elegidos.
  const chosen = PLAYOFF.filter(r => b[r.id].winner);
  const path = chosen.reduce((acc, r) => { const m = b[r.id]; return acc * winProb(ratings[m.winner], ratings[m.players.find(n => n !== m.winner)]); }, 1);
  const champ = b.F.winner;
  return `<section><h2>Simulador del playoff</h2>
    <p class="muted">Arranca con los cruces de hoy. Cambiá quién termina en cada puesto y tocá al ganador de cada partido hasta la final.</p>
    <div class="panel"><h3>Clasificados</h3><div class="two-col">${seedPickers}</div></div>
    <div class="sim-actions">
      <button type="button" class="ghost chip" data-sim="favorites">Completar con favoritos</button>
      <button type="button" class="ghost chip" data-sim="clear"${chosen.length ? '' : ' disabled'}>Borrar ganadores</button>
      <button type="button" class="ghost chip" data-sim="reset">Volver a la tabla de hoy</button>
    </div>
    ${bracketHtml(b, row)}
    ${champ ? `<div class="champion">🏆 <div><span><strong>${esc(champ)}</strong> campeón</span><span class="muted">Chance de que salga todo así según el modelo: ${path < 0.01 ? '<1%' : pct(path)}</span></div></div>`
      : `<p class="muted note">${chosen.length ? `Elegiste ${chosen.length} de 7 partidos.` : 'El porcentaje es la chance de ganar cada partido según el ranking.'}</p>`}
  </section>`;
}

function simAction(action) {
  if (action === 'reset') { simSeeds = currentSeeds(); simPicks = {}; }
  else if (action === 'clear') simPicks = {};
  else if (action === 'favorites') {
    for (const r of PLAYOFF) {
      const m = resolveBracket(simSeeds, simPicks)[r.id];
      if (m.winner) continue;
      const [a, c] = m.players;
      simPicks[r.id] = winProb(ratings[a], ratings[c]) >= 0.5 ? a : c;
    }
  }
}

// Cambiar a alguien de puesto: si ya estaba en otro puesto de la zona, intercambian.
function setSeed(key, name) {
  const [z, n] = key.split('-');
  const seeds = simSeeds[z];
  const other = seeds.indexOf(name);
  if (other >= 0) seeds[other] = seeds[n - 1];
  seeds[n - 1] = name;
}

function renderRanking() {
  const opts = rank.map(r => `<option>${esc(r.name)}</option>`).join('');
  return `<section><h2>Ranking</h2>
    <p class="muted">Todos arrancan con 1500 (50% contra cualquiera). Se recalcula con todos los partidos juntos:
    cuenta a quién le ganaste y por cuántos games, y ganarle a alguien que después rinde bien vale más.
    <a href="#h-rank">Cómo se calcula</a></p>
    <div class="table-wrap"><table class="rank">
      <thead><tr><th>#</th><th>Jugador</th><th>Zona</th><th>PJ</th><th>Rating</th><th title="Probabilidad de ganarle a un jugador promedio">vs. promedio</th></tr></thead>
      <tbody>${rank.map(r => `<tr>
        <td>${r.position}</td><td>${playerLink(r.name)}</td><td><span class="zone z${r.zone}">${r.zone}</span></td><td>${r.played}</td>
        <td><strong>${fmt(r.rating)}</strong></td>
        <td><span class="bar" style="--w:${pct(r.vsAverage)}"></span>${pct(r.vsAverage)}</td></tr>`).join('')}
      </tbody></table></div></section>
    <section class="h2h"><h2>Cara a cara</h2>
      <div class="h2h-pick"><select id="h2h-a">${opts}</select><span class="vs">vs</span><select id="h2h-b">${opts}</select></div>
      <div id="h2h-out"></div></section>`;
}

function updateH2H() {
  const a = $('#h2h-a')?.value, b = $('#h2h-b')?.value;
  if (!a) return;
  const p = winProb(byName[a].rating, byName[b].rating);
  $('#h2h-out').innerHTML = a === b ? '<p class="muted">Elegí dos jugadores distintos.</p>' :
    `<div class="split"><span style="flex:${p}">${esc(a)} ${pct(p)}</span><span style="flex:${1 - p}">${pct(1 - p)} ${esc(b)}</span></div>`;
}

const initials = name => name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
function avatar(p, size = '') {
  const photo = profiles[p.id]?.photo;
  return photo
    ? `<img class="avatar ${size}" src="${esc(photo)}" alt="${esc(p.name)}">`
    : `<span class="avatar ${size} z${p.zone}" aria-hidden="true">${initials(p.name)}</span>`;
}

function renderPlayers() {
  if (selectedPlayer) return renderPlayer(data.players.find(p => p.id === selectedPlayer));
  return ['A', 'B'].map(z => `<section><h2>Zona ${z}</h2><div class="people">${data.players.filter(p => p.zone === z).map(p => {
    const prof = profiles[p.id] ?? {};
    return `<a class="person" href="#jugador/${p.id}">${avatar(p)}
      <div><strong>${esc(p.name)}</strong>${prof.nickname ? `<span class="muted"> “${esc(prof.nickname)}”</span>` : ''}
      <p class="muted">#${byName[p.name].position} del ranking · ${fmt(byName[p.name].rating)}</p></div></a>`;
  }).join('')}</div></section>`).join('');
}

function renderPlayer(p) {
  const prof = profiles[p.id] ?? {};
  const r = byName[p.name];
  const facts = [['Juega con', prof.plays], ['Revés', prof.backhand]].filter(([, v]) => v);
  const ms = data.matches.filter(m => m.p1 === p.name || m.p2 === p.name).sort((a, b) => a.week - b.week);
  const line = m => {
    const rival = m.p1 === p.name ? m.p2 : m.p1;
    if (!m.result) return `<li><span>Sem. ${m.week}</span><span>vs ${playerLink(rival)}</span><span class="muted">${pct(winProb(r.rating, byName[rival].rating))} de ganar</span></li>`;
    const won = (m.result.winner === 1) === (m.p1 === p.name);
    const sets = m.sets.map(([a, b]) => (m.p1 === p.name ? `${a}-${b}` : `${b}-${a}`)).join(' ');
    return `<li class="${won ? 'w' : 'l'}"><span>Sem. ${m.week}</span><span>vs ${playerLink(rival)}</span><span>${won ? 'G' : 'P'} ${sets}${retTag(m)}</span></li>`;
  };
  return `<a href="#jugadores" class="back">← Todos los jugadores</a>
    <section class="profile">${avatar(p, 'big')}
      <div><h2>${esc(p.name)}</h2>${prof.nickname ? `<p class="muted">“${esc(prof.nickname)}”</p>` : ''}
        <p>Zona ${p.zone} · #${r.position} del ranking · <strong>${fmt(r.rating)}</strong> pts</p>
        ${facts.map(([k, v]) => `<p class="muted">${k}: ${esc(v)}</p>`).join('')}
        <p class="bio">${esc(prof.bio || 'Descripción pendiente.')}</p></div></section>
    <section><h2>Partidos</h2><ul class="fixture">${ms.map(line).join('')}</ul></section>`;
}

// Ejemplos de la ayuda: rating de alguien después de un único partido contra un rival sin otros partidos.
const EXAMPLES = [['6-0 6-0', [[6, 0], [6, 0]]], ['6-2 6-3', [[6, 2], [6, 3]]], ['7-6 6-4', [[7, 6], [6, 4]]], ['6-4 4-6 10-8', [[6, 4], [4, 6], [10, 8]]]];
function exampleRating(sets) {
  const players = [{ name: 'a', zone: 'A' }, { name: 'b', zone: 'A' }];
  return computeRatings(players, [{ id: 'x', zone: 'A', week: 1, p1: 'a', p2: 'b', sets, result: { winner: 1 } }]).a;
}

// Página explicativa. Los ejemplos usan las fórmulas reales del modelo para no desactualizarse.
function renderHelp() {
  return `<article class="help">
  <nav class="toc">
    <a href="#h-tabla">Tabla</a><a href="#h-rank">Ranking</a><a href="#h-prob">Probabilidades</a><a href="#h-datos">Datos</a>
  </nav>

  <section id="h-tabla"><h2>📋 La tabla</h2>
    <ul>
      <li>${zonesText}, todos contra todos.</li>
      ${withdrawn.map(w => `<li>${withdrawnText(w)} (Zona ${w.zone}) con el torneo empezado. Sus partidos se sacaron del fixture y la Zona ${w.zone} sigue con ${data.players.filter(p => p.zone === w.zone).length}.</li>`).join('')}
      <li>Partidos al mejor de 3 sets; si se llega al tercero, se juega un super tie-break a 10.</li>
      <li>El ganador suma <strong>2 puntos</strong>. El que pierde suma <strong>1 punto si ganó un set</strong>, si no 0.</li>
      <li>Si un jugador abandona, gana el rival. El que abandona suma 1 punto si ya había ganado un set; el set que quedó a medias no cuenta.</li>
      <li>Desempate: el partido entre ambos. Si empatan 3 o más, se miran los partidos entre ellos y después la diferencia de sets.</li>
      <li>Los 4 primeros de cada zona pasan a cuartos: 1°A vs 4°B, 2°B vs 3°A, 1°B vs 4°A y 2°A vs 3°B.
        Los ganadores de los dos primeros cruces juegan la Semifinal 1 y los de los otros dos la Semifinal 2. <a href="#cuadro">Ver el cuadro</a></li>
    </ul></section>

  <section id="h-rank"><h2>📊 El ranking</h2>
    <p>Mide el nivel de cada jugador con <strong>todos los partidos a la vez</strong>, parecido a cómo PageRank ordena páginas:
    no importa sólo cuántos partidos ganaste, sino <strong>a quién</strong> y <strong>por cuánto</strong>.</p>
    <ul>
      <li>Todos arrancan con <strong>1500</strong>: al principio cualquiera tiene 50% contra cualquiera.</li>
      <li>Se mira <strong>cada game</strong>: un 6-0 6-1 dice mucho más que un 7-6 7-6. El super tie-break cuenta como un game para el que lo gana.</li>
      <li>Es <strong>retroactivo</strong>: si le ganaste a alguien que después le gana a todos, tu victoria vale más. Y no importa en qué orden se jugaron los partidos.</li>
      <li>Con <strong>pocos partidos el rating se mueve con prudencia</strong>: un solo resultado no te manda arriba de todo. A medida que jugás, pesan más tus resultados.</li>
    </ul>
    <p>Así queda alguien que jugó un solo partido contra un rival que no jugó otros:</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Ganó</th><th>Rating</th><th>Chance vs. promedio</th></tr></thead>
      <tbody>${EXAMPLES.map(([label, sets]) => {
        const r = exampleRating(sets);
        return `<tr><td>${label}</td><td>${fmt(r)}</td><td>${pct(winProb(r, 1500))}</td></tr>`;
      }).join('')}</tbody></table></div>
    <p>El rating se muestra en escala tipo Elo: 100 puntos de diferencia ≈ ${pct(winProb(1600, 1500))} de chance para el de arriba.</p>
    <p class="muted">El ranking es independiente de la tabla: la tabla usa los puntos del reglamento.</p></section>

  <section id="h-prob"><h2>🔮 Probabilidades</h2>
    <p>De la diferencia de ranking sale la chance de ganar cada <strong>game</strong>. Con eso se calcula, con las reglas del torneo,
    la de ganar un set (con tie-break), el super tie-break a 10 y el partido. Ganar algunos games más que el rival se transforma en mucha ventaja en el partido:</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Chance de ganar cada game</th><th>Chance de ganar el partido</th></tr></thead>
      <tbody>${[0.52, 0.55, 0.6, 0.65].map(g => `<tr><td>${pct(g)}</td><td>${pct(matchFromGameEdge(Math.log(g / (1 - g))).p)}</td></tr>`).join('')}</tbody></table></div>
    <p>En cada partido por jugar se muestra la chance de cada uno, y en "Resultado más probable" la de cada marcador en sets.</p>
    <p>Para "Clasifica" y "Campeón", el sitio <strong>simula ${fmt(SIM_RUNS)} veces</strong> el resto del torneo: los partidos de zona que faltan
    y después cuartos, semis y final. Si alguien sale campeón en ${fmt(SIM_RUNS / 10)} de las ${fmt(SIM_RUNS)} simulaciones, tiene 10%.</p>
    <p class="muted">Es un modelo simple que sólo mira los resultados de este torneo. Es para divertirse, no lo tomes muy en serio 😅</p></section>

  <section id="h-datos"><h2>🔄 De dónde salen los datos</h2>
    <p>Todo sale de la planilla del torneo. El sitio la revisa todas las noches (23 h), así que un resultado cargado ahí durante el día aparece acá esa misma noche.</p></section>
  </article>`;
}

// Navegación por hash para poder compartir links.
const HASH_TABS = { inicio: 'home', tabla: 'table', cuadro: 'bracket', partidos: 'matches', ranking: 'ranking', jugadores: 'players', pronostico: 'outlook', simulador: 'simulator', 'como-funciona': 'help' };
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith('h-')) { // ancla dentro de "Cómo funciona"
    if (tab !== 'help') { tab = 'help'; render(); }
    document.getElementById(h)?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  if (h.startsWith('jugador/')) { tab = 'players'; selectedPlayer = h.slice(8); }
  else if (HASH_TABS[h]) { tab = HASH_TABS[h]; selectedPlayer = null; }
  render();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
document.addEventListener('change', e => {
  if (e.target.id?.startsWith('h2h-')) updateH2H();
  else if (e.target.dataset.seed) { setSeed(e.target.dataset.seed, e.target.value); render(); }
});

// Simulador: elegir ganador de un partido (tocarlo de nuevo lo deselecciona) y los botones de acciones.
document.addEventListener('click', e => {
  const pick = e.target.closest('[data-pick]');
  const action = e.target.closest('[data-sim]');
  if (pick) {
    const { pick: id, name } = pick.dataset;
    if (simPicks[id] === name) delete simPicks[id];
    else simPicks[id] = name;
  } else if (action) simAction(action.dataset.sim);
  else return;
  render();
});

document.addEventListener('click', e => {
  const goto = e.target.closest('[data-goto]');
  const tabBtn = e.target.closest('[role=tab]') ?? goto;
  if (!tabBtn) return;
  e.preventDefault();
  tab = tabBtn.dataset.tab ?? goto.dataset.goto;
  selectedPlayer = null;
  if (location.hash) history.replaceState(null, '', location.pathname);
  render();
  window.scrollTo(0, 0);
});

$('#source').href = data.source;
$('#updated').textContent = `Actualizado ${new Date(data.updatedAt).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })}`;
route();
