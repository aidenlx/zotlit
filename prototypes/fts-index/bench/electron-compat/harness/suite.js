'use strict';
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ORT = path.join(ROOT, 'ort_infer.linux-x64-gnu.node');
const ORT_STATIC = path.join(ROOT, 'addons/ort_infer_static_cxx.node');
const ZEROCOPY = path.join(ROOT, 'zerocopy_probe.linux-x64-gnu.node');
const BS3 = path.join(ROOT, 'addons/better_sqlite3.node');
const FTS = path.join(ROOT, 'zotlit_cjk_icu.so');
const REPAIR = 'BENCH_ROOT/static-infer/models/repair.onnx';
const DOCLAYOUT = 'BENCH_ROOT/static-infer/models/layout/pp_doclayout_s.onnx';
const REF_FEAT = 'BENCH_ROOT/static-infer/ref/repair_features.npy';

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

function ok(name, detail) {
  return { name, ok: true, detail };
}
function fail(name, err) {
  return { name, ok: false, error: String(err && err.stack || err) };
}

function testVersions() {
  return ok('process.versions', {
    electron: process.versions.electron || null,
    node: process.versions.node,
    modules: process.versions.modules,
    napi: process.versions.napi,
    sqlite: process.versions.sqlite || null,
    chrome: process.versions.chrome || null,
    type: typeof process.type !== 'undefined' ? process.type : 'node',
  });
}

function testOrtLoadAndInfer(addonPath) {
  try {
    const native = require(addonPath);
    const info = native.addonInfo ? native.addonInfo() : null;
    const eng = new native.NativeOrt(1, { repair: REPAIR, doclayout: DOCLAYOUT });
    const feat = loadNpyF32(REF_FEAT);
    const t0 = process.hrtime.bigint();
    const r = eng.runRepair({ data: feat.data, shape: feat.shape });
    const t1 = process.hrtime.bigint();
    // tiny synthetic RGBA for doclayout
    const w = 64, h = 64;
    const rgba = Buffer.alloc(w * h * 4, 200);
    const d = eng.runDoclayoutRgba(rgba, w, h, 480);
    return ok('ort_infer', {
      addonPath,
      info,
      repair_infer_ms: r.inferMs,
      repair_wall_ms: Number(t1 - t0) / 1e6,
      logits_len: r.logits.length,
      doclayout_boxes: d.shape,
      doclayout_infer_ms: d.inferMs,
      doclayout_n: d.boxes.length,
    });
  } catch (e) {
    return fail('ort_infer', e);
  }
}

function testBetterSqlite3() {
  try {
    require(BS3);
    return ok('better_sqlite3', { loaded: true, note: 'unexpected: Node-prebuilt loaded in Electron' });
  } catch (e) {
    const msg = String(e && e.message || e);
    const mismatch = /NODE_MODULE_VERSION|was compiled against a different/i.test(msg);
    return ok('better_sqlite3_expected_fail', { mismatch, message: msg.slice(0, 300) });
  }
}

function testNodeSqliteAndFts() {
  const out = { sqlite_version: process.versions.sqlite || null };
  try {
    const mod = require('node:sqlite');
    out.require_ok = true;
    out.keys = Object.keys(mod);
    const { DatabaseSync } = mod;
    // allowExtension
    try {
      const db = new DatabaseSync(':memory:', { allowExtension: true });
      out.allowExtension_open = true;
      try {
        db.loadExtension(FTS);
        out.loadExtension = true;
        db.exec(`CREATE VIRTUAL TABLE fts USING fts5(page UNINDEXED, text, tokenize='zotlit_cjk');`);
        const ins = db.prepare('INSERT INTO fts(page, text) VALUES (?, ?)');
        ins.run(1, '版本控制系统是软件工程的基础。Git 是一种分布式版本控制系统。');
        ins.run(2, '機械学習と自然言語処理の全文検索。');
        const q1 = db.prepare(`SELECT page, text FROM fts WHERE fts MATCH ?`).all('版本控制');
        const q2 = db.prepare(`SELECT page, text FROM fts WHERE fts MATCH ?`).all('控制');
        const q3 = db.prepare(`SELECT page FROM fts WHERE fts MATCH ?`).all('機械学習');
        out.cjk_phrase = q1.map((r) => r.page);
        out.cjk_subword = q2.map((r) => r.page);
        out.ja_query = q3.map((r) => r.page);
        out.tokenizer_works = q1.length > 0 && q2.length > 0;
        try {
          const caps = db.prepare('SELECT zotlit_cjk_caps()').get();
          out.caps = caps;
        } catch (_) {}
      } catch (e) {
        out.loadExtension_error = String(e.message || e).slice(0, 400);
      }
      // deny path
      try {
        const db2 = new DatabaseSync(':memory:');
        db2.loadExtension(FTS);
        out.allowExtension_false_allowed = true;
      } catch (e) {
        out.allowExtension_false_rejected = true;
        out.allowExtension_false_msg = String(e.message || e).slice(0, 200);
      }
    } catch (e) {
      out.DatabaseSync_error = String(e.message || e).slice(0, 400);
    }
    return ok('node_sqlite_fts', out);
  } catch (e) {
    out.require_ok = false;
    out.require_error = String(e.message || e).slice(0, 400);
    return ok('node_sqlite_fts', out);
  }
}

