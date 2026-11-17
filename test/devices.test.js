// Seadmete sidetest: kontrollib js/devices.js-i võltsplaatidega, mis vastavad nagu päris püsivara.
//
// Käivitamine:  node test/devices.test.js

"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

for (const file of ["js/junction.js", "js/controller.js", "js/devices.js"]) {
  const code = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  vm.runInThisContext(code, { filename: file });
}
const J = globalThis.JUNCTION;
const { Controller } = globalThis.Signals;
const { DeviceManager } = globalThis;

let failures = 0;
function check(ok, message) {
  if (!ok) failures++;
  console.log((ok ? "ok    " : "VIGA  ") + message);
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 5));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const options = (extra) => ({
  defaultLight: (taken) => J.LIGHTS.find((l) => !taken.includes(l.id)),
  isLight: (id) => J.LIGHTS.some((l) => l.id === id),
  isCrossing: (id) => J.CROSSINGS.some((c) => c.id === id),
  ...extra,
});

// firmware: "uus" (nagu sketch_valgusfoor.ino), "vana" (ei tunne KES?), "vait" (ei vasta)
// või "taaskäivitub" (pordi avamisel läheb hetkeks taaskäivitusse ja saadab siis READY)
class FakeBoard {
  constructor({ id = "3F2A1C", stored = "-,-", firmware = "uus" } = {}) {
    this.id = id;
    this.stored = stored;
    this.firmware = firmware;
    this.written = [];
    this.lights = null;
  }
  async open() {
    this.readable = new ReadableStream({ start: (c) => (this.ctrl = c) });
    this.writable = new WritableStream({
      write: (chunk) => {
        for (const line of new TextDecoder().decode(chunk).split("\n")) {
          if (line) {
            this.written.push(line);
            this.respond(line);
          }
        }
      },
    });
    this.lights = null;
    if (this.firmware === "taaskäivitub") {
      this.booting = true;
      setTimeout(() => {
        this.booting = false;
        this.reply("\r\nREADY\r\n");
      }, 20);
    }
  }
  respond(line) {
    if (this.firmware === "vait" || this.booting) return;
    if (line === "KES?") {
      this.reply(this.firmware === "vana" ? "VIGA KES?\r\n" : `SEADE:${this.id},${this.stored}\r\n`);
      return;
    }
    const name = line.slice(0, line.indexOf(":"));
    const value = line.slice(line.indexOf(":") + 1);
    if (name === "MAARA") {
      if (this.firmware !== "vana") this.stored = value;
      this.reply(`OK ${line}\r\n`);
    } else if (name === "TULED") {
      if (value !== this.lights) {
        this.lights = value;
        this.reply(`OK ${line}\r\n`);
      }
    } else {
      this.reply(`VIGA ${line}\r\n`);
    }
  }
  async close() {}
  reply(text) {
    this.ctrl.enqueue(new TextEncoder().encode(text));
  }
  unplug() {
    this.ctrl.error(new Error("juhe tõmmati välja"));
  }
}

