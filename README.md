# Valgusfoor – Paldiski mnt / Endla tn / Mustamäe tee ristmik

Kursuse kokkuvõttev liiklusprojekt (2 osalejat).

Veebileht näitab kogu ristmikku reaalajas: 8 autode foori (F1–F8, fotol punased kastid) ja
9 ülekäiguraja jalakäijate foorid (Ü1–Ü9, fotol kollased kastid). Iga USB-ga ühendatud
ESP8266 plaat on füüsiline foor, mis peegeldab ühte ristmiku foori – millist, valitakse lehel.

![Ristmik: kollased = ülekäigurajad, punased = autode foorid](photo_2026-11-09_13-01-32.jpg)

## Käivitamine

1. Ava `index.html` **Chrome'is või Edge'is** (USB-ühendus ehk Web Serial töötab ainult neis).
   Topeltklõps failil sobib; teine võimalus on `python3 -m http.server` ja aadress `http://localhost:8000`.
2. Ühenda ESP8266 USB-kaabliga, vajuta **„+ Ühenda ESP“** ja vali port. Iga järgmise plaadi jaoks
   korda sama – iga plaat võib näidata eri foori.
3. Vali seadme juures, millist autode foori ja ülekäiku see näitab. Teine võimalus: klõpsa
   kaardil foori ja vajuta **„Näita seadmel N“**. Plaat jätab valiku meelde: pärast lehe uuesti
   laadimist või USB-st välja ja tagasi panemist näitab see sama foori.

Plaadi püsivara on `sketch_valgusfoor/sketch_valgusfoor.ino` (Arduino IDE, ESP8266 plaatide pakett,
plaat nt „NodeMCU 1.0 (ESP-12E Module)“). LED-id: D3 autode punane, D4 autode kollane,
D5 autode roheline, D1 jalakäijate punane, D2 jalakäijate roheline. Skeem ja komponendid:
[docs/elektriskeem.md](docs/elektriskeem.md).

## Režiimid

| Režiim | Aeg (automaatrežiimis) | Faasi A / B / C roheline |
|---|---|---|
| Hommik | 06:00–10:00 | 28 / 22 / 10 s – kesklinna poole sõitjad eelisjärjekorras |
| Päev | 10:00–16:00 | 20 / 14 / 14 s |
| Õhtu | 16:00–23:00 | 26 / 18 / 18 s – kesklinnast välja sõitjad eelisjärjekorras |
| Öö | 23:00–06:00 | autodele vilkuv kollane, jalakäijate foorid kustu |

„Automaatne“ valib režiimi kellaaja järgi (aeg küsitakse internetist). Režiimi saab valida ka
käsitsi. Vahetus toimub alati ohutult: praegune faas lõpetatakse läbi vilkuva rohelise,
kollase ja kõik-punaste.

Faasid (millised autode foorid on korraga rohelised):

| Faas | Autode foorid | Jalakäijad saavad rohelise |
|---|---|---|
| A – Paldiski mnt otse | F1, F5, F6 | Ü4, Ü5, Ü7, Ü8, Ü9 |
| B – Mustamäe tee ja vasakpööre Mustamäe teele | F2, F7, F8 | Ü1, Ü2, Ü3, Ü6, Ü7, Ü8, Ü9 |
| C – Endla tn | F3, F4, F6, F8 | Ü2, Ü6 |

## Failid

- `index.html`, `css/style.css` – leht
- `js/junction.js` – **ristmiku andmed**: foorid, ülekäigurajad, vastuolulised suunad, faasid,
  režiimid ja ajakava. Ainus koht, mida ristmiku muutmiseks vaja muuta.
- `js/controller.js` – foorikontroller: faasid, vahetused, öörežiim, iga foori tulede olek
- `js/map.js` – ristmiku kaart (skeem või foto), `js/timeline.js` – tsükli ajajoon
- `js/devices.js` – USB-side ESP8266 plaatidega
- `js/app.js` – lehe loogika
- `test/safety.test.js` – ohutustest: simuleerib 6 tundi juhuslike režiimivahetustega ja kontrollib,
  et vastuolulised suunad ei saa kunagi korraga rohelist
