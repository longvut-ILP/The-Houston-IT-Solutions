/* ============================================================
   CONTROLLER · main.js
   Drives interactive play on top of the Board model:
     - select a piece -> highlight its legal destinations
     - click a destination (or capture ring) -> make the move
     - alternate turns, update status (check / checkmate / stalemate)
     - record moves in ICCS and show captured pieces
   ============================================================ */
(function (global) {
  "use strict";
  const XQ = global.XQ;

  class Controller {
    constructor() {
      this.board = XQ.Board.fromFen(XQ.START_FEN);
      this.tracker = new XQ.RepetitionTracker(this.board);
      this.view = new XQ.BoardView("board-canvas", "piece-layer");
      this.selected = null;     // {file,rank} of selected piece
      this.legal = [];          // legal moves from the selected piece
      this.gameOver = false;

      this.elTurnDot = document.getElementById("turn-dot");
      this.elTurnLabel = document.getElementById("turn-label");
      this.elLog = document.getElementById("move-log");
      this.elCapRed = document.getElementById("captured-red");
      this.elCapBlack = document.getElementById("captured-black");

      // AI controls
      this.elAiToggle = document.getElementById("ai-toggle");
      this.elAiDepth = document.getElementById("ai-depth");
      this.elAiStatus = document.getElementById("ai-status");
      // Either colour can be engine-controlled (human, vs-AI, or AI-vs-AI).
      this.aiRed = false;
      this.aiBlack = !!(this.elAiToggle && this.elAiToggle.checked);
      this.thinking = false;
      this.tournamentMatch = false; // true while the tournament drives the match

      this.ended = false;         // game-over fired guard
      this.redName = null;        // optional player names (tournament)
      this.blackName = null;
      this.onGameOver = null;     // (result) => void hook for the tournament

      // The AI is driven entirely over the UCCI protocol.
      this.ucci = new XQ.UcciEngine();
      this.ucci.onResponse = (line) => this.onUcciResponse(line);
      this.ucci.post("ucci");
      this.ucci.post("isready");

      // Casual "New Game" honours the checkbox (Red human, Black optional AI).
      document.getElementById("btn-new").addEventListener("click", () => {
        this.tournamentMatch = false;
        this.aiRed = false;
        this.aiBlack = this.elAiToggle.checked;
        this.newGame();
      });
      // Toggling the checkbox in a casual game flips Black between human/AI.
      this.elAiToggle.addEventListener("change", () => {
        if (this.tournamentMatch) return; // tournament decides per match
        this.aiRed = false;
        this.aiBlack = this.elAiToggle.checked;
        this.maybeTriggerAI();
      });

      this.view.drawBoard();
      this.refresh();
    }

    // Is the side to move controlled by the engine?
    isAITurn() {
      const t = this.board.turn;
      return (t === XQ.RED && this.aiRed) || (t === XQ.BLACK && this.aiBlack);
    }

    newGame() {
      this.board = XQ.Board.fromFen(XQ.START_FEN);
      this.tracker.reset(this.board);
      this.selected = null;
      this.legal = [];
      this.gameOver = false;
      this.ended = false;
      this.thinking = false;
      this.elLog.innerHTML = "";
      this.elCapRed.innerHTML = "";
      this.elCapBlack.innerHTML = "";
      this.elAiStatus.textContent = "";
      this.refresh();
      this.maybeTriggerAI();   // lets the engine open if it is the Red side
    }

    // Start a named match (tournament). opts.redAI / opts.blackAI mark which
    // side(s) the engine plays, so a match can be human-vs-human,
    // human-vs-computer, or computer-vs-computer.
    startMatch(redName, blackName, opts = {}) {
      this.redName = redName;
      this.blackName = blackName;
      this.tournamentMatch = true;
      this.aiRed = !!opts.redAI;
      this.aiBlack = !!opts.blackAI;
      this.newGame();
    }

    // Single funnel for every game end; fires onGameOver exactly once.
    endGame(result) {
      if (this.ended) return;
      this.ended = true;
      this.gameOver = true;
      this.selected = null;
      this.legal = [];
      this.elTurnLabel.textContent = this.resultLabel(result);
      if (this.onGameOver) this.onGameOver(result);
    }

    resultLabel(result) {
      const nameOf = (s) =>
        s === XQ.RED ? (this.redName || "Red") : (this.blackName || "Black");
      if (!result.winner) return "Draw — repetition";
      const reasons = {
        checkmate: "checkmate",
        stalemate: "no legal moves",
        perpetual_check_by_red: "perpetual check",
        perpetual_check_by_black: "perpetual check",
        perpetual_chase_by_red: "perpetual chase",
        perpetual_chase_by_black: "perpetual chase",
      };
      return `${nameOf(result.winner)} wins — ${reasons[result.reason] || result.reason}`;
    }

    checkSquare() {
      if (!this.board.isInCheck(this.board.turn)) return null;
      const g = this.board.generalOf(this.board.turn);
      return g ? { file: g.file, rank: g.rank } : null;
    }

    refresh() {
      this.view.renderPieces(this.board.pieces, {
        onPieceClick: (p) => this.onPieceClick(p),
        selected: this.selected,
        checkSquare: this.checkSquare(),
      });
      if (this.selected) {
        this.view.renderMarkers(this.legal, this.board, (m) => this.onMove(m));
      }
      this.updateStatus();
    }

    onPieceClick(piece) {
      if (this.gameOver || this.thinking) return;
      if (this.isAITurn()) return; // the engine is on move

      // Clicking an enemy piece that is a legal capture target = make the move.
      if (this.selected && piece.side !== this.board.turn) {
        const cap = this.legal.find(
          (m) => m.to.file === piece.file && m.to.rank === piece.rank
        );
        if (cap) return this.onMove(cap);
      }

      if (piece.side !== this.board.turn) return; // not your turn / enemy piece

      // Toggle selection off if same piece clicked again.
      if (this.selected &&
          this.selected.file === piece.file &&
          this.selected.rank === piece.rank) {
        this.selected = null;
        this.legal = [];
      } else {
        this.selected = { file: piece.file, rank: piece.rank };
        this.legal = this.board.legalMovesFrom(piece.file, piece.rank);
      }
      this.refresh();
    }

    onMove(move) {
      const mover = this.board.at(move.from.file, move.from.rank);
      const captured = this.board.at(move.to.file, move.to.rank);
      const sideThatMoved = this.board.turn;

      this.board.makeMove(move);
      this.tracker.push();
      this.logMove(mover, move, sideThatMoved);
      if (captured) this.addCapture(captured);

      this.selected = null;
      this.legal = [];

      // WXF repetition adjudication takes priority over normal status.
      const rep = this.tracker.adjudicate(3);
      if (rep.over) {
        this.view.renderPieces(this.board.pieces, { checkSquare: this.checkSquare() });
        const winner = rep.result === "red_wins" ? XQ.RED
          : rep.result === "black_wins" ? XQ.BLACK : null;
        this.endGame({ winner, reason: rep.reason });
        return;
      }

      this.refresh();
      if (this.gameOver) return;          // checkmate/stalemate set by updateStatus
      this.maybeTriggerAI();
    }

    // If the side to move is engine-controlled, search and play after a
    // short paint delay (also chains AI-vs-AI through onMove).
    maybeTriggerAI() {
      if (this.gameOver || this.thinking) return;
      if (!this.isAITurn()) return;
      this.thinking = true;
      this.elAiStatus.textContent = "Computer is thinking…";
      // setTimeout lets the browser repaint before the synchronous search.
      setTimeout(() => this.runAI(), 30);
    }

    // Drive the engine over UCCI: hand it the current position as FEN,
    // then ask it to search. The reply arrives in onUcciResponse().
    runAI() {
      const depth = parseInt(this.elAiDepth.value, 10) || 3;
      this.ucci.post(`position fen ${this.board.toFen()}`);
      this.ucci.post(`go depth ${depth} time 4000`);
    }

    // Handle UCCI response lines: stream `info` to the status panel and
    // apply the engine's `bestmove` to the board.
    onUcciResponse(line) {
      if (line.startsWith("info")) {
        const depth = (line.match(/depth (\d+)/) || [])[1];
        const nodes = (line.match(/nodes (\d+)/) || [])[1];
        const ms = (line.match(/time (\d+)/) || [])[1];
        if (depth) {
          this.elAiStatus.textContent =
            `depth ${depth} · ${Number(nodes).toLocaleString()} nodes · ${ms} ms`;
        }
      } else if (line.startsWith("bestmove")) {
        this.thinking = false;
        const mv = line.split(/\s+/)[1];
        const move = XQ.parseIccsMove(mv);
        this.onMove(move);
      } else if (line === "nobestmove") {
        this.thinking = false;
        this.refresh();
      }
    }

    logMove(piece, move, side) {
      const from = XQ.toIccsSquare(move.from.file, move.from.rank);
      const to = XQ.toIccsSquare(move.to.file, move.to.rank);
      const li = document.createElement("li");
      li.textContent = `${piece.glyph}  ${from}${to}`;
      li.classList.add(side === XQ.RED ? "log-red" : "log-black");
      this.elLog.appendChild(li);
      this.elLog.scrollTop = this.elLog.scrollHeight;
    }

    addCapture(piece) {
      const box = piece.side === XQ.RED ? this.elCapRed : this.elCapBlack;
      const span = document.createElement("span");
      span.textContent = piece.glyph;
      span.style.color = piece.side === XQ.RED
        ? "var(--red)" : "var(--black-soft)";
      box.appendChild(span);
    }

    updateStatus() {
      const st = this.board.status();
      const side = this.board.turn;
      const mover = side === XQ.RED ? (this.redName || "Red")
        : (this.blackName || "Black");
      this.elTurnDot.style.background = side === XQ.RED ? "var(--red)" : "var(--black)";

      if (st.over) {
        this.endGame({ winner: st.winner, reason: st.reason });
        return;
      }
      this.elTurnLabel.textContent = st.inCheck
        ? `${mover} to move — in check!`
        : `${mover} to move`;
    }
  }

  function boot() {
    const c = new Controller();
    const tn = XQ.TournamentManager ? new XQ.TournamentManager(c) : null;
    global.game = c;          // for console experimentation
    global.tournament = tn;
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(typeof window !== "undefined" ? window : globalThis);
