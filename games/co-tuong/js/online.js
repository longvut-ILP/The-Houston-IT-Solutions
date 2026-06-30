/* ============================================================
   online.js — online "winner stays on" tournament + spectating
   ------------------------------------------------------------
   Host creates a room (PIN). Players join from their own computers
   with a name (blank → "Player ####"). The front two of the queue
   play head-to-head, each from their own screen; everyone else
   WATCHES the live board. Winner stays, loser to the back, colours
   alternate — same ladder as the local tournament, but networked.

   Sync model = lockstep moves: the host is authoritative for who may
   move and for match results; every move is broadcast and applied by
   all participants to identical boards (same start position + same
   deterministic rules engine), so all screens stay in sync.
   ============================================================ */
(function (global) {
  "use strict";
  const XQ = global.XQ;

  const encMove = (m) =>
    XQ.toIccsSquare(m.from.file, m.from.rank) + XQ.toIccsSquare(m.to.file, m.to.rank);
  const decMove = (s) => XQ.parseIccsMove(s);
  const randomName = () => "Player " + Math.floor(1000 + Math.random() * 9000);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

  class OnlineManager {
    constructor(controller) {
      this.c = controller;
      this.net = new XQ.Net();
      this.isHost = false;
      this.myId = null;
      this.myName = null;

      // shared/host state
      this.players = [];     // {id, name, conn|null}
      this.queue = [];       // ids waiting (front = [0])
      this.redId = null;
      this.blackId = null;
      this.stayerId = null;
      this.streak = 0;
      this.pending = null;
      this.started = false;
      this._idc = 0;

      this.bindUI();
    }

    el(id) { return document.getElementById(id); }
    status(t) { const s = this.el("ol-status"); if (s) s.textContent = t; }
    nameOf(id) { const p = this.players.find((x) => x.id === id); return p ? p.name : id; }

    bindUI() {
      const host = this.el("ol-host");
      if (!host) return;
      host.addEventListener("click", () => this.startHost());
      this.el("ol-join").addEventListener("click", () => this.startJoin());
      const st = this.el("ol-start"); if (st) st.addEventListener("click", () => this.hostStart());
      const nx = this.el("ol-next"); if (nx) nx.addEventListener("click", () => this.hostNext());
    }

    showRoom() {
      this.el("ol-setup").style.display = "none";
      this.el("ol-room").style.display = "block";
    }

    /* ---------------- HOST ---------------- */
    startHost() {
      this.isHost = true;
      this.myName = (this.el("ol-name").value || "").trim() || randomName();
      this.myId = "host";
      this.players = [{ id: "host", name: this.myName, conn: null }];
      this.queue = ["host"];
      this.net.onData = (d, conn) => this.hostOnData(d, conn);
      this.net.onLeave = (conn) => this.hostOnLeave(conn);
      this.net.onError = (e) => this.status("Error: " + (e.type || e.message || e));
      this.status("Creating room…");
      this.net.host((pin) => {
        this.roomPin = pin;
        this.c.enterOnline(true, this.net, this);
        this.showRoom();
        this.el("ol-pin-display").textContent = "Room PIN: " + pin;
        this.el("ol-start").style.display = "inline-block";
        this.renderLobby();
      });
    }

    hostOnData(d, conn) {
      if (d.t === "join") {
        const id = "p" + (++this._idc);
        conn._pid = id;
        this.players.push({ id, name: (d.name || randomName()), conn });
        if (this.started) {
          // joined mid-tournament → go to the back of the line as a spectator
          this.queue.push(id);
        } else {
          this.queue.push(id);
        }
        this.net.sendTo(conn, { t: "welcome", id });
        this.broadcastLobby();
        // bring a late joiner up to the current match so they can spectate live
        if (this.started && this.redId) {
          this.net.sendTo(conn, this.matchMsg());
        }
      } else if (d.t === "move") {
        if (!this.started) return;
        const turnSeat = this.c.board.turn === XQ.RED ? this.redId : this.blackId;
        if (conn._pid !== turnSeat) return; // only the side to move may move
        this.c.onMove(decMove(d.mv)); // host branch broadcasts + applies
      }
    }

    hostOnLeave(conn) {
      const id = conn._pid;
      if (!id) return;
      this.players = this.players.filter((p) => p.id !== id);
      this.queue = this.queue.filter((q) => q !== id);
      this.broadcastLobby();
    }

    pubPlayers() { return this.players.map((p) => ({ id: p.id, name: p.name })); }

    broadcastLobby() {
      this.net.broadcast({ t: "lobby", players: this.pubPlayers(), queue: this.queue, started: this.started });
      this.renderLobby();
    }

    hostStart() {
      if (this.queue.length < 2) { alert("Need at least 2 players in the room to start."); return; }
      this.started = true;
      this.stayerId = null;
      this.streak = 0;
      this.pending = null;
      this.el("ol-start").style.display = "none";
      this.redId = this.queue.shift();
      this.blackId = this.queue.shift();
      this.seatMatch();
    }

    matchMsg() {
      return {
        t: "match",
        redId: this.redId, redName: this.nameOf(this.redId),
        blackId: this.blackId, blackName: this.nameOf(this.blackId),
        queue: this.queue, players: this.pubPlayers(),
      };
    }

    seatMatch() {
      this.net.broadcast(this.matchMsg());
      const mySeat = this.myId === this.redId ? "RED"
        : this.myId === this.blackId ? "BLACK" : "SPECTATOR";
      this.c.onGameOver = (result) => this.hostGameOver(result);
      this.c.beginOnlineMatch(this.nameOf(this.redId), this.nameOf(this.blackId), mySeat, {});
      this.renderLobby();
    }

    hostGameOver(result) {
      let winner, loser;
      if (result.winner === XQ.RED) { winner = this.redId; loser = this.blackId; }
      else if (result.winner === XQ.BLACK) { winner = this.blackId; loser = this.redId; }
      else {
        const champ = this.stayerId || this.redId;
        winner = champ;
        loser = champ === this.redId ? this.blackId : this.redId;
      }
      this.streak = winner === this.stayerId ? this.streak + 1 : 1;
      this.stayerId = winner;
      this.queue.push(loser);
      const next = this.queue.shift();
      const stayerWasRed = winner === this.redId;
      const nextRed = stayerWasRed ? next : winner;   // colours alternate
      const nextBlack = stayerWasRed ? winner : next;
      this.pending = { redId: nextRed, blackId: nextBlack };
      const text = result.winner
        ? `${this.nameOf(winner)} beat ${this.nameOf(loser)}`
        : `Draw — ${this.nameOf(winner)} keeps the seat`;
      this.net.broadcast({
        t: "matchend", text, queue: this.queue,
        nextRed: this.nameOf(nextRed), nextBlack: this.nameOf(nextBlack),
        streak: this.streak, king: this.nameOf(this.stayerId),
      });
      this.el("ol-next").style.display = "inline-block";
      this.renderLobby(text);
    }

    hostNext() {
      if (!this.pending) return;
      this.redId = this.pending.redId;
      this.blackId = this.pending.blackId;
      this.pending = null;
      this.el("ol-next").style.display = "none";
      this.seatMatch();
    }

    // called by the controller's onMove host-branch
    broadcastMove(move) { this.net.broadcast({ t: "move", mv: encMove(move) }); }

    /* ---------------- CLIENT ---------------- */
    startJoin() {
      this.isHost = false;
      this.myName = (this.el("ol-name").value || "").trim() || randomName();
      const pin = (this.el("ol-pin").value || "").trim();
      if (pin.length !== 4) { alert("Enter the 4-digit room PIN."); return; }
      this.net.onData = (d) => this.clientOnData(d);
      this.net.onError = (e) => this.status("Connection error: " + (e.type || e.message || e));
      this.status("Connecting…");
      this.net.join(pin, () => {
        this.c.enterOnline(false, this.net, this);
        this.net.sendToHost({ t: "join", name: this.myName });
        this.showRoom();
        this.el("ol-pin-display").textContent = "Joined room " + pin;
        this.status("Connected — waiting for the host to start.");
      });
    }

    clientOnData(d) {
      if (d.t === "welcome") {
        this.myId = d.id;
      } else if (d.t === "lobby") {
        this.players = d.players; this.queue = d.queue; this.started = d.started;
        this.renderLobby();
      } else if (d.t === "match") {
        this.players = d.players || this.players;
        this.queue = d.queue || this.queue;
        this.redId = d.redId; this.blackId = d.blackId;
        const mySeat = this.myId === d.redId ? "RED"
          : this.myId === d.blackId ? "BLACK" : "SPECTATOR";
        this.c.onGameOver = () => {}; // host orchestrates results
        this.c.beginOnlineMatch(d.redName, d.blackName, mySeat, {});
        this.renderLobby();
      } else if (d.t === "move") {
        this.c.applyRemoteMove(decMove(d.mv));
      } else if (d.t === "matchend") {
        this.queue = d.queue || this.queue;
        this.renderLobby(d.text);
      }
    }

    // called by the controller's onMove client-branch
    sendMove(move) { this.net.sendToHost({ t: "move", mv: encMove(move) }); }

    /* ---------------- shared UI ---------------- */
    renderLobby(note) {
      const seat = this.el("ol-seat");
      if (seat) {
        let s = "";
        const ms = this.c.online && this.c.online.mySeat;
        if (this.started && ms) {
          s = ms === "SPECTATOR" ? "👀 Watching — you’re in the queue"
            : ms === "RED" ? "🔴 You are Red — your move when it’s your turn"
            : "⚫ You are Black — your move when it’s your turn";
        }
        seat.textContent = s;
      }
      const body = this.el("ol-players");
      if (body) {
        const tag = (p) => p.id === this.redId ? " — 🔴"
          : p.id === this.blackId ? " — ⚫" : "";
        const list = this.players
          .map((p) => `<li>${esc(p.name)}${p.id === this.myId ? " (you)" : ""}${tag(p)}</li>`)
          .join("");
        body.innerHTML =
          (note ? `<div class="tn-result">${esc(note)}</div>` : "") +
          `<div class="tn-sub">In room (${this.players.length}):</div>` +
          `<ol class="tn-queue">${list}</ol>` +
          (this.isHost && !this.started && this.players.length < 2
            ? `<div class="tn-hint">Share the PIN — need 2+ players, then Start.</div>` : "");
      }
    }
  }

  XQ.OnlineManager = OnlineManager;

  // Boot after the local controller exists (main.js sets global.game).
  function boot() {
    if (!global.game) { setTimeout(boot, 50); return; }
    global.online = new OnlineManager(global.game);
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(typeof window !== "undefined" ? window : globalThis);
