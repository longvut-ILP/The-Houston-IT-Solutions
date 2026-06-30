/* ============================================================
   MODEL · repetition.js
   WXF (Asian-rules) repetition adjudication.

   Verdict summary (spec §3):
     • Perpetual CHECK            -> the checking side LOSES.
     • Perpetual CHASE of an
       unprotected enemy piece    -> the chasing side LOSES.
     • Everything else
       (idle, mutual check,
        mutual chase, exchanges)  -> DRAW.

   The tracker records lightweight metadata for every real ply
   (whether it gave check, and which enemy pieces it chased). When a
   position recurs for the Nth time, `adjudicate()` looks at the moves
   inside the repeating cycle and applies the table above.

   This implements the core WXF cases. The full rulebook has fine
   print (false chases, rooted/pinned pieces, advisor/elephant
   exceptions); those refinements are noted where they would attach.
   ============================================================ */
(function (global) {
  "use strict";
  const XQ = global.XQ;

  /* Enemy pieces (non-general) that `mover` attacks and that are
     UNPROTECTED — i.e. if captured, the opponent cannot recapture.
     Returns a Set of piece ids. Computed on the position AFTER the
     mover's move (board.turn is the opponent). */
  function chaseTargets(board) {
    const mover = board.other(board.turn);
    const victimSide = board.turn;
    const targets = new Set();

    // Squares the mover currently attacks.
    const attacked = new Set();
    for (const p of board.pieces) {
      if (p.side !== mover) continue;
      for (const m of p.pseudoLegalMoves(board)) {
        attacked.add(m.file * 100 + m.rank);
      }
    }

    for (const p of board.pieces) {
      if (p.side !== victimSide || p.type === XQ.TYPE.GENERAL) continue;
      if (!attacked.has(p.file * 100 + p.rank)) continue;

      // Is p defended? Remove it, then ask if its own side still
      // attacks the square (a recapture). If not -> unprotected.
      const f = p.file, r = p.rank;
      const idx = board.pieces.indexOf(p);
      board.pieces.splice(idx, 1);
      board.grid[r][f] = null;
      const defended = board.isAttackedBy(victimSide, f, r);
      board.grid[r][f] = p;
      board.pieces.splice(idx, 0, p);

      if (!defended) targets.add(p.id);
    }
    return targets;
  }

  class RepetitionTracker {
    constructor(board) {
      this.board = board;
      this.initialKey = board.zobrist;
      this.entries = []; // { key, side, gaveCheck, chase:Set }
    }

    reset(board) {
      this.board = board;
      this.initialKey = board.zobrist;
      this.entries = [];
    }

    /* Call right AFTER board.makeMove() for a real (non-search) move. */
    push() {
      const b = this.board;
      const side = b.other(b.turn);              // the side that just moved
      const gaveCheck = b.isInCheck(b.turn);     // opponent now in check?
      const chase = chaseTargets(b);
      this.entries.push({ key: b.zobrist, side, gaveCheck, chase });
    }

    pop() { this.entries.pop(); }

    _occurrences(key) {
      let n = (this.initialKey === key) ? 1 : 0;
      for (const e of this.entries) if (e.key === key) n++;
      return n;
    }

    /* Adjudicate the current position. `times` = how many times the
       position must have occurred to trigger (3 = classic three-fold). */
    adjudicate(times = 3) {
      if (this.entries.length === 0) return { over: false };
      const key = this.entries[this.entries.length - 1].key;
      if (this._occurrences(key) < times) return { over: false };

      // Loop = plies since the previous identical position.
      let start = -1;
      for (let i = this.entries.length - 2; i >= 0; i--) {
        if (this.entries[i].key === key) { start = i + 1; break; }
      }
      if (start < 0) start = 0;
      const loop = this.entries.slice(start);

      const verdictFor = (side) => {
        const plies = loop.filter((e) => e.side === side);
        if (plies.length === 0) return { check: false, chase: false };
        const check = plies.every((e) => e.gaveCheck);
        // Persistent chase: some victim chased in EVERY ply of this side.
        let chase = false;
        if (!check && plies[0].chase.size) {
          let common = new Set(plies[0].chase);
          for (let i = 1; i < plies.length; i++) {
            common = new Set([...common].filter((id) => plies[i].chase.has(id)));
          }
          chase = common.size > 0;
        }
        return { check, chase };
      };

      const red = verdictFor(XQ.RED);
      const black = verdictFor(XQ.BLACK);

      // Perpetual-check prohibition ranks above chase.
      if (red.check && !black.check)
        return { over: true, result: "black_wins", reason: "perpetual_check_by_red" };
      if (black.check && !red.check)
        return { over: true, result: "red_wins", reason: "perpetual_check_by_black" };

      // Perpetual chase of an unprotected piece (only side doing it loses).
      if (red.chase && !black.chase && !black.check)
        return { over: true, result: "black_wins", reason: "perpetual_chase_by_red" };
      if (black.chase && !red.chase && !red.check)
        return { over: true, result: "red_wins", reason: "perpetual_chase_by_black" };

      // Mutual check, mutual chase, idle, exchanges, etc.
      return { over: true, result: "draw", reason: "repetition_draw" };
    }
  }

  XQ.chaseTargets = chaseTargets;
  XQ.RepetitionTracker = RepetitionTracker;
})(typeof window !== "undefined" ? window : globalThis);
