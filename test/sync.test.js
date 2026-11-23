// Mitme arvuti test: simuleerib mitut lehte ühise ajaga ja võltsreleega ning kontrollib, et kõik
// lehed näitavad igal hetkel täpselt samu tulesid.
//
// Käivitamine:  node test/sync.test.js

"use strict";
process.env.TZ = "Europe/Tallinn";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

for (const file of ["js/junction.js", "js/controller.js", "js/sync.js"]) {
  const code = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  vm.runInThisContext(code, { filename: file });
}
const J = globalThis.JUNCTION;
const { SyncSession, SyncedClock, validMessage, nextBoundary, localMidnight, scheduledMode, LEAD_MS } =
  globalThis.Sync;

let failures = 0;
function check(ok, message) {
  if (!ok) failures++;
  console.log((ok ? "ok    " : "VIGA  ") + message);
}

let seed = 20261123;
function random() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Ühine "päris" aeg ja taimerid kõigile lehtedele
class World {
  constructor(start) {
    this.t = start;
    this.timers = [];
    this.api = {
      set: (fn, ms) => {
        const timer = { at: this.t + ms, fn };
        this.timers.push(timer);
        return timer;
      },
      clear: (timer) => {
        const i = this.timers.indexOf(timer);
        if (i >= 0) this.timers.splice(i, 1);
      },
    };
  }
  run(to, step, each) {
    while (this.t < to) {
      this.t = Math.min(to, this.t + step);
      for (;;) {
        this.timers.sort((a, b) => a.at - b.at);
        if (!this.timers.length || this.timers[0].at > this.t) break;
        this.timers.shift().fn();
      }
      if (each) each(this.t);
    }
  }
}

// Võltsrelee nagu ntfy.sh: hoiab sõnumeid vahemälus ja toimetab need viivitusega kohale
class Hub {
  constructor(world) {
    this.world = world;
    this.cache = [];
    this.clients = new Set();
    this.count = 0;
  }
  relay(options) {
    const hub = this;
    const client = {
      latency: 300,
      online: true,
      start() {
        options.onStatus("connecting");
        hub.world.api.set(() => {
          if (!client.online) return;
          for (const m of hub.cache) client.deliver(m);
          options.onCaughtUp();
          options.onStatus("connected");
          hub.clients.add(client);
        }, 100);
      },
      deliver(m) {
        let msg;
        try {
          msg = JSON.parse(m.message);
        } catch (e) {
          return;
        }
        options.onMessage(msg, m.time);
      },
      publish(msg) {
        hub.raw(JSON.stringify(msg));
        return Promise.resolve();
      },
      stop() {
        client.online = false;
        hub.clients.delete(client);
      },
    };
    return client;
  }
  raw(text) {
    const m = { id: "m" + this.count++, time: Math.floor(this.world.t / 1000), message: text };
    this.world.api.set(() => {
      this.cache.push(m);
      for (const c of this.clients) this.world.api.set(() => c.online && c.deliver(m), c.latency);
    }, 50);
  }
}

function makePage(world, hub, clockError = 0) {
  const clock = { now: () => world.t + clockError };
  const page = new SyncSession({ clock, timers: world.api, random, relay: hub && ((o) => hub.relay(o)) });
  return page;
}

function stateOf(page) {
  const now = page.clock.now();
  page.advance(now);
  const st = page.controller.states(now);
  return JSON.stringify([st.cars, st.peds, st.blinkOn]);
}

const CAR_GO = new Set(["001", "002", "010", "110"]);
const PED_GO = new Set(["01", "02"]);
function conflictFree(page) {
  const now = page.clock.now();
  const st = page.controller.states(now);
  for (const [a, b] of J.CONFLICTS) {
    if (CAR_GO.has(st.cars[a]) && CAR_GO.has(st.cars[b]) && !(st.cars[a] === "010" && st.cars[b] === "010")) return false;
  }
  for (const c of J.CROSSINGS) {
    for (const id of c.conflicts) if (PED_GO.has(st.peds[c.id]) && CAR_GO.has(st.cars[id])) return false;
  }
  return true;
}

