/* ============================================================
   MODEL · zobrist.js
   Zobrist hashing for fast, incrementally-updated position keys.

   A position's key is the XOR of one random 64-bit number per
   (side, piece-type, square), plus a side-to-move key when it is
   Black's turn. Because XOR is its own inverse, a move updates the
   key in O(1): XOR the moving piece out of its origin, XOR any
   captured piece out, XOR the moving piece into its destination,
   and toggle the side key.

   Keys are generated from a fixed seed so they are identical on
   every page load — essential for comparing/serialising positions.
   ============================================================ */
(function (global) {
  "use strict";
  const XQ = global.XQ;

  // Deterministic 32-bit PRNG (mulberry32) for reproducible keys.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0);
    };
  }

  function rand64(rng) {
    const hi = BigInt(rng());
    const lo = BigInt(rng());
    return ((hi << 32n) | lo) & 0xffffffffffffffffn;
  }

  const SIDES = [XQ.RED, XQ.BLACK];
  const TYPES = ["K", "A", "E", "H", "R", "C", "S"];

  const Zobrist = {
    // table[side][type][square] -> BigInt
    table: {},
    sideKey: 0n, // XORed in when it is Black to move
    squares: XQ.FILES * XQ.RANKS,

    index(file, rank) { return rank * XQ.FILES + file; },

    init(seed = 0x9e3779b9) {
      const rng = mulberry32(seed);
      for (const s of SIDES) {
        this.table[s] = {};
        for (const t of TYPES) {
          const arr = new Array(this.squares);
          for (let i = 0; i < this.squares; i++) arr[i] = rand64(rng);
          this.table[s][t] = arr;
        }
      }
      this.sideKey = rand64(rng);
      return this;
    },

    // Key contribution of one piece on a square.
    pieceKey(side, type, file, rank) {
      return this.table[side][type][this.index(file, rank)];
    },

    // Full key for a board (used to (re)initialise the running hash).
    compute(board) {
      let key = 0n;
      for (const p of board.pieces) {
        key ^= this.pieceKey(p.side, p.type, p.file, p.rank);
      }
      if (board.turn === XQ.BLACK) key ^= this.sideKey;
      return key;
    },
  };

  Zobrist.init();
  XQ.Zobrist = Zobrist;
})(typeof window !== "undefined" ? window : globalThis);
