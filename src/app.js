import { computeRatings, matchMarkets, ranking, simulateTournament, standings, winProb } from './model.js';

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
const sim = simulateTournament(data.players, data.matches, ratings, SIM_RUNS, rng);

const rank = ranking(data.players, data.matches);
// Empates comparten posición (ej. todos en 1500 al arrancar).
rank.forEach(r => { r.position = 1 + rank.filter(o => Math.round(o.rating) > Math.round(r.rating)).length; });
const byName = Object.fromEntries(rank.map(r => [r.name, r]));
const playerLink = name => `<a href="#jugador/${byName[name].id}" class="plink">${esc(name)}</a>`;
const played = data.matches.filter(m => m.result);
const pending = data.matches.filter(m => !m.result).sort((a, b) => a.week - b.week);

// Sets desde el punto de vista del ganador: "6-4 6-2".
// Más reciente primero según cuándo apareció en la planilla; si empatan, la semana del fixture.
const byRecent = (a, b) => (b.firstSeen ?? '').localeCompare(a.firstSeen ?? '') || b.week - a.week;
const winnerSets = m => m.sets.map(([a, b]) => (m.result.winner === 1 ? `${a}-${b}` : `${b}-${a}`)).join(' ');
const winnerOf = m => (m.result.winner === 1 ? m.p1 : m.p2);
const loserOf = m => (m.result.winner === 1 ? m.p2 : m.p1);

// ---------- vistas ----------
const views = { home: renderHome, table: renderTable, matches: renderMatches, ranking: renderRanking, players: renderPlayers, outlook: renderOutlook, help: renderHelp };
let tab = 'home';
let selectedPlayer = null; // id del jugador abierto en la pestaña Jugadores

