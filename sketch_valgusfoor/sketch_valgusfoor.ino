//  Valgusfoor (ESP8266) – Ristmik 2 ehk füüsiline foor
//  Juhitakse veebilehelt (index.html) USB jadapordi kaudu.
//
//  Käsud veebilehelt (iga käsk eraldi real):
//    SYNC:<ms>     – kellaaeg millisekundites alates südaööst
//    MODE:<0|1|2>  – 0 = automaatne, 1 = vilkuv kollane, 2 = nupuga ülekäik
//    CYCLE:<s>     – kogu tsükli pikkus sekundites (13–120)
//    OFFSET:<s>    – rohelise laine nihe sekundites (võib olla negatiivne)
//    BUTTON:<ms>   – jalakäija nupu vajutuse hetk (sama ajaskaala mis SYNC)
//  Vastused veebilehele: READY (käivitus), OK <käsk>, VIGA <käsk>
//
//  NB! Faaside tabel (PHASES) peab olema täpselt sama mis index.html-is,
//  muidu ekraani foor ja füüsiline foor ei näita sama asja.


// Viigud (pin), mille külge on ühendatud foori LED-id
const int carRed = D3;    // Autode punane tuli
const int carYellow = D4; // Autode kollane tuli
const int carGreen = D5;  // Autode roheline tuli
const int pedRed = D1;    // Jalakäijate punane tuli
const int pedGreen = D2;  // Jalakäijate roheline tuli

// Ühe tule võimalikud olekud faaside tabelis
const byte L_OFF = 0;   // Kustus
const byte L_ON = 1;    // Põleb
const byte L_BLINK = 2; // Vilgub (0,5 s põleb, 0,5 s kustus)

// Üks foori faas: kui kaua see kestab ja millised tuled põlevad
struct Phase {
  long dur;     // Kestus millisekundites; 0 = rohelise kestus (arvutatakse tsükli pikkusest)
  byte car[3];  // Autode tuled: punane, kollane, roheline
  byte ped[2];  // Jalakäijate tuled: punane, roheline
};

// Automaatse tsükli faasid järjekorras (tsükkel algab jalakäijate rohelisega)
const Phase PHASES[] = {
  {0,    {L_ON,  L_OFF, L_OFF},   {L_OFF, L_ON}},    // 0: Jalakäijatele roheline
  {2000, {L_ON,  L_OFF, L_OFF},   {L_OFF, L_BLINK}}, // 1: Jalakäijatele vilkuv roheline
  {1000, {L_ON,  L_OFF, L_OFF},   {L_ON,  L_OFF}},   // 2: Kõik punased (puhver)
  {1000, {L_ON,  L_ON,  L_OFF},   {L_ON,  L_OFF}},   // 3: Autodele punane + kollane
  {0,    {L_OFF, L_OFF, L_ON},    {L_ON,  L_OFF}},   // 4: Autodele roheline
  {2000, {L_OFF, L_OFF, L_BLINK}, {L_ON,  L_OFF}},   // 5: Autodele vilkuv roheline
  {2000, {L_OFF, L_ON,  L_OFF},   {L_ON,  L_OFF}},   // 6: Autodele kollane
  {1000, {L_ON,  L_OFF, L_OFF},   {L_ON,  L_OFF}},   // 7: Kõik punased (puhver)
};
const int PHASE_COUNT = 8;      // Faaside arv tabelis
const long FIXED_MS = 9000;     // Kõigi mitte-roheliste faaside kestuste summa (2+1+1+2+2+1 s)
const int IDLE_PHASE = 4;       // Nupurežiimi ooteseis: autodele roheline
const int BUTTON_START = 5;     // Nupuvajutuse järel alustatakse faasist "autodele vilkuv roheline"

// Foori seaded (muudetakse veebilehelt saadetud käskudega)
int mode = 0;            // Režiim: 0 = automaatne, 1 = vilkuv kollane, 2 = nupuga
long cycleMs = 20000;    // Kogu tsükli pikkus millisekundites
long offsetMs = 0;       // Laine nihe millisekundites (+ = hiljem, − = varem)
long long pressAt = -1;  // Jalakäija nupu vajutuse hetk; -1 = pole vajutatud

// Kellaaja sünkroniseerimine
bool synced = false;          // Kas veebilehelt on kellaaeg juba saadud
long long syncTime = 0;       // Saadud kellaaeg (ms alates südaööst)
unsigned long syncMillis = 0; // millis() väärtus sünkroniseerimise hetkel

String inputLine = "";  // Siia kogutakse jadapordist tulevaid tähemärke, kuni rida saab täis

// Praegune kellaaeg ms alates südaööst = sünkroniseeritud aeg + sellest möödunud aeg
long long now() {
  return syncTime + (long long)(millis() - syncMillis);
}

// Jääk, mis on alati positiivne (tavaline % annab negatiivse arvu korral negatiivse tulemuse)
long long mod(long long a, long long n) {
  long long r = a % n;
  return r < 0 ? r + n : r;
}

// Rohelise tule kestus: tsükkel miinus fikseeritud faasid, jagatud kaheks (autod + jalakäijad)
long greenMs() {
  return (cycleMs - FIXED_MS) / 2;
}

// Faasi kestus: tabelist või rohelise kestus, kui tabelis on 0
long phaseDur(int i) {
  return PHASES[i].dur > 0 ? PHASES[i].dur : greenMs();
}

// Mitu ms möödub tsükli algusest kuni faasi i alguseni
long phaseStart(int i) {
  long sum = 0;
  for (int k = 0; k < i; k++) sum += phaseDur(k);
  return sum;
}

