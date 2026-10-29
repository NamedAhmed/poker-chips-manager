(() => {
  "use strict";

  const STORAGE_KEY = "poker-chips-manager:v1";
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 10;

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
    raiseWrap: $("raise-every-wrap"),
    raiseEvery: $("raise-every"),
    players: $("players"),
    pot: $("pot-value"),
    hand: $("hand-number"),
    blinds: $("blinds-value"),
    nextHand: $("btn-next-hand"),
    newGame: $("btn-new"),
  };

  let state = null;
  let playerCount = 2;

  // ---------- helpers ----------

  const fmt = (n) => Number(n).toLocaleString();
  const toInt = (v) => Math.floor(Number(v));

  function defaultNames(count) {
    return Array.from({ length: count }, (_, i) => `Player ${i + 1}`);
  }

  function renderNameFields() {
    const existing = Array.from(els.names.querySelectorAll("input")).map((i) => i.value);
    els.names.querySelectorAll(".field").forEach((n) => n.remove());
    for (let i = 0; i < playerCount; i++) {
      const wrap = document.createElement("div");
      wrap.className = "field";
      const label = document.createElement("label");
      label.htmlFor = `name-${i}`;
      label.textContent = `Player ${i + 1}`;
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
    if (useBlinds) {
      if (!(smallBlind > 0) || !(bigBlind > 0)) return { error: "Blinds must be at least 1." };
      if (bigBlind < smallBlind) return { error: "Big blind must be at least the small blind." };
      if (autoRaise && !(raiseEvery > 0)) return { error: "Raise blinds every at least 1 hand." };
    }

    return {
      config: {
        startingChips,
        betUnit,
        useBlinds,
        smallBlind: useBlinds ? smallBlind : 0,
        bigBlind: useBlinds ? bigBlind : 0,
        autoRaise,
        raiseEvery: autoRaise ? raiseEvery : 0,
      },
      names,
    };
  }

  function newState(config, names) {
    const players = names.map((name, i) => ({
      id: i,
      name,
      stack: config.startingChips,
      bet: 0,
      out: false,
    }));
    return {
      config,
      players,
      dealer: 0,
      hand: 1,
      pot: 0,
      blindLevel: 0,
    };
  }

  function currentBlinds() {
    if (!state.config.useBlinds) return null;
    const mult = 2 ** state.blindLevel;
    return {
      small: state.config.smallBlind * mult,
      big: state.config.bigBlind * mult,
    };
  }

  function activePlayers() {
    return state.players.filter((p) => !p.out);
  }

  // Move chips from a player's stack into the pot.
  function putInPot(player, amount) {
    const pay = Math.min(amount, player.stack);
    player.stack -= pay;
    player.bet += pay;
    state.pot += pay;
    return pay;
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      /* storage full or disabled: keep playing in memory */
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function clearSaved() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {
      /* ignore */
    }
  }

  // ---------- actions ----------

  function adjustStack(player, delta) {
    if (delta > 0) {
      // Winnings or chips received come from the table, not the pot.
      player.stack += delta;
    } else {
      const take = Math.min(-delta, player.stack);
      player.stack -= take;
    }
    save();
    render();
  }

  function bet(player) {
    const unit = state.config.betUnit;
    const pay = putInPot(player, unit);
    if (pay === 0) return;
    save();
    render();
  }

  function awardPot(winnerIds) {
    if (state.pot <= 0 || winnerIds.length === 0) return;
    const share = Math.floor(state.pot / winnerIds.length);
    const remainder = state.pot - share * winnerIds.length;
    winnerIds.forEach((id) => {
      const p = state.players.find((x) => x.id === id);
      if (p) p.stack += share;
    });
    // Odd chips go to the first winner closest to the dealer.
    if (remainder > 0) {
      const p = state.players.find((x) => x.id === winnerIds[0]);
      if (p) p.stack += remainder;
    }
    state.pot = 0;
    state.players.forEach((p) => (p.bet = 0));
    save();
    render();
  }

  function nextDealerIndex() {
    const n = state.players.length;
    for (let step = 1; step <= n; step++) {
      const idx = (state.dealer + step) % n;
      if (!state.players[idx].out) return idx;
    }
    return state.dealer;
  }

  function nextHand() {
    // Clear uncollected bets back into play so chips are never lost.
    state.players.forEach((p) => {
      p.stack += p.bet;
      p.bet = 0;
    });
    state.pot = 0;

    // Eliminate players with no chips.
    state.players.forEach((p) => {
      if (p.stack <= 0) p.out = true;
    });

    state.dealer = nextDealerIndex();
    state.hand += 1;

    if (state.config.autoRaise && state.hand > 1 && (state.hand - 1) % state.config.raiseEvery === 0) {
      state.blindLevel += 1;
    }

    const blinds = currentBlinds();
    if (blinds) postBlinds(blinds);

    save();
    render();
  }

  function postBlinds(blinds) {
    const live = state.players.filter((p) => !p.out);
    if (live.length < 2) return;
    const n = state.players.length;
    const indexAfter = (from) => {
      for (let step = 1; step <= n; step++) {
        const idx = (from + step) % n;
        if (!state.players[idx].out) return idx;
      }
      return from;
    };
    const sbIdx = live.length === 2 ? state.dealer : indexAfter(state.dealer);
    const bbIdx = indexAfter(sbIdx);
    putInPot(state.players[sbIdx], blinds.small);
    putInPot(state.players[bbIdx], blinds.big);
  }

  // ---------- rendering ----------

  function renderPlayers() {
    els.players.textContent = "";
    state.players.forEach((p, idx) => {
      const li = document.createElement("li");
      li.className = "player";
      if (idx === state.dealer && !p.out) li.classList.add("is-dealer");
      if (p.out) li.classList.add("is-out");

      const head = document.createElement("div");
      head.className = "player-head";
      const name = document.createElement("span");
      name.className = "player-name";
      name.textContent = p.name;
      const badges = document.createElement("div");
      badges.className = "badges";
      if (idx === state.dealer && !p.out) badges.append(badge("Dealer"));
      if (p.out) badges.append(badge("Out"));
      head.append(name, badges);

      const stack = document.createElement("div");
      stack.className = "player-stack";
      stack.textContent = fmt(p.stack);

      const betLine = document.createElement("div");
      betLine.className = "player-bet";
      betLine.textContent = `In pot: ${fmt(p.bet)}`;

      const controls = document.createElement("div");
      controls.className = "player-controls";
      controls.append(
        button(`Bet ${fmt(state.config.betUnit)}`, "btn", () => bet(p), p.out || p.stack <= 0),
        button("Win pot", "btn btn-win", () => awardPot([p.id]), state.pot <= 0),
        button(`+${fmt(state.config.betUnit)}`, "btn", () => adjustStack(p, state.config.betUnit), false),
        button(`−${fmt(state.config.betUnit)}`, "btn", () => adjustStack(p, -state.config.betUnit), p.stack <= 0)
      );

      li.append(head, stack, betLine, controls);
      els.players.append(li);
    });
  }

  function badge(text) {
    const b = document.createElement("span");
    b.className = "badge";
    b.textContent = text;
    return b;
  }

  function button(label, className, onClick, disabled) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = className;
    b.textContent = label;
    b.disabled = !!disabled;
    b.addEventListener("click", onClick);
    return b;
  }

  function render() {
    els.pot.textContent = fmt(state.pot);
    els.hand.textContent = String(state.hand);
    const blinds = currentBlinds();
    els.blinds.textContent = blinds ? `${fmt(blinds.small)}/${fmt(blinds.big)}` : "Off";
    renderPlayers();
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

  // ---------- events ----------

  els.form.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-count]");
    if (!btn) return;
    setCount(playerCount + Number(btn.dataset.count));
  });

  els.useBlinds.addEventListener("change", () => {
    els.blindFields.hidden = !els.useBlinds.checked;
  });

  els.autoRaise.addEventListener("change", () => {
    els.raiseWrap.hidden = !els.autoRaise.checked;
  });

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const result = readSetup();
    if (result.error) {
      els.error.textContent = result.error;
      els.error.hidden = false;
      return;
    }
    state = newState(result.config, result.names);
    const blinds = currentBlinds();
    if (blinds) postBlinds(blinds);
    save();
    showGame();
  });

  els.nextHand.addEventListener("click", nextHand);

  els.newGame.addEventListener("click", () => {
    if (!window.confirm("Start a new game? The current game will be lost.")) return;
    state = null;
    clearSaved();
    showSetup();
  });

  // ---------- startup ----------

  setCount(2);
  const saved = load();
  if (saved && Array.isArray(saved.players) && saved.players.length >= MIN_PLAYERS) {
    state = saved;
    showGame();
  } else {
    showSetup();
  }
})();
