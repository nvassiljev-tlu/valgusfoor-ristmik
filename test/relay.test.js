// Relee test: käivitab server/relay.js-i ja ühendab sellega mitu lehte (js/sync.js) päris HTTP kaudu.
//
// Käivitamine:  node test/relay.test.js

"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { spawn } = require("child_process");

for (const file of ["js/junction.js", "js/controller.js", "js/sync.js"]) {
  const code = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  vm.runInThisContext(code, { filename: file });
}
const { SyncSession, RelayClient, randomId, relayTimeSource } = globalThis.Sync;

let failures = 0;
function check(ok, message) {
  if (!ok) failures++;
  console.log((ok ? "ok    " : "VIGA  ") + message);
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (condition()) return true;
    await wait(20);
  }
  return condition();
}

// Brauseri EventSource Node'is (ainult see osa, mida RelayClient kasutab)
class NodeEventSource {
  constructor(url) {
    this.abort = new AbortController();
    this.read(url);
  }
  async read(url) {
    try {
      const res = await fetch(url, { signal: this.abort.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      if (this.onopen) this.onopen();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) throw new Error("ühendus suleti");
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          let type = "message";
          const data = [];
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) type = line.slice(6).trim();
            if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
          }
          if (type === "message" && this.onmessage) this.onmessage({ data: data.join("\n") });
        }
      }
    } catch (e) {
      if (!this.closed && this.onerror) this.onerror(e);
    }
  }
  close() {
    this.closed = true;
    this.abort.abort();
  }
}

const clock = { now: () => Date.now() };
const page = () =>
  new SyncSession({ clock, relay: (options) => new RelayClient({ ...options, EventSource: NodeEventSource }) });
const settle = (...pages) => {
  const t = Date.now();
  for (const p of pages) p.advance(t);
};
const sameState = (a, b) => {
  const t = Date.now();
  a.advance(t);
  b.advance(t);
  const sa = a.controller.states(t);
  const sb = b.controller.states(t);
  return JSON.stringify([sa.cars, sa.peds]) === JSON.stringify([sb.cars, sb.peds]);
};

(async () => {
  const relay = spawn(process.execPath, [path.join(__dirname, "..", "server", "relay.js"), "0"]);
  const port = await new Promise((resolve, reject) => {
    relay.stdout.on("data", (chunk) => {
      const m = /pordil (\d+)/.exec(String(chunk));
      if (m) resolve(Number(m[1]));
    });
    relay.on("exit", () => reject(new Error("relee ei käivitunud")));
  });
  const server = `http://localhost:${port}`;
  const room = "test" + randomId(8);
  try {
    const source = relayTimeSource(server);
    const res = await fetch(source.url);
    const relayTime = await source.parse(res);
    check(Math.abs(relayTime - Date.now()) < 1000, "relee annab kellaaja (/aeg)");

    const pc1 = page();
    const pc2 = page();
    pc1.connect(server, room);
    pc2.connect(server, room);
    check(await until(() => pc1.ready && pc2.ready && pc2.status === "connected", 5000), "kaks lehte liitusid ruumiga");

    pc1.requestMode(false, "oo");
    check(await until(() => pc2.pending && pc2.pending.mode === "oo", 1400), "muutus jõudis teise lehte enne kehtima hakkamist");
    await wait(2000);
    settle(pc1, pc2);
    check(pc2.setting.mode === "oo" && !pc2.setting.auto && sameState(pc1, pc2), "mõlemad lehed on samas öörežiimis");

    const pc3 = page();
    pc3.connect(server, room);
    check(await until(() => pc3.ready, 5000), "kolmas leht liitus hiljem");
    check(pc3.setting.mode === "oo" && sameState(pc1, pc3), "hiljem liitunud leht sai sama oleku");

    pc3.requestMode(true, "paev");
    await wait(2200);
    settle(pc1, pc2, pc3);
    check(
      [pc1, pc2].every((p) => p.setting.auto) && sameState(pc1, pc2) && sameState(pc1, pc3),
      "kolmanda lehe muutus jõudis kõigini",
    );

    pc2.relay.es.close();
    pc2.relay.es.onerror();
    pc1.requestMode(false, "ohtu");
    check(await until(() => pc2.status === "connected", 6000), "katkenud ühendus taastus");
    await wait(2000);
    settle(pc1, pc2);
    check(pc2.setting.mode === "ohtu" && sameState(pc1, pc2), "katkestuse ajal saadetud muutus jõudis kohale");

    for (const p of [pc1, pc2, pc3]) p.disconnect();
  } finally {
    relay.kill();
  }

  if (failures) {
    console.error(`\n${failures} viga.`);
    process.exit(1);
  }
  console.log("\nOK – relee töötab.");
})();
