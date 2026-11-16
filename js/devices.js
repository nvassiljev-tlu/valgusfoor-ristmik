// Füüsilised foorid: ESP8266 plaadid USB kaudu (Web Serial, ainult Chrome ja Edge).
// Protokoll on kirjas README.md-s ja sketch_valgusfoor.ino päises.

(function () {
  "use strict";

  const BAUD = 115200;
  const KEEPALIVE_MS = 1000; // plaat läheb 5 s vaikuse järel rikkerežiimi
  const MAX_LOG = 300;

  // Jadapordis on ainult ASCII: "Ü8" -> "U8"
  const ascii = (id) => (id ? id.replace("Ü", "U") : "-");

  class DeviceManager {
    constructor({ onChange, onLog, defaultLight }) {
      this.devices = [];
      this.nextNumber = 1;
      this.onChange = onChange || (() => {});
      this.onLog = onLog || (() => {});
      this.defaultLight = defaultLight || (() => null);
      this.encoder = new TextEncoder();
      this.logLines = [];
      if (this.supported) {
        // Varem lubatud plaat ühendati uuesti USB-sse
        navigator.serial.addEventListener("connect", (e) => this.open(e.target));
      }
    }

    get supported() {
      return "serial" in navigator;
    }

    log(dev, text) {
      const time = new Date().toLocaleTimeString("et-EE");
      const line = `${time}  ${dev ? dev.name + " " : ""}${text}`;
      this.logLines.push(line);
      if (this.logLines.length > MAX_LOG) this.logLines.shift();
      this.onLog(line);
    }

    async add() {
      let port;
      try {
        port = await navigator.serial.requestPort();
      } catch (e) {
        return null; // kasutaja sulges akna
      }
      return this.open(port);
    }

    async reconnectGranted() {
      if (!this.supported) return;
      for (const port of await navigator.serial.getPorts()) this.open(port);
    }

    async open(port) {
      let dev = this.devices.find((d) => d.port === port);
      if (dev && (dev.status === "connected" || dev.status === "connecting")) return dev;
      if (!dev) {
        const number = this.nextNumber++;
        const light = this.defaultLight(this.devices.map((d) => d.light));
        dev = {
          port,
          number,
          name: "Seade " + number,
          light: light ? light.id : null,
          crossing: light ? light.pair : null,
          status: "connecting",
          error: "",
          lastSent: "",
          lastSentAt: 0,
          lastReply: "",
          fault: false,
        };
        this.devices.push(dev);
      }
      dev.status = "connecting";
      dev.error = "";
      this.onChange();
      try {
        await port.open({ baudRate: BAUD });
      } catch (e) {
        dev.status = "error";
        dev.error =
          e.name === "InvalidStateError"
            ? "port on juba avatud (kas mõni teine vahekaart või Arduino IDE Serial Monitor kasutab seda?)"
            : e.message;
        this.log(dev, "Ühendus ebaõnnestus: " + dev.error);
        this.onChange();
        return dev;
      }
      dev.writer = port.writable.getWriter();
      dev.status = "connected";
      dev.fault = false;
      dev.lastSent = "";
      this.log(dev, "Ühendatud.");
      dev.readDone = this.readLoop(dev);
      // Kui plaat pordi avamisel ei taaskäivitunud, READY-t ei tule
      this.sendAssignment(dev);
      this.onChange();
      return dev;
    }

    send(dev, line, quiet) {
      if (!dev.writer) return;
      dev.writer.write(this.encoder.encode(line + "\n")).catch(() => {});
      if (!quiet) this.log(dev, "→ " + line);
    }

    sendAssignment(dev) {
      this.send(dev, `MAARA:${dev.light || "-"},${ascii(dev.crossing)}`);
      dev.lastSent = ""; // järgmine tick saadab TULED kohe
    }

    assign(dev, light, crossing) {
      if (light !== undefined) dev.light = light;
      if (crossing !== undefined) dev.crossing = crossing;
      if (dev.status === "connected") this.sendAssignment(dev);
      this.onChange();
    }

    tick(states, now) {
      for (const dev of this.devices) {
        if (dev.status !== "connected") continue;
        const car = dev.light ? states.cars[dev.light] : "000";
        const ped = dev.crossing ? states.peds[dev.crossing] : "00";
        const line = "TULED:" + car + ped;
        if (line !== dev.lastSent) {
          this.send(dev, line);
          dev.lastSent = line;
          dev.lastSentAt = now;
        } else if (now - dev.lastSentAt >= KEEPALIVE_MS) {
          this.send(dev, line, true);
          dev.lastSentAt = now;
        }
      }
    }

    async readLoop(dev) {
      const reader = dev.port.readable.getReader();
      dev.reader = reader;
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop();
          for (const line of lines) this.handleLine(dev, line.trim());
          if (buffer.length > 200) buffer = "";
        }
      } catch (e) {
        // juhe tõmmati välja vms
      } finally {
        reader.releaseLock();
      }
      if (dev.closing) return;
      // Lugemine lõppes ise: close() ei tohi seda tsüklit ootama jääda
      dev.reader = null;
      dev.readDone = null;
      await this.close(dev);
      dev.status = "lost";
      this.log(dev, "Ühendus katkes.");
      this.onChange();
    }

    handleLine(dev, line) {
      // Plaadi käivitusprügi (teisel kiirusel saadetud baidid) jätame vahele
      if (!line || /[^\x20-\x7e]/.test(line)) return;
      this.log(dev, "← " + line);
      dev.lastReply = line;
      const hadFault = dev.fault;
      if (line === "READY") {
        dev.fault = false;
        this.sendAssignment(dev);
      } else if (line === "RIKE") {
        dev.fault = true;
      } else if (line.startsWith("OK TULED")) {
        dev.fault = false;
      }
      if (dev.fault !== hadFault) this.onChange();
    }

    async close(dev) {
      dev.closing = true;
      const { reader, writer, readDone } = dev;
      dev.reader = dev.writer = null;
      try {
        if (reader) await reader.cancel();
      } catch (e) {}
      try {
        if (readDone) await readDone;
      } catch (e) {}
      try {
        if (writer) writer.releaseLock();
      } catch (e) {}
      try {
        await dev.port.close();
      } catch (e) {}
      dev.closing = false;
    }

    async disconnect(dev) {
      if (dev.status === "connected") await this.close(dev);
      dev.status = "lost";
      this.log(dev, "Ühendus katkestatud.");
      this.onChange();
    }

    async reconnect(dev) {
      return this.open(dev.port);
    }

    remove(dev) {
      const i = this.devices.indexOf(dev);
      if (i >= 0) this.devices.splice(i, 1);
      this.onChange();
    }

    downloadLog() {
      const blob = new Blob([this.logLines.join("\n") + "\n"], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "foorid-logi-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".txt";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  }

  globalThis.DeviceManager = DeviceManager;
})();
