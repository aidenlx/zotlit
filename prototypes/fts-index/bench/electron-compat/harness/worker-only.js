'use strict';
const { Worker } = require('worker_threads');
const path = require('path');
const ORT = path.join(__dirname, '../ort_infer.linux-x64-gnu.node');
const REPAIR = 'BENCH_ROOT/static-infer/models/repair.onnx';
const REF = 'BENCH_ROOT/static-infer/ref/repair_features.npy';

async function main() {
  const out = { twice_in_main: null, worker_after_main: null, worker_only: null };

  // A: init twice in same thread
  try {
    const n = require(ORT);
    const a = new n.NativeOrt(1, { repair: REPAIR });
    try {
      const b = new n.NativeOrt(1, { repair: REPAIR });
      out.twice_in_main = { ok: true };
    } catch (e) {
      out.twice_in_main = { ok: false, error: String(e.message || e) };
    }
  } catch (e) {
    out.twice_in_main = { ok: false, error: String(e.message || e), stage: 'first' };
  }

  // B: worker after main already inited (same process)
  out.worker_after_main = await new Promise((resolve) => {
    const code = `
      const { parentPort, workerData } = require('worker_threads');
      try {
        const n = require(workerData.ort);
        new n.NativeOrt(1, { repair: workerData.repair });
        parentPort.postMessage({ ok: true });
      } catch (e) { parentPort.postMessage({ ok: false, error: String(e.message || e) }); }
    `;
    const w = new Worker(code, { eval: true, workerData: { ort: ORT, repair: REPAIR } });
    const t = setTimeout(() => { w.terminate(); resolve({ ok: false, error: 'timeout' }); }, 15000);
    w.on('message', (m) => { clearTimeout(t); w.terminate(); resolve(m); });
    w.on('error', (e) => { clearTimeout(t); resolve({ ok: false, error: String(e.message || e) }); });
  });

  console.log(JSON.stringify(out, null, 2));
}
main();
