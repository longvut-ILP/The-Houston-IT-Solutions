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

    sendToHost(msg) { if (this.toHost) { try { this.toHost.send(msg); } catch (e) {} } }
    broadcast(msg) { this.clients.forEach((c) => { try { c.send(msg); } catch (e) {} }); }
    sendTo(conn, msg) { try { conn.send(msg); } catch (e) {} }
  }

  XQ.Net = Net;
})(typeof window !== "undefined" ? window : globalThis);
