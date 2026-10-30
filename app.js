'use strict';

const KEY = 'poker-chips-v3';

let state = null;
let raiseVal = 0;

const $ = (s) => document.querySelector(s);
const fmt = (n) => n.toLocaleString('en-US');
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- persistence ---------- */
function save() { if (state) localStorage.setItem(KEY, JSON.stringify(state)); }
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.v === 3 && Array.isArray(s.players) && s.players.length) state = s;
  } catch (e) { state = null; }
}

/* ---------- helpers ---------- */
const cur = () => state.players[state.turn];
function topBet() { return Math.max(0, ...state.players.map((p) => p.bet)); }
function toCall() { return topBet() - cur().bet; }
function inHand(p) { return !p.folded && (p.chips > 0 || p.allin); }
function pending(p) { return inHand(p) && !p.allin && (!p.acted || topBet() - p.bet > 0); }
function nextPending(from) {
  for (let k = 1; k <= state.players.length; k++) {
    const j = (from + k) % state.players.length;
    if (pending(state.players[j])) return j;
  }
  return -1;
}
function nextAlive(i) {
  for (let k = 1; k <= state.players.length; k++) {
    const j = (i + k) % state.players.length;
    if (state.players[j].chips > 0) return j;
  }
  return i;
}
function minRaise() { return topBet() + state.bb; }
function maxRaise() { return cur().bet + cur().chips; }

function payChips(p, amt) {
  p.chips -= amt; p.bet += amt; state.pot += amt;
  if (p.chips === 0) p.allin = true;
}

/* ---------- setup screen ---------- */
function addNameRow() {
  const box = $('#name-fields');
  if (box.children.length >= 8) return;
  const row = document.createElement('div');
  row.className = 'name-row';
  row.innerHTML = '<input maxlength="12">' +
    '<button class="x" data-act="remove-row" type="button" aria-label="Remove player">&#10005;</button>';
  box.appendChild(row);
  refreshNameFields();
}
function refreshNameFields() {
  const rows = [...$('#name-fields').children];
  rows.forEach((r, i) => {
    r.querySelector('input').placeholder = `Player ${i + 1}`;
    r.querySelector('.x').hidden = rows.length <= 2;
  });
}

function startGame() {
  const names = [...document.querySelectorAll('#name-fields input')].map((x) => x.value.trim()).filter(Boolean);
  if (names.length < 2) { $('#setup-error').hidden = false; return; }
  const toInt = (v, d) => (parseInt(v, 10) > 0 ? parseInt(v, 10) : d);
  const chips = toInt($('#start-chips').value, 1000);
  const sb = toInt($('#sb').value, 25);
  const bb = Math.max(toInt($('#bb').value, 50), sb);
  state = {
    v: 3, players: names.map((n) => ({ name: n, chips, bet: 0 })),
    sb, bb, pot: 0, hand: 0, dealer: -1, sbIdx: -1, bbIdx: -1,
    turn: -1, phase: 'betting', raiseOpen: false, selection: [], result: '',
  };
  $('#setup-error').hidden = true;
  startHand();
}

/* ---------- hand flow ---------- */
function startHand() {
  state.hand++;
  state.phase = 'betting';
  state.raiseOpen = false;
  state.selection = [];
  state.result = '';
  state.players.forEach((p) => { p.bet = 0; p.folded = false; p.allin = false; p.acted = false; });
  state.dealer = nextAlive(state.dealer);

  const n = state.players.length;
  state.sbIdx = n === 2 ? state.dealer : nextAlive(state.dealer);
  state.bbIdx = nextAlive(state.sbIdx);
  const post = (i, amt) => {
    amt = Math.min(amt, state.players[i].chips);
    if (amt > 0) payChips(state.players[i], amt);
  };
  post(state.sbIdx, state.sb);
  post(state.bbIdx, state.bb);

  state.turn = nextPending(state.bbIdx);
  afterBlindsOnly();
  render(); save();
}

/* everyone may already be all-in from the blinds alone */
function afterBlindsOnly() {
  const inHandCount = state.players.filter(inHand).length;
  if (inHandCount <= 1 || state.turn === -1) endRound();
}

function actFold() {
  cur().folded = true;
  if (state.players.filter(inHand).length === 1) settleFoldout();
  else { advance(); }
}

function actCheck() { cur().acted = true; advance(); }

function actCall() {
  const p = cur();
  payChips(p, Math.min(toCall(), p.chips));
  p.acted = true;
  advance();
}

function actRaise(total) {
  const p = cur();
  const before = topBet();
  const target = Math.min(total, p.bet + p.chips);
  payChips(p, target - p.bet);
  if (p.bet > before) state.players.forEach((o) => { if (o !== p && !o.folded) o.acted = false; });
  p.acted = true;
  advance();
}