function render() {
  document.querySelectorAll('[role=tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
  document.querySelector('[role=tab][aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  $('#view').innerHTML = views[tab]();
  if (tab === 'ranking') { $('#h2h-b').selectedIndex = 1; updateH2H(); }
}

// Portada: resultados y rankings primero, con links a cada pestaña.
function renderHome() {
  const total = data.matches.length;
  const nextWeek = pending[0]?.week;
  const upcoming = pending.filter(m => m.week === nextWeek).slice(0, 4);
  const lastResults = [...played].sort(byRecent).slice(0, 5);
  const fav = data.players.map(p => ({ ...p, p: sim[p.name].champion })).sort((a, b) => b.p - a.p)[0];
  const leaders = ['A', 'B'].map(z => {
    const rows = standings(data.players, data.matches, z).slice(0, 4);
    return `<div><h4>Zona ${z}</h4><ol class="list">${rows.map((r, i) => `<li><span class="pos">${i + 1}</span>${playerLink(r.name)}<span class="muted">${r.points} pts</span></li>`).join('')}</ol></div>`;
  }).join('');

  return `<section class="hero">
    <p class="eyebrow">Torneo de singles · Oct-Nov 2026</p>
    <h2>Resultados, tabla y ranking del torneo 🎾</h2>
    <p class="lead">14 jugadores en 2 zonas. Pasan los 4 mejores de cada una a cuartos, después semis y la final a fin de noviembre.</p>
    <div class="hero-cta"><a class="light big" href="#" data-goto="table">Ver la tabla</a><a class="ghost big" href="#" data-goto="matches">Ver resultados</a></div>
  </section>

  <section class="stats">
    <a class="stat" href="#" data-goto="matches"><strong>${played.length}<span class="muted">/${total}</span></strong><span>partidos jugados</span>
      <span class="bar wide" style="--w:${pct(played.length / total)}"></span></a>
    ${nextWeek ? `<a class="stat" href="#" data-goto="matches"><strong>Semana ${nextWeek}</strong><span>${pending.filter(m => m.week === nextWeek).length} partidos por jugar</span></a>` : ''}
    <a class="stat" href="#" data-goto="outlook"><strong>${esc(fav.name)}</strong><span>favorito al título según el modelo (${pct(fav.p)})</span></a>
  </section>

  <div class="home-grid">
    <section class="panel"><h3>Últimos resultados</h3>
      ${lastResults.length ? `<ul class="list results">${lastResults.map(m => `<li><span>${playerLink(winnerOf(m))} le ganó a ${playerLink(loserOf(m))}</span><span class="muted">${winnerSets(m)}</span></li>`).join('')}</ul>`
        : '<p class="muted">Todavía no hay partidos jugados.</p>'}
      <a class="more" href="#" data-goto="matches">Ver todos los partidos →</a></section>
    <section class="panel wide"><h3>Tabla <span class="muted">· clasifican 4 por zona</span></h3>
      <div class="two-col">${leaders}</div>
      <a class="more" href="#" data-goto="table">Ver la tabla completa →</a></section>
    <section class="panel"><h3>Ranking Elo</h3>
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
      </tbody></table></div></section>`;
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
  return `<article class="card done"><div class="card-head"><span class="zone z${m.zone}">Zona ${m.zone}</span><span class="muted">Semana ${m.week}</span></div>
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

function renderRanking() {
  const opts = rank.map(r => `<option>${esc(r.name)}</option>`).join('');
  return `<section><h2>Ranking Elo</h2>
    <p class="muted">Todos arrancan con 1500 puntos (50% de chances contra cualquiera). Cada partido
    pasa puntos del perdedor al ganador; cuanto más inesperado el resultado, más puntos. Ganar 2-0 vale más que 2-1.</p>
    <div class="table-wrap"><table class="rank">
      <thead><tr><th>#</th><th>Jugador</th><th>Zona</th><th>PJ</th><th>Rating</th><th>±</th><th title="Probabilidad de ganarle a un jugador promedio">vs. promedio</th></tr></thead>
      <tbody>${rank.map(r => `<tr>
        <td>${r.position}</td><td>${playerLink(r.name)}</td><td><span class="zone z${r.zone}">${r.zone}</span></td><td>${r.played}</td>
        <td><strong>${fmt(r.rating)}</strong></td><td class="${r.change > 0.5 ? 'up' : r.change < -0.5 ? 'down' : ''}">${r.change > 0.5 ? '+' : ''}${fmt(r.change)}</td>
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
    return `<li class="${won ? 'w' : 'l'}"><span>Sem. ${m.week}</span><span>vs ${playerLink(rival)}</span><span>${won ? 'G' : 'P'} ${sets}</span></li>`;
  };
  return `<a href="#jugadores" class="back">← Todos los jugadores</a>
    <section class="profile">${avatar(p, 'big')}
      <div><h2>${esc(p.name)}</h2>${prof.nickname ? `<p class="muted">“${esc(prof.nickname)}”</p>` : ''}
        <p>Zona ${p.zone} · #${r.position} del ranking · <strong>${fmt(r.rating)}</strong> pts</p>
        ${facts.map(([k, v]) => `<p class="muted">${k}: ${esc(v)}</p>`).join('')}
        <p class="bio">${esc(prof.bio || 'Descripción pendiente.')}</p></div></section>
    <section><h2>Partidos</h2><ul class="fixture">${ms.map(line).join('')}</ul></section>`;
}

// Página explicativa. Los ejemplos usan las fórmulas reales del modelo para no desactualizarse.
function renderHelp() {
  const eloDelta = (ra, rb, dominance) => 48 * dominance * (1 - winProb(ra, rb));
  return `<article class="help">
  <nav class="toc">
    <a href="#h-tabla">Tabla</a><a href="#h-elo">Ranking Elo</a><a href="#h-prob">Probabilidades</a><a href="#h-datos">Datos</a>
  </nav>

  <section id="h-tabla"><h2>📋 La tabla</h2>
    <ul>
      <li>Dos zonas de 7 jugadores, todos contra todos.</li>
      <li>Partidos al mejor de 3 sets; si se llega al tercero, se juega un super tie-break a 10.</li>
      <li>El ganador suma <strong>2 puntos</strong>. El que pierde suma <strong>1 punto si ganó un set</strong>, si no 0.</li>
      <li>Desempate: el partido entre ambos. Si empatan 3 o más, se miran los partidos entre ellos y después la diferencia de sets.</li>
      <li>Los 4 primeros de cada zona pasan a cuartos: 1°A vs 4°B, 2°B vs 3°A, 1°B vs 4°A y 2°A vs 3°B.</li>
    </ul></section>

  <section id="h-elo"><h2>📊 El ranking Elo</h2>
    <p>Es el mismo sistema que se usa en ajedrez: mide el nivel de cada jugador según a quién le ganó y a quién no.</p>
    <ul>
      <li>Todos arrancan con <strong>1500 puntos</strong>: al principio cualquiera tiene 50% contra cualquiera.</li>
      <li>En cada partido el ganador <strong>le saca puntos al perdedor</strong>.</li>
      <li>Cuanto <strong>más inesperado</strong> el resultado, más puntos se mueven. Ganarle al favorito vale mucho; ganarle al último, poco.</li>
      <li>Ganar <strong>2-0</strong> mueve más que ganar <strong>2-1</strong>.</li>
    </ul>
    <div class="table-wrap"><table>
      <thead><tr><th>Partido</th><th>Ganando 2-0</th><th>Ganando 2-1</th></tr></thead>
      <tbody>
        <tr><td>Parejos (1500 vs 1500)</td><td>±${fmt(eloDelta(1500, 1500, 1.25))}</td><td>±${fmt(eloDelta(1500, 1500, 0.85))}</td></tr>
        <tr><td>El favorito gana (1560 vs 1440)</td><td>±${fmt(eloDelta(1560, 1440, 1.25))}</td><td>±${fmt(eloDelta(1560, 1440, 0.85))}</td></tr>
        <tr><td>Sorpresa: gana el de 1440 contra 1560</td><td>±${fmt(eloDelta(1440, 1560, 1.25))}</td><td>±${fmt(eloDelta(1440, 1560, 0.85))}</td></tr>
      </tbody></table></div>
    <p>La probabilidad de que A le gane a B es <code>1 / (1 + 10<sup>(B − A) / 400</sup>)</code>. Por ejemplo, 100 puntos de diferencia ≈ ${pct(winProb(1600, 1500))} para el de arriba.</p>
    <p class="muted">El Elo es independiente de la tabla: la tabla usa los puntos del reglamento.</p></section>

  <section id="h-prob"><h2>🔮 Probabilidades</h2>
    <p>En cada partido por jugar se muestra la chance de cada uno según el Elo, y en "Resultado más probable" la chance de cada marcador en sets.</p>
    <p>Para "Clasifica" y "Campeón", el sitio <strong>simula ${fmt(SIM_RUNS)} veces</strong> el resto del torneo: los partidos de zona que faltan
    y después cuartos, semis y final. Si alguien sale campeón en ${fmt(SIM_RUNS / 10)} de las ${fmt(SIM_RUNS)} simulaciones, tiene 10%.</p>
    <p class="muted">Es un modelo simple que sólo mira los resultados de este torneo. Es para divertirse, no lo tomes muy en serio 😅</p></section>

  <section id="h-datos"><h2>🔄 De dónde salen los datos</h2>
    <p>Todo sale de la planilla del torneo. El sitio la revisa cada 2 horas, así que un resultado cargado ahí aparece acá en ese plazo.</p></section>
  </article>`;
}

// Navegación por hash para poder compartir links.
const HASH_TABS = { inicio: 'home', tabla: 'table', partidos: 'matches', ranking: 'ranking', jugadores: 'players', pronostico: 'outlook', 'como-funciona': 'help' };
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
document.addEventListener('change', e => { if (e.target.id?.startsWith('h2h-')) updateH2H(); });

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