(async () => {
  const dm = new DeviceManager(options());
  const port = new FakeBoard();
  const dev = await dm.open(port);
  await flush();
  check(dev.status === "connected", "seade on ühendatud");
  check(port.written[0] === "KES?", "leht küsib kõigepealt, mida plaat mäletab (KES?)");
  check(dev.boardId === "3F2A1C", "plaadi kiibi number loeti vastusest");
  check(
    dev.light === "F1" && port.written[1] === "MAARA:F1,U1",
    "tühja mäluga plaat saab vaikimisi F1 ja Ü1 (MAARA:F1,U1)",
  );
  check(port.stored === "F1,U1", "plaat jättis määrangu meelde");

  const ctrl = new Controller(0, "paev");
  const expected = [];
  let lastWriteAt = 0;
  let maxGap = 0;
  let lateChanges = 0;
  let prevState = null;
  let prevCount = port.written.length;
  for (let now = 0; now <= 180000; now += 50) {
    ctrl.update(now);
    const st = ctrl.states(now);
    const state = "TULED:" + st.cars.F1 + st.peds["Ü1"];
    if (state !== prevState) {
      expected.push(state);
      prevState = state;
    }
    dm.tick(st, now);
    await flush();
    if (port.written.length > prevCount) {
      maxGap = Math.max(maxGap, now - lastWriteAt);
      lastWriteAt = now;
      if (port.written[port.written.length - 1] !== state) lateChanges++;
      prevCount = port.written.length;
    }
  }
  const tuled = port.written.filter((l) => l.startsWith("TULED:"));
  const sent = tuled.filter((l, i) => i === 0 || l !== tuled[i - 1]);
  check(
    JSON.stringify(sent) === JSON.stringify(expected),
    `iga olekumuutus saadeti kohe ja õiges järjekorras (${sent.length} muutust)`,
  );
  check(lateChanges === 0, "viimane saadetud olek on alati praegune olek");
  check(maxGap <= 1000, `elusolek: sõnumite vahe on kuni 1 s (suurim ${maxGap} ms)`);
  check(tuled.every((l) => /^TULED:[012]{5}$/.test(l)), "kõik TULED käsud on õige kujuga");

  port.written.length = 0;
  port.reply("\r\nÿ\u0001garbage\r\nREADY\r\n");
  await flush();
  dm.tick(ctrl.states(180050), 180050);
  await flush();
  check(port.written[0] === "MAARA:F1,U1", "READY peale saadetakse MAARA uuesti");
  check(/^TULED:/.test(port.written[1] || ""), "READY peale saadetakse TULED kohe uuesti");
  check(
    dm.logLines.some((l) => l.endsWith("← READY")) && !dm.logLines.some((l) => l.includes("garbage")),
    "prügirida jäeti vahele, READY loeti",
  );

  port.written.length = 0;
  dm.assign(dev, "F3", "Ü8");
  const st = ctrl.states(180100);
  dm.tick(st, 180100);
  await flush();
  check(port.written[0] === "MAARA:F3,U8", "uus määrang: MAARA:F3,U8");
  check(port.written[1] === "TULED:" + st.cars.F3 + st.peds["Ü8"], "kohe järel F3 ja Ü8 olek");
  check(port.stored === "F3,U8", "plaat jättis uue määrangu meelde");

  port.reply("RIKE\n");
  await flush();
  check(dev.fault === true, "RIKE märgitakse seadmele");
  port.reply("OK TULED:10010\n");
  await flush();
  check(dev.fault === false, "OK TULED lõpetab rikke");

  const port2 = new FakeBoard({ id: "00AB12" });
  const dev2 = await dm.open(port2);
  await flush();
  check(
    dev2.light === "F1" && port2.written.includes("MAARA:F1,U1"),
    "teine tühja mäluga plaat saab esimese vaba foori (F1, Ü1)",
  );

  port.unplug();
  await flush();
  await flush();
  check(dev.status === "lost", "lahtiühendamisel muutub olek 'ühendus katkes'");
  port.written.length = 0;
  dm.tick(ctrl.states(181000), 181000);
  check(port.written.length === 0, "katkenud seadmele ei saadeta midagi");

  await dm.reconnect(dev);
  await flush();
  check(dev.status === "connected" && port.written[0] === "MAARA:F3,U8", "uuesti ühendamisel jääb määrang alles");

  const many = new DeviceManager(options());
  const boards = [];
  for (let i = 0; i < J.LIGHTS.length; i++) {
    const p = new FakeBoard({ id: "B" + i });
    boards.push({ port: p, dev: await many.open(p) });
    await flush();
  }
  check(
    boards.every((b, i) => b.dev.light === J.LIGHTS[i].id && b.dev.crossing === J.LIGHTS[i].pair),
    "8 plaati korraga: igaüks saab vaikimisi eri foori (F1–F8) ja selle paarisraja",
  );

  const plan = boards.map((b, i) => [J.LIGHTS[(i + 3) % 8].id, J.CROSSINGS[(i + 5) % 9].id]);
  boards.forEach((b, i) => many.assign(b.dev, plan[i][0], plan[i][1]));
  await flush();
  check(
    boards.every((b, i) => b.port.written.at(-1) === `MAARA:${plan[i][0]},${plan[i][1].replace("Ü", "U")}`),
    "igale plaadile läks tema enda MAARA",
  );

  for (const b of boards) b.port.written.length = 0;
  const ctrl8 = new Controller(0, "paev");
  const expected8 = boards.map(() => []);
  for (let now = 0; now <= 120000; now += 50) {
    ctrl8.update(now);
    const st8 = ctrl8.states(now);
    boards.forEach((b, i) => {
      const line = "TULED:" + st8.cars[b.dev.light] + st8.peds[b.dev.crossing];
      if (expected8[i].at(-1) !== line) expected8[i].push(line);
    });
    many.tick(st8, now);
  }
  await flush();
  const changesOf = (lines) => lines.filter((l, i) => l !== lines[i - 1]);
  check(
    boards.every((b, i) => JSON.stringify(changesOf(b.port.written)) === JSON.stringify(expected8[i])),
    "8 plaati korraga: iga plaat sai ainult oma foori olekud õiges järjekorras",
  );
  check(new Set(expected8.map((e) => e.join())).size === 8, "8 plaadi olekute jadad on kõik erinevad");

  boards[2].port.unplug();
  await flush();
  await flush();
  for (const b of boards) b.port.written.length = 0;
  ctrl8.update(125000);
  many.tick(ctrl8.states(125000), 125000);
  await flush();
  check(
    boards[2].dev.status === "lost" &&
      boards[2].port.written.length === 0 &&
      boards.every((b, i) => i === 2 || b.port.written.length === 1),
    "ühe plaadi lahtiühendamine teisi plaate ei sega",
  );

  many.assign(boards[1].dev, boards[0].dev.light, boards[0].dev.crossing);
  ctrl8.update(125050);
  const st9 = ctrl8.states(125050);
  many.tick(st9, 125050);
  await flush();
  const same = "TULED:" + st9.cars[boards[0].dev.light] + st9.peds[boards[0].dev.crossing];
  check(
    boards[0].port.written.at(-1) === same && boards[1].port.written.at(-1) === same,
    "kaks plaati võivad näidata sama foori",
  );

  const reloaded = new DeviceManager(options());
  for (const b of boards) b.port.written.length = 0;
  const again = [];
  for (const b of boards) {
    again.push(await reloaded.open(b.port));
    await flush();
  }
  check(
    again.every((d, i) => d.light === boards[i].dev.light && d.crossing === boards[i].dev.crossing),
    "lehe uuesti laadimisel saab iga plaat tagasi oma foori",
  );
  check(
    boards.every((b) => b.port.written.join() === "KES?"),
    "meelde jäetud foori pole vaja uuesti saata (ainult KES?)",
  );
  const ctrlR = new Controller(0, "paev");
  ctrlR.update(30000);
  const stR = ctrlR.states(30000);
  reloaded.tick(stR, 30000);
  await flush();
  check(
    boards.every(
      (b, i) => b.port.written.at(-1) === "TULED:" + stR.cars[again[i].light] + stR.peds[again[i].crossing],
    ),
    "pärast uuesti laadimist saab iga plaat kohe oma foori tuled",
  );

  const before = again[4];
  boards[4].port.unplug();
  await flush();
  await flush();
  const replugged = new FakeBoard({ id: boards[4].port.id, stored: boards[4].port.stored });
  const after = await reloaded.open(replugged);
  await flush();
  check(
    before.status === "lost" &&
      after.number === before.number &&
      after.light === before.light &&
      after.crossing === before.crossing &&
      !reloaded.devices.includes(before) &&
      reloaded.devices.length === 8 &&
      reloaded.devices.indexOf(after) === 4,
    "USB-st välja ja tagasi: plaat saab tagasi oma numbri, foori ja koha, vana rida kaob",
  );

  const edge1 = new DeviceManager(options());
  const legacy = new FakeBoard({ firmware: "vana" });
  const devOld = await edge1.open(legacy);
  await flush();
  check(
    devOld.light === "F1" && legacy.written.join() === "KES?,MAARA:F1,U1",
    "vana püsivara (VIGA KES?): plaat saab kohe vaikimisi foori",
  );

  const edge2 = new DeviceManager(options({ identifyMs: 30 }));
  const silent = new FakeBoard({ firmware: "vait" });
  const devSilent = await edge2.open(silent);
  edge2.tick(new Controller(0, "paev").states(0), 0);
  await flush();
  check(!silent.written.some((l) => l.startsWith("TULED")), "tuvastamata plaadile tulesid ei saadeta");
  await wait(150);
  check(
    silent.written.filter((l) => l === "KES?").length === 3 &&
      devSilent.light === "F1" &&
      silent.written.at(-1) === "MAARA:F1,U1",
    "vastuseta plaat: kolm KES? küsimust, siis vaikimisi foor",
  );

  const rebooting = new FakeBoard({ id: "77AA01", stored: "F7,U4", firmware: "taaskäivitub" });
  const devBoot = await edge2.open(rebooting);
  await wait(80);
  check(
    devBoot.light === "F7" &&
      devBoot.crossing === "Ü4" &&
      rebooting.written.filter((l) => l === "KES?").length >= 2 &&
      !rebooting.written.some((l) => l.startsWith("MAARA")),
    "pordi avamisel taaskäivituv plaat: leht küsib READY järel uuesti ja foor jääb alles",
  );

  const edge3 = new DeviceManager(options());
  const bogus = new FakeBoard({ id: "<b>x</b>", stored: "F9,U8" });
  const devBogus = await edge3.open(bogus);
  await flush();
  check(devBogus.boardId === null, "vigane kiibi number jäetakse kõrvale");
  check(
    devBogus.light === "F1" && bogus.stored === "F1,U1",
    "tundmatu meelde jäetud foor (F9) asendatakse vaikimisi fooriga",
  );
  const crossingOnly = new FakeBoard({ id: "C0FFEE", stored: "-,U8" });
  const devCrossing = await edge3.open(crossingOnly);
  await flush();
  check(devCrossing.light === null && devCrossing.crossing === "Ü8", "ainult ülekäik (-,U8) jääb samuti meelde");

  const edge4 = new DeviceManager(options({ identifyMs: 30 }));
  const slow = new FakeBoard({ firmware: "vait" });
  const devSlow = await edge4.open(slow);
  edge4.assign(devSlow, "F2", "Ü4");
  await wait(150);
  check(
    devSlow.light === "F2" &&
      slow.written.filter((l) => l === "KES?").length === 1 &&
      slow.written.at(-1) === "MAARA:F2,U4",
    "kasutaja valik enne tuvastamist jääb kehtima",
  );

  if (failures) {
    console.error(`\n${failures} viga.`);
    process.exit(1);
  }
  console.log("\nOK – seadmete side töötab.");
})();
