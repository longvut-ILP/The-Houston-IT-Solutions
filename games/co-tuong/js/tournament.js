/* ============================================================
   tournament.js — office "winner stays on" queue
   ------------------------------------------------------------
   People enter their names into a line. The front two play.
   When a game ends:
     • the winner keeps their seat,
     • the loser goes to the BACK of the line,
     • on a draw the sitting champion stays and the challenger
       drops to the back,
     • colours ALTERNATE every match,
     • a streak counter tracks the current "King of the Hill".
   The line just keeps rotating, so it runs all day until Reset.

   The rotation logic (start / advance / next) is DOM-free and unit
   tested; rendering is layered on top and skipped when there is no
   document (e.g. under Node).
   ============================================================ */
(function (global) {
  "use strict";
  const XQ = global.XQ;
  const RED = XQ.RED, BLACK = XQ.BLACK;

  const AI_TOKEN = "🤖 Computer"; // a special "player" driven by the engine

  class TournamentManager {
    constructor(controller) {
      this.c = controller;
      this.AI_TOKEN = AI_TOKEN;
      this.line = [];          // queue of waiting player names (front = [0])
      this.redPlayer = null;
      this.blackPlayer = null;
      this.stayer = null;      // player who holds the seat (current champion)
      this.streak = 0;         // champion's consecutive results
      this.active = false;
      this.pending = null;     // computed next pairing, awaiting "Next match"
      this.lastResult = null;

      controller.onGameOver = (result) => this.onGameOver(result);
      this.bindUI();
      this.render();
    }

    /* ---------------- core rotation (DOM-free) ---------------- */

    isAI(name) { return name === AI_TOKEN; }

    addPlayer(name) {
      name = (name || "").trim();
      if (!name) name = "Player " + Math.floor(1000 + Math.random() * 9000);
      this.line.push(name);
      this.render();
      return true;
    }

    // Add the engine as a contender. It rotates through the line like a
    // person: when seated, its side is played automatically; winner-stays
    // and loser-to-back apply to it too. Only one Computer entry allowed.
    addAI() {
      const present = this.line.includes(AI_TOKEN) ||
        this.redPlayer === AI_TOKEN || this.blackPlayer === AI_TOKEN;
      if (present) return false;
      this.line.push(AI_TOKEN);
      this.render();
      return true;
    }

    start() {
      if (this.line.length < 2) return false;
      this.active = true;
      this.pending = null;
      this.lastResult = null;
      this.stayer = null;
      this.streak = 0;
      this.redPlayer = this.line.shift();
      this.blackPlayer = this.line.shift();
      this.seat(this.redPlayer, this.blackPlayer);
      this.render();
      return true;
    }

    // Compute (but do not seat) the next pairing from a finished game.
    advance(result) {
      let winner, loser;
      if (result.winner === RED) { winner = this.redPlayer; loser = this.blackPlayer; }
      else if (result.winner === BLACK) { winner = this.blackPlayer; loser = this.redPlayer; }
      else {
        // Draw: the sitting champion stays, the challenger drops out.
        const champ = this.stayer || this.redPlayer;
        winner = champ;
        loser = champ === this.redPlayer ? this.blackPlayer : this.redPlayer;
      }

      this.streak = winner === this.stayer ? this.streak + 1 : 1;
      this.stayer = winner;

      this.line.push(loser);              // loser to the back of the line
      const next = this.line.shift();      // bring in the next challenger

      // Colours alternate: the staying player flips colour each game.
      const stayerWasRed = winner === this.redPlayer;
      const stayerNowRed = !stayerWasRed;
      const redName = stayerNowRed ? winner : next;
      const blackName = stayerNowRed ? next : winner;

      this.lastResult = {
        winner, loser, reason: result.reason, draw: !result.winner,
      };
      this.pending = { redName, blackName, challenger: next, champion: winner };
      return this.pending;
    }

    // Seat the pending pairing and start the next game.
    next() {
      if (!this.pending) return;
      this.redPlayer = this.pending.redName;
      this.blackPlayer = this.pending.blackName;
      this.pending = null;
      this.seat(this.redPlayer, this.blackPlayer);
      this.render();
    }

    seat(redName, blackName) {
      this.c.startMatch(redName, blackName, {
        redAI: this.isAI(redName),
        blackAI: this.isAI(blackName),
      });
    }

    onGameOver(result) {
      if (!this.active) return;
      this.advance(result);
      this.render();
    }

    reset() {
      this.active = false;
      this.line = [];
      this.redPlayer = this.blackPlayer = this.stayer = null;
      this.streak = 0;
      this.pending = null;
      this.lastResult = null;
      this.render();
    }

    /* ---------------- UI (skipped without a document) ---------------- */

    el(id) { return typeof document !== "undefined" ? document.getElementById(id) : null; }

    bindUI() {
      const add = this.el("tn-add");
      const name = this.el("tn-name");
      const start = this.el("tn-start");
      const reset = this.el("tn-reset");
      if (!add) return; // no DOM (tests)

      const doAdd = () => { if (this.addPlayer(name.value)) name.value = ""; name.focus(); };
      add.addEventListener("click", doAdd);
      name.addEventListener("keydown", (e) => { if (e.key === "Enter") doAdd(); });
      start.addEventListener("click", () => this.start());
      reset.addEventListener("click", () => this.reset());
      const addAI = this.el("tn-ai");
      if (addAI) addAI.addEventListener("click", () => this.addAI());
    }

    render() {
      const body = this.el("tn-body");
      const start = this.el("tn-start");
      if (!body) return;

      if (start) start.disabled = this.active || this.line.length < 2;
      const addAI = this.el("tn-ai");
      if (addAI) {
        const aiIn = this.line.includes(AI_TOKEN) ||
          this.redPlayer === AI_TOKEN || this.blackPlayer === AI_TOKEN;
        addAI.disabled = aiIn;
      }

      if (!this.active) {
        body.innerHTML = this.line.length
          ? `<div class="tn-sub">In line (${this.line.length}):</div>` +
            `<ol class="tn-queue">${this.line.map((p) => `<li>${esc(p)}</li>`).join("")}</ol>` +
            (this.line.length < 2 ? `<div class="tn-hint">Add at least 2 players, then Start.</div>` : "")
          : `<div class="tn-hint">Add players to start an office ladder.</div>`;
        return;
      }

      const king = this.streak >= 2
        ? `<div class="tn-king">🔥 ${esc(this.stayer)} — ${this.streak} in a row</div>` : "";

      // Between games: show the result and a Start-next button.
      if (this.pending) {
        const r = this.lastResult;
        const verdict = r.draw
          ? `Draw — ${esc(r.champion || this.stayer)} keeps the seat`
          : `${esc(r.winner)} beat ${esc(r.loser)}`;
        body.innerHTML =
          `<div class="tn-result">${verdict}</div>` +
          king +
          `<div class="tn-next">Next: <b class="red">${esc(this.pending.redName)}</b> (Red) ` +
          `vs <b class="black">${esc(this.pending.blackName)}</b> (Black)</div>` +
          `<button id="tn-go" class="btn">Start next match ▶</button>` +
          this.queueHtml();
        const go = this.el("tn-go");
        if (go) go.addEventListener("click", () => this.next());
        return;
      }

      // Game in progress.
      body.innerHTML =
        `<div class="tn-match"><b class="red">${esc(this.redPlayer)}</b> (Red) ` +
        `vs <b class="black">${esc(this.blackPlayer)}</b> (Black)</div>` +
        king +
        this.queueHtml();
    }

    queueHtml() {
      if (!this.line.length) return `<div class="tn-sub">Line is empty — winner & loser rematch.</div>`;
      return `<div class="tn-sub">Up next:</div>` +
        `<ol class="tn-queue">${this.line.map((p) => `<li>${esc(p)}</li>`).join("")}</ol>`;
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  XQ.TournamentManager = TournamentManager;
})(typeof window !== "undefined" ? window : globalThis);