function actAllin() {
  const p = cur();
  const before = topBet();
  payChips(p, p.chips);
  if (p.bet > before) state.players.forEach((o) => { if (o !== p && !o.folded) o.acted = false; });
  p.acted = true;
  advance();
}

function advance() {
  if (state.players.filter(inHand).length === 1) return settleFoldout();
  const next = nextPending(state.turn);
  if (next === -1 || !state.players.some(pending)) return endRound();
  state.turn = next;
  render(); save();
}

/* refund any uncalled portion back to the top bettor */
function refundUncalled() {
  const top = topBet();
  const atTop = state.players.filter((p) => p.bet === top);
  if (atTop.length !== 1) return;
  const second = Math.max(0, ...state.players.filter((p) => p !== atTop[0]).map((p) => p.bet));
  const refund = top - second;
  if (refund > 0 && !atTop[0].folded) { atTop[0].chips += refund; state.pot -= refund; }
}

function settleFoldout() {
  refundUncalled();
  const w = state.players.findIndex(inHand);
  const pot = state.pot;
  state.players[w].chips += pot;
  state.result = `${state.players[w].name} wins ${fmt(pot)}`;
  state.pot = 0;
  state.phase = 'handEnd';
  state.turn = -1;
  render(); save();
}

function endRound() {
  refundUncalled();
  state.phase = 'winner';
  state.turn = -1;
  state.selection = [];
  render(); save();
}

function confirmWinners() {
  const sel = state.selection;
  if (!sel.length) return;
  const total = state.pot;
  const each = Math.floor(total / sel.length);
  let rem = total - each * sel.length;
  sel.slice().sort((a, b) => a - b).forEach((i, idx) => {
    state.players[i].chips += each + (idx < rem ? 1 : 0);
  });
  const names = sel.slice().sort((a, b) => a - b).map((i) => state.players[i].name);
  state.result = `${names.join(' & ')} win${names.length > 1 ? '' : ''} ${fmt(total)}`;
  state.pot = 0;
  state.phase = 'handEnd';
  render(); save();
}

function nextHand() {
  const alive = state.players.filter((p) => p.chips > 0);
  if (alive.length === 1) {
    state.phase = 'champion';
    state.result = `${alive[0].name} wins the game`;
    render(); save();
    return;
  }
  startHand();
}

/* ---------- render ---------- */
function render() {
  $('#setup').hidden = !!state;
  $('#game').hidden = !state;
  if (!state) return;
  $('#hand-label').textContent = `Hand ${state.hand} · ${fmt(state.sb)}/${fmt(state.bb)}`;
  $('#pot-value').textContent = fmt(state.pot);
  renderPlayers();
  renderConsole();
  if (window.Glass) Glass.refresh();
}

function renderPlayers() {
  const box = $('#players');
  box.innerHTML = '';
  const n = state.players.length;
  let start = state.turn >= 0 ? state.turn : state.players.findIndex((p) => p.chips > 0);
  if (start < 0) start = 0;
  const order = [];
  for (let k = 0; k < n; k++) order.push((start + k) % n);
  order.forEach((i, rank) => {
    const p = state.players[i];
    const isTurn = state.phase === 'betting' && i === state.turn;
    const div = document.createElement('div');
    div.className = 'pcard' + (rank === 0 ? ' hero' : '') + (isTurn ? ' to-act' : '') + (p.folded ? ' folded' : '') + (p.chips === 0 ? ' out' : '');
    const badges = [];
    if (p.chips > 0) {
      if (i === state.sbIdx) badges.push('SB');
      if (i === state.bbIdx) badges.push('BB');
      if (i === state.dealer) badges.push('D');
    }
    const foot = p.chips === 0 ? 'Out' : p.folded ? 'Folded' : p.bet > 0 ? `Bet ${fmt(p.bet)}` : '';
    div.innerHTML = `
      <div class="head"><span class="name">${esc(p.name)}</span><span class="badges">${badges.map((b) => `<i>${b}</i>`).join('')}</span></div>
      <div class="chips">${fmt(p.chips)}</div>
      <div class="meta">${foot}</div>`;
    const cv = document.createElement('canvas');
    cv.dataset.glass = '';
    cv.setAttribute('aria-hidden', 'true');
    div.appendChild(cv);
    box.appendChild(div);
  });
}

function actionButton(act, label, extra) {
  return `<button class="btn ${extra || ''}" data-act="${act}">${label}</button>`;
}

