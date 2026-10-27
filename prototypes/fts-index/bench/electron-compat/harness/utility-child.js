'use strict';
process.env.ZOTLIT_SKIP_WORKER = '1';
const { runSuite } = require('./suite');
(async () => {
  const r = await runSuite('utilityProcess');
  if (typeof process.parentPort !== 'undefined' && process.parentPort) {
    process.parentPort.postMessage(r);
  } else {
    // fallback
    console.log(JSON.stringify(r));
  }
  setTimeout(() => process.exit(0), 100);
})().catch((e) => {
  const msg = { error: String(e && e.stack || e) };
  if (process.parentPort) process.parentPort.postMessage(msg);
  else console.log(JSON.stringify(msg));
  process.exit(1);
});
