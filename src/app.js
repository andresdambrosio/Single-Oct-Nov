import { createStore } from './store.js';
import { computeRatings, matchMarkets, ranking, settle, simulateTournament, standings, toOdds, winProb } from './model.js';

const START_BALANCE = 1000;
const $ = sel => document.querySelector(sel);
const fmt = n => Math.round(n).toLocaleString('es-AR');
const pct = p => `${Math.round(p * 100)}%`;
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

const [data, profiles] = await Promise.all([
  fetch('data/tournament.json', { cache: 'no-cache' }).then(r => r.json()),
  fetch('data/profiles.json', { cache: 'no-cache' }).then(r => r.json()).then(j => j.players).catch(() => ({})),
]);
const ratings = computeRatings(data.players, data.matches);
// Semilla fija: las cuotas de campeón no cambian al recargar, sólo cuando entra un resultado.
let seed = 20261004;
const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const SIM_RUNS = 20000;
const sim = simulateTournament(data.players, data.matches, ratings, SIM_RUNS, rng);
const champion = null; // TODO: se completa cuando el playoff esté cargado en la planilla

// ---------- apuestas ----------
const store = await createStore();
const shared = store.mode === 'firebase';
const myBets = () => (store.user ? store.bets.filter(b => b.uid === store.user.uid) : []);

function balanceOf(bets) {
  let b = START_BALANCE;
  for (const bet of bets) {
    b -= bet.stake;
    if (settle(bet, data.matches, champion) === 'won') b += bet.stake * bet.odds;
  }
  return b;
}
const balance = () => balanceOf(myBets());
// Una apuesta por partido y mercado (y una sola a campeón).
const sameSlot = (a, b) => a.market === b.market && (a.market === 'champion' || a.matchId === b.matchId);

// ---------- vistas ----------
const views = { matches: renderMatches, table: renderTable, ranking: renderRanking, players: renderPlayers, outright: renderOutright, bets: renderBets, bettors: renderBettors, help: renderHelp };
let tab = 'matches';
let selectedPlayer = null; // id del jugador abierto en la pestaña Jugadores
const rank = ranking(data.players, data.matches);
// Empates comparten posición (ej. todos en 1500 al arrancar).
rank.forEach(r => { r.position = 1 + rank.filter(o => Math.round(o.rating) > Math.round(r.rating)).length; });
const byName = Object.fromEntries(rank.map(r => [r.name, r]));
const playerLink = name => `<a href="#jugador/${byName[name].id}" class="plink">${esc(name)}</a>`;

function renderAccount() {
  const el = $('#account');
  if (!shared) { el.hidden = true; return; }
  el.hidden = false;
  if (!store.authReady) { el.innerHTML = ''; return; }
  el.innerHTML = store.user
    ? `${store.user.photo ? `<img src="${esc(store.user.photo)}" alt="" referrerpolicy="no-referrer">` : ''}
       <span class="who">${esc(store.user.name)}</span><button class="link" id="logout">Salir</button>`
    : `<button class="google" id="login">${GOOGLE_G} Entrar con Google</button>`;
}
const GOOGLE_G = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

