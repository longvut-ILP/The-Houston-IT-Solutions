/* ============================================================
   net.js — tiny PeerJS wrapper for online play
   One peer "hosts" (claims a random 4-digit PIN); others "join"
   by entering that PIN. Host relays/broadcasts; clients talk only
   to the host. Same peer-to-peer approach as the Tiến Lên game.
   ============================================================ */
(function (global) {
  "use strict";
  const XQ = global.XQ || (global.XQ = {});

  const ICE = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  };

  class Net {
    constructor() {
      this.peer = null;
      this.isHost = false;
      this.toHost = null;       // client -> host connection
      this.clients = [];        // host -> [client connections]
      this.onData = null;       // (msg, conn) => void
      this.onJoin = null;       // (conn) => void   (host)
      this.onLeave = null;      // (conn) => void   (host)
      this.onError = null;      // (err) => void
    }

    // Host: keep trying random PINs until one is free, then call onReady(pin).
    host(onReady) {
      this.isHost = true;
      const attempt = () => {
        const pin = String(Math.floor(1000 + Math.random() * 9000));
        this.peer = new Peer(pin, { config: ICE });
        this.peer.on("open", (id) => onReady && onReady(id));
        this.peer.on("error", (err) => {
          if (err && err.type === "unavailable-id") {
            try { this.peer.destroy(); } catch (e) {}
            attempt();
          } else if (this.onError) this.onError(err);
        });
        this.peer.on("connection", (conn) => {
          this.clients.push(conn);
          conn.on("open", () => this.onJoin && this.onJoin(conn));
          conn.on("data", (d) => this.onData && this.onData(d, conn));
          conn.on("close", () => {
            this.clients = this.clients.filter((c) => c !== conn);
            this.onLeave && this.onLeave(conn);
          });
        });
      };
      attempt();
    }

    // Client: connect to a host PIN, call onOpen() when the link is live.
    join(pin, onOpen) {
      this.isHost = false;
      this.peer = new Peer(null, { config: ICE });
      this.peer.on("open", () => {
        this.toHost = this.peer.connect(pin);
        this.toHost.on("open", () => onOpen && onOpen());
        this.toHost.on("data", (d) => this.onData && this.onData(d, this.toHost));
        this.toHost.on("error", (e) => this.onError && this.onError(e));
      });
      this.peer.on("error", (e) => this.onError && this.onError(e));
    }

    // Named-room entry (used by the fixed "ET" room): try to JOIN the named room;
    // if nobody is hosting it yet, become its host. opts: {onHost, onClient, onError}.
    _roomId(name) {
      return "htx-cotuong-" + String(name).trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    }
    enter(roomName, opts) {
      opts = opts || {};
      this._tries = 0;
      this._tryClient(this._roomId(roomName), opts);
    }
    _tryClient(roomId, opts) {
      this.isHost = false;
      const peer = new Peer(null, { config: ICE });
      this.peer = peer;
      let decided = false;
      const toHost = () => { if (decided) return; decided = true; try { peer.destroy(); } catch (e) {} this._becomeHost(roomId, opts); };
      peer.on("open", () => {
        const conn = peer.connect(roomId, { reliable: true });
        const t = setTimeout(toHost, 4500); // no answer → nobody is hosting yet
        conn.on("open", () => {
          if (decided) return; decided = true; clearTimeout(t);
          this.toHost = conn;
          conn.on("data", (d) => this.onData && this.onData(d, conn));
          conn.on("close", () => this.onHostGone && this.onHostGone());
          opts.onClient && opts.onClient();
        });
      });
      peer.on("error", (err) => {
        if (err && err.type === "peer-unavailable") toHost();
        else if (!decided && opts.onError) opts.onError(err);
      });
    }
    _becomeHost(roomId, opts) {
      this._tries = (this._tries || 0) + 1;
      this.isHost = true;
      const peer = new Peer(roomId, { config: ICE });
      this.peer = peer;
      peer.on("open", () => opts.onHost && opts.onHost(roomId));
      peer.on("error", (err) => {
        if (err && err.type === "unavailable-id") {
          try { peer.destroy(); } catch (e) {}
          if (this._tries < 4) this._tryClient(roomId, opts);
          else if (opts.onError) opts.onError(err);
        } else if (opts.onError) opts.onError(err);
      });
      peer.on("connection", (conn) => {
        this.clients.push(conn);
        conn.on("open", () => this.onJoin && this.onJoin(conn));
        conn.on("data", (d) => this.onData && this.onData(d, conn));
        conn.on("close", () => {
          this.clients = this.clients.filter((c) => c !== conn);
          this.onLeave && this.onLeave(conn);
        });
      });
    }

    sendToHost(msg) { if (this.toHost) { try { this.toHost.send(msg); } catch (e) {} } }
    broadcast(msg) { this.clients.forEach((c) => { try { c.send(msg); } catch (e) {} }); }
    sendTo(conn, msg) { try { conn.send(msg); } catch (e) {} }
  }

  XQ.Net = Net;
})(typeof window !== "undefined" ? window : globalThis);
