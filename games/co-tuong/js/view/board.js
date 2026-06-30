/* ============================================================
   VIEW · board.js
   Draws the 9x10 grid, river and two palaces on the canvas, and
   renders Piece objects as positioned DOM elements over it.
   Pure rendering — no game rules live here.
   ============================================================ */
(function (global) {
  "use strict";
  const XQ = global.XQ;

  function readGeom() {
    const cs = getComputedStyle(document.documentElement);
    const px = (v) => parseFloat(cs.getPropertyValue(v));
    return { cell: px("--cell"), margin: px("--margin") };
  }

  class BoardView {
    constructor(canvasId, layerId) {
      this.canvas = document.getElementById(canvasId);
      this.layer = document.getElementById(layerId);
      this.ctx = this.canvas.getContext("2d");
      this.geom = readGeom();
      this._sizeCanvas();
    }

    _sizeCanvas() {
      const { cell, margin } = this.geom;
      const w = 8 * cell + 2 * margin;
      const h = 9 * cell + 2 * margin;
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.w = w; this.h = h;
    }

    // Internal (file,rank) -> pixel center.
    xy(file, rank) {
      const { cell, margin } = this.geom;
      return { x: margin + file * cell, y: margin + rank * cell };
    }

    drawBoard() {
      const ctx = this.ctx;
      const { cell, margin } = this.geom;
      ctx.clearRect(0, 0, this.w, this.h);
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = getComputedStyle(document.documentElement)
        .getPropertyValue("--line").trim() || "#5b3a1a";

      const left = margin, right = margin + 8 * cell;
      const top = margin, bottom = margin + 9 * cell;

      // Horizontal lines (10).
      for (let r = 0; r < XQ.RANKS; r++) {
        const y = margin + r * cell;
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      }
      // Vertical lines (9) — split at the river except the two border files.
      for (let f = 0; f < XQ.FILES; f++) {
        const x = margin + f * cell;
        if (f === 0 || f === 8) {
          ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
        } else {
          const riverTopY = margin + XQ.RIVER_TOP * cell;
          const riverBotY = margin + XQ.RIVER_BOTTOM * cell;
          ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, riverTopY); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x, riverBotY); ctx.lineTo(x, bottom); ctx.stroke();
        }
      }

      this._drawPalace(3, 0, 5, 2);  // black palace (top)
      this._drawPalace(3, 7, 5, 9);  // red palace (bottom)
      this._drawRiverText();
      this._drawStarPoints();
    }

    _drawPalace(f0, r0, f1, r1) {
      const a = this.xy(f0, r0), b = this.xy(f1, r1);
      const c = this.xy(f1, r0), d = this.xy(f0, r1);
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y);
      ctx.stroke();
    }

    _drawRiverText() {
      const ctx = this.ctx;
      const { cell } = this.geom;
      const y = this.xy(0, XQ.RIVER_TOP).y + cell / 2;
      ctx.save();
      ctx.fillStyle = "rgba(91,58,26,0.55)";
      ctx.font = `${cell * 0.5}px "Averia Serif Libre", serif`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillText("楚 河", this.xy(2, XQ.RIVER_TOP).x, y);
      ctx.fillText("漢 界", this.xy(6, XQ.RIVER_TOP).x, y);
      ctx.restore();
    }

    // Small decorative "+" marks at soldier/cannon start points.
    _drawStarPoints() {
      const pts = [
        [1, 2], [7, 2], [1, 7], [7, 7],           // cannons
        [0, 3], [2, 3], [4, 3], [6, 3], [8, 3],   // black soldiers
        [0, 6], [2, 6], [4, 6], [6, 6], [8, 6],   // red soldiers
      ];
      const ctx = this.ctx;
      const { cell } = this.geom;
      const s = cell * 0.11, gap = cell * 0.06;
      ctx.strokeStyle = "rgba(91,58,26,0.7)";
      for (const [f, r] of pts) {
        const { x, y } = this.xy(f, r);
        const corners = f === 0 ? [1] : f === 8 ? [-1] : [-1, 1];
        for (const sx of corners) {
          for (const sy of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(x + sx * gap, y + sy * (gap + s));
            ctx.lineTo(x + sx * gap, y + sy * gap);
            ctx.lineTo(x + sx * (gap + s), y + sy * gap);
            ctx.stroke();
          }
        }
      }
    }

    // Render an array of Piece objects as DOM nodes.
    // opts: { onPieceClick, selected:{file,rank}, checkSquare:{file,rank} }
    renderPieces(pieces, opts = {}) {
      const { onPieceClick, selected, checkSquare } = opts;
      this.layer.innerHTML = "";
      this._markers = [];
      for (const p of pieces) {
        const el = document.createElement("div");
        el.className = `piece ${p.side === XQ.RED ? "red" : "black"}`;
        if (selected && selected.file === p.file && selected.rank === p.rank)
          el.classList.add("selected");
        if (checkSquare && checkSquare.file === p.file && checkSquare.rank === p.rank)
          el.classList.add("in-check");
        el.textContent = p.glyph;
        const { x, y } = this.xy(p.file, p.rank);
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.dataset.file = p.file;
        el.dataset.rank = p.rank;
        if (onPieceClick) el.addEventListener("click", () => onPieceClick(p, el));
        this.layer.appendChild(el);
      }
    }

    // Highlight the most recent move's origin and destination so the player
    // can follow it (used for the AI's reply). Squares sit UNDER the pieces.
    // Cleared automatically on the next renderPieces() (it wipes the layer).
    highlightMove(from, to) {
      const place = (sq, cls) => {
        if (!sq) return;
        const el = document.createElement("div");
        el.className = `last-move ${cls}`;
        const { x, y } = this.xy(sq.file, sq.rank);
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        this.layer.prepend(el); // prepend → painted behind the piece glyphs
      };
      place(from, "from");
      place(to, "to");
    }

    // Draw clickable markers on legal destination squares.
    // moves: array of {to:{file,rank}}, captures show a ring, empties a dot.
    renderMarkers(moves, board, onMarkerClick) {
      for (const m of moves) {
        const isCapture = board && board.at(m.to.file, m.to.rank);
        const el = document.createElement("div");
        el.className = `move-marker ${isCapture ? "capture" : "quiet"}`;
        const { x, y } = this.xy(m.to.file, m.to.rank);
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.addEventListener("click", () => onMarkerClick(m));
        this.layer.appendChild(el);
      }
    }
  }

  XQ.BoardView = BoardView;
})(typeof window !== "undefined" ? window : globalThis);