- `test/devices.test.js` – USB-side test võltsitud plaadiga
- `sketch_valgusfoor/` – ESP8266 püsivara
- `docs/elektriskeem.md` – elektriskeem ja komponendid
- `docs/andmevoog.md` – andmete liikumise skeem ja pakettide näited

Testid (vaja Node.js-i):

```bash
node test/safety.test.js
```

```bash
node test/devices.test.js
```

## Side lehe ja plaadi vahel

Tekstiread üle USB jadapordi, 115200 baudi. Plaat ei tea ristmikust midagi – leht ütleb talle,
millised tuled põlevad. Plaat jätab meelde ainult selle, millist foori ta näitab.

| Suund | Käsk | Tähendus |
|---|---|---|
| leht → plaat | `KES?` | küsib plaadi kiibi numbrit ja seda, millist foori plaat mäletab (saadetakse ühendamisel) |
| leht → plaat | `MAARA:F3,U8` | plaat näitab autode foori F3 ja ülekäiku Ü8 (Ü asemel U) ja jätab selle meelde |
| leht → plaat | `TULED:00110` | autode punane, kollane, roheline, jalakäijate punane, roheline; 0 kustus, 1 põleb, 2 vilgub. Saadetakse kohe, kui olek muutub, ja iga sekund uuesti |
| plaat → leht | `READY` | plaat käivitus – leht saadab `MAARA` ja `TULED` uuesti (uuelt plaadilt küsib enne `KES?`) |
| plaat → leht | `SEADE:3F2A1C,F3,U8` | vastus `KES?`-le: kiibi number ja meelde jäetud foor; `-` tähendab „pole“ |
| plaat → leht | `OK <käsk>` | käsk täideti (`TULED` puhul ainult siis, kui olek muutus) |
| plaat → leht | `VIGA <käsk>` | tundmatu käsk või vale väärtus |
| plaat → leht | `RIKE` | lehelt pole 5 s midagi tulnud – plaat vilgutab autodele kollast |

Näide: plaat näitab foori F3 ja ülekäiku Ü8, ristmik vahetab faasi B → C (päevarežiim).

```
→ TULED:10002    vahetuse algus: jalakäijatele vilkuv roheline
← OK TULED:10002
→ TULED:10010    3 s hiljem: jalakäijatele punane
← OK TULED:10010
→ TULED:11010    4 s hiljem: autodele punane + kollane
← OK TULED:11010
→ TULED:00110    1 s hiljem: faas C, autodele roheline
← OK TULED:00110
```

Lehel saab kogu side logi salvestada („Salvesta logi“). Skeem, baidid ja mitme plaadi näide:
[docs/andmevoog.md](docs/andmevoog.md).

## Eeldused, mida kontrollida

Foto põhjal on oletatud, mis teed harudel on ja mida iga foor juhib. Kui päriselus on teisiti,
muuda `js/junction.js` ja käivita ohutustest.

| Foor | Mida juhib (oletus) |
|---|---|
| F1 | Paldiski mnt kesklinna poolt – otse Haabersti poole |
| F2 | Paldiski mnt kesklinna poolt – vasakule Mustamäe teele |
| F3 | Endla tn – paremale Paldiski mnt-le kesklinna poole |
| F4 | Endla tn – otse Haabersti poole ja vasakule Mustamäe teele |
| F5 | Paldiski mnt Haabersti poolt – kesklinna poole ja Endlale |
| F6 | Paldiski mnt Haabersti poolt – paremale Mustamäe teele |
| F7 | Mustamäe tee – otse Paldiski mnt-le kesklinna poole |
| F8 | Mustamäe tee – Endlale (kaarjas ühendustee) |

## Esitamiseks vajalik

- [ ] Toimiv lahendus (esitlus 30. novembril algaval nädalal)
- [x] Hommikune, õhtune ja öörežiim (tarkvaras)
- [ ] Vähemalt 1 kaubandusliku välimusega, põrutuskindel (30 cm kukkumine) komponent
- [x] Elektriskeem – [docs/elektriskeem.md](docs/elektriskeem.md)
- [x] Andmete liikumise skeem + pakettide näited – [docs/andmevoog.md](docs/andmevoog.md)
- [ ] Installijuhend
- [ ] Video (üldvaade + detailid)
