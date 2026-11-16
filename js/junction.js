// Ristmiku andmed: ainus koht, kus foorid, ülekäigurajad, faasid ja režiimid kirjas on.
// Koordinaadid on pikslid fotol photo_2026-11-09_13-01-32.jpg, nii et kaart ühtib fotoga.
// Teede nimed ja fooride suunad on foto põhjal oletatud. Pärast muutmist: node test/safety.test.js

(function () {
  "use strict";

  const PHOTO = {
    src: "photo_2026-11-09_13-01-32.jpg",
    width: 1808,
    height: 1296,
  };

  const ROADS = [
    { name: "Paldiski mnt", x: 395, y: 507, angle: -2 },
    { name: "Paldiski mnt", x: 1275, y: 236, angle: -27 },
    { name: "Endla tn", x: 1300, y: 742, angle: 9 },
    { name: "Mustamäe tee", x: 470, y: 985, angle: -58 },
  ];

  // pair: ülekäik, mida füüsiline foor vaikimisi näitab (esimene rada, mille selle foori autod ületavad).
  // paths: sõidusuunad, mis joonistatakse kaardile, kui foor on roheline.
  const LIGHTS = [
    {
      id: "F1",
      x: 1042,
      y: 357,
      pair: "Ü1",
      name: "Paldiski mnt kesklinna poolt – otse Haabersti poole",
      paths: ["M 1180 360 C 1020 420 890 520 740 548 L 560 552"],
    },
    {
      id: "F2",
      x: 1129,
      y: 474,
      pair: "Ü4",
      name: "Paldiski mnt kesklinna poolt – vasakule Mustamäe teele",
      paths: ["M 1190 432 C 1020 480 800 610 690 760 L 560 950"],
    },
    {
      id: "F3",
      x: 1223,
      y: 529,
      pair: "Ü8",
      name: "Endla tn – paremale Paldiski mnt-le kesklinna poole",
      paths: ["M 1290 588 C 1250 570 1260 530 1320 500 L 1470 425"],
    },
    {
      id: "F4",
      x: 1150,
      y: 598,
      pair: "Ü7",
      name: "Endla tn – otse Haabersti poole ja vasakule Mustamäe teele",
      paths: [
        "M 1300 625 C 1060 600 880 565 740 560 L 560 560",
        "M 1300 640 C 1060 640 820 680 700 770 L 590 950",
      ],
    },
    {
      id: "F5",
      x: 736,
      y: 591,
      pair: "Ü2",
      name: "Paldiski mnt Haabersti poolt – kesklinna poole ja Endlale",
      paths: [
        "M 540 640 C 760 640 980 560 1180 500 L 1470 375",
        "M 540 690 C 800 692 940 722 1080 735 L 1470 800",
      ],
    },
    {
      id: "F6",
      x: 616,
      y: 745,
      pair: "Ü3",
      name: "Paldiski mnt Haabersti poolt – paremale Mustamäe teele",
      paths: ["M 410 705 C 490 706 532 738 530 795 C 528 850 505 900 478 960"],
    },
    {
      id: "F7",
      x: 838,
      y: 824,
      pair: "Ü4",
      name: "Mustamäe tee – otse Paldiski mnt-le kesklinna poole",
      paths: ["M 640 1000 C 760 850 920 640 1160 515 L 1470 385"],
    },
    {
      id: "F8",
      x: 1011,
      y: 886,
      pair: "Ü5",
      name: "Mustamäe tee – Endlale (kaarjas ühendustee)",
      paths: ["M 790 1000 C 840 930 880 890 970 872 C 1110 845 1300 862 1470 895"],
    },
  ];

  // a, b: raja otsad. conflicts: autode foorid, mille autod ületavad raja – jalakäijad saavad
  // rohelise ainult siis, kui need kõik on punased.
  const CROSSINGS = [
    {
      id: "Ü1",
      a: [702, 503],
      b: [702, 592],
      width: 34,
      name: "üle Paldiski mnt (Haabersti poole sõitjad)",
      conflicts: ["F1", "F4"],
    },
    {
      id: "Ü2",
      a: [670, 598],
      b: [670, 724],
      width: 36,
      name: "üle Paldiski mnt (Haabersti poolt tulijad)",
      conflicts: ["F5"],
    },
    {
      id: "Ü3",
      a: [490, 772],
      b: [568, 772],
      width: 36,
      name: "üle parempöörde tee Mustamäe teele",
      conflicts: ["F6"],
    },
    {
      id: "Ü4",
      a: [638, 748],
      b: [856, 842],
      width: 38,
      name: "üle Mustamäe tee",
      conflicts: ["F2", "F4", "F7"],
    },
    {
      id: "Ü5",
      a: [925, 832],
      b: [958, 910],
      width: 40,
      name: "üle Mustamäe tee – Endla ühendustee",
      conflicts: ["F8"],
    },
    {
      id: "Ü6",
      a: [1000, 700],
      b: [1000, 762],
      width: 38,
      name: "üle Endla tn (ristmikult lahkujad)",
      conflicts: ["F5"],
    },
    {
      id: "Ü7",
      a: [1085, 586],
      b: [1085, 664],
      width: 38,
      name: "üle Endla tn (ristmikule tulijad)",
      conflicts: ["F4"],
    },
    {
      id: "Ü8",
      a: [1150, 552],
      b: [1245, 548],
      width: 34,
      name: "üle parempöörde tee Paldiski mnt-le (ristmiku pool)",
      conflicts: ["F3"],
    },
    {
      id: "Ü9",
      a: [1282, 499],
      b: [1354, 499],
      width: 40,
      name: "üle parempöörde tee Paldiski mnt-le (kesklinna pool)",
      conflicts: ["F3"],
    },
  ];

  // Ristuvad või liituvad suunad: neil ei tohi kunagi korraga roheline olla
  const CONFLICTS = [
    ["F1", "F4"],
    ["F2", "F4"],
    ["F2", "F5"],
    ["F3", "F5"],
    ["F3", "F7"],
    ["F4", "F5"],
    ["F4", "F7"],
    ["F5", "F7"],
  ];

  // Jalakäijate rohelised arvutatakse ülekäikude conflicts põhjal (js/controller.js)
  const STAGES = [
    { id: "A", name: "Paldiski mnt otse", cars: ["F1", "F5", "F6"] },
    { id: "B", name: "Mustamäe tee ja vasakpööre Mustamäe teele", cars: ["F2", "F7", "F8"] },
    { id: "C", name: "Endla tn", cars: ["F3", "F4", "F6", "F8"] },
  ];

  // greens: iga faasi rohelise kestus sekundites
  const MODES = {
    hommik: {
      name: "Hommik",
      description:
        "Hommikune tipptund kesklinna poole: pikem roheline Haabersti ja Mustamäe poolt tulijatele.",
      greens: { A: 28, B: 22, C: 10 },
    },
    paev: {
      name: "Päev",
      description: "Tavaline liiklus: faasid on enam-vähem võrdse pikkusega.",
      greens: { A: 20, B: 14, C: 14 },
    },
    ohtu: {
      name: "Õhtu",
      description:
        "Õhtune tipptund kesklinnast välja: pikem roheline kesklinna poolt ja Endlalt tulijatele.",
      greens: { A: 26, B: 18, C: 18 },
    },
    oo: {
      name: "Öö",
      description: "Autodele vilkuv kollane, jalakäijate foorid on kustu.",
      night: true,
    },
  };

  // Automaatrežiimi ajakava (kohalik kellaaeg)
  const SCHEDULE = [
    { from: "00:00", mode: "oo" },
    { from: "06:00", mode: "hommik" },
    { from: "10:00", mode: "paev" },
    { from: "16:00", mode: "ohtu" },
    { from: "23:00", mode: "oo" },
  ];

  // Millisekundites
  const TIMING = {
    flashGreen: 3000,
    yellow: 3000,
    allRed: 1000,
    redYellow: 1000,
    pedFlash: 3000,
    minGreen: 5000,
    nightAllRed: 2000,
    minNight: 3000,
    wakeYellow: 3000,
    wakeAllRed: 2000,
  };

  globalThis.JUNCTION = {
    PHOTO,
    ROADS,
    LIGHTS,
    CROSSINGS,
    CONFLICTS,
    STAGES,
    MODES,
    SCHEDULE,
    TIMING,
  };
})();
