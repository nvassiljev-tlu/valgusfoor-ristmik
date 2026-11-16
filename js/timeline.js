// Fooritsükli ajajoon: iga foori tuled ühe tsükli jooksul valitud režiimis.

(function () {
  "use strict";

  const J = globalThis.JUNCTION;
  const { cycleOf, statesIn, breakpoints } = globalThis.Signals;
  const SVG_NS = "http://www.w3.org/2000/svg";

  function make(tag, attrs, parent) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs || {})) el.setAttribute(key, value);
    if (parent) parent.appendChild(el);
    return el;
  }

  // Ühe foori olekud tsükli jooksul: [{ from, to, state }]
  function intervals(cycle, id, isCar) {
    const list = [];
    for (const seg of cycle.segments) {
      const points = [...breakpoints(seg), seg.duration].filter((t) => t <= seg.duration);
      for (let i = 0; i < points.length - 1; i++) {
        if (points[i + 1] <= points[i]) continue;
        const st = statesIn(seg, points[i]);
        const state = isCar ? st.cars[id] : st.peds[id];
        const from = seg.start + points[i];
        const to = seg.start + points[i + 1];
        const last = list[list.length - 1];
        if (last && last.state === state && last.to === from) last.to = to;
        else list.push({ from, to, state });
      }
    }
    return list;
  }

  function createTimeline(container) {
    let builtFor = null;
    let cursor = null;
    let length = 0;
    const W = 1000;
    const LABEL = 46;
    const ROW = 15;
    const GAP = 4;
    const TOP = 26;

    function build(mode) {
      builtFor = mode;
      container.textContent = "";
      const cycle = cycleOf(mode);
      if (!cycle) {
        const p = document.createElement("p");
        p.className = "tuhi";
        p.textContent =
          "Öörežiimis tsüklit pole: kõigile autodele vilgub kollane ja jalakäijate foorid on kustu.";
        container.appendChild(p);
        cursor = null;
        length = 0;
        return;
      }
      length = cycle.length;
      const rows = [
        ...J.LIGHTS.map((l) => ({ id: l.id, car: true })),
        ...J.CROSSINGS.map((c) => ({ id: c.id, car: false })),
      ];
      const sep = 10;
      const height = TOP + rows.length * (ROW + GAP) + sep + 18;
      const svg = make("svg", {
        viewBox: `0 0 ${W} ${height}`,
        class: "ajajoon-svg",
        role: "img",
        "aria-label": "Fooritsükli ajajoon",
      });
      const defs = make("defs", {}, svg);
      const pattern = make(
        "pattern",
        { id: "aj-vilkuv", width: 8, height: 8, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" },
        defs,
      );
      make("rect", { width: 8, height: 8, class: "aj-vilkuv-alus" }, pattern);
      make("rect", { width: 4, height: 8, class: "aj-vilkuv-triip" }, pattern);

      const x = (ms) => LABEL + ((W - LABEL - 4) * ms) / length;

      for (const seg of cycle.segments) {
        const isStage = seg.type === "stage";
        make(
          "rect",
          {
            x: x(seg.start),
            y: 2,
            width: x(seg.start + seg.duration) - x(seg.start),
            height: 18,
            class: isStage ? "aj-faas" : "aj-vahe",
          },
          svg,
        );
        if (isStage) {
          const t = make("text", { x: (x(seg.start) + x(seg.start + seg.duration)) / 2, y: 15, class: "aj-faasi-nimi" }, svg);
          t.textContent = "Faas " + J.STAGES[seg.stage].id;
        }
      }

      rows.forEach((row, i) => {
        const y = TOP + i * (ROW + GAP) + (row.car ? 0 : sep);
        const label = make("text", { x: LABEL - 8, y: y + ROW - 3, class: "aj-silt" }, svg);
        label.textContent = row.id;
        for (const part of intervals(cycle, row.id, row.car)) {
          make(
            "rect",
            {
              x: x(part.from),
              y,
              width: Math.max(0.5, x(part.to) - x(part.from)),
              height: ROW,
              class: "aj-" + part.state,
            },
            svg,
          );
        }
      });

      const axisY = TOP + rows.length * (ROW + GAP) + sep + 4;
      for (let s = 0; s * 1000 <= length; s += 10) {
        make("line", { x1: x(s * 1000), x2: x(s * 1000), y1: axisY, y2: axisY + 4, class: "aj-telg" }, svg);
        const t = make("text", { x: x(s * 1000), y: axisY + 14, class: "aj-aeg" }, svg);
        t.textContent = s + " s";
      }

      cursor = make("line", { x1: 0, x2: 0, y1: 0, y2: axisY, class: "aj-kursor" }, svg);
      container.appendChild(svg);
    }

    // position: ms tsükli algusest; null peidab kursori
    function update(mode, position) {
      if (mode !== builtFor) build(mode);
      if (!cursor) return;
      const show = position !== null && position >= 0 && position <= length;
      cursor.style.display = show ? "" : "none";
      if (show) {
        const cx = LABEL + ((W - LABEL - 4) * position) / length;
        cursor.setAttribute("x1", cx);
        cursor.setAttribute("x2", cx);
      }
    }

    return { update, lengthOf: (mode) => (cycleOf(mode) || { length: 0 }).length };
  }

  globalThis.createTimeline = createTimeline;
})();
