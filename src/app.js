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
const sim = simulateTournament(data.players, data.matches, ratings, 4000, rng);
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
const views = { matches: renderMatches, table: renderTable, ranking: renderRanking, players: renderPlayers, outright: renderOutright, bets: renderBets, bettors: renderBettors };
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
  $('#bettors-tab').hidden = !shared;
  $('#balance').textContent = shared && !store.user ? '—' : fmt(balance());
  const open = myBets().filter(b => settle(b, data.matches, champion) === 'open').length;
  $('#open-count').hidden = !open;
  $('#open-count').textContent = open;
  document.querySelectorAll('[role=tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
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
    <p class="muted">Probabilidades de ${fmt(4000)} simulaciones del resto del torneo según el rendimiento hasta ahora.</p>
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

// Tabla de apostadores: saldo actual = 1.000 − apostado + cobrado.
function renderBettors() {
  if (!store.user) return loginPrompt('Entrá con tu cuenta de Google para ver el ranking de apostadores.');
  const byUser = {};
  for (const b of store.bets) (byUser[b.uid] ??= []).push(b);
  const rows = Object.values(store.users).map(u => {
    const bets = byUser[u.uid] ?? [];
    const st = bets.map(b => settle(b, data.matches, champion));
    return { ...u, balance: balanceOf(bets), total: bets.length, won: st.filter(s => s === 'won').length, open: st.filter(s => s === 'open').length };
  }).sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
  return `<section><h2>Apostadores</h2>
    <p class="muted">Todos arrancan con ${fmt(START_BALANCE)} fichas. El saldo cuenta lo apostado y lo cobrado.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Apostador</th><th>Apuestas</th><th>Ganadas</th><th>Pendientes</th><th>Fichas</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr class="${r.uid === store.user.uid ? 'me' : ''}"><td>${i + 1}</td>
        <td class="bettor">${r.photo ? `<img src="${esc(r.photo)}" alt="" referrerpolicy="no-referrer">` : ''}${esc(r.name)}</td>
        <td>${r.total}</td><td>${r.won}</td><td>${r.open}</td><td><strong>${fmt(r.balance)}</strong></td></tr>`).join('')}
      </tbody></table></div></section>`;
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
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith('jugador/')) { tab = 'players'; selectedPlayer = h.slice(8); }
  else if (h === 'jugadores') { tab = 'players'; selectedPlayer = null; }
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
  const tabBtn = e.target.closest('[role=tab]');
  if (tabBtn) {
    tab = tabBtn.dataset.tab;
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
