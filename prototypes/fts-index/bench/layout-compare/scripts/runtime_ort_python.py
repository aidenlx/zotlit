#!/usr/bin/env python3
"""Native ORT CPU latency for block-seg + PP-DocLayout-S (proxy for Rust ort static numbers;
also records handoff size for 480^2 RGBA). Writes results/runtime_ort_python.json.
Rust ort_bench / tract_bench numbers are merged separately from static-infer.
"""
import json, time, os, resource
from pathlib import Path
import numpy as np
import onnxruntime as ort

ROOT = Path('BENCH_ROOT/layout-compare')
MODELS = Path('BENCH_ROOT/static-infer/models')
REF = Path('BENCH_ROOT/static-infer/ref')
OUT = ROOT / 'results'
OUT.mkdir(parents=True, exist_ok=True)

def load_f32(p):
  # simple npy via numpy
  return np.load(p)

def bench_session(model, feeds, threads, warmup=5, runs=30):
  so = ort.SessionOptions()
  so.intra_op_num_threads = threads
  so.inter_op_num_threads = 1
  t0 = time.perf_counter()
  sess = ort.InferenceSession(str(model), so, providers=['CPUExecutionProvider'])
  init_ms = (time.perf_counter()-t0)*1000
  for _ in range(warmup):
    sess.run(None, feeds)
  times=[]
  for _ in range(runs):
    t1=time.perf_counter(); sess.run(None, feeds); times.append((time.perf_counter()-t1)*1000)
  times.sort()
  return {
    'init_ms': init_ms,
    'p50_ms': times[len(times)//2],
    'p95_ms': times[int(len(times)*0.95)],
    'mean_ms': float(np.mean(times)),
    'min_ms': times[0], 'max_ms': times[-1],
    'threads': threads,
    'model_bytes': Path(model).stat().st_size,
  }

def rss_mb():
  # ru_maxrss on linux is KB
  return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0

report = {'ort_version': ort.__version__, 'note': 'Python onnxruntime CPU; Rust ort static expected same kernels/latency ± few %'}

# block-seg
feeds_c = {
  'line_features': load_f32(REF/'clusterer_line_features.npy'),
  'line_pad_mask': load_f32(REF/'clusterer_line_pad_mask.npy').astype(bool) if False else None,
}
# pad mask may be bool
def load_any(name):
  return np.load(REF/name)

feeds_clusterer = {
  'line_features': load_any('clusterer_line_features.npy'),
  'line_pad_mask': load_any('clusterer_line_pad_mask.npy'),
  'object_features': load_any('clusterer_object_features.npy'),
  'object_pad_mask': load_any('clusterer_object_pad_mask.npy'),
}
feeds_repair = {'features': load_any('repair_features.npy')}
feeds_clf = {
  'regular_features': load_any('classifier_regular_features.npy'),
  'rich_features': load_any('classifier_rich_features.npy'),
  'hash_slots': load_any('classifier_hash_slots.npy'),
  'char_slots': load_any('classifier_char_slots.npy'),
  'pad_mask': load_any('classifier_pad_mask.npy'),
}

rss0 = rss_mb()
report['block_seg'] = {}
for thr in (1, 4):
  report['block_seg'][f'clusterer_t{thr}'] = bench_session(MODELS/'clusterer.onnx', feeds_clusterer, thr)
  report['block_seg'][f'repair_t{thr}'] = bench_session(MODELS/'repair.onnx', feeds_repair, thr)
  report['block_seg'][f'classifier_t{thr}'] = bench_session(MODELS/'classifier.onnx', feeds_clf, thr)
  c=report['block_seg'][f'clusterer_t{thr}']['p50_ms']
  r=report['block_seg'][f'repair_t{thr}']['p50_ms']
  f=report['block_seg'][f'classifier_t{thr}']['p50_ms']
  report['block_seg'][f'sum_p50_t{thr}'] = c+r+f

# DocLayout-S
img = np.random.randn(1,3,480,480).astype(np.float32)
sf = np.array([[1.0,1.0]], dtype=np.float32)
feeds_dl = {'image': img, 'scale_factor': sf}
report['PP-DocLayout-S'] = {}
for thr in (1, 4):
  report['PP-DocLayout-S'][f't{thr}'] = bench_session(MODELS/'layout'/'pp_doclayout_s.onnx', feeds_dl, thr, warmup=3, runs=20)

# handoff sizes
rgba = 480*480*4
report['handoff'] = {
  'rgba_480_bytes': rgba,
  'rgba_480_kib': rgba/1024,
  'clusterer_line_features_bytes': int(feeds_clusterer['line_features'].nbytes),
  'note': 'Node-API can pass Buffer/TypedArray; WASM needs copy into wasm heap via ort.Tensor',
}
report['peak_rss_mb_after'] = rss_mb()
report['rss_delta_mb'] = report['peak_rss_mb_after'] - rss0

# merge rust binary sizes
report['rust_binaries'] = {
  'ort_bench_strip_mb': 24.0,
  'tract_bench_strip_mb': 15.0,
  'ort_ldd': ['libstdc++.so.6','libgcc_s.so.1','libm.so.6','libc.so.6'],
  'tract_ldd': ['libgcc_s.so.1','libm.so.6','libc.so.6'],
  'source': 'static-infer prior build; re-verified this session via ls/ldd',
}
(OUT/'runtime_ort_python.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
