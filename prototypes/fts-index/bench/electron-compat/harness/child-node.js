'use strict';
process.env.ZOTLIT_SKIP_WORKER = '1';
const { runSuite } = require('./suite');
(async () => {
  const r = await runSuite('child_process_ELECTRON_RUN_AS_NODE');
  process.stdout.write(JSON.stringify(r) + '\n');
})().catch((e) => {
  process.stdout.write(JSON.stringify({ error: String(e && e.stack || e) }) + '\n');
  process.exit(1);
});
