/* ============================================================
   AI · ucci.js
   UCCI (Universal Chinese Chess Interface) engine adapter.

   UCCI is a text protocol (a Xiangqi cousin of UCI): the interface
   sends command lines, the engine replies with response lines. This
   adapter is an in-process message bus — `post(line)` feeds a command
   and replies arrive through the `onResponse(line)` callback — so the
   GUI and engine stay fully decoupled, exactly as the spec requires.

   Supported commands (interface -> engine):
     ucci                         -> id lines + ucciok
     isready                      -> readyok
     setoption <name> <value>     -> (accepted)
     position startpos [moves ..] -> set up the start position
     position fen <FEN> [moves ..]-> set up an arbitrary position
     go depth <n> | time <ms> | nodes <n>
                                  -> info lines + bestmove <mv>
     stop                         -> bestmove from the search so far
     quit                         -> bye

   Moves use ICCS coordinate notation, e.g. "h2e2" (file h rank 2 ->
   file e rank 2), matching XQ.parseIccsMove.
   ============================================================ */
(function (global) {
  "use strict";
  const XQ = global.XQ;

  class UcciEngine {
    constructor() {
      this.board = XQ.Board.fromFen(XQ.START_FEN);
      this.onResponse = null;       // (line:string) => void
      this.pending = null;          // result of the latest go (for stop)
      this.name = "CoTuong-JS";
      this.version = "1.0";
    }

    _emit(line) { if (this.onResponse) this.onResponse(line); }

    // Feed one UCCI command line. Most replies are synchronous; `go`
    // schedules the search so the host UI can repaint first.
    post(line) {
      const tokens = line.trim().split(/\s+/);
      const cmd = tokens[0];
      switch (cmd) {
        case "ucci":      return this._ucci();
        case "isready":   return this._emit("readyok");
        case "setoption": return; // options accepted, no state needed
        case "position":  return this._position(tokens);
        case "go":        return this._go(tokens);
        case "stop":      return this._stop();
        case "quit":      return this._emit("bye");
        default:          return; // unknown commands are ignored, per spec
      }
    }

    _ucci() {
      this._emit(`id name ${this.name} ${this.version}`);
      this._emit("id author Co Tuong project");
      this._emit("option usemillisec type check default true");
      this._emit("option depth type spin default 4 min 1 max 8");
      this._emit("ucciok");
    }

    // position startpos|fen <...> [moves m1 m2 ...]
    _position(tokens) {
      let i = 1;
      if (tokens[i] === "startpos") {
        this.board = XQ.Board.fromFen(XQ.START_FEN);
        i++;
      } else if (tokens[i] === "fen") {
        // FEN occupies the next fields up to "moves" (or end of line).
        const movesAt = tokens.indexOf("moves");
        const end = movesAt === -1 ? tokens.length : movesAt;
        const fen = tokens.slice(i + 1, end).join(" ");
        this.board = XQ.Board.fromFen(fen);
        i = end;
      }
      if (tokens[i] === "moves") {
        for (const mv of tokens.slice(i + 1)) this._applyMove(mv);
      }
    }

    // Apply an ICCS move string if it is legal in the current position.
    _applyMove(mv) {
      const parsed = XQ.parseIccsMove(mv);
      const legal = this.board.legalMoves(this.board.turn).find(
        (m) =>
          m.from.file === parsed.from.file && m.from.rank === parsed.from.rank &&
          m.to.file === parsed.to.file && m.to.rank === parsed.to.rank
      );
      if (legal) this.board.makeMove(legal);
    }

    // go depth <n> | time <ms> | nodes <n>
    _go(tokens) {
      const opts = { depth: 4 };
      for (let i = 1; i < tokens.length; i++) {
        const v = parseInt(tokens[i + 1], 10);
        if (tokens[i] === "depth") { opts.depth = v; i++; }
        else if (tokens[i] === "time") { opts.timeLimitMs = v; i++; }
        else if (tokens[i] === "nodes") { opts.nodeLimit = v; i++; }
      }
      opts.onInfo = (info) => this._emit(this._formatInfo(info));

      // Run asynchronously so a host UI repaints before the blocking search.
      const run = () => {
        const result = XQ.AI.search(this.board, opts);
        this.pending = result;
        this._emit(result.move
          ? `bestmove ${this._iccs(result.move)}`
          : "nobestmove");
      };
      if (typeof setTimeout === "function") setTimeout(run, 0);
      else run();
    }

    _stop() {
      // Our search is synchronous; report the last completed result.
      if (this.pending && this.pending.move)
        this._emit(`bestmove ${this._iccs(this.pending.move)}`);
      else this._emit("nobestmove");
    }

    _formatInfo(info) {
      const mateish = Math.abs(info.score) > XQ.AI.MATE - 1000;
      const scoreField = mateish
        ? `score mate ${info.score > 0 ? "" : "-"}${XQ.AI.MATE - Math.abs(info.score)}`
        : `score ${info.score}`;
      return `info depth ${info.depth} ${scoreField} ` +
        `nodes ${info.nodes} time ${info.timeMs} pv ${this._iccs(info.move)}`;
    }

    _iccs(move) {
      return XQ.toIccsSquare(move.from.file, move.from.rank) +
        XQ.toIccsSquare(move.to.file, move.to.rank);
    }
  }

  XQ.UcciEngine = UcciEngine;
})(typeof window !== "undefined" ? window : globalThis);