const at = (y, m, d, h, min, s = 0, ms = 0) => new Date(y, m - 1, d, h, min, s, ms).getTime();

// ===== Ajakava ja südaöö =====
{
  const midnight = at(2026, 11, 23, 0, 0);
  check(localMidnight(at(2026, 11, 23, 14, 2, 11, 250)) === midnight, "kohalik südaöö arvutatakse õigesti");
  check(nextBoundary(midnight) === at(2026, 11, 23, 6, 0), "esimene ajakava piir pärast südaööd on 06:00");
  check(nextBoundary(at(2026, 11, 23, 23, 30)) === at(2026, 11, 24, 0, 0), "pärast 23:00 on järgmine piir südaöö");
  const dstMorning = nextBoundary(at(2026, 3, 29, 0, 0));
  check(
    new Date(dstMorning).getHours() === 6 && scheduledMode(dstMorning) === "hommik",
    "suveajale ülemineku päeval on hommik ikka kell 06:00",
  );
}

// ===== Eri ajal avatud lehed on ilma releeta samas taktis =====
{
  const world = new World(at(2026, 11, 23, 0, 0));
  const fromMidnight = makePage(world, null);
  world.run(at(2026, 11, 23, 8, 13, 27, 500), 1000, () => fromMidnight.advance(fromMidnight.clock.now()));
  const morning = makePage(world, null);
  world.run(at(2026, 11, 23, 14, 2, 11, 250), 1000, () => {
    fromMidnight.advance(fromMidnight.clock.now());
    morning.advance(morning.clock.now());
  });
  const afternoon = makePage(world, null);
  let same = 0;
  let differ = 0;
  let safe = true;
  world.run(at(2026, 11, 23, 16, 30), 50, () => {
    const s = stateOf(fromMidnight);
    if (s === stateOf(morning) && s === stateOf(afternoon)) same++;
    else differ++;
    safe = safe && conflictFree(afternoon);
  });
  check(differ === 0, `südaööst, 08:13 ja 14:02 avatud leht näitavad samu tulesid (${same} hetke, ka 16:00 vahetus)`);
  check(safe, "vastuolulised suunad pole kunagi korraga rohelised");
  const dstWorld = new World(at(2026, 3, 29, 1, 30));
  const early = makePage(dstWorld, null);
  dstWorld.run(at(2026, 3, 29, 12, 0), 1000, () => early.advance(early.clock.now()));
  const late = makePage(dstWorld, null);
  let dstDiffer = 0;
  dstWorld.run(at(2026, 3, 29, 13, 0), 50, () => {
    if (stateOf(early) !== stateOf(late)) dstDiffer++;
  });
  check(dstDiffer === 0, "ka suveajale ülemineku päeval on lehed samas taktis");
}

// ===== Režiimi muutus jõuab teise arvutisse ja hakkab kehtima samal hetkel =====
const world = new World(at(2026, 11, 23, 11, 0));
const hub = new Hub(world);
const pc1 = makePage(world, hub);
const pc2 = makePage(world, hub);
pc1.connect("https://relee", "test1234");
pc2.connect("https://relee", "test1234");
world.run(world.t + 5000, 50);
check(pc1.ready && pc2.ready && pc1.status === "connected", "mõlemad lehed on ruumis ja valmis");

const CAR_NEXT = { "100": ["110", "020"], "110": ["001"], "001": ["002"], "002": ["010"], "010": ["100"], "020": ["010"] };
const PED_NEXT = { "10": ["01", "00"], "01": ["02"], "02": ["10"], "00": ["10"] };
const lastSeen = new Map();
function badTransitions(page) {
  const now = page.clock.now();
  const st = page.controller.states(now);
  const prev = lastSeen.get(page);
  lastSeen.set(page, st);
  if (!prev) return 0;
  let bad = 0;
  for (const id in st.cars) if (st.cars[id] !== prev.cars[id] && !CAR_NEXT[prev.cars[id]].includes(st.cars[id])) bad++;
  for (const id in st.peds) if (st.peds[id] !== prev.peds[id] && !PED_NEXT[prev.peds[id]].includes(st.peds[id])) bad++;
  return bad;
}

