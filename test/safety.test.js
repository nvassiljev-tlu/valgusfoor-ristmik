// Ohutustest: kontrollib ristmiku andmeid ja simuleerib kontrollerit 6 tundi juhuslike
// režiimivahetustega. Iga 50 ms järel kontrollitakse, et vastuolulised suunad ei saa korraga
// minna, tuled vahetuvad lubatud järjekorras ja kollane, punane + kollane ning roheline
// kestavad ettenähtud aja.
//
// Käivitamine:  node test/safety.test.js

"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

for (const file of ["js/junction.js", "js/controller.js"]) {
  const code = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  vm.runInThisContext(code, { filename: file });
}
const J = globalThis.JUNCTION;
const { Controller, PED_GREEN } = globalThis.Signals;
const T = J.TIMING;

let failures = 0;
let checks = 0;
function check(ok, message) {
  checks++;
  if (!ok) {
    failures++;
    if (failures <= 30) console.error("VIGA: " + message);
  }
}

// ===== Andmed =====
const lightIds = J.LIGHTS.map((l) => l.id);
const crossingIds = J.CROSSINGS.map((c) => c.id);
const conflictSet = new Set(J.CONFLICTS.map(([a, b]) => [a, b].sort().join("-")));
const conflicting = (a, b) => conflictSet.has([a, b].sort().join("-"));

for (const [a, b] of J.CONFLICTS) {
  check(lightIds.includes(a) && lightIds.includes(b), `konflikt ${a}-${b}: tundmatu foor`);
}
for (const c of J.CROSSINGS) {
  for (const id of c.conflicts) check(lightIds.includes(id), `${c.id}: tundmatu foor ${id}`);
}
for (const light of J.LIGHTS) {
  check(crossingIds.includes(light.pair), `${light.id}: tundmatu paarisrada ${light.pair}`);
  check(
    J.STAGES.some((s) => s.cars.includes(light.id)),
    `${light.id} ei saa üheski faasis rohelist`,
  );
  const pair = J.CROSSINGS.find((c) => c.id === light.pair);
  check(
    pair && pair.conflicts.includes(light.id),
    `${light.id}: paarisrada ${light.pair} peaks olema raja, mida selle foori autod ületavad`,
  );
}
for (const s of J.STAGES) {
  for (const a of s.cars) {
    check(lightIds.includes(a), `faas ${s.id}: tundmatu foor ${a}`);
    for (const b of s.cars) {
      if (a < b) check(!conflicting(a, b), `faas ${s.id}: ${a} ja ${b} on vastuolus`);
    }
  }
}
for (const c of J.CROSSINGS) {
  check(
    PED_GREEN.some((list) => list.includes(c.id)),
    `${c.id} ei saa üheski faasis rohelist`,
  );
}
for (const [key, mode] of Object.entries(J.MODES)) {
  if (mode.night) continue;
  for (const s of J.STAGES) {
    const g = mode.greens[s.id];
    check(g * 1000 >= T.minGreen, `režiim ${key}: faasi ${s.id} roheline on lühem kui miinimum`);
  }
}

// ===== Simulatsioon =====
const CAR_GO = new Set(["001", "002", "010", "110"]);
const PED_GO = new Set(["01", "02"]);
// Ainus lubatud kattumine: mõlemad kollased (öörežiimi lõpus on kõigile kollane korraga)
const carClash = (a, b) => CAR_GO.has(a) && CAR_GO.has(b) && !(a === "010" && b === "010");
const CAR_NEXT = {
  "100": ["110", "020"],
  "110": ["001"],
  "001": ["002"],
  "002": ["010"],
  "010": ["100"],
  "020": ["010"],
};
const PED_NEXT = {
  "10": ["01", "00"],
  "01": ["02"],
  "02": ["10"],
  "00": ["10"],
};
const STEP = 50;
const HOURS = 6;
const CLEARANCE = 1000; // vähim aeg, mil vastuoluline suund peab seisma, enne kui teine hakkab minema
const modes = Object.keys(J.MODES);

// Fikseeritud seemnega juhuarvud, et viga oleks taasesitatav
let seed = 20261116;
function random() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const ctrl = new Controller(0, "paev");
let nextModeChange = 0;
const prev = {};
const stoppedAt = {};
for (const id of [...lightIds, ...crossingIds]) stoppedAt[id] = -Infinity;
const seenGreen = new Set();
let greenCheckFrom = null;

