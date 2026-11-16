// Seadmete sidetest: kontrollib js/devices.js-i võltsitud jadapordiga, mis salvestab lehe
// saadetud read ja laseb "plaadil" vastata.
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

class FakePort {
  constructor() {
    this.written = [];
  }
  async open() {
    this.readable = new ReadableStream({ start: (c) => (this.ctrl = c) });
    this.writable = new WritableStream({
      write: (chunk) => {
        for (const line of new TextDecoder().decode(chunk).split("\n")) {
          if (line) this.written.push(line);
        }
      },
    });
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
  const dm = new DeviceManager({
    defaultLight: (taken) => J.LIGHTS.find((l) => !taken.includes(l.id)),
  });
  const port = new FakePort();
  const dev = await dm.open(port);
  await flush();
  check(dev.status === "connected", "seade on ühendatud");
  check(port.written[0] === "MAARA:F1,U1", "esimene seade saab vaikimisi F1 ja Ü1 (MAARA:F1,U1)");

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
  check(dev.lastReply === "READY", "prügirida jäeti vahele, READY loeti");

  port.written.length = 0;
  dm.assign(dev, "F3", "Ü8");
  const st = ctrl.states(180100);
  dm.tick(st, 180100);
  await flush();
  check(port.written[0] === "MAARA:F3,U8", "uus määrang: MAARA:F3,U8");
  check(port.written[1] === "TULED:" + st.cars.F3 + st.peds["Ü8"], "kohe järel F3 ja Ü8 olek");

  port.reply("RIKE\n");
  await flush();
  check(dev.fault === true, "RIKE märgitakse seadmele");
  port.reply("OK TULED:10010\n");
  await flush();
  check(dev.fault === false, "OK TULED lõpetab rikke");

  const port2 = new FakePort();
  const dev2 = await dm.open(port2);
  check(
    dev2.light === "F1" && port2.written[0] === "MAARA:F1,U1",
    "teine seade saab esimese vaba foori (F1, Ü1)",
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

  if (failures) {
    console.error(`\n${failures} viga.`);
    process.exit(1);
  }
  console.log("\nOK – seadmete side töötab.");
})();
