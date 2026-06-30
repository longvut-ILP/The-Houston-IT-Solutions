/* ============================================================
   MODEL · game.js
   The board state machine: position, move generation, make/undo,
   check & flying-general detection, legal-move filtering, and
   end-of-game status (checkmate / stalemate).

   Coordinate convention (see constants.js):
     file 0..8 left->right, rank 0..9 top(black)->bottom(red).

   A "move" object is: { from:{file,rank}, to:{file,rank} }.
   Internally we also carry the moving piece and any captured piece.
   ============================================================ */
(function (global) {
  "use strict";
  const XQ = global.XQ;

  class Board {
    constructor() {
      this.grid = Array.from({ length: XQ.RANKS }, () =>
        new Array(XQ.FILES).fill(null));
      this.pieces = [];          // live pieces
      this.turn = XQ.RED;
      this.history = [];         // undo records
      this.fullmove = 1;
      this.zobrist = 0n;         // running Zobrist key (BigInt)
      this.positionKeys = [];    // keys reached, for repetition counting
    }

    // (Re)compute the running hash from scratch and seed positionKeys.
    initHash() {
      this.zobrist = XQ.Zobrist.compute(this);
      this.positionKeys = [this.zobrist];
      return this;
    }

    // How many times the current position's key has occurred so far.
    repetitionCount() {
      const k = this.zobrist;
      let n = 0;
      for (const key of this.positionKeys) if (key === k) n++;
      return n;
    }
    isRepetition(times = 3) { return this.repetitionCount() >= times; }

    /* ---------- Accessors ---------- */
    at(f, r) { return XQ.inBounds(f, r) ? this.grid[r][f] : null; }
    isEmpty(f, r) { return this.at(f, r) === null; }
    isEnemy(piece, f, r) {
      const p = this.at(f, r);
      return p !== null && p.side !== piece.side;
    }
    place(piece) {
      this.grid[piece.rank][piece.file] = piece;
      this.pieces.push(piece);
    }
    other(side) { return side === XQ.RED ? XQ.BLACK : XQ.RED; }
    generalOf(side) {
      return this.pieces.find(
        (p) => p.type === XQ.TYPE.GENERAL && p.side === side
      );
    }

    /* ---------- FEN ---------- */
    static fromFen(fen) {
      const board = new Board();
      const parts = fen.split(/\s+/);
      const rows = parts[0].split("/");
      for (let r = 0; r < rows.length; r++) {
        let f = 0;
        for (const ch of rows[r]) {
          if (/\d/.test(ch)) { f += +ch; continue; }
          const side = ch === ch.toUpperCase() ? XQ.RED : XQ.BLACK;
          const type = XQ.FEN_TO_TYPE[ch.toLowerCase()];
          board.place(XQ.createPiece(side, type, f, r));
          f++;
        }
      }
      board.turn = parts[1] === "b" ? XQ.BLACK : XQ.RED;
      board.fullmove = parts[5] ? +parts[5] : 1;
      board.initHash();
      return board;
    }

    toFen() {
      const rows = [];
      for (let r = 0; r < XQ.RANKS; r++) {
        let row = "", empty = 0;
        for (let f = 0; f < XQ.FILES; f++) {
          const p = this.grid[r][f];
          if (!p) { empty++; continue; }
          if (empty) { row += empty; empty = 0; }
          const letter = XQ.TYPE_TO_FEN[p.type];
          row += p.side === XQ.RED ? letter.toUpperCase() : letter;
        }
        if (empty) row += empty;
        rows.push(row);
      }
      return `${rows.join("/")} ${this.turn} - - 0 ${this.fullmove}`;
    }

    /* ---------- Move generation ---------- */
    // All pseudo-legal moves for a side (no self-check filtering).
    pseudoLegalMoves(side = this.turn) {
      const out = [];
      for (const p of this.pieces) {
        if (p.side !== side) continue;
        for (const dst of p.pseudoLegalMoves(this)) {
          out.push({
            from: { file: p.file, rank: p.rank },
            to: { file: dst.file, rank: dst.rank },
          });
        }
      }
      return out;
    }

    /* ---------- Attack / check detection ---------- */
    // Is square (f,r) attacked by any piece of `bySide`?
    // Uses each piece's own move rules, so cannon-screens and
    // horse-leg blocks are respected automatically.
    isAttackedBy(bySide, f, r) {
      for (const p of this.pieces) {
        if (p.side !== bySide) continue;
        const moves = p.pseudoLegalMoves(this);
        for (const m of moves) if (m.file === f && m.rank === r) return true;
      }
      return false;
    }

    // Two generals on the same file with nothing between = illegal face-off.
    generalsFacing() {
      const rg = this.generalOf(XQ.RED);
      const bg = this.generalOf(XQ.BLACK);
      if (!rg || !bg || rg.file !== bg.file) return false;
      const lo = Math.min(rg.rank, bg.rank) + 1;
      const hi = Math.max(rg.rank, bg.rank);
      for (let r = lo; r < hi; r++) if (this.grid[r][rg.file]) return false;
      return true;
    }

    isInCheck(side = this.turn) {
      const gen = this.generalOf(side);
      if (!gen) return true; // general captured == lost
      if (this.generalsFacing()) return true;
      return this.isAttackedBy(this.other(side), gen.file, gen.rank);
    }

    /* ---------- Make / Undo ---------- */
    makeMove(move) {
      const piece = this.at(move.from.file, move.from.rank);
      const captured = this.at(move.to.file, move.to.rank);
      const Z = XQ.Zobrist;

      const undo = {
        move,
        piece,
        captured,
        fromF: piece.file,
        fromR: piece.rank,
        turn: this.turn,
        fullmove: this.fullmove,
        prevZobrist: this.zobrist,
      };

      // Incremental Zobrist: out of origin, out captured, into destination.
      this.zobrist ^= Z.pieceKey(piece.side, piece.type, piece.file, piece.rank);
      if (captured) {
        this.zobrist ^= Z.pieceKey(captured.side, captured.type, captured.file, captured.rank);
        const i = this.pieces.indexOf(captured);
        if (i >= 0) this.pieces.splice(i, 1);
      }
      this.grid[piece.rank][piece.file] = null;
      piece.file = move.to.file;
      piece.rank = move.to.rank;
      this.grid[piece.rank][piece.file] = piece;
      this.zobrist ^= Z.pieceKey(piece.side, piece.type, piece.file, piece.rank);
      this.zobrist ^= Z.sideKey; // toggle side to move

      if (this.turn === XQ.BLACK) this.fullmove++;
      this.turn = this.other(this.turn);
      this.history.push(undo);
      this.positionKeys.push(this.zobrist);
      return undo;
    }

    undoMove() {
      const undo = this.history.pop();
      if (!undo) return;
      const { piece, captured, fromF, fromR } = undo;
      this.grid[piece.rank][piece.file] = null;
      piece.file = fromF;
      piece.rank = fromR;
      this.grid[fromR][fromF] = piece;
      if (captured) {
        this.grid[captured.rank][captured.file] = captured;
        this.pieces.push(captured);
      }
      this.turn = undo.turn;
      this.fullmove = undo.fullmove;
      this.zobrist = undo.prevZobrist;
      this.positionKeys.pop();
      return undo;
    }

    /* ---------- Legal moves (self-check filtered) ---------- */
    legalMoves(side = this.turn) {
      const legal = [];
      for (const move of this.pseudoLegalMoves(side)) {
        this.makeMove(move);
        const illegal = this.isInCheck(side); // own general must be safe
        this.undoMove();
        if (!illegal) legal.push(move);
      }
      return legal;
    }

    // Legal destinations for the piece on (f,r), for UI highlighting.
    legalMovesFrom(f, r) {
      const piece = this.at(f, r);
      if (!piece || piece.side !== this.turn) return [];
      return this.legalMoves(this.turn).filter(
        (m) => m.from.file === f && m.from.rank === r
      );
    }

    /* ---------- Status ---------- */
    // In Xiangqi, having no legal move (whether in check or not) is a LOSS
    // for the side to move. There is no draw-by-stalemate.
    status() {
      const side = this.turn;
      const hasMove = this.legalMoves(side).length > 0;
      const inCheck = this.isInCheck(side);
      if (!hasMove) {
        const winner = this.other(side);
        return {
          over: true,
          winner,
          reason: inCheck ? "checkmate" : "stalemate",
          inCheck,
        };
      }
      return { over: false, winner: null, reason: inCheck ? "check" : "normal", inCheck };
    }
  }

  XQ.Board = Board;
})(typeof window !== "undefined" ? window : globalThis);
