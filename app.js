(() => {
  "use strict";

  const STORAGE_KEY = "poker-chips-manager:v2";
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 10;

  const STREET_LABEL = {
    preflop: "Pre-flop",
    flop: "Flop",
    turn: "Turn",
    river: "River",
    showdown: "Showdown",
    handComplete: "Hand complete",
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    setup: $("setup"),
    game: $("game"),
    form: $("setup-form"),
    error: $("setup-error"),
    count: $("player-count"),
    names: $("name-fields"),
    startingChips: $("starting-chips"),
    betUnit: $("bet-unit"),
    useBlinds: $("use-blinds"),
    blindFields: $("blind-fields"),
    smallBlind: $("small-blind"),
    bigBlind: $("big-blind"),
    autoRaise: $("auto-raise"),
    raiseEveryWrap: $("raise-every-wrap"),
    raiseEvery: $("raise-every"),
    hand: $("hand-number"),
    stage: $("stage-label"),
    pot: $("pot-value"),
    blinds: $("blinds-value"),
    community: $("community-cards"),
    players: $("player-table-body"),
    actionTitle: $("to-act"),
    actions: $("action-buttons"),
    showdown: $("showdown"),
    showdownPot: $("showdown-pot"),
    winnerChoices: $("winner-choices"),
    confirmWinner: $("btn-confirm-winner"),
    complete: $("hand-complete"),
    completeMsg: $("complete-msg"),
    nextHand: $("btn-next-hand"),
    saveStop: $("btn-save-stop"),
    newGame: $("btn-new"),
  };

  // ---------- state ----------

  let state = null;
  let playerCount = 2;
  const choices = new Set();

  const fmt = (n) => Number(n).toLocaleString("en-US");
  const toInt = (v) => Math.floor(Number(v));
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function newCard() {
    const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
    const suits = ["\u2660", "\u2665", "\u2666", "\u2663"];
    return {
      rank: ranks[(Math.random() * ranks.length) | 0],
      suit: suits[(Math.random() * suits.length) | 0],
    };
  }

  const active = (p) => !p.out && !p.folded;
  const canAct = (p) => active(p) && !p.allIn;
  const activePlayers = () => state.players.filter(active);
  const actable = () => state.players.filter(canAct);
  const currentBet = () => state.players.filter(active).reduce((best, p) => Math.max(best, p.bet), 0);

  function nextLiveSeat(from) {
    const n = state.players.length;
    for (let step = 1; step <= n; step++) {
      const idx = (from + step) % n;
      const p = state.players[idx];
      if (!p.out && !p.folded) return idx;
    }
    return from;
  }

  // Hand-to-hand rotation skips only eliminated players; a fold this hand
  // still means you deal next time.
  function nextInGameSeat(from) {
    const n = state.players.length;
    for (let step = 1; step <= n; step++) {
      const idx = (from + step) % n;
      if (!state.players[idx].out) return idx;
    }
    return from;
  }

  function currentBlinds() {
    if (!state.config.useBlinds) return null;
    const mult = 2 ** state.blindLevel;
    return { small: state.config.smallBlind * mult, big: state.config.bigBlind * mult };
  }

  // Move chips from a player's stack into their street bet and the pot.
  function pay(p, amount) {
    const actual = Math.min(Math.max(amount, 0), p.stack);
    p.stack -= actual;
    p.bet += actual;
    p.total += actual;
    state.pot += actual;
    if (p.stack === 0) p.allIn = true;
  }

  // ---------- setup ----------

  function readSetup() {
    const names = Array.from({ length: playerCount }, (_, i) => {
      const v = $(`name-${i}`).value.trim();
      return v || `Player ${i + 1}`;
    });
    const startingChips = toInt(els.startingChips.value);
    const betUnit = toInt(els.betUnit.value);
    const useBlinds = els.useBlinds.checked;
    const smallBlind = toInt(els.smallBlind.value);
    const bigBlind = toInt(els.bigBlind.value);
    const autoRaise = useBlinds && els.autoRaise.checked;
    const raiseEvery = toInt(els.raiseEvery.value);

    if (!(startingChips > 0)) return { error: "Starting chips must be at least 1." };
    if (!(betUnit > 0)) return { error: "Bet unit must be at least 1." };
    if (useBlinds && (!(smallBlind > 0) || !(bigBlind > 0) || bigBlind < smallBlind)) {
      return { error: "Blinds must be at least 1, and the big blind can't be smaller than the small blind." };
    }
    if (autoRaise && !(raiseEvery > 0)) return { error: "Raise blinds every at least 1 hand." };

    return {
      names,
      config: {
        startingChips,
        betUnit,
        useBlinds,
        smallBlind: useBlinds ? smallBlind : 0,
        bigBlind: useBlinds ? bigBlind : 0,
        autoRaise,
        raiseEvery: autoRaise ? raiseEvery : 0,
      },
    };
  }

  function startGame(config, names) {
    const unitBase = config.useBlinds ? config.bigBlind : config.betUnit;
    state = {
      version: 2,
      config,
      players: names.map((name, i) => ({
        id: i,
        name,
        stack: config.startingChips,
        out: false,
        folded: false,
        allIn: false,
        bet: 0,
        total: 0,
        acted: false,
      })),
      dealer: 0,
      hand: 1,
      pot: 0,
      blindLevel: 0,
      street: "preflop",
      lastRaise: unitBase,
      community: [],
      phase: "playing",
      toAct: 0,
      summary: "",
      winners: [],
    };
    startHand();
    showGame();
  }

  function startHand() {
    choices.clear();
    state.pot = 0;
    state.community = [];
    state.winners = [];
    state.summary = "";
    state.street = "preflop";
    state.phase = "playing";
    state.lastRaise = state.config.useBlinds ? state.config.bigBlind : state.config.betUnit;
    state.players.forEach((p) => {
      p.folded = false;
      p.allIn = false;
      p.bet = 0;
      p.total = 0;
      p.acted = false;
    });

    const inGame = state.players.filter((p) => !p.out);
    if (inGame.length < 2) {
      state.phase = "handComplete";
      state.summary = `${inGame[0].name} wins the game.`;
      state.gameOver = true;
      save();
      render();
      return;
    }
    state.gameOver = false;

    if (state.config.useBlinds) {
      const n = state.players.length;
      const sbIdx = n === 2 ? state.dealer : nextLiveSeat(state.dealer);
      const bbIdx = nextLiveSeat(sbIdx);
      const blinds = currentBlinds();
      pay(state.players[sbIdx], blinds.small);
      pay(state.players[bbIdx], blinds.big);
    }
    toFirstActor();
    save();
    render();
  }

  function toFirstActor() {
    let start;
    if (state.street === "preflop") {
      const n = state.players.length;
      const sbIdx = n === 2 ? state.dealer : nextLiveSeat(state.dealer);
      const bbIdx = nextLiveSeat(sbIdx);
      start = n === 2 ? sbIdx : nextLiveSeat(bbIdx);
    } else {
      start = nextLiveSeat(state.dealer);
    }
    const duePlayers = actable().filter((p) => !p.acted || p.bet !== currentBet());
    if (duePlayers.length === 0) {
      // Blind-posted players are already all-in: nothing to act on.
      state.toAct = start;
      closeStreet();
      return;
    }
    if (!duePlayers.some((p) => p.id === start)) start = duePlayers[0].id;
    state.toAct = start;
  }

  function dueAt(idx) {
    const p = state.players[idx];
    if (!p || !canAct(p)) return false;
    return !p.acted || p.bet !== currentBet();
  }

  // ---------- hand actions ----------

  function fold() {
    const p = state.players[state.toAct];
    p.folded = true;
    p.acted = true;
    if (activePlayers().length === 1) {
      awardPotTo(activePlayers(), "Everyone else folded.");
    } else {
      advancePointer();
    }
    save();
    render();
  }

  function check() {
    state.players[state.toAct].acted = true;
    advancePointer();
    save();
    render();
  }

  function call() {
    const p = state.players[state.toAct];
    pay(p, currentBet() - p.bet);
    p.acted = true;
    advancePointer();
    save();
    render();
  }

  function allIn() {
    const p = state.players[state.toAct];
    raiseTo(p.bet + p.stack);
  }

  function raiseTo(target) {
    const p = state.players[state.toAct];
    const prevBet = currentBet();
    const capped = Math.min(target, p.bet + p.stack);
    pay(p, capped - p.bet);
    if (p.bet > prevBet) {
      state.lastRaise = Math.max(state.lastRaise, p.bet - prevBet);
      state.players.forEach((o) => {
        if (o !== p && canAct(o) && o.bet < p.bet) o.acted = false;
      });
    }
    p.acted = true;
    advancePointer();
    save();
    render();
  }

  function advancePointer() {
    if (activePlayers().length <= 1) {
      awardPotTo(activePlayers(), "Everyone else folded.");
      return;
    }
    if (roundComplete()) {
      closeStreet();
      return;
    }
    let idx = state.toAct;
    for (let step = 0; step < state.players.length; step++) {
      idx = (idx + 1) % state.players.length;
      if (dueAt(idx)) {
        state.toAct = idx;
        return;
      }
    }
  }

  function roundComplete() {
    return actable().filter((p) => !p.acted || p.bet !== currentBet()).length === 0;
  }

  function closeStreet() {
    refundUncalled();
    if (activePlayers().length <= 1) {
      awardPotTo(activePlayers(), "Everyone else folded.");
      return;
    }
    if (state.street === "river") {
      state.phase = "showdown";
      state.winners = [];
      save();
      render();
      return;
    }
    nextStreet();
  }

  function nextStreet() {
    const order = ["preflop", "flop", "turn", "river"];
    state.street = order[order.indexOf(state.street) + 1];
    const dealt = { flop: 3, turn: 1, river: 1 };
    for (let i = 0; i < dealt[state.street]; i++) state.community.push(newCard());
    state.players.forEach((p) => {
      p.bet = 0;
      p.acted = false;
    });
    state.lastRaise = state.config.useBlinds ? state.config.bigBlind : state.config.betUnit;

    if (actable().length === 0) {
      // Everyone all-in: run the remaining streets straight to showdown.
      if (state.street === "river") {
        state.phase = "showdown";
        state.winners = [];
        save();
        render();
      } else {
        nextStreet();
      }
      return;
    }

    // Post-flop action starts left of the button.
    const due = actable();
    if (dueAt(nextLiveSeat(state.dealer))) state.toAct = nextLiveSeat(state.dealer);
    else {
      const found = due.find((p) => !p.acted) ?? due[0];
      state.toAct = found.id;
    }
    save();
    render();
  }

  // A top bet nobody called (all others all-in short or folded) comes back.
  function refundUncalled() {
    const wagers = state.players.filter(active).map((p) => p.bet);
    if (wagers.length < 2) return;
    const sorted = [...wagers].sort((a, b) => b - a);
    const top = sorted[0];
    const second = sorted[1];
    if (top > second) {
      const p = state.players.find((x) => active(x) && x.bet === top);
      if (p) {
        const back = top - second;
        p.bet -= back;
        p.total -= back;
        p.stack += back;
        state.pot -= back;
      }
    }
  }

  function awardPotTo(winPlayers, note = "") {
    choices.clear();
    // Return any street bet that no one called before the hand ended.
    if (winPlayers.length === 1) {
      const others = state.players.filter((x) => !winPlayers.includes(x));
      const top = state.players.find((x) => winPlayers.includes(x) && x.bet > 0);
      if (top) {
        const rival = [0, ...others.filter((o) => o.bet > 0).map((o) => o.bet)].sort((a, b) => b - a)[0];
        if (top.bet > rival) {
          const back = top.bet - Math.max(rival, 0);
          top.bet -= back;
          top.total -= back;
          top.stack += back;
          state.pot -= back;
        }
      }
    }
    if (winPlayers.length === 0 || state.pot <= 0) return;

    const share = Math.floor(state.pot / winPlayers.length);
    const remainder = state.pot - share * winPlayers.length;
    winPlayers.forEach((p, i) => {
      p.stack += share + (i === 0 ? remainder : 0);
    });
    state.players.forEach((p) => {
      p.bet = 0;
      p.total = 0;
      p.acted = false;
      if (p.stack === 0) p.out = true;
    });
    state.pot = 0;
    state.winners = winPlayers.map((p) => p.id);
    state.phase = "handComplete";
    state.summary =
      winPlayers.length === 1
        ? `${winPlayers[0].name} takes the pot.${note ? " " + note : ""}`
        : `Split pot: ${winPlayers.map((p) => p.name).join(" & ")}.`;
    save();
    render();
  }

  function confirmWinners() {
    const selected = activePlayers().filter((p) => choices.has(p.id));
    choices.clear();
    if (selected.length === 0) return;
    awardPotTo(selected, "The chips have been paid out.");
  }

  function nextHand() {
    state.dealer = nextInGameSeat(state.dealer);
    state.hand += 1;
    if (state.config.autoRaise && state.hand > 1 && (state.hand - 1) % state.config.raiseEvery === 0) {
      state.blindLevel += 1;
    }
    startHand();
    showGame();
  }

  // ---------- persistence ----------

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      /* storage unavailable: play in memory */
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && parsed.version === 2 && Array.isArray(parsed.players) && parsed.players.length >= MIN_PLAYERS ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function clearSaved() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) { /* ignore */ }
  }

  // ---------- render ----------

  function badge(text, cls = "") {
    return `<span class="badge ${cls}">${text}</span>`;
  }

  function cardFace(c) {
    const red = c.suit === "\u2665" || c.suit === "\u2666";
    return `<div class="playing-card${red ? " is-red" : ""}" aria-hidden="true">
      <span class="card-rank">${c.rank}</span>
      <span class="card-suit">${c.suit}</span>
    </div>`;
  }

  function playerRow(p) {
    const n = state.players.length;
    const sbIdx = n === 2 ? state.dealer : nextLiveSeat(state.dealer);
    const bbIdx = nextLiveSeat(sbIdx);
    const role = p.id === sbIdx && state.config.useBlinds && !state.gameOver ? badge("SB") : p.id === bbIdx && state.config.useBlinds && !state.gameOver ? badge("BB") : "";
    const stat = p.out
      ? badge("Out", "b-dim")
      : p.folded
        ? badge("Folded", "b-dim")
        : p.allIn
          ? badge("All-in", "b-gold")
          : badge("Active", "b-green");
    const showStreetBet = state.phase === "playing" && p.bet > 0;
    const betCell = showStreetBet ? fmt(p.bet) : `0${p.total ? ` <em class="bet-total">Total ${fmt(p.total)}</em>` : ""}`;
    const classes = [
      state.phase === "playing" && p.id === state.toAct ? "is-acting" : "",
      p.folded || p.out ? "is-dim" : "",
      state.winners.includes(p.id) ? "is-winner" : "",
    ].filter(Boolean).join(" ");

    return `<tr class="${classes}">
      <td class="c-seg">${p.id + 1}</td>
      <td><span class="p-name">${esc(p.name)}</span> ${role}</td>
      <td class="num">${fmt(p.stack)}</td>
      <td class="num">${betCell}</td>
      <td class="c-stat">${stat}</td>
    </tr>`;
  }

  function render() {
    const blinds = currentBlinds();
    els.hand.textContent = String(state.hand);
    const stageKey = state.phase === "playing" ? state.street : state.phase;
    els.stage.textContent = STREET_LABEL[stageKey];
    els.pot.textContent = fmt(state.pot);
    els.blinds.textContent = blinds ? `${fmt(blinds.small)} / ${fmt(blinds.big)}` : "Off";

    let comm = "";
    for (let i = 0; i < 5; i++) {
      comm += i < state.community.length ? cardFace(state.community[i]) : '<div class="card-slot" aria-hidden="true"></div>';
    }
    els.community.innerHTML = comm;

    els.players.innerHTML = state.players.map(playerRow).join("");

    renderActions();
    renderShowdown();
    renderComplete();
  }

  function minRaiseTo() {
    const cb = currentBet();
    return cb > 0 ? cb + state.lastRaise : state.config.useBlinds ? currentBlinds().big : state.config.betUnit;
  }

  function renderActions() {
    const inPlay = state.phase === "playing";
    els.actionTitle.textContent = inPlay ? `${state.players[state.toAct]?.name ?? ""} to act` : "";
    els.actions.hidden = !inPlay;
    if (!inPlay) {
      els.actions.innerHTML = "";
      return;
    }

    const p = state.players[state.toAct];
    const need = Math.max(currentBet() - p.bet, 0);
    const minTo = minRaiseTo();
    const maxTo = p.bet + p.stack;
    const canRaise = p.stack > need && maxTo > minTo;

    let html = `<button class="btn btn-fold" data-act="fold">Fold</button>`;
    html += need === 0
      ? `<button class="btn btn-primary" data-act="check">Check</button>`
      : `<button class="btn btn-primary" data-act="call">Call (${fmt(need)})</button>`;
    if (canRaise) {
      html += `<div class="raise-box">
        <input id="raise-amount" type="number" inputmode="numeric" min="${minTo}" max="${maxTo}" step="${state.config.betUnit}" value="${minTo}">
        <button class="btn btn-gold" data-act="raise">Raise</button>
      </div>`;
    }
    if (p.stack > 0) html += `<button class="btn btn-allin" data-act="allin">All-in</button>`;
    els.actions.innerHTML = html;
  }

  els.actions.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn || state?.phase !== "playing") return;
    if (btn.dataset.act === "fold") fold();
    else if (btn.dataset.act === "check") check();
    else if (btn.dataset.act === "call") call();
    else if (btn.dataset.act === "allin") allIn();
    else if (btn.dataset.act === "raise") {
      const input = els.actions.querySelector("#raise-amount");
      const raw = toInt(input.value);
      const limit = minRaiseTo();
      raiseTo(Number.isFinite(raw) ? Math.max(limit, Math.min(raw, state.players[state.toAct].bet + state.players[state.toAct].stack)) : limit);
    }
  });

  function renderShowdown() {
    const shows = state.phase === "showdown";
    els.showdown.hidden = !shows;
    if (!shows) return;
    els.showdownPot.textContent = fmt(state.pot);
    els.winnerChoices.innerHTML = activePlayers().map((p) =>
      `<button class="btn btn-choice${choices.has(p.id) ? " is-picked" : ""}" data-id="${p.id}" aria-pressed="${choices.has(p.id)}">${esc(p.name)}</button>`
    ).join("");
    els.confirmWinner.disabled = choices.size === 0;
  }

  els.winnerChoices.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-choice");
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (choices.has(id)) choices.delete(id);
    else choices.add(id);
    renderShowdown();
    els.confirmWinner.disabled = choices.size === 0;
  });

  function renderComplete() {
    const shows = state.phase === "handComplete";
    els.complete.hidden = !shows;
    if (!shows) return;
    els.completeMsg.textContent = state.summary || "The chips have been paid out to the winner.";
    els.nextHand.hidden = state.gameOver || state.players.filter((p) => !p.out).length <= 1;
  }

  function showGame() {
    els.setup.hidden = true;
    els.game.hidden = false;
    els.newGame.hidden = false;
    render();
  }

  function showSetup() {
    els.game.hidden = true;
    els.newGame.hidden = true;
    els.setup.hidden = false;
    els.error.hidden = true;
  }

  // ---------- setup screen ----------

  function renderNameFields() {
    const existing = Array.from(els.names.querySelectorAll("input")).map((i) => i.value);
    els.names.querySelectorAll(".field").forEach((n) => n.remove());
    for (let i = 0; i < playerCount; i++) {
      const wrap = document.createElement("div");
      wrap.className = "field";
      const label = document.createElement("label");
      label.htmlFor = `name-${i}`;
      label.textContent = `Name of player ${i + 1}`;
      const input = document.createElement("input");
      input.type = "text";
      input.id = `name-${i}`;
      input.maxLength = 20;
      input.autocomplete = "off";
      input.placeholder = `Player ${i + 1}`;
      input.value = existing[i] ?? "";
      wrap.append(label, input);
      els.names.append(wrap);
    }
    els.count.textContent = String(playerCount);
  }

  function setCount(next) {
    playerCount = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, next));
    renderNameFields();
  }

  els.form.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-count]");
    if (!btn) return;
    setCount(playerCount + Number(btn.dataset.count));
  });

  els.useBlinds.addEventListener("change", () => {
    els.blindFields.hidden = !els.useBlinds.checked;
  });

  els.autoRaise.addEventListener("change", () => {
    els.raiseEveryWrap.hidden = !els.autoRaise.checked;
  });

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const result = readSetup();
    if (result.error) {
      els.error.textContent = result.error;
      els.error.hidden = false;
      return;
    }
    startGame(result.config, result.names);
  });

  // ---------- game level events ----------

  els.confirmWinner.addEventListener("click", confirmWinners);
  els.nextHand.addEventListener("click", nextHand);

  els.saveStop.addEventListener("click", () => {
    save();
    els.saveStop.textContent = "Saved";
    els.saveStop.disabled = true;
    setTimeout(() => {
      els.saveStop.textContent = "Save and stop here";
      els.saveStop.disabled = false;
    }, 1500);
  });

  els.newGame.addEventListener("click", () => {
    if (!window.confirm("Start a new game? The current game will be lost.")) return;
    state = null;
    choices.clear();
    clearSaved();
    showSetup();
  });

  // ---------- startup ----------

  setCount(2);
  const saved = load();
  if (saved) {
    state = saved;
    choices.clear();
    showGame();
  } else {
    showSetup();
  }
})();
