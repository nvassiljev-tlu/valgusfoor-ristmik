// Ristmiku kaart (SVG). Koordinaadid on foto pikslites, seega saab skeemi asemel näidata ka fotot.

(function () {
  "use strict";

  const J = globalThis.JUNCTION;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const VIEW = [380, 280, 1100, 720]; // nähtav ala fotol: x, y, laius, kõrgus

  const ROAD_POLYGONS = [
    // Paldiski mnt Haabersti pool: põhja- ja lõunapoolne sõidutee
    "370,510 735,500 760,500 760,590 370,590",
    "370,598 760,598 760,724 370,724",
    // Paldiski mnt kesklinna pool
    "840,462 1490,128 1490,398 1185,548 1060,560",
    // Endla tn: ristmikule tulev ja ristmikult lahkuv sõidutee
    "1040,572 1190,556 1490,604 1490,702 1300,690 1130,668 1040,666",
    "950,700 1110,704 1490,772 1490,850 1340,818 1110,772 950,764",
    // Mustamäe tee
    "622,742 860,846 700,1010 470,1010",
    // Ristmiku keskosa
    "735,505 845,460 1070,555 1185,548 1110,575 1040,575 1040,700 950,700 950,764 905,800 862,846 622,742 735,724",
  ];
  const ROAD_STROKES = [
    // Paldiski mnt -> Mustamäe tee parempööre
    { d: "M 430 714 C 500 716 540 745 538 800 C 536 860 512 915 482 975", width: 44 },
    // Mustamäe tee -> Endla kaarjas ühendustee
    { d: "M 770 1015 C 830 935 875 892 965 872 C 1110 842 1300 858 1500 895", width: 58 },
    // Endla -> Paldiski mnt parempööre
    { d: "M 1205 585 C 1250 565 1290 530 1335 500 C 1380 470 1430 448 1495 420", width: 32 },
  ];
  // Eraldussaared ja haljasribad
  const MEDIANS = [
    { d: "M 1135 472 L 1495 290", width: 10 },
    { d: "M 1110 686 C 1250 696 1380 715 1495 738", width: 26 },
    { d: "M 700 800 L 575 1010", width: 8 },
  ];

  function make(tag, attrs, parent) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs || {})) el.setAttribute(key, value);
    if (parent) parent.appendChild(el);
    return el;
  }

  function createMap(svg, onSelect) {
    svg.setAttribute("viewBox", VIEW.join(" "));
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Ristmiku kaart kõigi fooridega");

    const defs = make("defs", {}, svg);
    for (const id of ["nool-roheline", "nool-kollane"]) {
      const marker = make(
        "marker",
        {
          id,
          viewBox: "0 0 10 10",
          refX: 6,
          refY: 5,
          markerWidth: 3.4,
          markerHeight: 3.4,
          orient: "auto-start-reverse",
        },
        defs,
      );
      make("path", { d: "M0,0 L10,5 L0,10 z", class: id }, marker);
    }

    const photo = make("g", { class: "alus alus-foto" }, svg);
    make(
      "image",
      { href: J.PHOTO.src, x: 0, y: 0, width: J.PHOTO.width, height: J.PHOTO.height },
      photo,
    );

    const scheme = make("g", { class: "alus alus-skeem" }, svg);
    make("rect", { x: VIEW[0], y: VIEW[1], width: VIEW[2], height: VIEW[3], class: "maa" }, scheme);
    for (const points of ROAD_POLYGONS) make("polygon", { points, class: "tee" }, scheme);
    for (const s of ROAD_STROKES) {
      make("path", { d: s.d, class: "tee-kaar", "stroke-width": s.width }, scheme);
    }
    for (const m of MEDIANS) make("path", { d: m.d, class: "saar", "stroke-width": m.width }, scheme);

    const labels = make("g", { class: "teenimed" }, svg);
    for (const road of J.ROADS) {
      const t = make(
        "text",
        { x: road.x, y: road.y, transform: `rotate(${road.angle} ${road.x} ${road.y})` },
        labels,
      );
      t.textContent = road.name;
    }

    const gMoves = make("g", { class: "suunad" }, svg);
    const moves = {};
    for (const light of J.LIGHTS) {
      moves[light.id] = light.paths.map((d) => make("path", { d, class: "suund" }, gMoves));
    }

    const gCross = make("g", { class: "ylekaigud" }, svg);
    const crossings = {};
    for (const c of J.CROSSINGS) {
      const [ax, ay] = c.a;
      const [bx, by] = c.b;
      const len = Math.hypot(bx - ax, by - ay);
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      const angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
      const g = make("g", { class: "ylekaik", "data-id": c.id }, gCross);
      make("title", {}, g).textContent = `${c.id} – ${c.name}`;
      // Sebra on pööratud nii, et x-telg on jalakäija liikumissuund (a -> b)
      const zebra = make("g", { transform: `translate(${ax} ${ay}) rotate(${angle})` }, g);
      const tint = make(
        "rect",
        { x: 0, y: -c.width / 2, width: len, height: c.width, class: "sebra-toon" },
        zebra,
      );
      for (let x = 4; x < len - 4; x += 12) {
        make("rect", { x, y: -c.width / 2 + 2, width: 6, height: c.width - 4, class: "sebra-triip" }, zebra);
      }
      const heads = [
        [ax - ux * 20, ay - uy * 20],
        [bx + ux * 20, by + uy * 20],
      ].map(([x, y]) => {
        const head = make("g", { class: "jk-foor", transform: `translate(${x} ${y})` }, g);
        make("rect", { x: -8, y: -17, width: 16, height: 34, rx: 4, class: "korpus" }, head);
        return {
          red: make("circle", { cx: 0, cy: -7.5, r: 5.5, class: "lamp punane" }, head),
          green: make("circle", { cx: 0, cy: 7.5, r: 5.5, class: "lamp roheline" }, head),
        };
      });
      const label = make(
        "text",
        { x: (ax + bx) / 2, y: (ay + by) / 2 + 4, class: "raja-silt" },
        g,
      );
      label.textContent = c.id;
      g.addEventListener("click", () => onSelect && onSelect(c.id));
      crossings[c.id] = { g, tint, heads };
    }

    const gLights = make("g", { class: "foorid" }, svg);
    // Seadmete sildid eraldi kihis kõige peal, et naaberfoor neid ei kataks
    const gBadges = make("g", { class: "seadmete-sildid" }, svg);
    const lights = {};
    for (const light of J.LIGHTS) {
      const g = make("g", { class: "auto-foor", transform: `translate(${light.x} ${light.y})` }, gLights);
      make("title", {}, g).textContent = `${light.id} – ${light.name}`;
      make("rect", { x: -20, y: -48, width: 40, height: 96, rx: 9, class: "valik" }, g);
      make("rect", { x: -14, y: -40, width: 28, height: 80, rx: 7, class: "korpus" }, g);
      const lamps = {
        red: make("circle", { cx: 0, cy: -24, r: 9.5, class: "lamp punane" }, g),
        yellow: make("circle", { cx: 0, cy: 0, r: 9.5, class: "lamp kollane" }, g),
        green: make("circle", { cx: 0, cy: 24, r: 9.5, class: "lamp roheline" }, g),
      };
      make("text", { x: 0, y: -50, class: "foori-silt" }, g).textContent = light.id;
      const badge = make(
        "g",
        { class: "seadme-silt", transform: `translate(${light.x} ${light.y + 60})` },
        gBadges,
      );
      make("rect", { x: -26, y: -11, width: 52, height: 22, rx: 11 }, badge);
      const badgeText = make("text", { x: 0, y: 5 }, badge);
      g.addEventListener("click", () => onSelect && onSelect(light.id));
      lights[light.id] = { g, lamps, badge, badgeText };
    }

    function setClass(el, cls, on) {
      if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
    }
    const lit = (digit, blinkOn) => digit === "1" || (digit === "2" && blinkOn);

    // view = { cars, peds, blinkOn, allYellow, devices: { F1: "ESP 1" }, selected, pairs: Set }
    function update(view) {
      for (const light of J.LIGHTS) {
        const s = view.cars[light.id];
        const L = lights[light.id];
        setClass(L.lamps.red, "on", lit(s[0], view.blinkOn));
        setClass(L.lamps.yellow, "on", lit(s[1], view.blinkOn));
        setClass(L.lamps.green, "on", lit(s[2], view.blinkOn));
        setClass(L.g, "valitud", view.selected === light.id);
        const dev = view.devices[light.id] || "";
        setClass(L.badge, "nahtav", dev !== "");
        if (L.badgeText.textContent !== dev) L.badgeText.textContent = dev;
        // Öörežiimi lõpus on kõik kollased korraga – siis kollaseid nooli ei näita
        const go = s === "001" || s === "002";
        const warn = (s === "010" || s === "110") && !view.allYellow;
        for (const path of moves[light.id]) {
          setClass(path, "roheline", go);
          setClass(path, "kollane", warn);
        }
      }
      for (const c of J.CROSSINGS) {
        const s = view.peds[c.id];
        const C = crossings[c.id];
        for (const head of C.heads) {
          setClass(head.red, "on", lit(s[0], view.blinkOn));
          setClass(head.green, "on", lit(s[1], view.blinkOn));
        }
        setClass(C.tint, "roheline", s === "01" || (s === "02" && view.blinkOn));
        setClass(C.tint, "punane", s === "10" || (s === "02" && !view.blinkOn));
        setClass(C.g, "valitud", view.selected === c.id || view.pairs.has(c.id));
      }
    }

    function setBase(name) {
      svg.classList.toggle("foto", name === "foto");
    }

    function setArrows(show) {
      svg.classList.toggle("peida-suunad", !show);
    }

    return { update, setBase, setArrows };
  }

  globalThis.createMap = createMap;
})();
