// Lehe põhiloogika: kell, režiimi valik, kontrolleri käitamine, kaart, nimekirjad ja seadmed.

(function () {
  "use strict";

  const J = globalThis.JUNCTION;
  const { Controller, CAR_STATE_NAMES, PED_STATE_NAMES, PED_GREEN } = globalThis.Signals;
  const $ = (id) => document.getElementById(id);
  const lightById = Object.fromEntries(J.LIGHTS.map((l) => [l.id, l]));
  const crossingById = Object.fromEntries(J.CROSSINGS.map((c) => [c.id, c]));

  // Õige kellaaeg internetist; automaatrežiim valib selle järgi režiimi
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
  let clockOffset = 0;
  const wallClock = () => new Date(Date.now() + clockOffset);

  async function syncClock() {
    const el = $("ajaAllikas");
    for (const src of TIME_SOURCES) {
      try {
        const sent = Date.now();
        const res = await fetch(src.url, { cache: "no-store", signal: AbortSignal.timeout(4000) });
        const time = await src.parse(res);
        if (!isFinite(time)) throw new Error("vale vastus");
        const received = Date.now();
        // Server saatis aja umbes poole päringu ajaga varem, kui vastus kohale jõudis
        clockOffset = Math.round(time + (received - sent) / 2 - received);
        el.textContent = `aeg: ${src.name} (arvuti kell ${Math.abs(clockOffset)} ms ${clockOffset > 0 ? "maas" : "ees"})`;
        el.className = "vaike";
        return;
      } catch (e) {
        // proovime järgmist allikat
      }
    }
    clockOffset = 0;
    el.textContent = "internet ei vastanud – kasutan arvuti kella";
    el.className = "vaike hoiatus";
  }

  function scheduledMode(date) {
    const minutes = date.getHours() * 60 + date.getMinutes();
    let mode = J.SCHEDULE[0].mode;
    for (const entry of J.SCHEDULE) {
      const [h, m] = entry.from.split(":").map(Number);
      if (h * 60 + m <= minutes) mode = entry.mode;
    }
    return mode;
  }

  let auto = true;
  let manualMode = "paev";
  let selected = null;
  const wantedMode = () => (auto ? scheduledMode(wallClock()) : manualMode);

  // Kontroller kasutab monotoonset kella, et kella sünkroniseerimine foore ei hüpitaks
  const controller = new Controller(performance.now(), wantedMode());

  const map = createMap($("kaart"), select);
  const timeline = createTimeline($("ajajoon"));
  const devices = new DeviceManager({
    onChange: renderDevices,
    onLog: appendLog,
    defaultLight: (taken) => J.LIGHTS.find((l) => !taken.includes(l.id)) || J.LIGHTS[0],
  });

  function step(now) {
    controller.setMode(wantedMode(), now);
    controller.update(now);
  }

  // Seadmetele saatmine käib taimeriga, sest requestAnimationFrame seisab, kui vahekaart pole nähtav
  setInterval(() => {
    const now = performance.now();
    step(now);
    devices.tick(controller.states(now), now);
  }, 50);

  function renderModeButtons() {
    for (const btn of document.querySelectorAll("[data-reziim]")) {
      const key = btn.dataset.reziim;
      btn.setAttribute("aria-pressed", String(key === "auto" ? auto : !auto && key === manualMode));
    }
    const shown = auto ? scheduledMode(wallClock()) : manualMode;
    $("reziimiInfo").textContent =
      (auto ? "Režiim vahetub ise kellaaja järgi. Praegu: " + J.MODES[shown].name + ". " : "") +
      J.MODES[shown].description;
  }
  for (const btn of document.querySelectorAll("[data-reziim]")) {
    btn.addEventListener("click", () => {
      const key = btn.dataset.reziim;
      auto = key === "auto";
      if (!auto) manualMode = key;
      step(performance.now());
      renderModeButtons();
    });
  }
  $("ajakava").textContent =
    "Ajakava: " +
    J.SCHEDULE.map((entry, i) => {
      const to = (J.SCHEDULE[i + 1] || { from: "24:00" }).from;
      return `${entry.from}–${to} ${J.MODES[entry.mode].name.toLowerCase()}`;
    }).join(" · ");

  for (const btn of document.querySelectorAll("[data-alus]")) {
    btn.addEventListener("click", () => {
      map.setBase(btn.dataset.alus);
      for (const b of document.querySelectorAll("[data-alus]")) {
        b.setAttribute("aria-pressed", String(b === btn));
      }
    });
  }
  $("naitaSuundi").addEventListener("change", (e) => map.setArrows(e.target.checked));

  const rows = {};
  function buildLists() {
    for (const light of J.LIGHTS) {
      const li = document.createElement("li");
      li.className = "rida";
      li.tabIndex = 0;
      li.innerHTML = `
        <span class="mini auto"><i class="punane"></i><i class="kollane"></i><i class="roheline"></i></span>
        <span class="tahis">${light.id}</span>
        <span class="kirjeldus">${light.name}</span>
        <span class="olek"></span>
        <span class="seade-kiip"></span>`;
      li.addEventListener("click", () => select(light.id));
      li.addEventListener("keydown", (e) => e.key === "Enter" && select(light.id));
      $("autoFoorid").appendChild(li);
      rows[light.id] = { li, lamps: li.querySelectorAll(".mini i"), state: li.querySelector(".olek"), dev: li.querySelector(".seade-kiip") };
    }
    for (const c of J.CROSSINGS) {
      const li = document.createElement("li");
      li.className = "rida";
      li.tabIndex = 0;
      li.title = c.name;
      li.innerHTML = `
        <span class="mini jk"><i class="punane"></i><i class="roheline"></i></span>
        <span class="tahis">${c.id}</span>
        <span class="olek"></span>`;
      li.addEventListener("click", () => select(c.id));
      li.addEventListener("keydown", (e) => e.key === "Enter" && select(c.id));
      $("jkFoorid").appendChild(li);
      rows[c.id] = { li, lamps: li.querySelectorAll(".mini i"), state: li.querySelector(".olek") };
    }
  }

  const lit = (digit, blinkOn) => digit === "1" || (digit === "2" && blinkOn);
  const seconds = (ms) => Math.max(1, Math.ceil(ms / 1000)) + " s";

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  function stateText(id, state, changes) {
    const name = id in lightById ? CAR_STATE_NAMES[state] : PED_STATE_NAMES[state];
    const next = changes[id];
    return next ? `${name} · ${seconds(next.inMs)}` : name;
  }

  function renderLists(st, changes, badges) {
    for (const light of J.LIGHTS) {
      const r = rows[light.id];
      const s = st.cars[light.id];
      r.lamps.forEach((lamp, i) => lamp.classList.toggle("on", lit(s[i], st.blinkOn)));
      setText(r.state, stateText(light.id, s, changes));
      setText(r.dev, badges[light.id] || "");
      r.li.classList.toggle("valitud", selected === light.id);
    }
    for (const c of J.CROSSINGS) {
      const r = rows[c.id];
      const s = st.peds[c.id];
      r.lamps.forEach((lamp, i) => lamp.classList.toggle("on", lit(s[i], st.blinkOn)));
      setText(r.state, stateText(c.id, s, changes));
      r.li.classList.toggle("valitud", selected === c.id);
    }
  }

  function select(id) {
    selected = selected === id ? null : id;
    renderSelected();
  }

  function renderSelected() {
    const box = $("valitud");
    box.textContent = "";
    if (!selected) {
      box.innerHTML = '<p class="vaike">Klõpsa kaardil või nimekirjas foori või ülekäigurada.</p>';
      return;
    }
    const isCar = selected in lightById;
    const item = isCar ? lightById[selected] : crossingById[selected];
    const stages = J.STAGES.filter((s, k) =>
      isCar ? s.cars.includes(selected) : PED_GREEN[k].includes(selected),
    ).map((s) => s.id);
    const extra = isCar
      ? `Jalakäijate paar: ${item.pair}`
      : `Üle sõidavad: ${item.conflicts.join(", ")}`;
    box.innerHTML = `
      <div class="valitud-pais"><span class="tahis suur">${item.id}</span><span>${isCar ? item.name : "Ülekäigurada " + item.name}</span></div>
      <p class="valitud-olek" id="valitudOlek"></p>
      <p class="vaike">Roheline faasides: ${stages.join(", ")} · ${extra}</p>
      <div class="maara" id="maara"></div>`;
    const assign = $("maara");
    const connected = devices.devices.filter((d) => d.status === "connected");
    if (!connected.length) {
      assign.innerHTML = '<p class="vaike">Ühenda ESP, et see foor füüsiliselt peegeldada.</p>';
      return;
    }
    for (const dev of connected) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = `Näita seadmel ${dev.number}`;
      btn.addEventListener("click", () => {
        if (isCar) devices.assign(dev, item.id, item.pair);
        else devices.assign(dev, undefined, item.id);
      });
      assign.appendChild(btn);
    }
  }

  let pendingDeviceRender = false;

  function renderDevices() {
    const box = $("seadmed");
    // Ümberehitamine sulgeks avatud rippmenüü – teeme selle pärast valikut
    if (box.contains(document.activeElement) && document.activeElement.tagName === "SELECT") {
      pendingDeviceRender = true;
      return;
    }
    pendingDeviceRender = false;
    box.textContent = "";
    if (!devices.devices.length) {
      box.innerHTML =
        '<p class="vaike">Ühenda ESP8266 USB-kaabliga ja vajuta „+ Ühenda ESP“. Seejärel vali, millist foori see näitab.</p>';
    }
    for (const dev of devices.devices) {
      const el = document.createElement("div");
      el.className = "seade";
      const statusText = {
        connecting: "ühendan…",
        connected: dev.fault ? "ühendatud, RIKE" : "ühendatud",
        lost: "ühendus katkes",
        error: "viga",
      }[dev.status];
      const statusClass = dev.status === "connected" && !dev.fault ? "ok" : dev.status === "connecting" ? "" : "viga";
      el.innerHTML = `
        <div class="seade-pais">
          <span class="seade-nimi"><span class="seade-nr">${dev.number}</span>${dev.name}</span>
          <span class="seade-olek ${statusClass}">${statusText}</span>
          <span class="seade-nupud"></span>
        </div>
        ${dev.error ? `<p class="hoiatus">${dev.error}</p>` : ""}
        <div class="seade-valikud">
          <label>Autode foor<select data-mis="auto"></select></label>
          <label>Jalakäijate foor<select data-mis="jk"></select></label>
        </div>
        <div class="seade-side vaike">Saadetud <code data-mis="saadetud">–</code> · vastus <code data-mis="vastus">–</code></div>`;
      const carSelect = el.querySelector('[data-mis="auto"]');
      const pedSelect = el.querySelector('[data-mis="jk"]');
      carSelect.add(new Option("– puudub –", ""));
      for (const light of J.LIGHTS) carSelect.add(new Option(`${light.id} – ${light.name}`, light.id));
      pedSelect.add(new Option("– puudub –", ""));
      for (const c of J.CROSSINGS) pedSelect.add(new Option(`${c.id} – ${c.name}`, c.id));
      carSelect.value = dev.light || "";
      pedSelect.value = dev.crossing || "";
      carSelect.addEventListener("change", () => {
        const light = lightById[carSelect.value];
        // Autode foori vahetusel tuleb kaasa ka selle foori jalakäijate paar
        devices.assign(dev, light ? light.id : null, light ? light.pair : dev.crossing);
      });
      pedSelect.addEventListener("change", () => devices.assign(dev, undefined, pedSelect.value || null));
      for (const s of [carSelect, pedSelect]) {
        s.addEventListener("blur", () => pendingDeviceRender && setTimeout(renderDevices));
      }
      const buttons = el.querySelector(".seade-nupud");
      const addButton = (text, fn) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = text;
        b.addEventListener("click", fn);
        buttons.appendChild(b);
      };
      if (dev.status === "connected") addButton("Katkesta", () => devices.disconnect(dev));
      if (dev.status === "lost" || dev.status === "error") {
        addButton("Ühenda uuesti", () => devices.reconnect(dev));
        addButton("Eemalda", () => devices.remove(dev));
      }
      dev.el = el;
      box.appendChild(el);
    }
    renderSelected();
  }

  function updateDeviceTexts() {
    for (const dev of devices.devices) {
      if (!dev.el) continue;
      setText(dev.el.querySelector('[data-mis="saadetud"]'), dev.lastSent || "–");
      setText(dev.el.querySelector('[data-mis="vastus"]'), dev.lastReply || "–");
    }
  }

  function deviceBadges() {
    const badges = {};
    for (const dev of devices.devices) {
      if (dev.status !== "connected" || !dev.light) continue;
      badges[dev.light] = (badges[dev.light] ? badges[dev.light] + ", " : "ESP ") + dev.number;
    }
    return badges;
  }

  function mirroredCrossings() {
    return new Set(
      devices.devices.filter((d) => d.status === "connected" && d.crossing).map((d) => d.crossing),
    );
  }

  $("lisaSeade").addEventListener("click", () => devices.add());
  $("salvestaLogi").addEventListener("click", () => devices.downloadLog());
  if (!devices.supported) {
    $("serialPuudub").hidden = false;
    $("lisaSeade").disabled = true;
  }

  const logLines = [];
  function appendLog(line) {
    logLines.push(line);
    if (logLines.length > 150) logLines.shift();
    const el = $("logi");
    el.textContent = logLines.join("\n");
    el.scrollTop = el.scrollHeight;
  }

  let changes = {};
  let changesAt = -Infinity;

  function frame() {
    const now = performance.now();
    step(now);
    const st = controller.states(now);
    if (now - changesAt > 200) {
      changes = controller.nextChanges(now);
      changesAt = now;
    }
    const badges = deviceBadges();
    map.update({
      cars: st.cars,
      peds: st.peds,
      blinkOn: st.blinkOn,
      allYellow: st.seg.type === "fromNight",
      devices: badges,
      selected,
      pairs: mirroredCrossings(),
    });
    renderLists(st, changes, badges);
    renderStatus(now, st);
    updateDeviceTexts();

    const selState = $("valitudOlek");
    if (selState && selected) {
      const s = selected in lightById ? st.cars[selected] : st.peds[selected];
      setText(selState, stateText(selected, s, changes));
    }

    const inCycle =
      controller.cycleStart !== null && (st.seg.type === "stage" || st.seg.type === "change");
    timeline.update(controller.mode, inCycle ? now - controller.cycleStart : null);
    const cycleLength = timeline.lengthOf(controller.mode);
    setText(
      $("ajajooneNimi"),
      "Fooritsükkel – " +
        J.MODES[controller.mode].name +
        (cycleLength ? ` (${Math.round(cycleLength / 1000)} s)` : ""),
    );

    setText($("kell"), wallClock().toLocaleTimeString("et-EE"));
    requestAnimationFrame(frame);
  }

  function renderStatus(now, st) {
    const d = controller.describe(now);
    setText($("faasiNimi"), d.title);
    setText($("faasiInfo"), d.detail);
    setText($("faasiAeg"), d.left === null ? "" : "veel " + seconds(d.left));
    $("edenemine").style.width = d.progress === null ? "100%" : Math.min(100, d.progress * 100) + "%";
    $("edenemine").classList.toggle("oo", st.seg.type === "night");
    setText(
      $("kehtivReziim"),
      J.MODES[controller.mode].name + (auto ? " · automaatne" : " · käsitsi"),
    );
    const wanted = controller.wanted;
    setText(
      $("ootel"),
      wanted !== controller.mode ? `→ ${J.MODES[wanted].name} (ohutult pärast praegust faasi)` : "",
    );
  }

  buildLists();
  renderModeButtons();
  renderDevices();
  map.setBase("skeem");
  requestAnimationFrame(frame);
  setInterval(renderModeButtons, 30000);
  syncClock().then(renderModeButtons);
  devices.reconnectGranted();
})();
