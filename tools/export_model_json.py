#!/usr/bin/env python3
"""
export_model_json.py  -  turn YOUR recordings into the model file the website uses
===================================================================================
The website runs the finger detection inside the browser. A Random Forest (54 MB) is far too big for
that, so this tool trains a compact LINEAR model (LDA or logistic regression) on exactly the same
96 features your Python tools use, tests it honestly on rounds it never saw, compares it with the
Random Forest, and writes  model.json  (about 40 KB).

Put this file in the SAME folder as  emg_hand_3ch.py  and your  emg3_dataset  folder, then:

    python export_model_json.py                      # singles only (5 fingers), writes model.json
    python export_model_json.py --upload             # ... and sends it to Firebase (website loads it by itself)
    python export_model_json.py --set basic          # other gesture sets work too
    python export_model_json.py --kind logreg        # logistic regression instead of LDA

After --upload nothing needs to be redeployed: the website fetches the model from Firebase when it starts.
Retrain + upload again whenever you re-record (every new sitting).
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

import numpy as np

try:
    import emg_hand_3ch as T
except ImportError:
    sys.exit("Put export_model_json.py in the same folder as emg_hand_3ch.py (and run it from there).")

from scipy.signal import sosfilt_zi
from sklearn.discriminant_analysis import LinearDiscriminantAnalysis
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold, cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

DEFAULT_DB = "https://irumbu-kai-maayavi-default-rtdb.asia-southeast1.firebasedatabase.app"


def r(v):
    """Short, exact-enough floats keep the JSON small (9 significant digits)."""
    return float(f"{float(v):.9g}")


def make_linear(kind, n_classes):
    if kind == "logreg":
        clf = LogisticRegression(max_iter=3000, C=1.0)
    else:
        clf = LinearDiscriminantAnalysis(priors=np.full(n_classes, 1.0 / n_classes))
    return make_pipeline(StandardScaler(), clf)


def main():
    ap = argparse.ArgumentParser(description="Train + export the website model")
    ap.add_argument("--dataset", default="emg3_dataset")
    ap.add_argument("--set", default="singles", choices=list(T.SETS))
    ap.add_argument("--only", nargs="+", help="only these gestures (instead of --set)")
    ap.add_argument("--kind", default="lda", choices=["lda", "logreg"])
    ap.add_argument("--rest-weight", type=float, default=2.0)
    ap.add_argument("--out", default="model.json")
    ap.add_argument("--upload", action="store_true", help="also PUT the model to Firebase")
    ap.add_argument("--device", default="NPG01", help="device id used by the website / firmware")
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--demo", action="store_true", help="mark as DEMO (simulator-trained) - never for real use")
    ap.add_argument("--no-rf", action="store_true", help="skip the Random Forest comparison (faster)")
    args = ap.parse_args()

    root, recdir, _, _ = T.ds_paths(args.dataset)
    catalog = T.load_catalog(root)
    entries = sorted(catalog["recordings"], key=lambda e: (e["sitting"], e["added"]))
    if not entries:
        sys.exit(f"The dataset '{root}' has no recordings. Record with emg_hand_3ch.py first.")
    files = [str(recdir / e["file"]) for e in entries]
    print(f"Loading {len(files)} recording(s) and computing features ...")
    X, y, g, thr, used = T.build_dataset(files)

    keep = [T.canon(x) for x in args.only] if args.only else list(T.SETS[args.set])
    m = np.isin(y, keep + ["REST"])
    X, y, g = X[m], y[m], g[m]
    rounds = {c: len(set(g[y == c].tolist())) for c in set(y.tolist()) if c != "REST"}
    few = [c for c, n in rounds.items() if n < 4]
    if few:
        print(f"Left out (fewer than 4 rounds): {', '.join(sorted(few))}")
        m = ~np.isin(y, few)
        X, y, g = X[m], y[m], g[m]
    thin = T.rest_thin_mask(y, args.rest_weight)
    Xt, yt, gt = X[thin], y[thin], g[thin]
    classes_sorted = sorted(set(yt.tolist()))
    gestures = [c for c in classes_sorted if c != "REST"]
    if len(gestures) < 2 or len(set(gt.tolist())) < 3:
        sys.exit("Need at least 2 gestures and 3 recorded rounds.")
    n_splits = min(6, len(set(gt.tolist())))
    print(f"{len(Xt)} windows, {len(gestures)} gestures: {', '.join(gestures)}   (chance {100 / len(gestures):.0f}%)\n")

    print("Honest test (rounds the model never saw):")
    print(f"{'model':<26s}{'fingers/window':>16s}{'REST kept':>12s}")
    results = {}
    cands = {"LDA": "lda", "LogReg": "logreg"}
    for name, kind in cands.items():
        p = cross_val_predict(make_linear(kind, len(classes_sorted)), Xt, yt, groups=gt, cv=GroupKFold(n_splits=n_splits))
        fa = T.finger_state_acc  # noqa: F841 (kept for clarity)
        mg = np.isin(yt, gestures)
        results[kind] = (float(np.mean(p[mg] == yt[mg])), float(np.mean(p[yt == "REST"] == "REST")) if (yt == "REST").any() else float("nan"))
        print(f"{name + ' (exported)':<26s}{results[kind][0] * 100:15.1f}%{results[kind][1] * 100:11.1f}%")
    if not args.no_rf:
        rf = RandomForestClassifier(n_estimators=100, min_samples_leaf=5, max_samples=0.5, random_state=0,
                                    n_jobs=-1, class_weight="balanced_subsample")
        p = cross_val_predict(rf, Xt, yt, groups=gt, cv=GroupKFold(n_splits=n_splits))
        mg = np.isin(yt, gestures)
        print(f"{'RandomForest (too big)':<26s}{np.mean(p[mg] == yt[mg]) * 100:15.1f}%"
              f"{np.mean(p[yt == 'REST'] == 'REST') * 100:11.1f}%   <- what the Python tools use")
    print(f"\nExporting a {args.kind.upper()} model ...")

    model = make_linear(args.kind, len(classes_sorted)).fit(Xt, yt)
    scaler, clf = model.steps[0][1], model.steps[1][1]
    classes = [str(c) for c in clf.classes_]
    coef, intercept = np.asarray(clf.coef_), np.asarray(clf.intercept_)
    if coef.shape[0] != len(classes):
        sys.exit("Unexpected model shape (binary problems are not supported).")

    # sanity: the JSON maths (softmax of linear scores) must equal sklearn's own predict_proba
    z = scaler.transform(Xt[:200])
    s = z @ coef.T + intercept
    s = s - s.max(axis=1, keepdims=True)
    pj = np.exp(s)
    pj /= pj.sum(axis=1, keepdims=True)
    assert np.allclose(pj, model.predict_proba(Xt[:200]), atol=1e-8), "exported maths does not match sklearn"

    sos = T.design_sos()
    zi = sosfilt_zi(sos)
    per_class = {}
    pred_all = cross_val_predict(make_linear(args.kind, len(classes_sorted)), Xt, yt, groups=gt, cv=GroupKFold(n_splits=n_splits))
    for c in classes:
        mm = yt == c
        per_class[c] = r(np.mean(pred_all[mm] == c)) if mm.any() else None
    out = {
        "format": "ikm-model-1",
        "demo": bool(args.demo),
        "created": datetime.now().isoformat(timespec="seconds"),
        "fs": T.FS, "win": T.WIN, "step": T.STEP, "n_ch": T.N_CH, "nf": T.NF, "n_feat": int(Xt.shape[1]),
        "classes": classes,
        "fingers": {c: ([] if c == "REST" else list(T.gesture_fingers(c))) for c in classes},
        "sos": [[float(v) for v in row] for row in sos],      # full precision: the filter poles are sensitive
        "zi": [[float(v) for v in row] for row in zi],
        "thr": [float(v) for v in np.asarray(thr, float)],
        "scaler": {"mean": [r(v) for v in scaler.mean_], "scale": [r(v) for v in scaler.scale_]},
        "linear": {"kind": args.kind, "coef": [[r(v) for v in row] for row in coef], "intercept": [r(v) for v in intercept]},
        "defaults": {"rest_bias": 2.0, "activity_floor": 1.15, "cooldown": 1.0, "steady": "normal", "vote": 8},
        "steady": {k: list(v) for k, v in T.STEADY.items()},
        "train": {"windows": int(len(Xt)), "recordings": [Path(p).name for p in used],
                  "accuracy_window": r(results[args.kind][0]), "rest_kept": r(results[args.kind][1]), "per_class": per_class},
    }
    text = json.dumps(out, separators=(",", ":"))
    Path(args.out).write_text(text, encoding="utf-8")
    print(f"Wrote {args.out}  ({len(text) / 1024:.0f} KB, {len(classes)} classes: {', '.join(classes)})")

    if args.upload:
        url = f"{args.db.rstrip('/')}/models/{args.device}.json"
        body = json.dumps({"json": text, "updated": int(time.time() * 1000), "demo": bool(args.demo), "n": len(classes)}).encode()
        req = urllib.request.Request(url, data=body, method="PUT", headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                print(f"Uploaded to {url}  (HTTP {resp.status}). The website loads it automatically.")
        except urllib.error.HTTPError as e:
            print(f"Upload FAILED: HTTP {e.code} {e.reason}. Check the database rules (database.rules.json) are published.")
        except Exception as e:  # noqa: BLE001
            print(f"Upload FAILED: {e}. Are you online?")
    else:
        print("Next:  python export_model_json.py --upload     (or copy model.json into the website folder)")


if __name__ == "__main__":
    main()
