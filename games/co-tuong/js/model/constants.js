/* ============================================================
   MODEL · constants.js
   Piece types, Traditional Chinese glyphs, evaluation weights,
   board geometry and the standard opening position (Xiangqi FEN).
   Loaded as a global namespace `XQ` (no modules, plain ES6).
   ============================================================ */
(function (global) {
  "use strict";

  const XQ = global.XQ || (global.XQ = {});

  /* --- Sides --- */
  XQ.RED = "r";
  XQ.BLACK = "b";

  /* --- Board geometry ---
     Files (columns) are 0..8, left->right.
     Ranks (rows)    are 0..9, top->bottom (rank 0 is Black's back row).
     ICCS files are labelled a..i; ICCS ranks 0..9 from Red's side (bottom). */
  XQ.FILES = 9;
  XQ.RANKS = 10;
  XQ.RIVER_TOP = 4;     // last rank on Black's half
  XQ.RIVER_BOTTOM = 5;  // first rank on Red's half

  /* --- Piece type keys --- */
  XQ.TYPE = {
    GENERAL: "K", // 將/帥
    ADVISOR: "A", // 士/仕
    ELEPHANT: "E", // 象/相
    HORSE: "H",   // 馬/傌
    CHARIOT: "R", // 車/俥
    CANNON: "C",  // 砲/炮
    SOLDIER: "S", // 卒/兵
  };

  /* --- Traditional Chinese glyphs, by side --- */
  XQ.GLYPH = {
    r: { K: "帥", A: "仕", E: "相", H: "傌", R: "俥", C: "炮", S: "兵" },
    b: { K: "將", A: "士", E: "象", H: "馬", R: "車", C: "砲", S: "卒" },
  };

  /* --- Evaluation baseline weights (spec §4) --- */
  XQ.WEIGHTS = {
    K: 900, // General
    R: 90,  // Chariot / Rook
    C: 45,  // Cannon
    H: 40,  // Horse / Knight
    A: 20,  // Advisor
    E: 20,  // Elephant
    S: 15,  // Soldier / Pawn
  };

  /* Penalty applied when the General leaves its safest home square,
     used by the evaluation function to discourage early exposure. */
  XQ.GENERAL_HOME_PENALTY = 12;

  /* --- MVVA piece ordering value (for capture-first search) --- */
  XQ.MVV = { K: 6, R: 5, C: 4, H: 3, A: 2, E: 2, S: 1 };

  /* --- FEN mapping ---
     Lowercase = black, uppercase = red, using standard Xiangqi letters:
     k a/b? -> we use: K=king, A=advisor, E=elephant(b), H=horse(n),
     R=rook, C=cannon, S=soldier(p). We translate the conventional
     WXF FEN letters (r n b a k c p) into our TYPE keys on load. */
  XQ.FEN_TO_TYPE = {
    k: "K", a: "A", b: "E", n: "H", r: "R", c: "C", p: "S",
  };
  XQ.TYPE_TO_FEN = {
    K: "k", A: "a", E: "b", H: "n", R: "r", C: "c", S: "p",
  };

  /* Standard opening position in Xiangqi FEN (Black on top, Red to move). */
  XQ.START_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";

  /* --- ICCS coordinate helpers ---
     ICCS file letters a..i map to internal file index 0..8.
     ICCS rank digit 0..9 is measured from Red's side (bottom = 0),
     so internal rank = 9 - iccsRank. */
  XQ.fileToLetter = (f) => "abcdefghi"[f];
  XQ.letterToFile = (ch) => "abcdefghi".indexOf(ch);
  XQ.rankToIccs = (r) => 9 - r;     // internal rank -> ICCS digit
  XQ.iccsToRank = (d) => 9 - d;     // ICCS digit -> internal rank

  /* Convert internal {file,rank} to an ICCS square string, e.g. "h2". */
  XQ.toIccsSquare = (file, rank) =>
    XQ.fileToLetter(file) + XQ.rankToIccs(rank);

  /* Convert a 4-char ICCS move "h2e2" to {from:{file,rank}, to:{file,rank}}. */
  XQ.parseIccsMove = (mv) => ({
    from: { file: XQ.letterToFile(mv[0]), rank: XQ.iccsToRank(+mv[1]) },
    to: { file: XQ.letterToFile(mv[2]), rank: XQ.iccsToRank(+mv[3]) },
  });

  XQ.inBounds = (f, r) => f >= 0 && f < XQ.FILES && r >= 0 && r < XQ.RANKS;

  /* Palace columns are files 3..5; palace ranks are 0..2 (black) and 7..9 (red). */
  XQ.inPalace = (side, f, r) => {
    if (f < 3 || f > 5) return false;
    return side === XQ.BLACK ? r <= 2 : r >= 7;
  };

  /* True if (f,r) is on `side`'s own half of the river. */
  XQ.ownHalf = (side, r) =>
    side === XQ.BLACK ? r <= XQ.RIVER_TOP : r >= XQ.RIVER_BOTTOM;

})(typeof window !== "undefined" ? window : globalThis);