function render() {
  renderAccount();
  $('#balance').textContent = shared && !store.user ? '—' : fmt(balance());
  const open = myBets().filter(b => settle(b, data.matches, champion) === 'open').length;
  $('#open-count').hidden = !open;
  $('#open-count').textContent = open;
  document.querySelectorAll('[role=tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
  document.querySelector('[role=tab][aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  $('#view').innerHTML = views[tab]();
  if (tab === 'ranking') { $('#h2h-b').selectedIndex = 1; updateH2H(); }
}

function oddsButton(bet, label) {
  const mine = myBets().find(b => sameSlot(b, bet));
  const cls = !mine ? '' : mine.pick === bet.pick ? ' taken' : ' locked';
  return `<button class="odd${cls}" data-bet='${esc(JSON.stringify(bet))}'>
    <span>${esc(label)}</span><strong>${bet.odds.toFixed(2)}</strong></button>`;
}

function renderMatches() {
  const weeks = [...new Set(data.matches.map(m => m.week))].sort((a, b) => a - b);
  const pendingFirst = weeks.map(w => {
    const ms = data.matches.filter(m => m.week === w);
    return `<section class="week"><h2>Semana ${w}</h2><div class="grid">${ms.map(matchCard).join('')}</div></section>`;
  });
  return pendingFirst.join('');
}

function matchCard(m) {
  const zone = `<span class="zone z${m.zone}">Zona ${m.zone}</span>`;
  if (m.result) {
    const sets = m.sets.map(([a, b]) => `${a}-${b}`).join(' ');
    const w = m.result.winner;
    return `<article class="card done">${zone}
      <div class="players"><span class="${w === 1 ? 'win' : ''}">${esc(m.p1)}</span><span class="vs">vs</span><span class="${w === 2 ? 'win' : ''}">${esc(m.p2)}</span></div>
      <p class="result">${sets}</p></article>`;
  }
  const mk = matchMarkets(m, ratings);
  const base = { matchId: m.id, title: `${m.p1} vs ${m.p2}` };
  const winner = side => ({ ...base, market: 'winner', pick: side, odds: mk.winner[side].odds, key: `${m.id}:winner`, desc: `Gana ${side === 'p1' ? m.p1 : m.p2}` });
  const score = s => ({ ...base, market: 'score', pick: s, odds: mk.score[s].odds, key: `${m.id}:score:${s}`, desc: `Resultado exacto ${s} (sets, ${m.p1} primero)` });
  const n = shared ? store.bets.filter(b => b.matchId === m.id).length : 0;
  return `<article class="card">${zone}${n ? `<span class="muted crowd">👥 ${n} apuesta${n > 1 ? 's' : ''}</span>` : ''}
    <div class="row">${oddsButton(winner('p1'), m.p1)}${oddsButton(winner('p2'), m.p2)}</div>
    <details><summary>Resultado exacto</summary>
      <div class="row four">${['2-0', '2-1', '1-2', '0-2'].map(s => oddsButton(score(s), s)).join('')}</div>
    </details></article>`;
}

function renderTable() {
  return ['A', 'B'].map(z => {
    const rows = standings(data.players, data.matches, z);
    return `<section><h2>Zona ${z}</h2><div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Jugador</th><th>PJ</th><th>Sets</th><th>Pts</th><th title="Probabilidad de entrar a cuartos">Clasifica</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr class="${i < 4 ? 'in' : ''}">
        <td>${i + 1}</td><td>${playerLink(r.name)}</td><td>${r.played}</td><td>${r.setsWon}-${r.setsLost}</td><td><strong>${r.points}</strong></td>
        <td><span class="bar" style="--w:${pct(sim[r.name].qualify)}"></span>${pct(sim[r.name].qualify)}</td></tr>`).join('')}
      </tbody></table></div></section>`;
  }).join('') + `<p class="muted note">Pasan a cuartos los 4 primeros de cada zona. Ganar suma 2 puntos; perder ganando un set suma 1. Desempate: partido entre ambos.</p>`;
}

function renderOutright() {
  const list = data.players
    .map(p => ({ ...p, p: sim[p.name].champion }))
    .sort((a, b) => b.p - a.p);
  return `<section><h2>¿Quién sale campeón?</h2>
    <p class="muted">Probabilidades de ${fmt(SIM_RUNS)} simulaciones del resto del torneo según el rendimiento hasta ahora.</p>
    <div class="outright">${list.map(p => {
      const bet = { market: 'champion', pick: p.name, odds: toOdds(Math.max(p.p, 0.005)), key: `champion:${p.id}`, title: 'Campeón del torneo', desc: `${p.name} campeón` };
      return `<div class="out-row"><span class="zone z${p.zone}">${p.zone}</span><span class="name">${playerLink(p.name)}</span><span class="muted">${pct(p.p)}</span>${oddsButton(bet, 'Apostar')}</div>`;
    }).join('')}</div></section>`;
}

function renderBets() {
  if (shared && !store.user) return loginPrompt('Entrá con tu cuenta de Google para ver y hacer tus apuestas.');
  const bets = myBets().sort((a, b) => a.placedAt.localeCompare(b.placedAt));
  if (!bets.length) return `<section class="empty"><h2>Todavía no apostaste</h2><p class="muted">Arrancás con ${fmt(START_BALANCE)} fichas. Elegí una cuota en Partidos o Campeón.</p></section>`;
  const label = { open: 'Pendiente', won: 'Ganada', lost: 'Perdida' };
  return `<section><h2>Mis apuestas</h2><div class="bets">${[...bets].reverse().map(b => {
    const st = settle(b, data.matches, champion);
    return `<div class="bet ${st}"><div><strong>${esc(b.desc)}</strong><p class="muted">${esc(b.title)}</p></div>
      <div class="right"><span>${fmt(b.stake)} @ ${b.odds.toFixed(2)}</span><span class="status">${label[st]}${st === 'won' ? ` +${fmt(b.stake * b.odds)}` : ''}</span></div></div>`;
  }).join('')}</div>
  ${store.reset ? '<button class="ghost reset" id="reset">Reiniciar fichas</button>' : ''}</section>`;
}

const loginPrompt = msg => `<section class="empty"><h2>Entrá para jugar</h2><p class="muted">${msg}</p>
  <button class="google" id="login">${GOOGLE_G} Entrar con Google</button></section>`;

// Ranking de fichas. "Ganancia" sólo cuenta apuestas ya resueltas: lo que está en juego todavía no se perdió.
function bettorRows() {
  const byUser = {};
  for (const b of store.bets) (byUser[b.uid] ??= []).push(b);
  return Object.values(store.users).map(u => {
    const bets = byUser[u.uid] ?? [];
    const st = bets.map(b => settle(b, data.matches, champion));
    const inPlay = bets.filter((b, i) => st[i] === 'open').reduce((a, b) => a + b.stake, 0);
    const available = balanceOf(bets);
    const won = st.filter(x => x === 'won').length;
    const decided = st.filter(x => x !== 'open').length;
    return { ...u, available, inPlay, total: available + inPlay, profit: available + inPlay - START_BALANCE, bets: bets.length, won, decided };
  }).sort((a, b) => b.total - a.total || b.won - a.won || a.name.localeCompare(b.name));
}

const signed = n => (n > 0.5 ? `+${fmt(n)}` : fmt(n));
const userPic = (u, cls = '') => u.photo
  ? `<img class="${cls}" src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">`
  : `<span class="${cls} nopic" aria-hidden="true">${esc((u.name || '?')[0].toUpperCase())}</span>`;

function renderBettors() {
  if (shared && !store.user) return loginPrompt('Entrá con tu cuenta de Google para ver quién va ganando con las fichas.');
  const rows = bettorRows();
  const me = store.user?.uid;
  if (!rows.some(r => r.bets)) return `<section class="empty"><h2>Ranking de fichas</h2>
    <p class="muted">Todavía nadie apostó. ¡Estrenalo! Elegí una cuota en Partidos.</p></section>`;
  const medals = ['🥇', '🥈', '🥉'];
  const podium = rows.slice(0, 3).map((r, i) => `<div class="podium-spot p${i + 1}${r.uid === me ? ' me' : ''}">
      <span class="medal">${medals[i]}</span>${userPic(r, 'pic')}
      <strong class="pname">${esc(r.name)}</strong>
      <span class="ptotal">${fmt(r.total)}</span>
      <span class="${r.profit > 0.5 ? 'up' : r.profit < -0.5 ? 'down' : 'muted'}">${signed(r.profit)}</span></div>`).join('');
  return `<section><h2>Ranking de fichas</h2>
    <p class="muted">Todos arrancan con ${fmt(START_BALANCE)}. Se ordena por fichas totales: las disponibles más las que están en juego en apuestas pendientes.</p>
    <div class="podium">${podium}</div>
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Apostador</th><th>Total</th><th title="Ganancia o pérdida de apuestas ya resueltas">±</th><th>Disponibles</th><th>En juego</th><th>Aciertos</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr class="${r.uid === me ? 'me' : ''}"><td>${i + 1}</td>
        <td class="bettor">${userPic(r)}${esc(r.name)}</td>
        <td><strong>${fmt(r.total)}</strong></td>
        <td class="${r.profit > 0.5 ? 'up' : r.profit < -0.5 ? 'down' : ''}">${signed(r.profit)}</td>
        <td>${fmt(r.available)}</td><td>${fmt(r.inPlay)}</td>
        <td>${r.decided ? `${r.won}/${r.decided}` : '—'}</td></tr>`).join('')}
      </tbody></table></div></section>`;
}

// Página explicativa. Los ejemplos usan las fórmulas reales del modelo para no desactualizarse.
function renderHelp() {
  const eloDelta = (ra, rb, dominance) => 48 * dominance * (1 - winProb(ra, rb));
  const even = matchMarkets({ p1: 'a', p2: 'b' }, { a: 1500, b: 1500 });
  const fav = matchMarkets({ p1: 'a', p2: 'b' }, { a: 1580, b: 1460 });
  const example = data.matches.find(m => !m.result);
  const exMk = example && matchMarkets(example, ratings);
  const exName = n => esc(n.split(' ').slice(-1)[0]);
  return `<article class="help">
  <nav class="toc">
    <a href="#h-fichas">Fichas</a><a href="#h-cuotas">Cuotas</a><a href="#h-exacto">Resultado exacto</a>
    <a href="#h-reglas">Reglas</a><a href="#h-elo">Ranking Elo</a><a href="#h-campeon">Campeón</a><a href="#h-faq">Preguntas</a>
  </nav>

  <section id="h-fichas"><h2>🪙 Las fichas</h2>
    <p>Cada uno arranca con <strong>${fmt(START_BALANCE)} fichas</strong>. No son plata real ni se compran: es sólo para jugar y ver quién la pega más.
    Si te quedás sin fichas, no podés apostar más hasta cobrar alguna apuesta pendiente.</p>
    <p>En <a href="#fichas">Ranking de fichas</a> se ve quién va ganando.</p></section>

  <section id="h-cuotas"><h2>📈 Cómo leer una cuota</h2>
    <p>La cuota es <strong>cuánto cobrás por cada ficha apostada</strong> si acertás (incluye lo que apostaste).</p>
    <div class="callout">Apostás <strong>100</strong> a cuota <strong>${even.winner.p1.odds.toFixed(2)}</strong> → si acertás cobrás <strong>${fmt(100 * even.winner.p1.odds)}</strong>
      (ganás ${fmt(100 * even.winner.p1.odds - 100)}). Si no, perdés las 100.</div>
    <p>Cuota baja = favorito (más probable, paga poco). Cuota alta = punto (menos probable, paga mucho).
    Con dos jugadores parejos ambos pagan ${even.winner.p1.odds.toFixed(2)}; si uno viene mejor, por ejemplo
    ${fav.winner.p1.odds.toFixed(2)} contra ${fav.winner.p2.odds.toFixed(2)}.</p>
    ${example ? `<p class="muted">Ejemplo real: en <em>${esc(example.p1)} vs ${esc(example.p2)}</em> hoy pagan
      ${exMk.winner.p1.odds.toFixed(2)} y ${exMk.winner.p2.odds.toFixed(2)}.</p>` : ''}
    <p>La cuota sale de la probabilidad del modelo: <code>cuota = 1 / (probabilidad × 1,06)</code>.
    Ese 6% es el margen de la "casa", para que apostar a todo no sea negocio.</p>
    <p><strong>La cuota queda fija</strong> en el momento en que apostás, aunque después cambie.</p></section>

  <section id="h-exacto"><h2>🎯 Resultado exacto</h2>
    <p>Se apuesta a cómo termina el partido en sets, <strong>siempre contando primero al jugador de arriba</strong> en la tarjeta:</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Botón</th><th>Significa</th><th>Cuota con jugadores parejos</th></tr></thead>
      <tbody>
        <tr><td><strong>2-0</strong></td><td>Gana el de arriba en 2 sets</td><td>${even.score['2-0'].odds.toFixed(2)}</td></tr>
        <tr><td><strong>2-1</strong></td><td>Gana el de arriba en 3 (super tie-break)</td><td>${even.score['2-1'].odds.toFixed(2)}</td></tr>
        <tr><td><strong>1-2</strong></td><td>Gana el de abajo en 3 (super tie-break)</td><td>${even.score['1-2'].odds.toFixed(2)}</td></tr>
        <tr><td><strong>0-2</strong></td><td>Gana el de abajo en 2 sets</td><td>${even.score['0-2'].odds.toFixed(2)}</td></tr>
      </tbody></table></div>
    <p>Es más difícil de acertar que el ganador, por eso paga más.</p></section>

  <section id="h-reglas"><h2>📋 Reglas de las apuestas</h2>
    <ul>
      <li><strong>Una apuesta por partido a ganador</strong> y <strong>una a resultado exacto</strong>. Se pueden hacer las dos.</li>
      <li><strong>Una sola apuesta a campeón</strong> en todo el torneo.</li>
      <li>Una vez hecha, <strong>no se puede cambiar ni cancelar</strong>.</li>
      <li>Se puede apostar hasta que se carga el resultado en la planilla.</li>
      <li>Las apuestas se cobran solas cuando Matías carga el resultado (el sitio se actualiza cada 2 horas).</li>
      <li>Si ganás las dos apuestas de un partido, cobrás las dos.</li>
      <li>Todos los que entraron ven las apuestas de todos: en cada partido aparece cuántas hay (👥).</li>
    </ul></section>

  <section id="h-elo"><h2>📊 El ranking Elo</h2>
    <p>Es el mismo sistema que se usa en ajedrez. Sirve para estimar quién es favorito en cada partido.</p>
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
    <p class="muted">El Elo es independiente de la tabla del torneo: la tabla usa los puntos del reglamento (2 al ganador, 1 al perdedor que gana un set). Ver <a href="#" data-goto="ranking">Ranking</a>.</p></section>

  <section id="h-campeon"><h2>🏆 Cuotas a campeón</h2>
    <p>El sitio <strong>simula ${fmt(SIM_RUNS)} veces</strong> el resto del torneo: los partidos de zona que faltan y después cuartos, semis y final,
    con el cuadro del reglamento (1°A vs 4°B, 2°B vs 3°A, 1°B vs 4°A, 2°A vs 3°B).
    Si alguien sale campeón en ${fmt(SIM_RUNS / 10)} de las ${fmt(SIM_RUNS)} simulaciones, tiene 10% y su cuota es ${toOdds(0.1).toFixed(2)}.</p>
    <p>Lo mismo da el "% Clasifica" de la <a href="#" data-goto="table">Tabla</a>.</p></section>

  <section id="h-faq"><h2>❓ Preguntas</h2>
    <details><summary>¿Quién paga lo que gano?</summary><p>Nadie: las fichas que cobrás las crea el sitio y las que perdés desaparecen. No hay plata de nadie en juego.</p></details>
    <details><summary>¿Puedo apostar a los dos jugadores para no perder?</summary><p>Al ganador no: una apuesta por partido. Podés combinar ganador y resultado exacto, pero por el margen de la casa a la larga cubrirte hace perder fichas.</p></details>
    <details><summary>¿Por qué cambian las cuotas?</summary><p>Porque con cada resultado se actualiza el Elo. Tu apuesta mantiene la cuota del momento en que la hiciste.</p></details>
    <details><summary>¿Se ve mi mail?</summary><p>No. Los demás sólo ven tu nombre y tu foto de Google.</p></details>
    <details><summary>¿Puedo apostar a mi propio partido?</summary><p>Sí, y también en contra 😅. Queda a la vista de todos.</p></details>
  </section>
  </article>`;
}

function renderRanking() {
  const opts = rank.map(r => `<option>${esc(r.name)}</option>`).join('');
  return `<section><h2>Ranking Tini</h2>
    <p class="muted">Modelo Elo: todos arrancan con 1500 puntos (50% de chances contra cualquiera). Cada partido
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

// Navegación por hash para poder compartir el link de un jugador.
const HASH_TABS = { jugadores: 'players', fichas: 'bettors', 'como-funciona': 'help' };
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

// ---------- boleta ----------
let current = null;
function openSlip(bet) {
  current = bet;
  $('#slip-title').textContent = bet.title;
  $('#slip-desc').textContent = `${bet.desc} · cuota ${bet.odds.toFixed(2)}`;
  const stake = $('#stake');
  stake.max = Math.floor(balance());
  stake.value = Math.min(50, Math.floor(balance()));
  updatePayout();
  $('#slip').showModal();
  stake.focus();
}
function updatePayout() {
  $('#payout').textContent = fmt((+$('#stake').value || 0) * (current?.odds ?? 0));
}

$('#stake').addEventListener('input', updatePayout);
document.querySelectorAll('.quick button').forEach(b => b.addEventListener('click', () => {
  $('#stake').value = b.dataset.q === 'max' ? Math.floor(balance()) : Math.min(+b.dataset.q, Math.floor(balance()));
  updatePayout();
}));
$('#slip').addEventListener('close', async () => {
  if ($('#slip').returnValue !== 'ok' || !current) return;
  const stake = Math.floor(+$('#stake').value);
  if (stake <= 0 || stake > balance()) return;
  const { key, ...bet } = current;
  try {
    await store.place({ ...bet, stake });
  } catch (err) {
    console.error(err);
    alert('No se pudo guardar la apuesta. Puede que ya hayas apostado a este partido.');
  }
});
store.onChange(render);

document.addEventListener('click', e => {
  const goto = e.target.closest('[data-goto]');
  const tabBtn = e.target.closest('[role=tab]') ?? goto;
  if (tabBtn) {
    e.preventDefault();
    tab = tabBtn.dataset.tab ?? goto.dataset.goto;
    selectedPlayer = null;
    if (location.hash) history.replaceState(null, '', location.pathname);
    render();
    return;
  }
  if (e.target.closest('#login')) { store.signIn().catch(err => alert(`No se pudo entrar: ${err.message}`)); return; }
  if (e.target.closest('#logout')) { store.signOut(); return; }
  const odd = e.target.closest('.odd');
  if (odd) {
    const bet = JSON.parse(odd.dataset.bet);
    if (shared && !store.user) { store.signIn().catch(err => alert(`No se pudo entrar: ${err.message}`)); return; }
    if (myBets().some(b => sameSlot(b, bet))) { alert('Ya apostaste a este mercado. Las apuestas no se pueden cambiar.'); return; }
    if (balance() < 1) { alert('Te quedaste sin fichas 😅'); return; }
    openSlip(bet);
    return;
  }
  if (e.target.id === 'reset' && confirm('¿Borrar todas tus apuestas y volver a 1.000 fichas?')) store.reset();
});

$('#updated').textContent = `Actualizado ${new Date(data.updatedAt).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })}`;
$('#source').href = data.source;
route();
