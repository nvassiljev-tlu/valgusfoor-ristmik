//  Valgusfoor (ESP8266): füüsiline foor, mis peegeldab üht ristmiku foori.
//  Millist foori plaat näitab, valitakse veebilehel (index.html); kogu foorikava on lehel.
//  Plaat jätab valitud foori välkmällu meelde, nii et see säilib ka pärast taaskäivitust.
//
//  Käsud lehelt (iga käsk eraldi real, 115200 baudi):
//    KES?          – küsib plaadi tunnust ja meelde jäetud foori
//    MAARA:F3,U8   – plaat näitab autode foori F3 ja ülekäiku Ü8 ning jätab selle meelde
//    TULED:00110   – autode punane, kollane, roheline, jalakäijate punane, roheline;
//                    0 = kustus, 1 = põleb, 2 = vilgub. Leht kordab olekut iga sekund.
//  Vastused lehele:
//    READY               – plaat käivitus
//    SEADE:3F2A1C,F3,U8  – vastus KES?-le: kiibi number ja meelde jäetud foor ("-" = pole)
//    OK <käsk>           – käsk täideti (TULED puhul ainult siis, kui olek muutus)
//    VIGA <käsk>         – tundmatu käsk või vale väärtus
//    RIKE                – lehelt pole 5 s midagi tulnud, autodele vilkuv kollane

#include <EEPROM.h>

// D3 (GPIO0) ja D4 (GPIO2) mõjutavad käivitumist ning D4 küljes on plaadi enda LED.
// Kui plaat ei käivitu, tõsta autode punane D7-le ja kollane D6-le (docs/elektriskeem.md).
const int carRed = D3;
const int carYellow = D4;
const int carGreen = D5;
const int pedRed = D1;
const int pedGreen = D2;

const unsigned long SIDE_TIMEOUT = 5000;
const unsigned long BLINK_MS = 1000;

const char L_ON = '1';
const char L_BLINK = '2';

const int MEMORY_SIZE = 32;
const byte MEMORY_MARK = 0xA7; // mälu algus: määrang on salvestatud
const char NOT_ASSIGNED[] = "-,-";

char lights[6] = "02000";
char boardId[9];
String assigned = NOT_ASSIGNED;
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

String loadAssignment() {
  if (EEPROM.read(0) != MEMORY_MARK) return NOT_ASSIGNED;
  String value = "";
  for (int i = 1; i < MEMORY_SIZE; i++) {
    char c = EEPROM.read(i);
    if (c == 0) break;
    if (c < ' ' || c > '~') return NOT_ASSIGNED;
    value += c;
  }
  return value.length() > 0 ? value : String(NOT_ASSIGNED);
}

void saveAssignment(const String &value) {
  EEPROM.write(0, MEMORY_MARK);
  for (unsigned int i = 0; i < value.length(); i++) EEPROM.write(1 + i, value[i]);
  EEPROM.write(1 + value.length(), 0);
  EEPROM.commit();
}

void handleCommand(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;
  if (cmd == "KES?") {
    Serial.println(String("SEADE:") + boardId + "," + assigned);
    return;
  }
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
    if (value != assigned) { // välkmällu kirjutame ainult muutuse
      assigned = value;
      saveAssignment(assigned);
    }
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

  snprintf(boardId, sizeof(boardId), "%06lX", (unsigned long)ESP.getChipId());
  EEPROM.begin(MEMORY_SIZE);
  assigned = loadAssignment();

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
