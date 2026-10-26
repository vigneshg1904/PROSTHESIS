#!/usr/bin/env python3
"""
sim_device.py  -  a pretend NPG (no hardware needed)
=====================================================
Pushes simulated 3-channel EMG to Firebase in exactly the same format as the real NPG firmware, so you can
test the website (loading, device ONLINE/OFFLINE, all five games, the report) before wearing any electrodes.

Put it next to emg_hand_3ch.py, then:

    python sim_device.py                          # cycles through the fingers by itself
    python sim_device.py --follow                 # fingers are chosen from the website's dev panel (?dev=1)
    python sim_device.py --db http://localhost:8787/db     # test against the local mock server

IMPORTANT: this makes SIMULATED signals. They only work with the DEMO model, never with a model trained on
your own arm. Stop it (Ctrl+C) before you power on the real NPG.
"""

import argparse
import base64
import json
import sys
import threading
import time
import urllib.error
import urllib.request

import numpy as np

try:
    from emg_hand_3ch import FS, N_CH, SimSignal
except ImportError:
    sys.exit("Put sim_device.py in the same folder as emg_hand_3ch.py.")

DEFAULT_DB = "https://irumbu-kai-maayavi-default-rtdb.asia-southeast1.firebasedatabase.app"
FINGERS = ["THUMB", "INDEX", "MIDDLE", "RING", "LITTLE"]


def http(method, url, body=None, timeout=5):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def main():
    ap = argparse.ArgumentParser(description="Simulated NPG -> Firebase")
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--device", default="NPG01")
    ap.add_argument("--follow", action="store_true", help="take the finger from /sim/<device>/label (website dev panel)")
    ap.add_argument("--hold", type=float, default=3.0, help="seconds per finger when cycling")
    ap.add_argument("--rest", type=float, default=2.5, help="seconds of rest between fingers when cycling")
    ap.add_argument("--batch", type=int, default=100, help="samples per upload (100 = every 0.2 s)")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    db = args.db.rstrip("/")
    raw_url = f"{db}/devices/{args.device}/raw.json?print=silent"
    label = {"v": "REST"}
    stop = threading.Event()

    def follower():
        url = f"{db}/sim/{args.device}/label.json"
        while not stop.is_set():
            try:
                v = http("GET", url, timeout=3)
                label["v"] = v if isinstance(v, str) and v else "REST"
            except Exception:
                pass
            stop.wait(0.25)

    if args.follow:
        threading.Thread(target=follower, daemon=True).start()

    try:
        http("PUT", f"{db}/devices/{args.device}/info.json?print=silent",
             {"fw": "sim-1.0", "ip": "simulated", "ssid": "simulated", "rate": FS, "ch": N_CH})
    except Exception as e:
        print("Could not reach the database:", e)
        print("Check the --db address / your internet connection.")
        return

    sim = SimSignal(args.seed)
    plan = []
    for f in FINGERS:
        plan += [("REST", args.rest), (f, args.hold)]
    plan_total = sum(d for _, d in plan)
    t0 = time.monotonic()
    seq, s0 = 0, 0
    next_t = t0
    print(f"Sending simulated NPG data to {db}/devices/{args.device}/raw  (Ctrl+C to stop)")
    fails = 0
    try:
        while True:
            now = time.monotonic()
            if not args.follow:
                t = (now - t0) % plan_total
                acc = 0.0
                for name, d in plan:
                    acc += d
                    if t < acc:
                        label["v"] = name
                        break
            block = sim.block(label["v"] if label["v"] in FINGERS + ["REST"] else "REST", args.batch)
            b64 = base64.b64encode(np.asarray(block, dtype="<i2").tobytes()).decode()
            payload = {"seq": seq, "s0": s0, "n": args.batch, "b": b64, "rssi": -47, "up": int((now - t0) * 1000), "fw": "sim"}
            try:
                http("PUT", raw_url, payload, timeout=4)
                fails = 0
            except Exception as e:  # noqa: BLE001
                fails += 1
                if fails in (1, 10, 50):
                    print("upload failed:", e)
            seq += 1
            s0 += args.batch
            next_t += args.batch / FS
            delay = next_t - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            elif delay < -2:
                next_t = time.monotonic()
    except KeyboardInterrupt:
        print("\nstopped.")
    finally:
        stop.set()


if __name__ == "__main__":
    main()