function compare(pages, until, label) {
  let differ = 0;
  let unsafe = 0;
  let jumps = 0;
  let samples = 0;
  world.run(until, 50, () => {
    const first = stateOf(pages[0]);
    samples++;
    for (const p of pages.slice(1)) if (stateOf(p) !== first) differ++;
    if (!pages.every(conflictFree)) unsafe++;
    for (const p of pages) jumps += badTransitions(p);
  });
  check(differ === 0, `${label} (${samples} hetke)`);
  check(unsafe === 0 && jumps === 0, `${label}: tuled vahetuvad lubatud järjekorras, vastuolusid pole`);
}

pc1.requestMode(false, "oo");
check(pc1.pending && pc1.pending.at > world.t, "muutus on ootel");
const switchAt = pc1.pending.at;
world.run(world.t + 600, 50);
check(pc2.pending && pc2.pending.at === switchAt, "teine arvuti sai muutuse enne selle kehtima hakkamist");
check(switchAt - world.t <= LEAD_MS, "muutus hakkab kehtima kuni 1,5 s pärast klõpsu");
compare([pc1, pc2], world.t + 10 * 60000, "käsitsi öörežiim: mõlemad arvutid samas taktis");
check(
  pc2.setting.auto === false && pc2.setting.mode === "oo" && pc2.controller.seg.type === "night",
  "teine arvuti on öörežiimis",
);

pc1.requestMode(true, "paev");
compare([pc1, pc2], world.t + 5 * 60000, "tagasi automaatrežiimile: samas taktis");

for (const c of hub.clients) c.latency = 2500;
pc2.requestMode(false, "hommik");
world.run(world.t + 4000, 50, () => [pc1, pc2].forEach(badTransitions));
compare([pc1, pc2], world.t + 5 * 60000, "hilinenud sõnumi järel jälle samas taktis");
for (const c of hub.clients) c.latency = 300;

// ===== Hiljem liituv arvuti =====
const pc3 = makePage(world, hub);
pc3.connect("https://relee", "test1234");
world.run(world.t + 3000, 50);
check(pc3.ready, "hiljem liitunud leht on valmis");
compare([pc1, pc2, pc3], world.t + 10 * 60000, "hiljem liitunud leht (vahemälust) on samas taktis");

// ===== Vahemälu on tühi: olemasolev leht vastab olekuga =====
const world2 = new World(at(2026, 11, 23, 15, 0));
const hub2 = new Hub(world2);
const first = makePage(world2, hub2);
first.connect("https://relee", "ruum5678");
world2.run(world2.t + 3000, 50);
first.requestMode(false, "ohtu");
world2.run(world2.t + 7 * 60000, 50);
hub2.cache = [];
const joiner = makePage(world2, hub2);
joiner.connect("https://relee", "ruum5678");
world2.run(world2.t + 1500, 50);
let diff2 = 0;
world2.run(world2.t + 10 * 60000, 50, () => {
  if (stateOf(first) !== stateOf(joiner)) diff2++;
});
check(
  diff2 === 0 && joiner.setting.mode === "ohtu" && !joiner.setting.auto,
  "tühja vahemäluga liitunud leht saab teiselt lehelt oleku ja käsitsi režiimi",
);

// ===== Kaks arvutit klõpsavad peaaegu korraga =====
pc1.requestMode(false, "ohtu");
world.run(world.t + 200, 50);
pc2.requestMode(false, "hommik");
world.run(world.t + 4000, 50);
compare([pc1, pc2, pc3], world.t + 5 * 60000, "üheaegsed klõpsud: kõik arvutid jõuavad samasse olekusse");

