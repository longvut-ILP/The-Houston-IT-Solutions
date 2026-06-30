/* ============================================================
   MODEL · pieces.js
   Piece base class + one subclass per piece type.
   Each subclass implements pseudoLegalMoves(board) returning the
   list of {file,rank} destinations allowed by that piece's movement
   rules (spec §3). Check/general-facing legality is resolved later
   by the board model, not here.

   `board` is expected to expose:
     board.at(file, rank)        -> Piece | null
     board.isEnemy(piece, f, r)  -> bool  (square holds an opponent)
     board.isEmpty(f, r)         -> bool
   ============================================================ */
(function (global) {
  "use strict";
  const XQ = global.XQ;

  /* ---------- Base ---------- */
  class Piece {
    constructor(side, type, file, rank) {
      this.side = side;          // XQ.RED | XQ.BLACK
      this.type = type;          // XQ.TYPE.*
      this.file = file;
      this.rank = rank;
      this.id = `${side}${type}_${file}${rank}`;
    }
    get glyph() { return XQ.GLYPH[this.side][this.type]; }
    get value() { return XQ.WEIGHTS[this.type]; }
    get forward() { return this.side === XQ.RED ? -1 : +1; } // Red moves up (rank--)

    isEnemy(p) { return p && p.side !== this.side; }
    isFriend(p) { return p && p.side === this.side; }

    /* Override in subclasses. Returns array of {file,rank}. */
    pseudoLegalMoves(_board) { return []; }

    /* Helper: add target if empty or enemy-occupied. */
    _tryAdd(board, out, f, r) {
      if (!XQ.inBounds(f, r)) return;
      const occ = board.at(f, r);
      if (!occ || this.isEnemy(occ)) out.push({ file: f, rank: r });
    }
  }

  /* ---------- General / King (帥 將) ---------- */
  class General extends Piece {
    pseudoLegalMoves(board) {
      const out = [];
      const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [df, dr] of steps) {
        const f = this.file + df, r = this.rank + dr;
        if (XQ.inPalace(this.side, f, r)) this._tryAdd(board, out, f, r);
      }
      // "Flying general": may capture the enemy General down an open file.
      const dir = this.forward;
      let r = this.rank + dir;
      while (XQ.inBounds(this.file, r)) {
        const occ = board.at(this.file, r);
        if (occ) {
          if (occ.type === XQ.TYPE.GENERAL && occ.side !== this.side)
            out.push({ file: this.file, rank: r });
          break;
        }
        r += dir;
      }
      return out;
    }
  }

  /* ---------- Advisor (仕 士) — diagonal, in palace ---------- */
  class Advisor extends Piece {
    pseudoLegalMoves(board) {
      const out = [];
      for (const [df, dr] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const f = this.file + df, r = this.rank + dr;
        if (XQ.inPalace(this.side, f, r)) this._tryAdd(board, out, f, r);
      }
      return out;
    }
  }

  /* ---------- Elephant (相 象) — 2-step diagonal, no river, blockable ---------- */
  class Elephant extends Piece {
    pseudoLegalMoves(board) {
      const out = [];
      for (const [df, dr] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
        const f = this.file + df, r = this.rank + dr;
        if (!XQ.inBounds(f, r)) continue;
        if (!XQ.ownHalf(this.side, r)) continue;          // cannot cross river
        const eyeF = this.file + df / 2, eyeR = this.rank + dr / 2;
        if (board.at(eyeF, eyeR)) continue;               // "elephant's eye" blocked
        this._tryAdd(board, out, f, r);
      }
      return out;
    }
  }

  /* ---------- Horse / Knight (傌 馬) — L-shape, leg-blockable ---------- */
  class Horse extends Piece {
    pseudoLegalMoves(board) {
      const out = [];
      // [legF, legR, destF, destR]
      const moves = [
        [0, -1, -1, -2], [0, -1, 1, -2],   // up
        [0, 1, -1, 2], [0, 1, 1, 2],       // down
        [-1, 0, -2, -1], [-1, 0, -2, 1],   // left
        [1, 0, 2, -1], [1, 0, 2, 1],       // right
      ];
      for (const [lf, lr, df, dr] of moves) {
        if (board.at(this.file + lf, this.rank + lr)) continue; // hobbled leg
        this._tryAdd(board, out, this.file + df, this.rank + dr);
      }
      return out;
    }
  }

  /* ---------- Chariot / Rook (俥 車) — straight slider ---------- */
  class Chariot extends Piece {
    pseudoLegalMoves(board) {
      const out = [];
      for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let f = this.file + df, r = this.rank + dr;
        while (XQ.inBounds(f, r)) {
          const occ = board.at(f, r);
          if (!occ) { out.push({ file: f, rank: r }); }
          else { if (this.isEnemy(occ)) out.push({ file: f, rank: r }); break; }
          f += df; r += dr;
        }
      }
      return out;
    }
  }

  /* ---------- Cannon (炮 砲) — slides like rook, leaps one to capture ---------- */
  class Cannon extends Piece {
    pseudoLegalMoves(board) {
      const out = [];
      for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let f = this.file + df, r = this.rank + dr;
        let jumped = false;
        while (XQ.inBounds(f, r)) {
          const occ = board.at(f, r);
          if (!jumped) {
            if (!occ) out.push({ file: f, rank: r });       // quiet slide
            else jumped = true;                              // found the screen
          } else if (occ) {
            if (this.isEnemy(occ)) out.push({ file: f, rank: r }); // capture
            break;
          }
          f += df; r += dr;
        }
      }
      return out;
    }
  }

  /* ---------- Soldier / Pawn (兵 卒) — forward; sideways after river ---------- */
  class Soldier extends Piece {
    pseudoLegalMoves(board) {
      const out = [];
      this._tryAdd(board, out, this.file, this.rank + this.forward); // forward
      if (!XQ.ownHalf(this.side, this.rank)) {                       // crossed river
        this._tryAdd(board, out, this.file - 1, this.rank);
        this._tryAdd(board, out, this.file + 1, this.rank);
      }
      return out;
    }
  }

  /* ---------- Factory ---------- */
  const CLASS_BY_TYPE = {
    K: General, A: Advisor, E: Elephant,
    H: Horse, R: Chariot, C: Cannon, S: Soldier,
  };
  XQ.createPiece = (side, type, file, rank) =>
    new CLASS_BY_TYPE[type](side, type, file, rank);

  XQ.Piece = Piece;
  XQ.pieceClasses = { General, Advisor, Elephant, Horse, Chariot, Cannon, Soldier };

})(typeof window !== "undefined" ? window : globalThis);
