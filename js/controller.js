// Foorikontroller: valib faasi ja arvutab iga foori tulede oleku.
//
// Olek on numbrijada, üks number tule kohta: 0 kustus, 1 põleb, 2 vilgub.
//   autod:      punane, kollane, roheline  ("001" = roheline)
//   jalakäijad: punane, roheline           ("10" = punane)
// Sama kuju saadetakse füüsilisele foorile.
//
// Kontroller liigub segmentide kaupa: stage (faas), change (faaside vahetus),
// toNight, night ja fromNight (öörežiimi algus, öörežiim, öörežiimi lõpp).

(function () {
  "use strict";

  const J = globalThis.JUNCTION;
  const T = J.TIMING;
  const STAGE_COUNT = J.STAGES.length;

  const INTERGREEN = T.flashGreen + T.yellow + T.allRed + T.redYellow;
  const TO_NIGHT = T.flashGreen + T.yellow + T.nightAllRed;
  const FROM_NIGHT = T.wakeYellow + T.wakeAllRed + T.redYellow;

  // Jalakäijad saavad faasis rohelise, kui ükski selle faasi auto nende rada ei ületa
  const PED_GREEN = J.STAGES.map((stage) =>
    J.CROSSINGS.filter(
      (c) => !c.conflicts.some((id) => stage.cars.includes(id)),
    ).map((c) => c.id),
  );

  const carGreenIn = (id, k) => J.STAGES[k].cars.includes(id);
  const pedGreenIn = (id, k) => PED_GREEN[k].includes(id);

  const CAR_STATE_NAMES = {
    "100": "punane",
    "110": "punane + kollane",
    "001": "roheline",
    "002": "vilkuv roheline",
    "010": "kollane",
    "020": "vilkuv kollane",
    "000": "kustus",
  };
  const PED_STATE_NAMES = {
    "10": "punane",
    "01": "roheline",
    "02": "vilkuv roheline",
    "00": "kustus",
  };

  // leaving: oli roheline, entering: saab rohelise, t: ms vahetuse algusest
  function carBetween(leaving, entering, t) {
    if (leaving && entering) return "001";
    if (leaving) {
      if (t < T.flashGreen) return "002";
      if (t < T.flashGreen + T.yellow) return "010";
      return "100";
    }
    if (entering && t >= INTERGREEN - T.redYellow) return "110";
    return "100";
  }

  function pedBetween(leaving, entering, t) {
    if (leaving && entering) return "01";
    if (leaving && t < T.pedFlash) return "02";
    return "10";
  }

  function carState(seg, id, t) {
    switch (seg.type) {
      case "stage":
        return carGreenIn(id, seg.stage) ? "001" : "100";
      case "change":
        return carBetween(carGreenIn(id, seg.stage), carGreenIn(id, seg.next), t);
      case "toNight":
        return carBetween(carGreenIn(id, seg.stage), false, t);
      case "night":
        return "020";
      case "fromNight":
        if (t < T.wakeYellow) return "010";
        if (t < T.wakeYellow + T.wakeAllRed) return "100";
        return carGreenIn(id, 0) ? "110" : "100";
    }
    return "000";
  }

  function pedState(seg, id, t) {
    switch (seg.type) {
      case "stage":
        return pedGreenIn(id, seg.stage) ? "01" : "10";
      case "change":
        return pedBetween(pedGreenIn(id, seg.stage), pedGreenIn(id, seg.next), t);
      case "toNight":
        return pedBetween(pedGreenIn(id, seg.stage), false, t);
      case "night":
        return "00";
      case "fromNight":
        return "10";
    }
    return "00";
  }

  function statesIn(seg, t) {
    const cars = {};
    const peds = {};
    for (const light of J.LIGHTS) cars[light.id] = carState(seg, light.id, t);
    for (const c of J.CROSSINGS) peds[c.id] = pedState(seg, c.id, t);
    return { cars, peds };
  }

  // Hetked segmendi sees (ms algusest), mil mõni tuli võib muutuda
  function breakpoints(seg) {
    switch (seg.type) {
      case "change":
        return [0, T.flashGreen, T.pedFlash, T.flashGreen + T.yellow, INTERGREEN - T.redYellow];
      case "toNight":
        return [0, T.flashGreen, T.pedFlash, T.flashGreen + T.yellow];
      case "fromNight":
        return [0, T.wakeYellow, T.wakeYellow + T.wakeAllRed];
    }
    return [0];
  }

  class Controller {
    constructor(now, mode) {
      // wanted: režiim, kuhu liigume; mode: režiim, mille järgi praegu töötame
      this.wanted = mode;
      this.mode = mode;
      this.cycleStart = null;
      this.seg =
        mode === "oo"
          ? { type: "night", start: now, duration: Infinity }
          : { type: "fromNight", start: now, duration: FROM_NIGHT };
    }

    stageDuration(k) {
      if (J.MODES[this.wanted].night) return T.minGreen; // öö tulekul lõpetame faasi kiiresti
      return J.MODES[this.wanted].greens[J.STAGES[k].id] * 1000;
    }

    // Vahetusi ei katkestata: praegune roheline lõpeb uue režiimi järgi, kuid mitte enne
    // miinimumi, ja öörežiimi minnakse läbi kollase ja kõik-punaste.
    setMode(mode, now) {
      if (mode === this.wanted || !J.MODES[mode]) return;
      this.update(now);
      this.wanted = mode;
      const seg = this.seg;
      if (seg.type === "stage") {
        seg.duration = Math.max(this.stageDuration(seg.stage), T.minGreen, now - seg.start);
        if (!J.MODES[mode].night) this.mode = mode;
      } else if (seg.type === "night") {
        seg.duration = J.MODES[mode].night
          ? Infinity
          : Math.max(T.minNight, now - seg.start);
      }
    }

    // Tsükkel, sest pärast taustal olnud vahekaarti võib mitu segmenti korraga mööduda
    update(now) {
      let guard = 0;
      while (now >= this.seg.start + this.seg.duration && guard++ < 100000) {
        this.seg = this.advance(this.seg);
      }
    }

    advance(seg) {
      const end = seg.start + seg.duration;
      switch (seg.type) {
        case "stage":
          if (J.MODES[this.wanted].night) {
            return { type: "toNight", stage: seg.stage, start: end, duration: TO_NIGHT };
          }
          return {
            type: "change",
            stage: seg.stage,
            next: (seg.stage + 1) % STAGE_COUNT,
            start: end,
            duration: INTERGREEN,
          };
        case "change":
          return this.startStage(seg.next, end);
        case "toNight":
          this.mode = "oo";
          return {
            type: "night",
            start: end,
            duration: J.MODES[this.wanted].night ? Infinity : T.minNight,
          };
        case "night":
          this.mode = this.wanted;
          return { type: "fromNight", start: end, duration: FROM_NIGHT };
        case "fromNight":
          return this.startStage(0, end);
      }
      return seg;
    }

    startStage(k, start) {
      if (!J.MODES[this.wanted].night) this.mode = this.wanted;
      if (k === 0) this.cycleStart = start;
      return { type: "stage", stage: k, start, duration: this.stageDuration(k) };
    }

    // Kogu olek tavalise objektina, et teine arvuti saaks täpselt sama kontrolleri taastada
    snapshot() {
      const seg = { ...this.seg };
      if (!isFinite(seg.duration)) seg.duration = null;
      return { wanted: this.wanted, mode: this.mode, cycleStart: this.cycleStart, seg };
    }

    static restore(snap) {
      const c = Object.create(Controller.prototype);
      c.wanted = snap.wanted;
      c.mode = snap.mode;
      c.cycleStart = snap.cycleStart;
      c.seg = { ...snap.seg, duration: snap.seg.duration === null ? Infinity : snap.seg.duration };
      return c;
    }

    states(now) {
      const t = now - this.seg.start;
      const st = statesIn(this.seg, t);
      st.seg = this.seg;
      st.blinkOn = t % 1000 < 500; // vilkumine algab segmendi algusest, nagu plaadil
      return st;
    }

    // Praegune segment ja count järgmist, praeguse soovitud režiimi järgi
    upcoming(count) {
      const clone = Object.assign(Object.create(Controller.prototype), this);
      const list = [this.seg];
      let seg = this.seg;
      for (let i = 0; i < count && isFinite(seg.duration); i++) {
        seg = clone.advance(seg);
        list.push(seg);
      }
      return list;
    }

    nextChanges(now) {
      const current = statesIn(this.seg, now - this.seg.start);
      const result = {};
      const pending = new Set([...Object.keys(current.cars), ...Object.keys(current.peds)]);
      for (const seg of this.upcoming(10)) {
        for (const offset of breakpoints(seg)) {
          const at = seg.start + offset;
          if (at <= now) continue;
          const st = statesIn(seg, offset);
          for (const id of [...pending]) {
            const before = id in current.cars ? current.cars[id] : current.peds[id];
            const after = id in st.cars ? st.cars[id] : st.peds[id];
            if (after !== before) {
              result[id] = { inMs: at - now, to: after };
              pending.delete(id);
            }
          }
          if (!pending.size) return result;
        }
      }
      return result;
    }

    describe(now) {
      const seg = this.seg;
      const left = isFinite(seg.duration) ? seg.start + seg.duration - now : null;
      const progress = isFinite(seg.duration) ? (now - seg.start) / seg.duration : null;
      let title;
      let detail = "";
      switch (seg.type) {
        case "stage": {
          const s = J.STAGES[seg.stage];
          title = "Faas " + s.id;
          detail = s.name;
          break;
        }
        case "change":
          title = "Vahetus " + J.STAGES[seg.stage].id + " → " + J.STAGES[seg.next].id;
          detail = "vilkuv roheline, kollane, kõik punased, punane + kollane";
          break;
        case "toNight":
          title = "Üleminek öörežiimile";
          detail = "rohelised lõpetavad, siis kõik punased";
          break;
        case "night":
          title = "Öörežiim";
          detail = "autodele vilkuv kollane, jalakäijate foorid kustu";
          break;
        case "fromNight":
          title = "Foorid lähevad tööle";
          detail = "kollane, kõik punased, siis faas " + J.STAGES[0].id;
          break;
      }
      return { title, detail, left, progress };
    }
  }

  function cycleOf(mode) {
    const m = J.MODES[mode];
    if (!m || m.night) return null;
    const segments = [];
    let t = 0;
    for (let k = 0; k < STAGE_COUNT; k++) {
      const green = m.greens[J.STAGES[k].id] * 1000;
      segments.push({ type: "stage", stage: k, start: t, duration: green });
      t += green;
      segments.push({
        type: "change",
        stage: k,
        next: (k + 1) % STAGE_COUNT,
        start: t,
        duration: INTERGREEN,
      });
      t += INTERGREEN;
    }
    return { segments, length: t };
  }

  globalThis.Signals = {
    Controller,
    statesIn,
    breakpoints,
    cycleOf,
    PED_GREEN,
    INTERGREEN,
    TO_NIGHT,
    FROM_NIGHT,
    CAR_STATE_NAMES,
    PED_STATE_NAMES,
  };
})();