// ===== Vigased ja võõrad sõnumid =====
const goodSnap = pc1.controller.snapshot();
const junk = [
  "pole json",
  JSON.stringify({ v: 1, t: "reziim", id: "aaaaaaaaaa", from: "bbbbbbbbbb", at: NaN, auto: false, mode: "oo", snap: goodSnap }),
  JSON.stringify({ v: 1, t: "reziim", id: "aaaaaaaaab", from: "bbbbbbbbbb", at: world.t + 5000, auto: false, mode: "xx", snap: goodSnap }),
  JSON.stringify({ v: 1, t: "reziim", id: "aaaaaaaaac", from: "bbbbbbbbbb", at: world.t + 3600000, auto: false, mode: "oo", snap: goodSnap }),
  JSON.stringify({ v: 1, t: "reziim", id: "aaaaaaaaad", from: "bbbbbbbbbb", at: world.t + 5000, auto: false, mode: "toString", snap: goodSnap }),
  JSON.stringify({ v: 1, t: "olek", id: "aaaaaaaaae", from: "bbbbbbbbbb", at: world.t + 5000, auto: true, mode: "paev", snap: { ...goodSnap, seg: { type: "stage", stage: 7, start: world.t, duration: 5000 } } }),
  JSON.stringify({ v: 1, t: "olek", id: "AAAAAAAAAF", from: "bbbbbbbbbb", at: world.t + 5000, auto: true, mode: "paev", snap: goodSnap }),
];
for (const text of junk) hub.raw(text);
const before = pc2.setting;
compare([pc1, pc2, pc3], world.t + 60000, "vigased sõnumid ei muuda midagi");
check(pc2.setting.mode === before.mode && pc2.setting.auto === before.auto, "režiim jäi samaks");
check(
  validMessage({ v: 1, t: "tere", id: "abcdefgh12", from: "abcdefgh34" }, world.t) &&
    !validMessage({ v: 1, t: "tere", id: "x", from: "abcdefgh34" }, world.t) &&
    !validMessage(null, world.t),
  "sõnumite kontroll",
);

// ===== Ilma ruumita muutub režiim kohe ja ainult selles arvutis =====
{
  const w = new World(at(2026, 11, 23, 12, 0));
  const alone = makePage(w, null);
  alone.requestMode(false, "oo");
  w.run(w.t + 100, 50);
  check(!alone.pending && alone.setting.mode === "oo", "ruumita leht: režiim muutub kohe");
}

// ===== Kell =====
{
  let perfT = 1000;
  const wallBase = at(2026, 11, 23, 9, 0) - 1000;
  let wallJump = 0;
  let serverAhead = 1234;
  const jumps = [];
  const clock = new SyncedClock({
    perf: () => perfT,
    wall: () => perfT + wallBase + wallJump,
    samples: 3,
    onJump: (d) => jumps.push(d),
    fetch: async () => {
      perfT += 20;
      const server = perfT + wallBase + wallJump + serverAhead;
      perfT += 20;
      return { ok: true, text: async () => "ts=" + (server / 1000).toFixed(3) };
    },
  });
  (async () => {
    await clock.sync();
    await Promise.resolve();
    const err1 = clock.now() - (perfT + wallBase + serverAhead);
    check(Math.abs(err1) <= 20 && clock.status.synced, `esimene sünkroniseerimine: viga ${Math.round(err1)} ms`);
    check(jumps.length === 1, "esimene sünkroniseerimine parandab kella kohe");
    serverAhead += 300;
    await clock.sync();
    let prev = clock.now();
    let monotonic = true;
    const start = prev;
    perfT += 1000;
    const afterSecond = clock.now();
    monotonic = monotonic && afterSecond > prev;
    check(afterSecond - start <= 1050 + 1, "väike parandus (300 ms) tehakse sujuvalt, kuni 50 ms sekundis");
    for (let i = 0; i < 100; i++) {
      perfT += 100;
      const n = clock.now();
      monotonic = monotonic && n > prev;
      prev = n;
    }
    check(monotonic, "sujuva parandamise ajal ei lähe kell kunagi tagasi");
    check(Math.abs(clock.now() - (perfT + wallBase + serverAhead)) <= 20, "parandus on lõpuks täielik");
    const beforeSleep = clock.now();
    wallJump = 60000;
    perfT += 10;
    const afterSleep = clock.now();
    await Promise.resolve();
    check(afterSleep - beforeSleep > 59000 && jumps.length === 2, "pärast unerežiimi hüppab kell kohe õigeks");

    if (failures) {
      console.error(`\n${failures} viga.`);
      process.exit(1);
    }
    console.log("\nOK – mitu arvutit on samas taktis.");
  })();
}
