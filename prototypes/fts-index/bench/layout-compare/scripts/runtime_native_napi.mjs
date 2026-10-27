/**
 * PDF.js → node-canvas RGBA → Rust static ort (napi) vs onnxruntime-web
 * Measures p50/p95, init, handoff, RSS; logits MAD vs ref npy / WASM.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import canvasPkg from 'canvas';
import { patchContext } from './canvas-fix.mjs';

const { createCanvas, Image, DOMMatrix, ImageData, Path2D } = canvasPkg;
Object.assign(globalThis, { Image, DOMMatrix, ImageData, Path2D });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'results');
const MODELS = 'BENCH_ROOT/static-infer/models';
const REF = 'BENCH_ROOT/static-infer/ref';
const require = createRequire(path.join(ROOT, 'native-ort/package.json'));

function rssKb() {
  try {
    const s = fs.readFileSync('/proc/self/status', 'utf8');
    const m = s.match(/VmRSS:\s+(\d+)/);
    return m ? +m[1] : 0;
  } catch { return 0; }
}
function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * p))];
}
function mad(a, b) {
  let m = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}
function loadNpyF32(p) {
  const buf = fs.readFileSync(p);
  const ver = buf[6];
  let hoff = 8, hlen;
  if (ver === 1) { hlen = buf.readUInt16LE(8); hoff = 10; }
  else { hlen = buf.readUInt32LE(8); hoff = 12; }
  const header = buf.slice(hoff, hoff + hlen).toString();
  const shape = [...header.match(/\((.*?)\)/)[1].matchAll(/\d+/g)].map((x) => +x[0]);
  const data = new Float32Array(buf.buffer, buf.byteOffset + hoff + hlen, shape.reduce((a, b) => a * b, 1));
  return { shape, data: Float32Array.from(data) };
}
function loadNpyBool(p) {
  const buf = fs.readFileSync(p);
  const ver = buf[6];
  let hoff = 8, hlen;
  if (ver === 1) { hlen = buf.readUInt16LE(8); hoff = 10; }
  else { hlen = buf.readUInt32LE(8); hoff = 12; }
  const header = buf.slice(hoff, hoff + hlen).toString();
  const shape = [...header.match(/\((.*?)\)/)[1].matchAll(/\d+/g)].map((x) => +x[0]);
  const raw = buf.slice(hoff + hlen);
  const data = [...raw].map((b) => b !== 0);
  return { shape, data };
}
function loadNpyI64(p) {
  const buf = fs.readFileSync(p);
  const ver = buf[6];
  let hoff = 8, hlen;
  if (ver === 1) { hlen = buf.readUInt16LE(8); hoff = 10; }
  else { hlen = buf.readUInt32LE(8); hoff = 12; }
  const header = buf.slice(hoff, hoff + hlen).toString();
  const shape = [...header.match(/\((.*?)\)/)[1].matchAll(/\d+/g)].map((x) => +x[0]);
  const n = shape.reduce((a, b) => a * b, 1);
  const view = new BigInt64Array(buf.buffer, buf.byteOffset + hoff + hlen, n);
  return { shape, data: [...view].map((x) => Number(x)) };
}

function findAddon() {
  const candidates = [
    path.join(ROOT, 'native-ort/ort_infer.linux-x64-gnu.node'),
    path.join(ROOT, 'native-ort/crates/ort_infer_napi/ort_infer.linux-x64-gnu.node'),
    ...fs.readdirSync(path.join(ROOT, 'native-ort')).filter((f) => f.endsWith('.node')).map((f) => path.join(ROOT, 'native-ort', f)),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

async function main() {
  const addonPath = findAddon();
  if (!addonPath) {
    console.error('napi addon not found yet');
    process.exit(2);
  }
  const native = require(addonPath);
  const report = {
    runtime: 'rust-ort-static-napi',
    addonPath,
    addonInfo: native.addonInfo?.() || null,
    rss_kb_start: rssKb(),
    binary_bytes: fs.statSync(addonPath).size,
  };

  const paths = {
    clusterer: path.join(MODELS, 'clusterer.onnx'),
    repair: path.join(MODELS, 'repair.onnx'),
    classifier: path.join(MODELS, 'classifier.onnx'),
    doclayout: path.join(MODELS, 'layout/pp_doclayout_s.onnx'),
  };

  const eng = new native.NativeOrt(1, paths);
  for (const threads of [1, 4]) {
    eng.setThreads(threads);
    const block = { threads };

    // repair
    {
      const { shape, data } = loadNpyF32(path.join(REF, 'repair_features.npy'));
      const feat = { data: new Float32Array(data), shape };
      eng.runRepair(feat); // warm
      const times = [];
      for (let i = 0; i < 50; i++) {
        const r = eng.runRepair(feat);
        times.push(r.inferMs);
      }
      times.sort((a, b) => a - b);
      const r = eng.runRepair(feat);
      const pref = loadNpyF32(path.join(REF, 'repair_logits.npy')).data;
      block.repair = {
        p50_ms: pct(times, 0.5), p95_ms: pct(times, 0.95),
        handoff_ms: r.handoffMs,
        max_abs_diff_vs_ref: mad(r.logits, pref),
      };
    }

    // clusterer
    {
      const lf = loadNpyF32(path.join(REF, 'clusterer_line_features.npy'));
      const lp = loadNpyBool(path.join(REF, 'clusterer_line_pad_mask.npy'));
      const of = loadNpyF32(path.join(REF, 'clusterer_object_features.npy'));
      const op = loadNpyBool(path.join(REF, 'clusterer_object_pad_mask.npy'));
      const args = [
        { data: new Float32Array(lf.data), shape: lf.shape },
        { data: lp.data, shape: lp.shape },
        { data: new Float32Array(of.data), shape: of.shape },
        { data: op.data, shape: op.shape },
      ];
      eng.runClusterer(...args);
      const times = [];
      for (let i = 0; i < 30; i++) times.push(eng.runClusterer(...args).inferMs);
      times.sort((a, b) => a - b);
      const r = eng.runClusterer(...args);
      const er = loadNpyF32(path.join(REF, 'clusterer_emissions.npy')).data;
      const orv = loadNpyF32(path.join(REF, 'clusterer_object_rule_logits.npy')).data;
      block.clusterer = {
        p50_ms: pct(times, 0.5), p95_ms: pct(times, 0.95),
        handoff_ms: r.handoffMs,
        max_abs_diff_emissions_vs_ref: mad(r.emissions, er),
        max_abs_diff_object_vs_ref: mad(r.objectRuleLogits, orv),
      };
    }

    // classifier
    {
      const r1 = loadNpyF32(path.join(REF, 'classifier_regular_features.npy'));
      const r2 = loadNpyF32(path.join(REF, 'classifier_rich_features.npy'));
      const h = loadNpyI64(path.join(REF, 'classifier_hash_slots.npy'));
      const c = loadNpyI64(path.join(REF, 'classifier_char_slots.npy'));
      const p = loadNpyBool(path.join(REF, 'classifier_pad_mask.npy'));
      const args = [
        { data: new Float32Array(r1.data), shape: r1.shape },
        { data: new Float32Array(r2.data), shape: r2.shape },
        { data: h.data, shape: h.shape },
        { data: c.data, shape: c.shape },
        { data: p.data, shape: p.shape },
      ];
      eng.runClassifier(...args);
      const times = [];
      for (let i = 0; i < 30; i++) times.push(eng.runClassifier(...args).inferMs);
      times.sort((a, b) => a - b);
      const r = eng.runClassifier(...args);
      const tr = loadNpyF32(path.join(REF, 'classifier_type_logits.npy')).data;
      const fr = loadNpyF32(path.join(REF, 'classifier_flow_logits.npy')).data;
      block.classifier = {
        p50_ms: pct(times, 0.5), p95_ms: pct(times, 0.95),
        handoff_ms: r.handoffMs,
        max_abs_diff_type_vs_ref: mad(r.typeLogits, tr),
        max_abs_diff_flow_vs_ref: mad(r.flowLogits, fr),
      };
    }

    // DocLayout synthetic RGBA
    {
      const size = 480;
      const rgba = Buffer.alloc(size * size * 4, 200);
      eng.runDoclayoutRgba(rgba, size, size, size);
      const times = [];
      for (let i = 0; i < 15; i++) times.push(eng.runDoclayoutRgba(rgba, size, size, size).inferMs);
      times.sort((a, b) => a - b);
      const r = eng.runDoclayoutRgba(rgba, size, size, size);
      block.doclayout_s_rgba = {
        p50_ms: pct(times, 0.5), p95_ms: pct(times, 0.95),
        handoff_ms: r.handoffMs, preprocess_ms: r.preprocessMs,
        out_shape: r.shape, n_boxes: r.boxes.length / (r.shape[1] || 6),
      };
    }

    // real page if available
    const pagePng = path.join(ROOT, 'pages/arxiv-attention/page-001.png');
    if (fs.existsSync(pagePng)) {
      const img = new Image();
      img.src = fs.readFileSync(pagePng);
      const canvas = createCanvas(img.width, img.height);
      const ctx = patchContext(canvas.getContext('2d'));
      ctx.drawImage(img, 0, 0);
      const rgba = canvas.toBuffer('raw'); // BGRA on some; node-canvas gives BGRA actually
      // Use getImageData for RGBA
      const id = ctx.getImageData(0, 0, img.width, img.height);
      const buf = Buffer.from(id.data.buffer, id.data.byteOffset, id.data.byteLength);
      eng.runDoclayoutRgba(buf, img.width, img.height, 480);
      const times = [];
      for (let i = 0; i < 10; i++) times.push(eng.runDoclayoutRgba(buf, img.width, img.height, 480).inferMs);
      times.sort((a, b) => a - b);
      const r = eng.runDoclayoutRgba(buf, img.width, img.height, 480);
      block.doclayout_s_page1 = {
        p50_ms: pct(times, 0.5), p95_ms: pct(times, 0.95),
        preprocess_ms: r.preprocessMs, handoff_ms: r.handoffMs,
        width: img.width, height: img.height, out_len: r.boxes.length,
      };
    }

    block.block_seg_sum_p50_ms = (block.clusterer?.p50_ms || 0) + (block.repair?.p50_ms || 0) + (block.classifier?.p50_ms || 0);
    block.rss_kb = rssKb();
    report[`t${threads}`] = block;
  }

  // ORT: one Environment per process → worker_thread cannot construct a second NativeOrt.
  // child_process smoke (separate process = new env) is the supported off-main path.
  report.worker_thread_same_process = {
    ok: false,
    reason: 'ort: only one environment is allowed per process',
  };
  report.child_process = await new Promise((resolve) => {
    import('node:child_process').then(({ spawn }) => {
      const script = `
        const addon = require(${JSON.stringify(addonPath)});
        const eng = new addon.NativeOrt(1, ${JSON.stringify(paths)});
        const size = 480;
        const rgba = Buffer.alloc(size*size*4, 180);
        const r = eng.runDoclayoutRgba(rgba, size, size, 480);
        console.log(JSON.stringify({ ok: true, inferMs: r.inferMs, out_len: r.boxes.length }));
      `;
      const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('close', (code) => {
        try { resolve(JSON.parse(out.trim().split('\n').pop())); }
        catch (e) { resolve({ ok: false, code, out, err: err.slice(0, 500), parseError: String(e) }); }
      });
    }).catch((e) => resolve({ ok: false, error: String(e) }));
  });

  report.rss_kb_end = rssKb();
  fs.writeFileSync(path.join(OUT, 'runtime_rust_ort_napi.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
