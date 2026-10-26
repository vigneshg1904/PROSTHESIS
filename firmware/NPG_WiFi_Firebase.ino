// NPG_WiFi_Firebase.ino
// =============================================================================================
// NPG Lite -> Wi-Fi -> Firebase Realtime Database, for the "Irumbu Kai Maayavi" website.
//
// What it does
//   1. Power on: the status LED turns RED, then YELLOW while it joins your Wi-Fi, then GREEN when
//      it is streaming. (If the cloud link fails it shows ORANGE and keeps retrying.)
//   2. It samples the 3 BioAmp channels at 500 Hz (same ADC settings as the official Upside Down
//      Labs firmware), packs ~100 samples per upload and PUTs them to
//          <DB_URL>/devices/<DEVICE_ID>/raw.json
//      The website reads that node live, filters it and detects your fingers in the browser.
//   3. No laptop is needed. Power it from the battery.
//
// Board setup (Arduino IDE)
//   - Board: "ESP32C6 Dev Module"  (Arduino-ESP32 core 3.x)   - Library: "Adafruit NeoPixel"
//   - USB CDC On Boot: Enabled (only needed to see the log in Serial Monitor at 115200)
//   - Edit the four lines marked  <<< EDIT  below, then Upload.
//
// Safety: this sketch only reads signals. Electrodes + USB cable -> run the laptop on battery.
// Security note: the database rules in database.rules.json let anyone who knows your database URL
// write to /devices/<id>/raw. That is fine for a lab prototype; add authentication before real use.
// =============================================================================================

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <sdkconfig.h>
#include <Adafruit_NeoPixel.h>
#if defined(CONFIG_IDF_TARGET_ESP32C6)
#include "hal/efuse_hal.h"
#endif

// ----------------------------------------------------------------------------- <<< EDIT
const char *WIFI_SSID = "YOUR_WIFI_NAME";        // <<< EDIT  your Wi-Fi name (2.4 GHz)
const char *WIFI_PASS = "YOUR_WIFI_PASSWORD";    // <<< EDIT  your Wi-Fi password
const char *DEVICE_ID = "NPG01";                 // <<< EDIT  must match "Device ID" in the website Setup
const char *DB_URL = "https://irumbu-kai-maayavi-default-rtdb.asia-southeast1.firebasedatabase.app";  // <<< EDIT only if you change project
// -----------------------------------------------------------------------------

#define FW_VERSION "1.0"
#define NUM_CHANNELS 3
#define SAMP_RATE 500            // Hz per channel (the website expects 500)
#define RING_SIZE 1024           // samples kept while a upload is in progress (about 2 s)
#define BATCH_MIN 80             // do not upload fewer samples than this
#define BATCH_MAX 150            // 150 samples = 900 bytes, 1200 characters in base64
#define SEND_INTERVAL_MS 180     // about 5 uploads per second

#if defined(CONFIG_IDF_TARGET_ESP32C6)
uint32_t chiprev = efuse_hal_chip_revision();
#define PIXEL_PIN 15
#define PIXEL_COUNT 6
#elif defined(CONFIG_IDF_TARGET_ESP32C3)
#define PIXEL_PIN 3
#define PIXEL_COUNT 4
#else
#error "Unsupported board: please select ESP32-C6 (NPG Lite) in the Board Manager."
#endif
#define PIXEL_BRIGHTNESS 7

Adafruit_NeoPixel pixels(PIXEL_COUNT, PIXEL_PIN, NEO_GRB + NEO_KHZ800);

// ---- sampling: a hardware timer wakes a high-priority task every 2 ms; Wi-Fi uploads can block as long
//      as they like without losing samples.
hw_timer_t *sampleTimer = NULL;
TaskHandle_t samplerHandle = NULL;
static int16_t ring[RING_SIZE][NUM_CHANNELS];
static volatile uint32_t wrCount = 0;   // samples written since boot (monotonic)
static uint32_t rdCount = 0;            // samples already uploaded (monotonic)
static volatile bool skewFlag = false;  // set if sampling stalled, so the website restarts its filters

