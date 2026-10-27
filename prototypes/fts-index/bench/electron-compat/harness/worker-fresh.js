'use strict';
const { Worker } = require('worker_threads');
const path = require('path');
const ORT = path.join(__dirname, '../ort_infer.linux-x64-gnu.node');
const REPAIR = 'BENCH_ROOT/static-infer/models/repair.onnx';
const REF = 'BENCH_ROOT/static-infer/ref/repair_features.npy';

const code = `
  const { parentPort, workerData } = require('worker_threads');
  const fs = require('fs');
  try {
    const n = require(workerData.ort);
    const eng = new n.NativeOrt(1, { repair: workerData.repair });
    const buf = fs.readFileSync(workerData.ref);
    const ver = buf[6]; let hoff=8,hlen; if(ver===1){hlen=buf.readUInt16LE(8);hoff=10;}else{hlen=buf.readUInt32LE(8);hoff=12;}
    const header=buf.slice(hoff,hoff+hlen).toString();
    const shape=[...header.match(/\\((.*?)\\)/)[1].matchAll(/\\d+/g)].map(x=>+x[0]);
    const data=new Float32Array(buf.buffer,buf.byteOffset+hoff+hlen,shape.reduce((a,b)=>a*b,1));
    const r = eng.runRepair({ data: Float32Array.from(data), shape });
    parentPort.postMessage({ ok: true, inferMs: r.inferMs, logits: r.logits.length });
  } catch (e) { parentPort.postMessage({ ok: false, error: String(e.message || e) }); }
`;
new Promise((resolve) => {
  const w = new Worker(code, { eval: true, workerData: { ort: ORT, repair: REPAIR, ref: REF } });
  const t = setTimeout(() => { w.terminate(); resolve({ ok: false, error: 'timeout' }); }, 20000);
  w.on('message', (m) => { clearTimeout(t); w.terminate(); resolve(m); });
  w.on('error', (e) => { clearTimeout(t); resolve({ ok: false, error: String(e.message || e) }); });
}).then((r) => { console.log(JSON.stringify({ worker_only_fresh_process: r }, null, 2)); });