function renderConsole() {
  const c = $('#console');
  const inner = c.querySelector('.inner') || c.appendChild(Object.assign(document.createElement('div'), { className: 'inner' }));

  if (state.phase === 'betting') {
    const p = cur();
    const tc = Math.min(toCall(), p.chips);
    const canRaise = p.bet + p.chips > topBet();
    let html = `<div class="who">${esc(p.name)} to act${tc > 0 ? ` · call ${fmt(tc)}` : ''}</div>`;
    const a = [];
    a.push(actionButton('fold', 'Fold', 'ghost'));
    if (toCall() === 0) a.push(actionButton('check', 'Check'));
    else if (p.chips <= toCall()) a.push(actionButton('allin', `All-in ${fmt(p.bet + p.chips)}`));
    else a.push(actionButton('call', `Call ${fmt(toCall())}`));
    if (canRaise && p.bet + p.chips >= minRaise()) a.push(actionButton('raise-toggle', 'Raise', 'primary'));
    html += `<div class="actions">${a.join('')}</div>`;
    if (state.raiseOpen) {
      const min = minRaise();
      const max = p.bet + p.chips;
      html += `
        <div class="panel">
          <div class="stepper">
            <button class="btn" data-act="raise-minus" aria-label="Smaller total">&#8722;</button>
            <input id="raise-input" inputmode="numeric" value="${raiseVal || min}">
            <button class="btn" data-act="raise-plus" aria-label="Bigger total">+</button>
          </div>
          <button class="btn primary" data-act="raise-confirm" id="raise-confirm-btn">Bet ${fmt(Math.min(Math.max(raiseVal || min, min), max))}</button>
        </div>
        <div class="hint">This is your total bet for the hand · min ${fmt(min)}</div>`;
    }
    inner.innerHTML = html;
    return;
  }

  if (state.phase === 'winner') {
    const inHandNow = state.players.map((p, i) => ({ p, i })).filter((x) => inHand(x.p));
    const btns = inHandNow.map((x) =>
      `<button class="wbtn${state.selection.includes(x.i) ? ' on' : ''}" data-act="pick" data-idx="${x.i}">${esc(x.p.name)}</button>`).join('');
    inner.innerHTML = `
      <div class="hint">Who won this hand?</div>
      <div class="winners">${btns}</div>
      <button class="btn primary" data-act="confirm-winners" ${state.selection.length ? '' : 'disabled'}>${state.selection.length > 1 ? 'Split pot' : 'Confirm'}</button>`;
    return;
  }

  if (state.phase === 'handEnd') {
    inner.innerHTML = `
      <div class="result">${esc(state.result)}</div>
      <div class="row"><button class="btn primary" data-act="next-hand">Next hand</button></div>`;
    return;
  }

  inner.innerHTML = `
    <div class="result">${esc(state.result)}</div>
    <div class="row"><button class="btn primary" data-act="new-game">New game</button></div>`;
}

function clampRaise(v) {
  return Math.min(Math.max(v, minRaise()), maxRaise());
}

/* ---------- events ---------- */
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'add-row') { addNameRow(); return; }
  if (act === 'remove-row') { b.closest('.name-row').remove(); refreshNameFields(); return; }
  if (act === 'start') { startGame(); return; }
  if (act === 'end-game') {
    if (confirm('End this game? All chips will be cleared.')) {
      localStorage.removeItem(KEY); state = null; refreshNameFields(); render();
    }
    return;
  }
  if (!state) return;
  if (state.phase === 'betting') {
    if (act === 'fold') actFold();
    else if (act === 'check') actCheck();
    else if (act === 'call') actCall();
    else if (act === 'allin') actAllin();
    else if (act === 'raise-toggle') {
      if (state.raiseOpen) { state.raiseOpen = false; }
      else { state.raiseOpen = true; raiseVal = minRaise(); }
      renderConsole();
    } else if (act === 'raise-minus') { raiseVal = clampRaise(raiseVal - state.bb); renderConsole(); }
    else if (act === 'raise-plus') { raiseVal = clampRaise(raiseVal + state.bb); renderConsole(); }
    else if (act === 'raise-confirm') { state.raiseOpen = false; actRaise(clampRaise(parseInt($('#raise-input').value, 10) || 0)); }
    return;
  }
  if (state.phase === 'winner') {
    if (act === 'pick') {
      const i = +b.dataset.idx;
      const at = state.selection.indexOf(i);
      if (at >= 0) state.selection.splice(at, 1); else state.selection.push(i);
      save();
      renderConsole();
    } else if (act === 'confirm-winners') confirmWinners();
    return;
  }
  if (state.phase === 'handEnd' && act === 'next-hand') nextHand();
  if (state.phase === 'champion' && act === 'new-game') {
    localStorage.removeItem(KEY); state = null; refreshNameFields(); render();
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'raise-input') {
    raiseVal = parseInt(e.target.value, 10) || 0;
    const min = minRaise(), max = maxRaise();
    $('#raise-confirm-btn').textContent = `Bet ${fmt(Math.min(Math.max(raiseVal, min), max))}`;
  }
});

/* ---------- boot ---------- */
load();
if (!state) { for (let i = 0; i < 4; i++) addNameRow(); }
refreshNameFields();
render();
