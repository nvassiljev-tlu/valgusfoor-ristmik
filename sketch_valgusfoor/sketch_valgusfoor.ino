//  Valgusfoor (ESP8266): füüsiline foor, mis peegeldab üht ristmiku foori.
//  Millist foori plaat näitab, valitakse veebilehel (index.html); kogu foorikava on lehel.
//
//  Käsud lehelt (iga käsk eraldi real, 115200 baudi):
//    MAARA:F3,U8   – plaat näitab autode foori F3 ja ülekäiku Ü8 (ainult info)
//    TULED:00110   – autode punane, kollane, roheline, jalakäijate punane, roheline;
//                    0 = kustus, 1 = põleb, 2 = vilgub. Leht kordab olekut iga sekund.
//  Vastused lehele:
//    READY         – plaat käivitus
//    OK <käsk>     – käsk täideti (TULED puhul ainult siis, kui olek muutus)
//    VIGA <käsk>   – tundmatu käsk või vale väärtus
//    RIKE          – lehelt pole 5 s midagi tulnud, autodele vilkuv kollane

// D3 (GPIO0) ja D4 (GPIO2) mõjutavad käivitumist ning D4 küljes on plaadi enda LED.
// Kui plaat ei käivitu, tõsta LED-id viikudele D5, D6, D7.
const int carRed = D3;
const int carYellow = D4;
const int carGreen = D5;
const int pedRed = D1;
const int pedGreen = D2;

const unsigned long SIDE_TIMEOUT = 5000;
const unsigned long BLINK_MS = 1000;

const char L_ON = '1';
const char L_BLINK = '2';

char lights[6] = "02000";
String assigned = "-";
bool linkOk = false;
unsigned long lastMessage = 0;
unsigned long blinkStart = 0; // vilkumine algab oleku saabumisel, et käia lehega samas taktis

String inputLine = "";

bool isOn(char v, bool blinkOn) {
  return v == L_ON || (v == L_BLINK && blinkOn);
}

void setLights(bool cR, bool cY, bool cG, bool pR, bool pG) {
  digitalWrite(carRed, cR);
  digitalWrite(carYellow, cY);
  digitalWrite(carGreen, cG);
  digitalWrite(pedRed, pR);
  digitalWrite(pedGreen, pG);
}

bool validLights(const String &v) {
  if (v.length() != 5) return false;
  for (int i = 0; i < 5; i++) {
    if (v[i] < '0' || v[i] > '2') return false;
  }
  return true;
}

void handleCommand(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;
  int colon = cmd.indexOf(':');
  if (colon < 0) {
    Serial.println("VIGA " + cmd);
    return;
  }
  String name = cmd.substring(0, colon);
  String value = cmd.substring(colon + 1);

  if (name == "TULED" && validLights(value)) {
    lastMessage = millis();
    bool changed = !linkOk || value != String(lights);
    if (changed) {
      value.toCharArray(lights, sizeof(lights));
      blinkStart = millis();
      linkOk = true;
      Serial.println("OK " + cmd); // elusoleku kordusi ei kinnitata
    }
  } else if (name == "MAARA" && value.length() > 0 && value.length() <= 20) {
    lastMessage = millis();
    assigned = value;
    Serial.println("OK " + cmd);
  } else {
    Serial.println("VIGA " + cmd);
  }
}

void readSerial() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\n') {
      handleCommand(inputLine);
      inputLine = "";
    } else if (c != '\r') {
      inputLine += c;
      if (inputLine.length() > 60) inputLine = "";
    }
  }
}

void setup() {
  Serial.begin(115200);

  pinMode(carRed, OUTPUT);
  pinMode(carYellow, OUTPUT);
  pinMode(carGreen, OUTPUT);
  pinMode(pedRed, OUTPUT);
  pinMode(pedGreen, OUTPUT);
  setLights(false, false, false, false, false);

  Serial.println(); // eraldab käivitusprügi READY-st
  Serial.println("READY");
}

void loop() {
  readSerial();
  unsigned long now = millis();

  if (linkOk && now - lastMessage > SIDE_TIMEOUT) {
    linkOk = false;
    blinkStart = now;
    Serial.println("RIKE");
  }

  bool blinkOn = (now - blinkStart) % BLINK_MS < BLINK_MS / 2;
  if (!linkOk) {
    setLights(false, blinkOn, false, false, false);
  } else {
    setLights(isOn(lights[0], blinkOn), isOn(lights[1], blinkOn), isOn(lights[2], blinkOn),
              isOn(lights[3], blinkOn), isOn(lights[4], blinkOn));
  }
}
