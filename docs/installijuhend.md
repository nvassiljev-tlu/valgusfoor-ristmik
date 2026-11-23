# Installijuhend

See juhend paneb kogu lahenduse nullist tööle: püsivara plaatidele, veebileht arvutisse ja soovi korral
mitu arvutit koos. Juhtmete ühendused on kirjas [elektriskeem.md](elektriskeem.md)-s.

## Mida on vaja

| Mis | Milleks | Märkus |
|---|---|---|
| Arvuti (Windows, macOS või Linux) | veebileht ja plaatide USB-ühendus | |
| Google Chrome või Microsoft Edge | veebileht | USB-ühendus (Web Serial) töötab ainult neis, Safari ja Firefox ei sobi |
| [Arduino IDE 2](https://www.arduino.cc/en/software) | püsivara laadimine plaatidele | vaja ainult seadistamisel |
| ESP8266 plaat, 5 LED-i, 5 takistit, juhtmed | iga füüsiline foor | vt [komponendid](elektriskeem.md#komponendid-ühe-foori-kohta) |
| micro-USB **andmekaabel** | toide ja andmed | ainult laadimiseks mõeldud kaabliga arvuti plaati ei näe |
| Internet | õige kellaaeg ja mitme arvuti ruum | ilma internetita töötab leht arvuti kella järgi |
| [Node.js](https://nodejs.org) 22 või uuem | ainult testid ja oma relee | lehe kasutamiseks pole vaja |

## 1. Kood

Repo on privaatne, seega on kloonimiseks vaja ligipääsu (küsi meeskonnalt). Seejärel:

```bash
git clone https://github.com/nvassiljev-tlu/valgusfoor-ristmik.git
```

Teine võimalus: GitHubis **Code → Download ZIP** ja paki lahti. Midagi pole vaja paigaldada ega
kompileerida, veebileht koosneb tavalistest failidest.

## 2. Riistvara

Ühenda iga foori viis LED-i plaadi külge [elektriskeemi](elektriskeem.md) järgi:

| Tuli | Viik |
|---|---|
| Autode punane, kollane, roheline | D3, D4, D5 |
| Jalakäijate punane, roheline | D1, D2 |
| Kõigi LED-ide miinus | GND |

Iga LED-iga on jadamisi takisti 220 Ω ja LED-i pikk jalg on takisti poole.

## 3. Püsivara plaatidele

Tee seda iga plaadiga üks kord ja uuesti siis, kui `sketch_valgusfoor.ino` muutub.

1. Paigalda ja ava Arduino IDE 2.
2. Lisa ESP8266 plaatide pakett: **File → Preferences** (macOS-is **Arduino IDE → Settings**), kirjuta
   väljale **Additional boards manager URLs**

   ```
   https://arduino.esp8266.com/stable/package_esp8266com_index.json
   ```

   ja vajuta **OK**.
3. **Tools → Board → Boards Manager**, otsi `esp8266` ja paigalda **esp8266 by ESP8266 Community**.
4. Vali **Tools → Board → esp8266 → NodeMCU 1.0 (ESP-12E Module)**.
5. Ühenda plaat andmekaabliga ja vali **Tools → Port** alt selle port (macOS-is nt
   `/dev/cu.usbserial-…`, Windowsis nt `COM3`). Kui pole kindel, tõmba plaat lahti ja vaata, milline
   port kaob.
6. **File → Open** ja vali repo kaustast `sketch_valgusfoor/sketch_valgusfoor.ino`.
7. Vajuta **Upload** (nool vasakul üleval). Laadimine on valmis, kui allservas on „Hard resetting via
   RTS pin…“.
8. Kontrolli plaati Serial Monitoriga (115200 baudi, „New Line“), nagu kirjas
   [elektriskeemi juhendis](elektriskeem.md#kontroll-enne-veebilehe-kasutamist): plaat kirjutab
   `READY`, `KES?` peale vastab `SEADE:…` ja `TULED:11111` paneb kõik LED-id põlema.
9. **Sulge Serial Monitor**, muidu ei saa veebileht porti avada.

## 4. Veebileht

1. Ava `index.html` **Chrome'is või Edge'is**: lohista fail brauseri aknasse või vali paremklõpsuga
   „Ava rakendusega → Chrome“. Topeltklõps sobib, kui Chrome või Edge on vaikimisi brauser.
2. Päises on kellaaja allikas, nt „aeg: cloudflare.com ±12 ms“. Kui seal on „internet ei vastanud –
   kasutan arvuti kella“, töötab leht ikka, aga mitme arvuti korral võivad foorid olla veidi eri
   taktis.

Teine võimalus on käivitada repo kaustas kohalik veebiserver (vaja on Pythonit):

```bash
python3 -m http.server 8000
```

ja avada `http://localhost:8000`.

## 5. Plaatide ühendamine

1. Ühenda plaat USB-kaabliga arvutiga. Plaat vilgutab autodele kollast: lehelt pole veel midagi
   tulnud.
2. Vajuta plokis **„Füüsilised foorid“** nuppu **„+ Ühenda ESP“**, vali avanevas aknas plaadi port ja
   vajuta **Connect** (eestikeelses Chrome'is „Ühenda“).
3. Plokki tekib rida **„Seade 1“** koos plaadi kiibi numbriga. Olek „tuvastan…“ muutub kohe
   „ühendatud“-ks.
4. Vali real, millist **autode foori** see plaat näitab. Ülekäik tuleb automaatselt kaasa, seda saab
   eraldi muuta. Teine võimalus: klõpsa kaardil foori ja vajuta **„Näita seadmel 1“**.
5. Plaat jätab valiku meelde. Pärast lehe uuesti laadimist või plaadi uuesti ühendamist näitab see sama
   foori. Kui Chrome plaati ise uuesti ei ühenda, vajuta jälle „+ Ühenda ESP“.
6. Järgmise plaadi jaoks korda samme 1–4. Plaate võib olla nii palju, kui USB-porte jagub.

## 6. Mitu arvutit (valikuline)

Kui plaadid on mitme arvuti küljes, tee igas arvutis sammud 4–5 ja ühenda arvutid samasse ruumi:

1. Esimeses arvutis vajuta plokis **„Mitu arvutit“** nuppu **„Uus ruum“**. Ruumi kood on plokis näha.
2. Teises arvutis kirjuta sama kood väljale ja vajuta **„Ühenda“**.
3. Mõlemas arvutis on olek „ruumis“. Režiimi muutus ühes arvutis hakkab kõigis kehtima samal hetkel.

Vaikimisi käivad sõnumid avaliku relee ntfy.sh kaudu ja selleks on vaja internetti. Ilma internetita:

1. Paigalda ühte arvutisse Node.js ja käivita repo kaustas

   ```bash
   node server/relay.js
   ```

   Jäta see aken lahti, kuni foore kasutatakse.
2. Relee kirjutab oma aadressid, nt `http://192.168.1.5:8090`. Kirjuta see kõigis arvutites väljale
   **„Relee“** enne nupu „Ühenda“ vajutamist.
3. Arvutid peavad olema samas võrgus, nt telefoni levialas. Kui arvuti küsib, kas lubada `node`-l
   võrguühendusi vastu võtta, või Chrome küsib luba kohtvõrgu seadmetega suhtlemiseks, luba.

Rohkem: [README](../README.md#mitu-arvutit) ja [andmevoog.md](andmevoog.md#mitu-arvutit).

## 7. Kas kõik töötab?

- [ ] Päises on kellaaja allikas, nt „aeg: cloudflare.com ±12 ms“.
- [ ] Iga plaadi rida on „ühendatud“ ja plaadi LED-id näitavad sama mis selle foor kaardil.
- [ ] Nupp „Öö“ viib plaadid ohutult öörežiimi: roheline → vilkuv roheline → kollane → punane →
      vilkuv kollane.
- [ ] Mitme arvutiga: kõigis on „ruumis“ ja ühes arvutis valitud režiim jõuab teistesse.

## Testid (valikuline)

Vaja on Node.js 22 või uuemat. Käivita repo kaustas:

```bash
node test/safety.test.js
```

```bash
node test/devices.test.js
```

```bash
node test/sync.test.js
```

```bash
node test/relay.test.js
```

Iga test lõpeb reaga „OK – …“.

## Uuendamine

```bash
git pull
```

Kui `sketch_valgusfoor/sketch_valgusfoor.ino` muutus, laadi püsivara kõigile plaatidele uuesti
(samm 3). Plaadi meelde jäetud foor jääb alles, kui Arduino IDE-s on **Tools → Erase Flash**
väärtus „Only Sketch“ (vaikimisi).

## Probleemid

| Mida näed | Mida teha |
|---|---|
| „See brauser ei toeta USB-ühendust (Web Serial)“, nupp „+ Ühenda ESP“ on hall | Ava leht Chrome'is või Edge'is |
| Pordi valikus pole plaati | Proovi teist kaablit (andmekaabel!) ja teist USB-porti; vajadusel paigalda plaadi USB-kiibi draiver (CH340 või CP210x, kiip on USB-pesa juures) |
| Linuxis „Ühendus ebaõnnestus“ | Lisa kasutaja gruppi `dialout` (`sudo usermod -aG dialout $USER`) ja logi uuesti sisse |
| „port on juba avatud…“ | Sulge Arduino IDE Serial Monitor ja teised vahekaardid, kus leht on lahti |
| Üleslaadimisel „Failed to connect to ESP8266“ | Hoia plaadi FLASH-nuppu all, kui laadimine algab; proovi teist kaablit või väiksemat **Tools → Upload Speed** väärtust |
| Plaat ei käivitu, Serial Monitoris pole `READY`-t | Vt [Kui plaat ei käivitu](elektriskeem.md#kui-plaat-ei-käivitu) |
| Plaat vilgutab kollast, kuigi on ühendatud | Esimestel sekunditel on see normaalne. Hiljem tähendab see, et lehelt ei tule ridu (leht suleti või vahekaart oli kaua peidus); seadme olek on siis „ühendatud, RIKE“ |
| Plaat näitab vale foori | Vali seadme real õige foor, plaat jätab uue valiku meelde |
| „internet ei vastanud – kasutan arvuti kella“ | Ühenda internet; mitme arvuti korral sobib ka oma relee |
| „Mitu arvutit“: „Relee ei vasta“ | Kontrolli internetti või relee aadressi; oma relee peab töötama ja arvutid olema samas võrgus |