void IRAM_ATTR onSampleTimer() {
  BaseType_t woken = pdFALSE;
  vTaskNotifyGiveFromISR(samplerHandle, &woken);   // the task runs at the next RTOS tick (<= 1 ms)
}

static inline uint16_t readAdc(int ch) {
#if defined(CONFIG_IDF_TARGET_ESP32C6)
  if (chiprev == 1) return (uint16_t)map(analogRead(ch), 0, 3249, 0, 4095);   // same correction as the official firmware
#endif
  return (uint16_t)analogRead(ch);
}

void samplerTask(void *) {
  for (;;) {
    uint32_t n = ulTaskNotifyTake(pdFALSE, pdMS_TO_TICKS(100));   // one sample per notification
    if (n == 0) { skewFlag = true; continue; }                     // timer silent for 100 ms: flag a discontinuity
    uint32_t idx = wrCount % RING_SIZE;
    for (int c = 0; c < NUM_CHANNELS; c++) ring[idx][c] = (int16_t)readAdc(c);
    wrCount = wrCount + 1;
  }
}

// ---- LED
static void setLed(uint8_t r, uint8_t g, uint8_t b) {
  pixels.setPixelColor(PIXEL_COUNT - 1, pixels.Color(r, g, b));
  pixels.show();
}
#define LED_RED() setLed(PIXEL_BRIGHTNESS, 0, 0)
#define LED_YELLOW() setLed(PIXEL_BRIGHTNESS, PIXEL_BRIGHTNESS, 0)
#define LED_GREEN() setLed(0, PIXEL_BRIGHTNESS, 0)
#define LED_ORANGE() setLed(PIXEL_BRIGHTNESS, PIXEL_BRIGHTNESS / 3, 0)

// ---- base64 (no library needed)
static size_t b64encode(const uint8_t *src, size_t len, char *dst) {
  static const char T[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  size_t o = 0, i = 0;
  while (i + 2 < len) {
    uint32_t v = ((uint32_t)src[i] << 16) | ((uint32_t)src[i + 1] << 8) | src[i + 2];
    dst[o++] = T[(v >> 18) & 63]; dst[o++] = T[(v >> 12) & 63]; dst[o++] = T[(v >> 6) & 63]; dst[o++] = T[v & 63];
    i += 3;
  }
  if (len - i == 1) {
    uint32_t v = (uint32_t)src[i] << 16;
    dst[o++] = T[(v >> 18) & 63]; dst[o++] = T[(v >> 12) & 63]; dst[o++] = '='; dst[o++] = '=';
  } else if (len - i == 2) {
    uint32_t v = ((uint32_t)src[i] << 16) | ((uint32_t)src[i + 1] << 8);
    dst[o++] = T[(v >> 18) & 63]; dst[o++] = T[(v >> 12) & 63]; dst[o++] = T[(v >> 6) & 63]; dst[o++] = '=';
  }
  dst[o] = 0;
  return o;
}

// ---- cloud
WiFiClientSecure secureClient;
HTTPClient http;
String rawUrl, infoUrl;
static uint32_t seqNo = 0, lastSendMs = 0, failCount = 0;
static bool announced = false;

static bool putJson(const String &url, const String &body) {
  http.begin(secureClient, url);
  http.addHeader("Content-Type", "application/json");
  int code = http.PUT(body);
  http.end();
  return code >= 200 && code < 300;
}

static void connectWifi() {
  LED_YELLOW();
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);              // lower latency
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t t0 = millis();
  bool on = true;
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 25000) {
    delay(300);
    on = !on;
    if (on) LED_YELLOW(); else setLed(0, 0, 0);
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Wi-Fi connected, IP ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("Wi-Fi not connected yet; will keep trying");
  }
}

static void announce() {
  String body = String("{\"fw\":\"") + FW_VERSION + "\",\"ip\":\"" + WiFi.localIP().toString() + "\",\"ssid\":\"" + WIFI_SSID +
                "\",\"rate\":" + String(SAMP_RATE) + ",\"ch\":" + String(NUM_CHANNELS) + "}";
  putJson(infoUrl, body);
}

