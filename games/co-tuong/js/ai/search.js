/* ============================================================
   AI · search.js
   Minimax with alpha-beta pruning (negamax form).

   Design (spec §4):
     • Negamax: every node is scored from the side-to-move's view,
       so one routine serves both colours.
     • Alpha-beta pruning cuts branches that cannot affect the result.
     • Staged move ordering: captures first, ranked by MVV-LVA
       (Most Valuable Victim − Least Valuable Attacker), then quiet
       moves — this maximises beta cut-offs.
     • Quiescence search extends capture sequences past the horizon so
       the engine doesn't stop in the middle of a trade.
     • Mate / stalemate score a loss for the side to move (Xiangqi has
       no draw by stalemate). Repetition inside the line scores 0.
     • Iterative deepening with an optional time budget returns the
       best move found at the deepest fully-searched depth.

   Consumes the static evaluator in evaluate.js (Red-positive); the
   search converts it to a side-to-move-relative score.
   ============================================================ */
(function (global) {
  "use strict";
  const XQ = global.XQ;

  const MATE = 100000;          // base mate score
  const INF = 1e9;

  // Side-to-move-relative static score.
  function relEval(board) {
    const s = XQ.evaluate(board.pieces);
    return board.turn === XQ.RED ? s : -s;
  }

  // Ordered pseudo-legal moves: captures (MVV-LVA) first, then quiet.
  function orderedMoves(board, side) {
    const moves = board.pseudoLegalMoves(side);
    for (const m of moves) {
      const victim = board.at(m.to.file, m.to.rank);
      if (victim) {
        const attacker = board.at(m.from.file, m.from.rank);
        m.order = 1e6 + XQ.mvvLva(attacker, victim); // captures dominate
        m.capture = true;
      } else {
        m.order = 0;
        m.capture = false;
      }
    }
    moves.sort((a, b) => b.order - a.order);
    return moves;
  }

  class Search {
    constructor() { this.nodes = 0; this.stop = false; this.deadline = Infinity; }

    // Quiescence: only resolve captures (or all evasions when in check).
    quiesce(board, alpha, beta, ply) {
      this.nodes++;
      const side = board.turn;
      const inCheck = board.isInCheck(side);

      let standPat = relEval(board);
      if (!inCheck) {
        if (standPat >= beta) return beta;
        if (standPat > alpha) alpha = standPat;
      }

      const moves = orderedMoves(board, side);
      let anyLegal = false;
      for (const m of moves) {
        if (!inCheck && !m.capture) continue; // quiescence: captures only
        board.makeMove(m);
        if (board.isInCheck(side)) { board.undoMove(); continue; } // illegal
        anyLegal = true;
        const score = -this.quiesce(board, -beta, -alpha, ply + 1);
        board.undoMove();
        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
      }
      // If in check and no legal move existed, it's mate.
      if (inCheck && !anyLegal) return -MATE + ply;
      return alpha;
    }

    negamax(board, depth, alpha, beta, ply) {
      this.nodes++;
      if (this.nodes % 4096 === 0 && Date.now() > this.deadline) this.stop = true;
      if (this.stop) return relEval(board);

      // Draw by repetition inside the search line.
      if (ply > 0 && board.repetitionCount() >= 2) return 0;

      if (depth <= 0) return this.quiesce(board, alpha, beta, ply);

      const side = board.turn;
      const moves = orderedMoves(board, side);
      let best = -INF;
      let anyLegal = false;

      for (const m of moves) {
        board.makeMove(m);
        if (board.isInCheck(side)) { board.undoMove(); continue; } // illegal
        anyLegal = true;
        const score = -this.negamax(board, depth - 1, -beta, -alpha, ply + 1);
        board.undoMove();
        if (this.stop) return best > -INF ? best : relEval(board);

        if (score > best) best = score;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break; // beta cut-off
      }

      // No legal move -> loss for the side to move (mate or stalemate).
      if (!anyLegal) return -MATE + ply;
      return best;
    }

    // Root: returns {move, score, nodes, depth} for the side to move.
    searchRoot(board, depth) {
      const side = board.turn;
      const moves = orderedMoves(board, side);
      let best = null, bestScore = -INF;
      let alpha = -INF, beta = INF;

      for (const m of moves) {
        board.makeMove(m);
        if (board.isInCheck(side)) { board.undoMove(); continue; }
        const score = -this.negamax(board, depth - 1, -beta, -alpha, 1);
        board.undoMove();
        if (this.stop) break;
        if (score > bestScore) { bestScore = score; best = m; }
        if (bestScore > alpha) alpha = bestScore;
      }
      return { move: best, score: bestScore, nodes: this.nodes, depth };
    }
  }

  /* Public API. opts: { depth=4, timeLimitMs } with iterative deepening. */
  XQ.AI = {
    search(board, opts = {}) {
      const maxDepth = opts.depth || 4;
      const timeLimit = opts.timeLimitMs || 0;
      const start = Date.now();
      let result = { move: null, score: 0, nodes: 0, depth: 0 };

      for (let d = 1; d <= maxDepth; d++) {
        const s = new Search();
        s.deadline = timeLimit ? start + timeLimit : Infinity;
        const r = s.searchRoot(board, d);
        if (s.stop && d > 1) { result.nodes += r.nodes; break; }
        result = { ...r, nodes: (result.nodes || 0) + r.nodes };
        // Report this depth to any listener (used for UCCI info lines).
        if (opts.onInfo && r.move) {
          opts.onInfo({
            depth: d,
            score: r.score,
            nodes: result.nodes,
            timeMs: Date.now() - start,
            move: r.move,
          });
        }
        // Stop early if a forced mate is already found.
        if (Math.abs(r.score) > MATE - 1000) break;
        if (timeLimit && Date.now() - start > timeLimit) break;
      }
      return result;
    },
    _Search: Search,
    _orderedMoves: orderedMoves,
    MATE,
  };
})(typeof window !== "undefined" ? window : globalThis);
