# Irumbu Kai Maayavi - myoelectric training lab (Phase 1)

A website where your own finger signals play five trials and produce a prosthesis-readiness report.
NPG (3 channels + REF) -> Wi-Fi -> Firebase Realtime Database -> this website (detects your fingers in the browser).

Educational training tool. Not a medical device. Scores are indicative, not a clinical assessment.

## What is in this folder

| path | what it is |
|---|---|
| `index.html`, `css/`, `js/`, `assets/` | the website (plain static files, no build step) |
| `js/config.js` | your Firebase settings and the Device ID |
| `database.rules.json` | the Realtime Database rules (paste into the Firebase console) |
| `firmware/NPG_WiFi_Firebase.ino` | code for the NPG Lite (Arduino IDE) |
| `tools/export_model_json.py` | trains the website's detection model from YOUR recordings and uploads it |
| `tools/sim_device.py` | a pretend NPG, to test everything before wearing electrodes |
| `dev/mock_rtdb.mjs` | a local fake Firebase for offline testing (needs Node.js) |
| `model.demo.json` | DEMO model, works only with the simulator, never with a real arm |
| `vercel.json` | deployment settings |

## 1. Firebase (once)

1. Firebase console -> Realtime Database -> **Rules** tab -> replace everything with the contents of `database.rules.json` -> **Publish**.
2. Your database address is already in `js/config.js` and in the firmware. Change both only if you make a new project.

Security: these rules let anyone who knows your database address write to `/devices/<id>/raw`. That is fine for a lab prototype.
Before real patients use it, add Firebase Authentication and tighten the rules.

## 2. Put the website online (Vercel)

1. Make a GitHub repository whose root contains `index.html` (upload the contents of this folder).
2. Vercel -> Add New Project -> import the repository. Framework Preset: **Other**. Build command: empty. Output directory: empty (or `.`). Deploy.
3. Open the site. The game list works offline; trials need the NPG online.

## 3. Flash the NPG

1. Arduino IDE: Board **ESP32C6 Dev Module** (Arduino-ESP32 core 3.x). Library: **Adafruit NeoPixel**.
2. Open `firmware/NPG_WiFi_Firebase.ino`. Edit the lines marked `<<< EDIT`: Wi-Fi name (2.4 GHz), Wi-Fi password, Device ID (default `NPG01`).
3. Upload. Power it from the battery. Light: red = booting, yellow = joining Wi-Fi, green = sending, orange = cloud problem (it keeps retrying).
4. Electrodes + USB cable together: run the laptop on battery, charger unplugged.

## 4. Your own detection model (important)

The website ships with a DEMO model. For your arm, on the laptop that has your recordings
(`emg_hand_3ch.py` and the `emg3_dataset` folder), put `tools/export_model_json.py` next to them and run:

    python export_model_json.py --upload

It prints an honest accuracy test, then uploads the model to Firebase. The website loads it automatically.
Re-run it after every new recording sitting. Setup (gear icon) shows whether the model is DEMO or yours.

## 5. Try everything without hardware

    # one terminal (needs Node.js)
    node dev/mock_rtdb.mjs
    # second terminal: copy tools/sim_device.py into the folder that has emg_hand_3ch.py, then run it from THERE
    python sim_device.py --db http://localhost:8787/db --follow
    # browser
    http://localhost:8787/?dev=1&db=http://localhost:8787/db

`?dev=1` and `?db=` only work on localhost. Keys 0-5 pick the simulated finger.
Against the real Firebase, plain `python sim_device.py` works too (same folder rule). Stop it before you wear the real NPG.

## First-run checklist

1. NPG light green, website chip says **NPG ONLINE**.
2. Forearm on a table, palm up. Press **Hand check** once per sitting (4 s relaxed).
3. Curl ONE finger, hold, relax fully. The next finger registers about 1 s after you relax (the "RELAX 0.8s" badge counts it down).

## Troubleshooting

- Chip says WAITING FOR NPG: the NPG is not sending. Check Wi-Fi (2.4 GHz), Device ID equal in firmware and Setup, rules published.
- Chip says NPG OFFLINE: the website cannot reach Firebase (internet or wrong database address).
- Fingers read wrong or flicker: re-run the export tool after a fresh recording at the start of the day; check electrodes.
- A relaxed hand shows a finger: in `js/config.js` raise `rest_bias` (2 -> 3) or `activity_floor` (1.15 -> 1.3).

## What was tested, and what was not

Tested by automated runs (simulated NPG, local fake Firebase, headless Chromium): the in-browser detection matches the
Python pipeline exactly, all five trials complete and score, offline locking, pause on signal loss and automatic resume,
the firmware logic (contiguous samples, gap flagging after a Wi-Fi outage), and that every payload fits the rules.
NOT tested: your real NPG, Wi-Fi and Firebase connection, and the detection accuracy on your own arm.