function testZerocopy() {
  try {
    const z = require(ZEROCOPY);
    const ext = z.tryExternalArraybuffer(4096);
    const buf = Buffer.alloc(1 << 20);
    for (let i = 0; i < buf.length; i++) buf[i] = i % 251;
    const t0 = process.hrtime.bigint();
    const sum = z.sumJsBuffer(buf);
    const t1 = process.hrtime.bigint();
    const t2 = process.hrtime.bigint();
    const alloc = z.allocRustBuffer(1 << 20);
    const t3 = process.hrtime.bigint();
    const t4 = process.hrtime.bigint();
    const rt = z.roundtripCopy(buf);
    const t5 = process.hrtime.bigint();
    return ok('zerocopy', {
      external_arraybuffer: ext,
      js_buffer_into_native_ms: sum.ms,
      js_buffer_wall_ms: Number(t1 - t0) / 1e6,
      sum: sum.sum,
      alloc_rust_buffer_ms: Number(t3 - t2) / 1e6,
      alloc_len: alloc.length,
      roundtrip_copy_ms: Number(t5 - t4) / 1e6,
      roundtrip_len: rt.length,
      note: 'Electron>=21 V8 memory cage typically rejects napi_create_external_arraybuffer; JS-allocated Buffer into native remains fine (may copy under cage).',
    });
  } catch (e) {
    return fail('zerocopy', e);
  }
}

function testOrtWorkerThread() {
  return new Promise((resolve) => {
    // Init ORT in main first, then try worker
    let mainInit = null;
    try {
      const native = require(ORT);
      const eng = new native.NativeOrt(1, { repair: REPAIR });
      const feat = loadNpyF32(REF_FEAT);
      eng.runRepair({ data: feat.data, shape: feat.shape });
      mainInit = 'ok';
    } catch (e) {
      return resolve(fail('ort_worker_threads', e));
    }
    const workerCode = `
      const { parentPort, workerData } = require('worker_threads');
      try {
        const native = require(workerData.ort);
        const eng = new native.NativeOrt(1, { repair: workerData.repair });
        parentPort.postMessage({ ok: true, note: 'worker init succeeded' });
      } catch (e) {
        parentPort.postMessage({ ok: false, error: String(e && e.message || e) });
      }
    `;
    const w = new Worker(workerCode, {
      eval: true,
      workerData: { ort: ORT, repair: REPAIR },
    });
    const timer = setTimeout(() => {
      w.terminate();
      resolve(ok('ort_worker_threads', { mainInit, worker: { ok: false, error: 'timeout' } }));
    }, 15000);
    w.on('message', (msg) => {
      clearTimeout(timer);
      w.terminate();
      resolve(ok('ort_worker_threads', { mainInit, worker: msg, expected_fail_reason: 'ort: only one environment is allowed per process' }));
    });
    w.on('error', (e) => {
      clearTimeout(timer);
      resolve(ok('ort_worker_threads', { mainInit, worker: { ok: false, error: String(e.message || e) } }));
    });
  });
}

function testOrtFreshWorkerOnly() {
  // Fresh process-like: worker without prior init in parent — still same process
  return new Promise((resolve) => {
    const workerCode = `
      const { parentPort, workerData } = require('worker_threads');
      try {
        const native = require(workerData.ort);
        const eng = new native.NativeOrt(1, { repair: workerData.repair });
        const fs = require('fs');
        const buf = fs.readFileSync(workerData.ref);
        const ver = buf[6]; let hoff=8,hlen; if(ver===1){hlen=buf.readUInt16LE(8);hoff=10;}else{hlen=buf.readUInt32LE(8);hoff=12;}
        const header=buf.slice(hoff,hoff+hlen).toString();
        const shape=[...header.match(/\\((.*?)\\)/)[1].matchAll(/\\d+/g)].map(x=>+x[0]);
        const data=new Float32Array(buf.buffer,buf.byteOffset+hoff+hlen,shape.reduce((a,b)=>a*b,1));
        const r = eng.runRepair({ data: Float32Array.from(data), shape });
        parentPort.postMessage({ ok: true, inferMs: r.inferMs, logits: r.logits.length });
      } catch (e) {
        parentPort.postMessage({ ok: false, error: String(e && e.message || e) });
      }
    `;
    const w = new Worker(workerCode, {
      eval: true,
      workerData: { ort: ORT, repair: REPAIR, ref: REF_FEAT },
    });
    const timer = setTimeout(() => { w.terminate(); resolve(ok('ort_worker_fresh', { ok: false, error: 'timeout' })); }, 20000);
    w.on('message', (msg) => { clearTimeout(timer); w.terminate(); resolve(ok('ort_worker_fresh', msg)); });
    w.on('error', (e) => { clearTimeout(timer); resolve(ok('ort_worker_fresh', { ok: false, error: String(e.message || e) })); });
  });
}

async function runSuite(ctx) {
  const results = [];
  results.push(testVersions());
  results.push(Object.assign(testOrtLoadAndInfer(ORT), { ctx }));
  if (fs.existsSync(ORT_STATIC)) {
    const r = testOrtLoadAndInfer(ORT_STATIC);
    r.name = 'ort_infer_static_cxx';
    results.push(r);
  }
  results.push(testBetterSqlite3());
  results.push(testNodeSqliteAndFts());
  results.push(testZerocopy());
  // worker tests only if not already in a worker
  if (!process.env.ZOTLIT_SKIP_WORKER) {
    results.push(await testOrtWorkerThread());
  }
  return { ctx, results, at: new Date().toISOString() };
}

module.exports = { runSuite, testOrtLoadAndInfer, ORT, REPAIR, REF_FEAT, loadNpyF32 };
