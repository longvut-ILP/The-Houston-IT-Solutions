/* ============================================================
   AI · evaluate.js
   Static evaluation of a board state from Red's perspective.
   Positive = good for Red, negative = good for Black.

   This milestone provides the baseline material evaluator plus the
   General "out of home" penalty (spec §4). The minimax / alpha-beta
   search and MVV-LVA move ordering will consume this in a later step.
   ============================================================ */
(function (global) {
  "use strict";
  const XQ = global.XQ;

  // Safest starting squares for the General (file 4, back-rank center).
  const HOME = { r: { file: 4, rank: 9 }, b: { file: 4, rank: 0 } };

  /* pieces: array of live Piece objects on the board. */
  XQ.evaluate = function evaluate(pieces) {
    let score = 0;
    for (const p of pieces) {
      const sign = p.side === XQ.RED ? 1 : -1;
      let v = XQ.WEIGHTS[p.type];

      if (p.type === XQ.TYPE.GENERAL) {
        const home = HOME[p.side];
        if (p.file !== home.file || p.rank !== home.rank) {
          v -= XQ.GENERAL_HOME_PENALTY; // discourage early exposure
        }
      }
      score += sign * v;
    }
    return score;
  };

  /* MVV-LVA ordering score for capture-first search:
     prize the most valuable victim, prefer the least valuable attacker. */
  XQ.mvvLva = function mvvLva(attacker, victim) {
    if (!victim) return 0;
    return XQ.MVV[victim.type] * 10 - XQ.MVV[attacker.type];
  };

  XQ.GENERAL_HOME = HOME;
})(typeof window !== "undefined" ? window : globalThis);
