'use strict';
const { app, BrowserWindow, utilityProcess, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { runSuite, ORT, REPAIR, REF_FEAT } = require('./suite');

const OUT = process.env.COMPAT_OUT || path.join(__dirname, '../results/out.json');
const report = { electron: process.versions.electron, node: process.versions.node, contexts: {} };

async function runMain() {
  process.env.ZOTLIT_SKIP_WORKER = '';
  report.contexts.main = await runSuite('main');
}

async function runRenderer() {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
        // Obsidian-like
      },
    });
    const html = `data:text/html,<!doctype html><meta charset=utf-8><script>
      const { runSuite } = require(${JSON.stringify(path.join(__dirname, 'suite.js'))});
      const { ipcRenderer } = require('electron');
      (async () => {
        try {
          process.env.ZOTLIT_SKIP_WORKER = '1'; // keep renderer suite lighter; worker covered in main
          const r = await runSuite('renderer');
          ipcRenderer.send('compat-renderer', r);
        } catch (e) {
          ipcRenderer.send('compat-renderer', { ctx: 'renderer', error: String(e && e.stack || e) });
        }
      })();
    </script>`;
    ipcMain.once('compat-renderer', (_e, data) => {
      report.contexts.renderer = data;
      win.destroy();
      resolve();
    });
    win.loadURL(html);
    setTimeout(() => {
      if (!report.contexts.renderer) {
        report.contexts.renderer = { error: 'timeout' };
        try { win.destroy(); } catch (_) {}
        resolve();
      }
    }, 60000);
  });
}

async function runUtility() {
  // Electron utilityProcess
  if (typeof utilityProcess === 'undefined' || !utilityProcess.fork) {
    report.contexts.utilityProcess = { skipped: true, reason: 'utilityProcess.fork unavailable' };
    return;
  }
  return new Promise((resolve) => {
    const child = utilityProcess.fork(path.join(__dirname, 'utility-child.js'), [], {
      stdio: 'pipe',
      serviceName: 'zotlit-compat',
    });
    let buf = '';
    const done = (data) => {
      report.contexts.utilityProcess = data;
      try { child.kill(); } catch (_) {}
      resolve();
    };
    child.on('message', (msg) => done(msg));
    if (child.stdout) child.stdout.on('data', (d) => { buf += d.toString(); });
    if (child.stderr) child.stderr.on('data', (d) => { buf += d.toString(); });
    child.on('exit', (code) => {
      if (!report.contexts.utilityProcess) {
        done({ error: 'exit without message', code, buf: buf.slice(0, 2000) });
      }
    });
    setTimeout(() => {
      if (!report.contexts.utilityProcess) done({ error: 'timeout', buf: buf.slice(0, 2000) });
    }, 60000);
  });
}

async function runChildProcess() {
  // classic child_process with ELECTRON_RUN_AS_NODE
  const electronBin = process.execPath;
  const script = path.join(__dirname, 'child-node.js');
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', ZOTLIT_SKIP_WORKER: '1' };
  const r = spawnSync(electronBin, [script], { encoding: 'utf8', env, timeout: 60000 });
  try {
    report.contexts.child_process_run_as_node = JSON.parse(r.stdout.split('\n').filter((l) => l.startsWith('{')).pop());
  } catch (e) {
    report.contexts.child_process_run_as_node = {
      error: String(e),
      status: r.status,
      stdout: (r.stdout || '').slice(0, 2000),
      stderr: (r.stderr || '').slice(0, 2000),
    };
  }
}

app.whenReady().then(async () => {
  try {
    await runMain();
    await runRenderer();
    await runUtility();
    await runChildProcess();
  } catch (e) {
    report.fatal = String(e && e.stack || e);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('WROTE', OUT);
  app.quit();
}).catch((e) => {
  console.error(e);
  app.exit(1);
});

// Prevent default quit on window close during tests
app.on('window-all-closed', (e) => {});
