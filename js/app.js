// Lehe põhiloogika: kell, režiimi valik, kontrolleri käitamine, kaart, nimekirjad ja seadmed.

(function () {
  "use strict";

  const J = globalThis.JUNCTION;
  const { CAR_STATE_NAMES, PED_STATE_NAMES, PED_GREEN } = globalThis.Signals;
  const { SyncedClock, SyncSession, TIME_SOURCES, relayTimeSource, scheduledMode, randomId } = globalThis.Sync;
  const $ = (id) => document.getElementById(id);
  const lightById = Object.fromEntries(J.LIGHTS.map((l) => [l.id, l]));
  const crossingById = Object.fromEntries(J.CROSSINGS.map((c) => [c.id, c]));

  // Kõik arvutid arvutavad foorid sama, internetist sünkroniseeritud kella järgi (vt js/sync.js)
  let session = null;
  let clockReady = false;
  const clock = new SyncedClock({
    onJump: () => session && session.rebuild(),
    onStatus: renderClock,
  });
  session = new SyncSession({ clock, onChange: renderSync });
  const wallClock = () => new Date(clock.now());
  let selected = null;

  const map = createMap($("kaart"), select);
  const timeline = createTimeline($("ajajoon"));
  const devices = new DeviceManager({
    onChange: renderDevices,
    onLog: appendLog,
    defaultLight: (taken) => J.LIGHTS.find((l) => !taken.includes(l.id)) || J.LIGHTS[0],
    isLight: (id) => id in lightById,
    isCrossing: (id) => id in crossingById,
  });

  // Seadmetele saatmine käib taimeriga, sest requestAnimationFrame seisab, kui vahekaart pole nähtav.
  // Enne kella sünkroniseerimist ja ruumi oleku saamist plaatidele midagi ei saadeta.
  setInterval(() => {
    const now = clock.now();
    session.advance(now);
    if (clockReady && session.ready) devices.tick(session.controller.states(now), now);
  }, 50);

  function renderModeButtons() {
    const s = session.pending || session.setting;
    for (const btn of document.querySelectorAll("[data-reziim]")) {
      const key = btn.dataset.reziim;
      btn.setAttribute("aria-pressed", String(key === "auto" ? s.auto : !s.auto && key === s.mode));
    }
    const shown = s.auto ? scheduledMode(clock.now()) : s.mode;
    $("reziimiInfo").textContent =
      (s.auto ? "Režiim vahetub ise kellaaja järgi. Praegu: " + J.MODES[shown].name + ". " : "") +
      J.MODES[shown].description;
  }
  for (const btn of document.querySelectorAll("[data-reziim]")) {
    btn.addEventListener("click", () => {
      const key = btn.dataset.reziim;
      session.requestMode(key === "auto", key === "auto" ? scheduledMode(clock.now()) : key);
      renderModeButtons();
    });
  }

  function renderClock() {
    const el = $("ajaAllikas");
    const s = clock.status;
    if (s.synced) {
      el.textContent = `aeg: ${s.source} ±${s.accuracy} ms` + (s.failed ? " (viimane päring ebaõnnestus)" : "");
      el.className = "vaike";
    } else if (s.failed) {
      el.textContent = "internet ei vastanud – kasutan arvuti kella";
      el.className = "vaike hoiatus";
    }
  }

  const store = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        return null;
      }
    },
    set(key, value) {
      try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch (e) {}
    },
  };
  const DEFAULT_SERVER = "https://ntfy.sh";
  let roomError = "";

  function joinRoom(code) {
    const room = code.trim().toLowerCase();
    const server = $("ruumServer").value.trim().replace(/\/+$/, "") || DEFAULT_SERVER;
    roomError = "";
    if (!/^[a-z0-9_-]{8,40}$/.test(room)) roomError = "Ruumi kood peab olema 8–40 märki: tähed, numbrid, - või _.";
    else if (!/^https?:\/\/[^\s/]+(:\d+)?$/.test(server)) roomError = "Serveri aadress peab olema kujul https://ntfy.sh või http://192.168.1.5:8090.";
    if (roomError) {
      renderSync();
      return;
    }
    $("ruumKood").value = room;
    $("ruumServer").value = server;
    store.set("ristmik.ruum", room);
    store.set("ristmik.server", server);
    clock.setSources(server === DEFAULT_SERVER ? TIME_SOURCES : [relayTimeSource(server), ...TIME_SOURCES]);
    session.connect(server, room);
  }

  function leaveRoom() {
    store.set("ristmik.ruum", null);
    session.disconnect();
    clock.setSources(TIME_SOURCES);
  }

  $("ruumNupp").addEventListener("click", () => (session.relay ? leaveRoom() : joinRoom($("ruumKood").value)));
  $("ruumUus").addEventListener("click", () => joinRoom(randomId(10)));
  $("ruumKood").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !session.relay) joinRoom($("ruumKood").value);
  });

  function renderSync() {
    const on = !!session.relay;
    $("ruumNupp").textContent = on ? "Lahku" : "Ühenda";
    $("ruumUus").hidden = on;
    $("ruumKood").disabled = on;
    $("ruumServer").disabled = on;
    const chip = $("syncKiip");
    chip.textContent = {
      off: "üksi",
      connecting: "ühendan…",
      connected: session.ready ? "ruumis" : "liitun…",
      reconnecting: "ühendus katkes",
      error: "viga",
    }[session.status];
    chip.className = "kiip" + (session.status === "connected" ? " ok" : session.status === "off" ? "" : " viga");
    let info;
    if (roomError) {
      info = roomError;
    } else if (!on) {
      info =
        "Automaatrežiimis on foorid kõigis arvutites samas taktis ka ilma ruumita (sama kell). " +
        "Et ka käsitsi valitud režiim jõuaks teistesse arvutitesse, ühendage kõik arvutid sama koodiga ruumi.";
    } else if (session.status === "connected") {
      info =
        `Ruumi kood: ${session.room}. Sisesta see teises arvutis ja vajuta „Ühenda“. ` +
        "Režiimi muutus jõuab kõigisse arvutitesse ja hakkab kehtima samal hetkel." +
        (session.error ? " " + session.error : "");
    } else if (session.status === "connecting") {
      info = "Ühendan releega…";
    } else {
      info =
        `Relee ei vasta (${session.error || "ühendus katkes"}), proovin uuesti. ` +
        "Automaatrežiim jääb ikka teiste arvutitega samasse takti.";
    }
    setText($("syncInfo"), info);
    $("syncInfo").classList.toggle("hoiatus", !!roomError || session.status === "error" || session.status === "reconnecting");
    renderModeButtons();
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
        '<p class="vaike">Ühenda ESP8266 USB-kaabliga ja vajuta „+ Ühenda ESP“. Seejärel vali, millist foori see näitab – plaat jätab selle meelde.</p>';
    }
    for (const dev of devices.devices) {
      const el = document.createElement("div");
      el.className = "seade";
      const identifying = dev.status === "connected" && !dev.identified;
      const statusText = identifying
        ? "tuvastan…"
        : {
            connecting: "ühendan…",
            connected: dev.fault ? "ühendatud, RIKE" : "ühendatud",
            lost: "ühendus katkes",
            error: "viga",
          }[dev.status];
      const statusClass =
        identifying || dev.status === "connecting" ? "" : dev.status === "connected" && !dev.fault ? "ok" : "viga";
      el.innerHTML = `
        <div class="seade-pais">
          <span class="seade-nimi"><span class="seade-nr">${dev.number}</span>${dev.name}${dev.boardId ? `<span class="seade-id" title="Plaadi kiibi number">${dev.boardId}</span>` : ""}</span>
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
        pedSelect.value = dev.crossing || "";
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

  let shownSetting = "";

  function frame() {
    const now = clock.now();
    session.advance(now);
    const controller = session.controller;
    const st = controller.states(now);
    const setting = JSON.stringify(session.pending || session.setting);
    if (setting !== shownSetting) {
      shownSetting = setting;
      renderModeButtons();
    }
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
    const controller = session.controller;
    const d = controller.describe(now);
    setText($("faasiNimi"), d.title);
    setText($("faasiInfo"), d.detail);
    setText($("faasiAeg"), d.left === null ? "" : "veel " + seconds(d.left));
    $("edenemine").style.width = d.progress === null ? "100%" : Math.min(100, d.progress * 100) + "%";
    $("edenemine").classList.toggle("oo", st.seg.type === "night");
    setText(
      $("kehtivReziim"),
      J.MODES[controller.mode].name + (session.setting.auto ? " · automaatne" : " · käsitsi"),
    );
    const wanted = controller.wanted;
    const next = session.pending;
    setText(
      $("ootel"),
      next
        ? `→ ${next.auto ? "automaatne" : J.MODES[next.mode].name} kõigis arvutites ${seconds(next.at - now)} pärast`
        : wanted !== controller.mode
          ? `→ ${J.MODES[wanted].name} (ohutult pärast praegust faasi)`
          : "",
    );
  }

  buildLists();
  renderModeButtons();
  renderDevices();
  map.setBase("skeem");
  requestAnimationFrame(frame);
  setInterval(renderModeButtons, 30000);
  renderSync();
  const savedServer = store.get("ristmik.server");
  if (savedServer) $("ruumServer").value = savedServer;
  const savedRoom = store.get("ristmik.ruum");
  if (savedRoom) joinRoom(savedRoom);
  Promise.race([clock.sync(), new Promise((resolve) => setTimeout(resolve, 3000))]).then(() => {
    clockReady = true;
    renderClock();
    renderModeButtons();
  });
  clock.startAuto();
  devices.reconnectGranted();
})();
