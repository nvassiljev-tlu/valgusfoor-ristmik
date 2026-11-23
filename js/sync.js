// Mitu arvutit: ühine kell ja režiimi muutuste jagamine, et kõigi arvutite foorid oleksid samas taktis.
//
// Iga leht arvutab foorid ise, aga internetist sünkroniseeritud kella järgi ja samast alguspunktist
// (kohalik südaöö, sealt edasi ajakava). Nii on automaatrežiimis kõik lehed samas taktis ka ilma
// ühenduseta. Käsitsi tehtud muutus saadetakse relee kaudu teistele lehtedele: sõnumis on hetk,
// millal muutus kehtima hakkab, ja kontrolleri olek sel hetkel, nii et ka hiljem liitunud leht
// jõuab täpselt samasse olekusse.

(function () {
  "use strict";

  const J = globalThis.JUNCTION;
  const { Controller } = globalThis.Signals;

  const SLEW = 0.05; // väike kellaparandus tehakse sujuvalt (kuni 50 ms sekundis), et foorid ei hüppaks
  const JUMP_MS = 1000;
  const RESYNC_MS = 5 * 60 * 1000;
  const RETRY_MS = 30 * 1000;
  const LEAD_MS = 1500; // muutus hakkab kehtima nii palju hiljem, et sõnum jõuaks kõigi arvutiteni
  const GREET_WAIT_MS = 2000;
  const MAX_AGE_MS = 13 * 3600 * 1000;
  const MAX_AHEAD_MS = 60 * 1000;
  const MAX_SEG_MS = 48 * 3600 * 1000;
  const TOPIC_PREFIX = "ristmik-";
  const SEG_TYPES = ["stage", "change", "toNight", "night", "fromNight"];
  const has = (obj, key) => typeof key === "string" && Object.prototype.hasOwnProperty.call(obj, key);

  const TIME_SOURCES = [
    {
      name: "cloudflare.com",
      url: "https://www.cloudflare.com/cdn-cgi/trace",
      parse: async (res) => parseFloat((await res.text()).match(/^ts=([\d.]+)/m)[1]) * 1000,
    },
    {
      name: "time.now",
      url: "https://time.now/developer/api/timezone/Europe/Tallinn",
      parse: async (res) =>
        Date.parse((await res.json()).utc_datetime.replace(/(\.\d{3})\d+/, "$1")),
    },
  ];

  // Oma relee (server/relay.js) annab ka kellaaja, et kõik arvutid kasutaksid sama kella ka ilma internetita
  function relayTimeSource(server) {
    const url = server.replace(/\/+$/, "");
    return {
      name: url.replace(/^https?:\/\//, ""),
      url: url + "/aeg",
      parse: async (res) => Number((await res.text()).trim()),
    };
  }

  function randomId(length = 12) {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) => chars[b % chars.length]).join("");
  }

  class SyncedClock {
    constructor({ sources, fetch: fetchImpl, perf, wall, samples, onJump, onStatus } = {}) {
      this.sources = sources || TIME_SOURCES;
      this.fetch = fetchImpl || ((url, options) => globalThis.fetch(url, options));
      this.perf = perf || (() => performance.now());
      this.wall = wall || (() => Date.now());
      this.samples = samples || 5;
      this.onJump = onJump || (() => {});
      this.onStatus = onStatus || (() => {});
      const p = this.perf();
      this.offset = this.wall() - p;
      this.target = this.offset;
      this.lastRead = p;
      this.lastGap = this.offset;
      this.status = { synced: false, failed: false, source: null, accuracy: null };
      this.running = null;
      this.auto = false;
      this.timer = null;
    }

    // Monotoonne kell (performance.now) + parandus, mis viib selle internetiaja peale
    now() {
      const p = this.perf();
      const gap = this.wall() - p;
      if (Math.abs(gap - this.lastGap) > 2 * JUMP_MS) {
        // Arvuti magas või selle kella muudeti: järgime kohe ja küsime aega uuesti
        const delta = gap - this.lastGap;
        this.offset += delta;
        this.target += delta;
        this.lastGap = gap;
        this.lastRead = p;
        queueMicrotask(() => this.onJump(delta));
        this.sync();
        return p + this.offset;
      }
      this.lastGap = gap;
      const elapsed = Math.max(0, p - this.lastRead);
      this.lastRead = p;
      const diff = this.target - this.offset;
      this.offset += Math.sign(diff) * Math.min(Math.abs(diff), elapsed * SLEW);
      return p + this.offset;
    }

    sync() {
      if (!this.running) {
        this.running = this.measure().finally(() => {
          this.running = null;
          this.schedule();
        });
      }
      return this.running;
    }

    setSources(sources) {
      this.sources = sources;
      return (this.running || Promise.resolve()).then(() => this.sync());
    }

    startAuto() {
      this.auto = true;
      this.schedule();
    }

    schedule() {
      clearTimeout(this.timer);
      if (!this.auto) return;
      const ok = this.status.synced && !this.status.failed;
      this.timer = setTimeout(() => this.sync(), ok ? RESYNC_MS : RETRY_MS);
    }

    // Mitu mõõtmist, parim on kõige lühema edasi-tagasi ajaga: selle viga on kuni pool sellest ajast
    async measure() {
      for (const src of this.sources) {
        try {
          let best = null;
          for (let i = 0; i < this.samples; i++) {
            const t0 = this.perf();
            const res = await this.fetch(src.url, { cache: "no-store", signal: AbortSignal.timeout(4000) });
            if (!res.ok) throw new Error("HTTP " + res.status);
            const server = await src.parse(res);
            const t1 = this.perf();
            if (!Number.isFinite(server)) throw new Error("vale vastus");
            const rtt = t1 - t0;
            if (!best || rtt < best.rtt) best = { rtt, offset: server + rtt / 2 - t1 };
          }
          this.setTarget(best.offset);
          this.status = {
            synced: true,
            failed: false,
            source: src.name,
            accuracy: Math.max(1, Math.round(best.rtt / 2)),
          };
          this.onStatus(this.status);
          return true;
        } catch (e) {
          // proovime järgmist allikat
        }
      }
      this.status = { ...this.status, failed: true };
      this.onStatus(this.status);
      return false;
    }

    setTarget(offset) {
      this.now();
      this.target = offset;
      if (!this.status.synced || Math.abs(offset - this.offset) > JUMP_MS) {
        const delta = offset - this.offset;
        this.offset = offset;
        if (delta !== 0) queueMicrotask(() => this.onJump(delta));
      }
    }
  }

  function localMidnight(t) {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function scheduledMode(t) {
    const d = new Date(t);
    const minutes = d.getHours() * 60 + d.getMinutes();
    let mode = J.SCHEDULE[0].mode;
    for (const entry of J.SCHEDULE) {
      const [h, m] = entry.from.split(":").map(Number);
      if (h * 60 + m <= minutes) mode = entry.mode;
    }
    return mode;
  }

  // Esimene ajakava piir pärast hetke t
  function nextBoundary(t) {
    const d = new Date(t);
    for (let day = 0; day < 2; day++) {
      for (const entry of J.SCHEDULE) {
        const [h, m] = entry.from.split(":").map(Number);
        const b = new Date(d.getFullYear(), d.getMonth(), d.getDate() + day, h, m).getTime();
        if (b > t) return b;
      }
    }
    return Infinity;
  }

  function validSnapshot(s, at) {
    if (!s || typeof s !== "object" || !s.seg || typeof s.seg !== "object") return false;
    if (!has(J.MODES, s.wanted) || !has(J.MODES, s.mode)) return false;
    if (s.cycleStart !== null && !Number.isFinite(s.cycleStart)) return false;
    const seg = s.seg;
    if (!SEG_TYPES.includes(seg.type) || !Number.isFinite(seg.start)) return false;
    if (seg.start > at || at - seg.start > MAX_SEG_MS) return false;
    if (seg.duration === null) {
      if (seg.type !== "night") return false;
    } else if (!Number.isFinite(seg.duration) || seg.duration <= 0 || seg.duration > MAX_SEG_MS) {
      return false;
    }
    const stageOk = (k) => Number.isInteger(k) && k >= 0 && k < J.STAGES.length;
    if (["stage", "change", "toNight"].includes(seg.type) && !stageOk(seg.stage)) return false;
    if (seg.type === "change" && !stageOk(seg.next)) return false;
    return true;
  }

  // Relee on avalik: kõik, mis sealt tuleb, kontrollime enne kasutamist üle
  function validMessage(m, now) {
    const idOk = (v) => typeof v === "string" && /^[a-z0-9]{8,32}$/.test(v);
    if (!m || typeof m !== "object" || m.v !== 1 || !idOk(m.id) || !idOk(m.from)) return false;
    if (m.t === "tere") return true;
    if (m.t !== "reziim" && m.t !== "olek") return false;
    if (!Number.isFinite(m.at) || m.at > now + MAX_AHEAD_MS || m.at < now - MAX_AGE_MS) return false;
    if (typeof m.auto !== "boolean" || !has(J.MODES, m.mode)) return false;
    return validSnapshot(m.snap, m.at);
  }

  const newer = (a, b) => a.at > b.at || (a.at === b.at && a.id > b.id);

  // Ühine ajajoon: viimane olekuga sõnum (või südaöö) + ajakava. Kõik lehed, kellel on samad sõnumid,
  // arvutavad igal hetkel täpselt sama oleku.
  class SharedTimeline {
    constructor(now) {
      this.reset(now);
    }

    reset(now) {
      const at = localMidnight(now);
      const mode = scheduledMode(at);
      this.queue = [];
      this.seen = new Set();
      this.adopt({ id: "", at, auto: true, mode, snap: new Controller(at, mode).snapshot() }, now);
    }

    get setting() {
      return { auto: this.base.auto, mode: this.base.mode };
    }

    get pending() {
      return this.queue[0] || null;
    }

    adopt(msg, now) {
      const ctrl = Controller.restore(msg.snap);
      ctrl.setMode(msg.auto ? scheduledMode(msg.at) : msg.mode, msg.at);
      this.base = msg;
      this.controller = ctrl;
      this.lastTime = msg.at;
      this.runTo(now);
    }

    runTo(now) {
      if (this.base.auto) {
        for (let b = nextBoundary(this.lastTime); b <= now; b = nextBoundary(b)) {
          this.controller.update(b);
          this.controller.setMode(scheduledMode(b), b);
          this.lastTime = b;
        }
      }
      if (now > this.lastTime) {
        this.controller.update(now);
        this.lastTime = now;
      }
    }

    advance(now) {
      while (this.queue.length && this.queue[0].at <= now) {
        const msg = this.queue.shift();
        if (newer(msg, this.base)) this.adopt(msg, msg.at);
      }
      this.runTo(now);
    }

    receive(msg, now) {
      if (this.seen.has(msg.id)) return false;
      this.seen.add(msg.id);
      if (!newer(msg, this.base)) return false;
      if (msg.at <= this.lastTime) {
        this.adopt(msg, Math.max(now, this.lastTime));
      } else {
        this.queue.push(msg);
        this.queue.sort((a, b) => (newer(a, b) ? 1 : -1));
      }
      return true;
    }

    // Pärast kella hüpet: arvutame praeguse oleku sama aluse pealt uuesti
    rebuild(now) {
      if (this.base.at <= now) {
        this.adopt(this.base, now);
        return;
      }
      const waiting = (this.base.id ? [this.base] : []).concat(this.queue);
      const seen = this.seen;
      this.reset(now);
      this.seen = seen;
      this.queue = waiting.sort((a, b) => (newer(a, b) ? 1 : -1));
    }

    clone() {
      const c = Object.create(SharedTimeline.prototype);
      c.base = this.base;
      c.queue = this.queue.slice();
      c.seen = new Set();
      c.controller = Controller.restore(this.controller.snapshot());
      c.lastTime = this.lastTime;
      return c;
    }

    // Sõnum koos kontrolleri olekuga hetkel at (enne sõnumi enda muutust)
    message(t, at, id, from, auto, mode) {
      const sim = this.clone();
      sim.advance(at);
      const setting = auto === undefined ? sim.base : { auto, mode };
      return {
        v: 1,
        t,
        id,
        from,
        at,
        auto: setting.auto,
        mode: setting.auto ? scheduledMode(at) : setting.mode,
        snap: sim.controller.snapshot(),
      };
    }
  }

  // ntfy.sh-ga ühilduv relee: POST /<teema> saadab, GET /<teema>/json?poll=1 annab vahemälu,
  // GET /<teema>/sse annab uued sõnumid.
  class RelayClient {
    constructor({ server, topic, onMessage, onStatus, onCaughtUp, EventSource: ES, fetch: fetchImpl }) {
      this.url = server.replace(/\/+$/, "") + "/" + topic;
      this.onMessage = onMessage;
      this.onStatus = onStatus || (() => {});
      this.onCaughtUp = onCaughtUp || (() => {});
      this.ES = ES || globalThis.EventSource;
      this.fetch = fetchImpl || ((url, options) => globalThis.fetch(url, options));
      this.lastId = null;
      this.lostAt = null;
      this.stopped = false;
    }

    async start() {
      this.onStatus("connecting");
      try {
        const res = await this.fetch(this.url + "/json?poll=1&since=12h", {
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        for (const line of (await res.text()).split("\n")) this.handle(line);
      } catch (e) {
        if (!this.stopped) this.onStatus("error", e.message);
      }
      if (this.stopped) return;
      this.onCaughtUp();
      this.subscribe();
    }

    subscribe() {
      if (this.stopped) return;
      const lost = this.lostAt ? Math.ceil((Date.now() - this.lostAt) / 1000) + 60 + "s" : "2m";
      const es = new this.ES(this.url + "/sse?since=" + encodeURIComponent(this.lastId || lost));
      this.es = es;
      es.onopen = () => {
        this.lostAt = null;
        this.onStatus("connected");
      };
      es.onmessage = (event) => this.handle(event.data);
      es.onerror = () => {
        es.close();
        if (this.stopped) return;
        if (!this.lostAt) this.lostAt = Date.now();
        this.onStatus("reconnecting");
        clearTimeout(this.retry);
        this.retry = setTimeout(() => this.subscribe(), 3000);
      };
    }

    handle(line) {
      let data;
      try {
        data = JSON.parse(line);
      } catch (e) {
        return;
      }
      if (!data || data.event !== "message" || typeof data.message !== "string") return;
      if (typeof data.id === "string") this.lastId = data.id;
      let msg;
      try {
        msg = JSON.parse(data.message);
      } catch (e) {
        return;
      }
      this.onMessage(msg, typeof data.time === "number" ? data.time : null);
    }

    async publish(msg) {
      const res = await this.fetch(this.url, { method: "POST", body: JSON.stringify(msg) });
      if (!res.ok) throw new Error("HTTP " + res.status);
    }

    stop() {
      this.stopped = true;
      clearTimeout(this.retry);
      if (this.es) this.es.close();
    }
  }

  // Ühe lehe osalemine ruumis: liitudes küsib (tere), olemasolevad lehed vastavad olekuga (olek),
  // režiimi muutus (reziim) saadetakse kõigile ja hakkab kehtima LEAD_MS pärast.
  class SyncSession {
    constructor({ clock, onChange, relay, timers, random } = {}) {
      this.clock = clock;
      this.onChange = onChange || (() => {});
      this.makeRelay = relay || ((options) => new RelayClient(options));
      this.timers = timers || { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) };
      this.random = random || Math.random;
      this.pageId = randomId();
      this.timeline = new SharedTimeline(clock.now());
      this.relay = null;
      this.room = null;
      this.server = null;
      this.status = "off";
      this.error = "";
      this.ready = true;
      this.seen = new Set();
      this.lastHeard = null;
      this.replyTimer = null;
      this.readyTimer = null;
    }

    get controller() {
      return this.timeline.controller;
    }

    get setting() {
      return this.timeline.setting;
    }

    get pending() {
      return this.timeline.pending;
    }

    advance(now) {
      this.timeline.advance(now);
    }

    rebuild() {
      this.timeline.rebuild(this.clock.now());
      this.onChange();
    }

    connect(server, room) {
      this.disconnect(true);
      this.server = server;
      this.room = room;
      this.ready = false;
      this.status = "connecting";
      this.seen = new Set();
      // Ruumiga liitudes kehtib ruumi olek, mitte selle lehe varasem käsitsi valik
      this.timeline.reset(this.clock.now());
      const relay = this.makeRelay({
        server,
        topic: TOPIC_PREFIX + room,
        onMessage: (msg, time) => this.relay === relay && this.handle(msg, time),
        onStatus: (status, error) => {
          if (this.relay !== relay) return;
          this.status = status;
          this.error = error || "";
          this.onChange();
        },
        onCaughtUp: () => this.relay === relay && this.greet(),
      });
      this.relay = relay;
      relay.start();
      this.onChange();
    }

    disconnect(quiet) {
      if (this.relay) this.relay.stop();
      this.relay = null;
      this.room = null;
      this.status = "off";
      this.error = "";
      this.ready = true;
      this.cancelReply();
      this.timers.clear(this.readyTimer);
      if (!quiet) this.onChange();
    }

    greet() {
      this.send({ v: 1, t: "tere", id: randomId(), from: this.pageId });
      this.timers.clear(this.readyTimer);
      this.readyTimer = this.timers.set(() => this.markReady(), GREET_WAIT_MS);
    }

    markReady() {
      this.timers.clear(this.readyTimer);
      if (!this.ready) {
        this.ready = true;
        this.onChange();
      }
    }

    handle(msg, time) {
      const now = this.clock.now();
      if (!validMessage(msg, now) || this.seen.has(msg.id)) return;
      this.seen.add(msg.id);
      this.lastHeard = now;
      if (msg.t === "tere") {
        // Vahemälust tulnud vanale tervitusele ei vasta
        const fresh = time !== null && Math.abs(now / 1000 - time) < 30;
        if (msg.from !== this.pageId && this.ready && fresh) this.scheduleReply();
        return;
      }
      if (msg.t === "olek" && msg.from !== this.pageId) {
        this.cancelReply();
        this.markReady();
      }
      this.timeline.advance(now);
      if (this.timeline.receive(msg, now)) this.onChange();
    }

    // Vastab üks leht: igaüks ootab juhusliku aja ja jätab vastamata, kui keegi jõudis ette
    scheduleReply() {
      this.cancelReply();
      this.replyTimer = this.timers.set(() => {
        this.replyTimer = null;
        const now = this.clock.now();
        this.timeline.advance(now);
        const at = Math.max(now, this.timeline.base.at + 1);
        const msg = this.timeline.message("olek", at, randomId(), this.pageId);
        this.seen.add(msg.id);
        this.timeline.receive(msg, now);
        this.send(msg);
      }, 200 + this.random() * 1300);
    }

    cancelReply() {
      if (this.replyTimer) this.timers.clear(this.replyTimer);
      this.replyTimer = null;
    }

    requestMode(auto, mode) {
      const now = this.clock.now();
      this.timeline.advance(now);
      const at = Math.max(this.relay ? now + LEAD_MS : now, this.timeline.base.at + 1);
      const msg = this.timeline.message("reziim", at, randomId(), this.pageId, auto, mode);
      this.seen.add(msg.id);
      this.timeline.receive(msg, now);
      this.timeline.advance(now);
      this.send(msg);
      this.onChange();
    }

    send(msg) {
      if (!this.relay) return;
      this.relay.publish(msg).catch((e) => {
        this.error = "saatmine ebaõnnestus: " + e.message;
        this.onChange();
      });
    }
  }

  globalThis.Sync = {
    SyncedClock,
    SharedTimeline,
    RelayClient,
    SyncSession,
    TIME_SOURCES,
    TOPIC_PREFIX,
    LEAD_MS,
    relayTimeSource,
    randomId,
    scheduledMode,
    nextBoundary,
    localMidnight,
    validMessage,
  };
})();