// Kas tuli peab praegu põlema (vilkuv tuli põleb iga sekundi esimese poole)
bool isOn(byte v, bool blinkOn) {
  return v == L_ON || (v == L_BLINK && blinkOn);
}

// Näitab faasi i; inPhase = mitu ms on faasi algusest möödunud (vaja vilkumise jaoks)
void showPhase(int i, long long inPhase) {
  bool blinkOn = mod(inPhase, 1000) < 500;
  const Phase &p = PHASES[i];
  setLights(isOn(p.car[0], blinkOn), isOn(p.car[1], blinkOn), isOn(p.car[2], blinkOn),
            isOn(p.ped[0], blinkOn), isOn(p.ped[1], blinkOn));
}

// Leiab, milline faas on tsükli hetkel ct (0 … cycleMs-1), ja näitab seda
void showCycleAt(long long ct) {
  for (int i = 0; i < PHASE_COUNT; i++) {
    long d = phaseDur(i);
    if (ct < d) {        // ct jääb selle faasi sisse
      showPhase(i, ct);
      return;
    }
    ct -= d;             // Liigume järgmise faasi juurde
  }
}

// Lülitab kõik viis LED-i korraga sisse või välja
void setLights(bool cR, bool cY, bool cG, bool pR, bool pG) {
  digitalWrite(carRed, cR);      // true = HIGH (põleb), false = LOW (kustus)
  digitalWrite(carYellow, cY);
  digitalWrite(carGreen, cG);
  digitalWrite(pedRed, pR);
  digitalWrite(pedGreen, pG);
}

// Täidab ühe veebilehelt saadud käsu, nt "MODE:2"
void handleCommand(String cmd) {
  cmd.trim();                       // Eemaldame tühikud rea otstest
  int colon = cmd.indexOf(':');     // Koolon eraldab käsu nime ja väärtuse
  if (colon < 0) {
    Serial.println("VIGA " + cmd);
    return;
  }
  String name = cmd.substring(0, colon);         // Käsu nimi, nt "MODE"
  long value = cmd.substring(colon + 1).toInt(); // Väärtus numbrina, nt 2

  if (name == "SYNC") {
    // Jätame meelde saadud kellaaja ja millis() väärtuse samal hetkel
    syncTime = value;
    syncMillis = millis();
    synced = true;
  } else if (name == "MODE" && value >= 0 && value <= 2) {
    mode = value;
    pressAt = -1;  // Režiimi vahetusel tühistame pooleli oleva nupuvajutuse
  } else if (name == "CYCLE" && value >= 13 && value <= 120) {
    cycleMs = value * 1000;  // Sekundid -> millisekundid
  } else if (name == "OFFSET" && value >= -120 && value <= 120) {
    offsetMs = value * 1000; // Sekundid -> millisekundid
  } else if (name == "BUTTON" && mode == 2) {
    pressAt = value;  // Vajutuse hetk tuleb veebilehelt, et mõlemad foorid alustaksid täpselt koos
  } else {
    Serial.println("VIGA " + cmd);  // Tundmatu käsk või vale väärtus
    return;
  }
  Serial.println("OK " + cmd);  // Kinnitus veebilehele (näha logis)
}

// Loeb jadapordist tähemärke ilma ootamata; terve rea korral täidab käsu
void readSerial() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\n') {               // Rea lõpp -> käsk on terve
      handleCommand(inputLine);
      inputLine = "";
    } else if (c != '\r') {
      inputLine += c;
      if (inputLine.length() > 40) inputLine = "";  // Kaitse prügi vastu: liiga pikk rida visatakse ära
    }
  }
}

// Käivitub üks kord, kui plaat sisse lülitatakse
void setup() {
  Serial.begin(115200);  // Jadaühendus (sama kiirus mis veebilehel)

  // Määrame kõik LED-ide viigud väljunditeks
  pinMode(carRed, OUTPUT);
  pinMode(carYellow, OUTPUT);
  pinMode(carGreen, OUTPUT);
  pinMode(pedRed, OUTPUT);
  pinMode(pedGreen, OUTPUT);

  setLights(LOW, LOW, LOW, LOW, LOW);  // Alguses kõik tuled kustu
  Serial.println();         // Tühi rida eraldab käivitusprügi meie teatest
  Serial.println("READY");  // Veebileht saadab selle peale kellaaja ja seaded
}

// Põhitsükkel, mis kordub lõputult
void loop() {
  readSerial();  // Kontrollime, kas veebilehelt on tulnud uus käsk

  long long t = now();  // Sünkroniseeritud kellaaeg

  if (!synced || mode == 1) {
    // Kellaaega pole veel saadud VÕI öörežiim: autodele vilkuv kollane, jalakäijatele kõik kustu
    setLights(false, mod(t, 1000) < 500, false, false, false);
  } else if (mode == 0) {
    // Automaatne tsükkel: nihe lükkab tsüklit (+ = hiljem, − = varem)
    showCycleAt(mod(t - offsetMs, cycleMs));
  } else {
    // Nupurežiim
    long long elapsed = t - pressAt;  // Mitu ms on nupuvajutusest möödunud
    if (pressAt >= 0 && elapsed < cycleMs - greenMs()) {
      // Ülekäik käib: liigume tsüklis alates faasist "autodele vilkuv roheline"
      showCycleAt(mod(phaseStart(BUTTON_START) + elapsed, cycleMs));
    } else {
      // Ootame nuppu: autodele roheline, jalakäijatele punane
      showPhase(IDLE_PHASE, 0);
    }
  }
}
