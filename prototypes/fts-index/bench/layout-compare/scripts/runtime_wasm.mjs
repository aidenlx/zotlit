/**
 * onnxruntime-web WASM latency under Node (document-worker version).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const ortPath = 'PDF_WORKER_ROOT/node_modules/onnxruntime-web';
const version = JSON.parse(fs.readFileSync(path.join(ortPath, 'package.json'), 'utf8')).version;
const ortMod = await import(pathToFileURL(path.join(ortPath, 'dist/ort.node.min.mjs')).href);
const ORT = ortMod.default ?? ortMod;

const MODELS = 'BENCH_ROOT/static-infer/models';
const REF = 'BENCH_ROOT/static-infer/ref';
const OUT = 'BENCH_ROOT/layout-compare/results';
fs.mkdirSync(OUT, { recursive: true });

const wasmDir = path.join(ortPath, 'dist');
ORT.env.wasm.numThreads = Number(process.env.ORT_THREADS || 1);
ORT.env.wasm.simd = true;
ORT.env.wasm.wasmPaths = pathToFileURL(wasmDir).href + '/';

function loadNpyF32(p) {
  const buf = fs.readFileSync(p);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const major = buf[6];
  let headerLen, headerStart;
  if (major === 1) { headerLen = dv.getUint16(8, true); headerStart = 10; }
  else { headerLen = dv.getUint32(8, true); headerStart = 12; }
  const header = buf.subarray(headerStart, headerStart + headerLen).toString();
  const m = header.match(/\(([^)]*)\)/);
  const shape = m[1].split(',').map(s => s.trim()).filter(Boolean).map(Number);
  const dataStart = headerStart + headerLen;
  const floats = new Float32Array(buf.buffer, buf.byteOffset + dataStart, shape.reduce((a,b)=>a*b,1));
  return { shape, data: floats };
}
function loadNpyBool(p) {
  const buf = fs.readFileSync(p);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const major = buf[6];
  let headerLen, headerStart;
  if (major === 1) { headerLen = dv.getUint16(8, true); headerStart = 10; }
  else { headerLen = dv.getUint32(8, true); headerStart = 12; }
  const header = buf.subarray(headerStart, headerStart + headerLen).toString();
  const m = header.match(/\(([^)]*)\)/);
  const shape = m[1].split(',').map(s => s.trim()).filter(Boolean).map(Number);
  const dataStart = headerStart + headerLen;
  const n = shape.reduce((a,b)=>a*b,1);
  const data = new Uint8Array(buf.buffer, buf.byteOffset + dataStart, n);
  return { shape, data: Array.from(data, x => !!x) };
}
function loadNpyI64(p) {
  const buf = fs.readFileSync(p);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const major = buf[6];
  let headerLen, headerStart;
  if (major === 1) { headerLen = dv.getUint16(8, true); headerStart = 10; }
  else { headerLen = dv.getUint32(8, true); headerStart = 12; }
  const header = buf.subarray(headerStart, headerStart + headerLen).toString();
  const m = header.match(/\(([^)]*)\)/);
  const shape = m[1].split(',').map(s => s.trim()).filter(Boolean).map(Number);
  const dataStart = headerStart + headerLen;
  const n = shape.reduce((a,b)=>a*b,1);
  const data = new BigInt64Array(buf.buffer, buf.byteOffset + dataStart, n);
  return { shape, data };
}

async function benchModel(name, modelPath, feedsFactory, { warmup = 3, runs = 20 } = {}) {
  const tInit0 = performance.now();
  const session = await ORT.InferenceSession.create(fs.readFileSync(modelPath), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  const initMs = performance.now() - tInit0;
  let handoffMs = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const feeds = feedsFactory();
    handoffMs.push(performance.now() - t0);
    if (i === 0) {
      for (let w = 0; w < warmup; w++) await session.run(feeds);
    }
  }
  const times = [];
  for (let i = 0; i < runs; i++) {
    const feeds = feedsFactory();
    const t0 = performance.now();
    await session.run(feeds);
    times.push(performance.now() - t0);
  }
  times.sort((a,b)=>a-b);
  handoffMs.sort((a,b)=>a-b);
  return {
    name,
    init_ms: +initMs.toFixed(2),
    p50_ms: +times[times.length >> 1].toFixed(3),
    p95_ms: +times[Math.min(times.length - 1, Math.floor(times.length * 0.95))].toFixed(3),
    mean_ms: +(times.reduce((a,b)=>a+b,0)/times.length).toFixed(3),
    handoff_p50_ms: +handoffMs[handoffMs.length >> 1].toFixed(3),
    model_bytes: fs.statSync(modelPath).size,
    threads: ORT.env.wasm.numThreads,
  };
}

const sab = typeof SharedArrayBuffer !== 'undefined';
const report = {
  runtime: 'onnxruntime-web',
  version,
  numThreads: ORT.env.wasm.numThreads,
  simd: ORT.env.wasm.simd,
  sharedArrayBufferAvailable: sab,
  crossOriginIsolated: globalThis.crossOriginIsolated ?? false,
  node: process.version,
  wasmAssets: {
    'ort-wasm-simd-threaded.wasm_mb': +(fs.statSync(path.join(wasmDir, 'ort-wasm-simd-threaded.wasm')).size / 1e6).toFixed(2),
    'ort-wasm-simd-threaded.jsep.wasm_mb': +(fs.statSync(path.join(wasmDir, 'ort-wasm-simd-threaded.jsep.wasm')).size / 1e6).toFixed(2),
  },
  note: 'Multi-thread WASM needs SharedArrayBuffer (COOP/COEP in Electron). Plain Node typically single-thread.',
};

const lf = loadNpyF32(path.join(REF, 'clusterer_line_features.npy'));
const lpm = loadNpyBool(path.join(REF, 'clusterer_line_pad_mask.npy'));
const of_ = loadNpyF32(path.join(REF, 'clusterer_object_features.npy'));
const opm = loadNpyBool(path.join(REF, 'clusterer_object_pad_mask.npy'));
const rf = loadNpyF32(path.join(REF, 'repair_features.npy'));

function clustererFeeds() {
  return {
    line_features: new ORT.Tensor('float32', lf.data, lf.shape),
    line_pad_mask: new ORT.Tensor('bool', lpm.data, lpm.shape),
    object_features: new ORT.Tensor('float32', of_.data, of_.shape),
    object_pad_mask: new ORT.Tensor('bool', opm.data, opm.shape),
  };
}
function repairFeeds() {
  return { features: new ORT.Tensor('float32', rf.data, rf.shape) };
}
const cr = loadNpyF32(path.join(REF, 'classifier_regular_features.npy'));
const cri = loadNpyF32(path.join(REF, 'classifier_rich_features.npy'));
const ch = loadNpyI64(path.join(REF, 'classifier_hash_slots.npy'));
const cc = loadNpyI64(path.join(REF, 'classifier_char_slots.npy'));
const cpm = loadNpyBool(path.join(REF, 'classifier_pad_mask.npy'));
function clfFeeds() {
  return {
    regular_features: new ORT.Tensor('float32', cr.data, cr.shape),
    rich_features: new ORT.Tensor('float32', cri.data, cri.shape),
    hash_slots: new ORT.Tensor('int64', ch.data, ch.shape),
    char_slots: new ORT.Tensor('int64', cc.data, cc.shape),
    pad_mask: new ORT.Tensor('bool', cpm.data, cpm.shape),
  };
}

report.block_seg = {};
report.block_seg.clusterer = await benchModel('clusterer', path.join(MODELS, 'clusterer.onnx'), clustererFeeds);
report.block_seg.repair = await benchModel('repair', path.join(MODELS, 'repair.onnx'), repairFeeds, { runs: 40 });
report.block_seg.classifier = await benchModel('classifier', path.join(MODELS, 'classifier.onnx'), clfFeeds);
report.block_seg.sum_p50 = +(report.block_seg.clusterer.p50_ms + report.block_seg.repair.p50_ms + report.block_seg.classifier.p50_ms).toFixed(3);

const img = new Float32Array(1 * 3 * 480 * 480);
for (let i = 0; i < img.length; i++) img[i] = Math.random() * 0.1;
const sf = new Float32Array([1, 1]);
function dlFeeds() {
  return {
    image: new ORT.Tensor('float32', img, [1, 3, 480, 480]),
    scale_factor: new ORT.Tensor('float32', sf, [1, 2]),
  };
}
report.doclayout_s = await benchModel('PP-DocLayout-S', path.join(MODELS, 'layout/pp_doclayout_s.onnx'), dlFeeds, { warmup: 2, runs: 10 });

const rgba = new Uint8Array(480 * 480 * 4);
const handoff = [];
for (let i = 0; i < 50; i++) {
  const t0 = performance.now();
  const f = new Float32Array(1 * 3 * 480 * 480);
  for (let p = 0; p < 480 * 480; p++) {
    f[p] = rgba[p * 4] / 255;
    f[480 * 480 + p] = rgba[p * 4 + 1] / 255;
    f[2 * 480 * 480 + p] = rgba[p * 4 + 2] / 255;
  }
  const tensor = new ORT.Tensor('float32', f, [1, 3, 480, 480]);
  handoff.push(performance.now() - t0);
  void tensor;
}
handoff.sort((a,b)=>a-b);
report.handoff_rgba_to_tensor_p50_ms = +handoff[handoff.length >> 1].toFixed(3);
report.handoff_rgba_bytes = rgba.length;

fs.writeFileSync(path.join(OUT, 'runtime_wasm.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
