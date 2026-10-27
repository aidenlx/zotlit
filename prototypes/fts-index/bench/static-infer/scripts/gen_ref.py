#!/usr/bin/env python3
"""Generate deterministic reference inputs/outputs with onnxruntime."""
import json, time, os
from pathlib import Path
import numpy as np
import onnxruntime as ort

ROOT = Path("BENCH_ROOT/static-infer")
MODELS = ROOT / "models"
OUT = ROOT / "ref"
OUT.mkdir(exist_ok=True)

rng = np.random.default_rng(42)

def save(name, arr):
    path = OUT / f"{name}.npy"
    np.save(path, arr)
    return path

def bench(sess, feeds, n_warm=3, n_run=20):
    for _ in range(n_warm):
        sess.run(None, feeds)
    times = []
    for _ in range(n_run):
        t0 = time.perf_counter()
        outs = sess.run(None, feeds)
        times.append((time.perf_counter() - t0) * 1000)
    return outs, float(np.median(times)), float(np.mean(times)), float(np.min(times)), float(np.max(times))

results = {}

# --- clusterer: B=1, T=64, O=8 (page-equivalent) ---
B, T, O = 1, 64, 8
line_features = rng.standard_normal((B, T, 22), dtype=np.float32)
line_pad_mask = np.zeros((B, T), dtype=bool)
line_pad_mask[:, 48:] = True  # last 16 padded
object_features = rng.standard_normal((B, O, 22), dtype=np.float32)
object_pad_mask = np.zeros((B, O), dtype=bool)
object_pad_mask[:, 6:] = True

save("clusterer_line_features", line_features)
save("clusterer_line_pad_mask", line_pad_mask)
save("clusterer_object_features", object_features)
save("clusterer_object_pad_mask", object_pad_mask)

opts = ort.SessionOptions()
opts.intra_op_num_threads = 1
opts.inter_op_num_threads = 1
sess = ort.InferenceSession(str(MODELS / "clusterer.onnx"), opts, providers=["CPUExecutionProvider"])
feeds = {
    "line_features": line_features,
    "line_pad_mask": line_pad_mask,
    "object_features": object_features,
    "object_pad_mask": object_pad_mask,
}
outs, med, mean, mn, mx = bench(sess, feeds)
save("clusterer_emissions", outs[0])
save("clusterer_object_rule_logits", outs[1])
results["clusterer"] = {
    "latency_ms_median": med, "latency_ms_mean": mean, "latency_ms_min": mn, "latency_ms_max": mx,
    "shapes": {"emissions": list(outs[0].shape), "object_rule_logits": list(outs[1].shape)},
    "providers": sess.get_providers(),
}

# --- repair: G=32 ---
G = 32
features = rng.standard_normal((G, 219), dtype=np.float32)
save("repair_features", features)
sess = ort.InferenceSession(str(MODELS / "repair.onnx"), opts, providers=["CPUExecutionProvider"])
outs, med, mean, mn, mx = bench(sess, {"features": features})
save("repair_logits", outs[0])
results["repair"] = {
    "latency_ms_median": med, "latency_ms_mean": mean, "latency_ms_min": mn, "latency_ms_max": mx,
    "shapes": {"logits": list(outs[0].shape)},
}

# --- classifier: N=48 blocks ---
N = 48
regular = rng.standard_normal((1, N, 196), dtype=np.float32)
rich = rng.standard_normal((1, N, 306), dtype=np.float32)
hash_slots = rng.integers(0, 1000, (1, N, 36), dtype=np.int64)
char_slots = rng.integers(0, 100, (1, N, 4), dtype=np.int64)
pad_mask = np.zeros((1, N), dtype=bool)
pad_mask[:, 40:] = True
save("classifier_regular_features", regular)
save("classifier_rich_features", rich)
save("classifier_hash_slots", hash_slots)
save("classifier_char_slots", char_slots)
save("classifier_pad_mask", pad_mask)

sess = ort.InferenceSession(str(MODELS / "classifier.onnx"), opts, providers=["CPUExecutionProvider"])
feeds = {
    "regular_features": regular,
    "rich_features": rich,
    "hash_slots": hash_slots,
    "char_slots": char_slots,
    "pad_mask": pad_mask,
}
outs, med, mean, mn, mx = bench(sess, feeds)
save("classifier_type_logits", outs[0])
save("classifier_flow_logits", outs[1])
results["classifier"] = {
    "latency_ms_median": med, "latency_ms_mean": mean, "latency_ms_min": mn, "latency_ms_max": mx,
    "shapes": {"type_logits": list(outs[0].shape), "flow_logits": list(outs[1].shape)},
}

# model sizes
results["model_sizes_bytes"] = {
    "clusterer": (MODELS / "clusterer.onnx").stat().st_size,
    "repair": (MODELS / "repair.onnx").stat().st_size,
    "classifier": (MODELS / "classifier.onnx").stat().st_size,
}
results["ort_version"] = ort.__version__
results["threads"] = 1

with open(OUT / "ort_baseline.json", "w") as f:
    json.dump(results, f, indent=2)
print(json.dumps(results, indent=2))