for (let now = 0; now <= HOURS * 3600 * 1000; now += STEP) {
  if (now >= nextModeChange) {
    const mode = modes[Math.floor(random() * modes.length)];
    ctrl.setMode(mode, now);
    const long = random() < 0.3;
    nextModeChange = now + (long ? 300000 : 2000 + random() * 60000);
    if (long && !J.MODES[mode].night) {
      greenCheckFrom = now + 30000;
      seenGreen.clear();
    } else {
      greenCheckFrom = null;
    }
  }
  ctrl.update(now);
  const st = ctrl.states(now);

  for (const [a, b] of J.CONFLICTS) {
    check(
      !carClash(st.cars[a], st.cars[b]),
      `${now} ms: ${a}=${st.cars[a]} ja ${b}=${st.cars[b]} korraga`,
    );
  }
  for (const c of J.CROSSINGS) {
    for (const id of c.conflicts) {
      check(
        !(PED_GO.has(st.peds[c.id]) && CAR_GO.has(st.cars[id])),
        `${now} ms: ${c.id}=${st.peds[c.id]} ja ${id}=${st.cars[id]} korraga`,
      );
    }
  }
  if (st.seg.type === "night") {
    for (const id of lightIds) check(st.cars[id] === "020", `${now} ms: öösel ${id}=${st.cars[id]}`);
    for (const id of crossingIds) check(st.peds[id] === "00", `${now} ms: öösel ${id}=${st.peds[id]}`);
  }

  const all = [
    ...lightIds.map((id) => [id, st.cars[id], CAR_NEXT]),
    ...crossingIds.map((id) => [id, st.peds[id], PED_NEXT]),
  ];
  for (const [id, state, allowed] of all) {
    if (state === "001" || state === "01") seenGreen.add(id);
    const p = prev[id];
    if (p && p.state !== state) {
      const starts = (p.state === "100" && state === "110") || (p.state === "10" && state === "01");
      if (starts) {
        const rivals = lightIds.includes(id)
          ? [
              ...J.CONFLICTS.filter((pair) => pair.includes(id)).map((pair) => pair.find((x) => x !== id)),
              ...J.CROSSINGS.filter((c) => c.conflicts.includes(id)).map((c) => c.id),
            ]
          : J.CROSSINGS.find((c) => c.id === id).conflicts;
        for (const r of rivals) {
          const since = stoppedAt[r];
          check(
            since !== undefined && now - since >= CLEARANCE - STEP,
            `${now} ms: ${id} hakkab minema, kuid ${r} seisab alles ${since === undefined ? "?" : now - since} ms`,
          );
        }
      }
      const wasGo = CAR_GO.has(p.state) || PED_GO.has(p.state);
      const isGo = CAR_GO.has(state) || PED_GO.has(state);
      if (wasGo && !isGo) stoppedAt[id] = now;
      check(
        (allowed[p.state] || []).includes(state),
        `${now} ms: ${id} muutus ${p.state} -> ${state} (pole lubatud)`,
      );
      const lasted = now - p.since;
      if (p.state === "010") {
        const ok =
          Math.abs(lasted - T.yellow) <= STEP || Math.abs(lasted - T.wakeYellow) <= STEP;
        check(ok, `${now} ms: ${id} kollane kestis ${lasted} ms`);
      }
      if (p.state === "110") {
        check(Math.abs(lasted - T.redYellow) <= STEP, `${now} ms: ${id} punane+kollane ${lasted} ms`);
      }
      if (p.state === "001" && p.since > 0) {
        check(lasted >= T.minGreen - STEP, `${now} ms: ${id} roheline kestis ainult ${lasted} ms`);
      }
      prev[id] = { state, since: now };
    } else if (!p) {
      prev[id] = { state, since: now };
    }
  }

  // Pika sama režiimi perioodi jooksul peab iga foor ja rada rohelise saama
  if (greenCheckFrom !== null && now === nextModeChange - STEP) {
    for (const id of [...lightIds, ...crossingIds]) {
      check(seenGreen.has(id), `${now} ms: ${id} ei saanud ${Math.round((now - greenCheckFrom) / 1000)} s jooksul rohelist`);
    }
  }
  if (greenCheckFrom !== null && now === greenCheckFrom) seenGreen.clear();
}

if (failures) {
  console.error(`\n${failures} viga ${checks} kontrollist.`);
  process.exit(1);
}
console.log(`OK – ${checks} kontrolli, ${HOURS} h simulatsiooni, vigu pole.`);