static bool sendBatch(uint16_t n) {
  static uint8_t raw[BATCH_MAX * NUM_CHANNELS * 2];
  static char b64[BATCH_MAX * NUM_CHANNELS * 2 * 4 / 3 + 8];
  for (uint16_t i = 0; i < n; i++) {
    uint32_t idx = (rdCount + i) % RING_SIZE;
    for (int c = 0; c < NUM_CHANNELS; c++) {
      int16_t v = ring[idx][c];
      size_t o = ((size_t)i * NUM_CHANNELS + c) * 2;
      raw[o] = (uint8_t)(v & 0xFF);
      raw[o + 1] = (uint8_t)((v >> 8) & 0xFF);
    }
  }
  size_t L = b64encode(raw, (size_t)n * NUM_CHANNELS * 2, b64);
  bool gap = skewFlag;
  String body;
  body.reserve(L + 160);
  body += "{\"seq\":"; body += String((unsigned long)seqNo);
  body += ",\"s0\":"; body += String((unsigned long)rdCount);
  body += ",\"n\":"; body += String((unsigned int)n);
  body += ",\"b\":\""; body += b64; body += "\"";
  body += ",\"rssi\":"; body += String((int)WiFi.RSSI());
  body += ",\"up\":"; body += String((unsigned long)millis());
  body += ",\"fw\":\"" FW_VERSION "\"";
  if (gap) body += ",\"g\":1";
  body += "}";
  seqNo++;
  lastSendMs = millis();
  bool ok = putJson(rawUrl, body);
  if (ok) {
    rdCount += n;
    if (gap) { skewFlag = false; }
    failCount = 0;
    LED_GREEN();
  } else {
    failCount++;
    LED_ORANGE();
    if (failCount % 4 == 0) secureClient.stop();   // force a fresh TLS connection
  }
  return ok;
}

void setup() {
  Serial.begin(115200);
  pixels.begin();
  LED_RED();
  analogReadResolution(12);
  rawUrl = String(DB_URL) + "/devices/" + DEVICE_ID + "/raw.json?print=silent";
  infoUrl = String(DB_URL) + "/devices/" + DEVICE_ID + "/info.json?print=silent";
  secureClient.setInsecure();        // skips certificate checks (simple for a prototype; see note at the top)
  http.setReuse(true);
  http.setTimeout(4000);
  http.setConnectTimeout(4000);

  xTaskCreate(samplerTask, "sampler", 4096, NULL, 6, &samplerHandle);
  sampleTimer = timerBegin(1000000);
  timerAttachInterrupt(sampleTimer, &onSampleTimer);
  timerAlarm(sampleTimer, 1000000 / SAMP_RATE, true, 0);

  connectWifi();
  if (WiFi.status() == WL_CONNECTED) { announce(); announced = true; }
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    LED_YELLOW();
    static uint32_t lastTry = 0;
    if (millis() - lastTry > 8000) { lastTry = millis(); WiFi.disconnect(); WiFi.begin(WIFI_SSID, WIFI_PASS); }
    delay(200);
    uint32_t over = wrCount - rdCount;     // keep the buffer from growing while offline
    if (over > RING_SIZE / 2) { rdCount = wrCount - 128; skewFlag = true; }
    return;
  }
  if (!announced) { announce(); announced = true; }

  uint32_t avail = wrCount - rdCount;
  if (avail > RING_SIZE - 64) {            // about to overwrite unsent samples: drop the oldest, flag the gap
    rdCount = wrCount - RING_SIZE / 2;
    skewFlag = true;
    avail = wrCount - rdCount;
  }
  if (avail >= BATCH_MIN && millis() - lastSendMs >= SEND_INTERVAL_MS) {
    uint16_t n = avail > BATCH_MAX ? BATCH_MAX : (uint16_t)avail;
    sendBatch(n);
  } else {
    delay(4);
  }
}
