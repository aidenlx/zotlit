/**
 * Fair ranking: sample phrases from each method's own block units; measure blockTop1/Top3.
 * Also split phrase/AND recall by kind (en vs cjk) using C-sampled phrases (same as main) + self.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// reuse helpers by dynamic import of run-fts pieces — inline minimal copy
const Database = require('BENCH_ROOT/zotlit-fts-prototype/node_modules/better-sqlite3');
const PDF_DIR = 'BENCH_ROOT/zotero-model-history/fts-exp/pdfs';
const PAGES_ROOT = path.join(__dirname, '../pages');
const OUT = path.join(__dirname, '../out');

// Import extract from sibling by spawning node eval is heavy; re-import via subprocess of a thin wrapper.
// Instead: call run-fts-abcd's functions by reading and eval — cleaner: duplicate thin extract via child.

const { pathToFileURL } = await import('url');
// Load the main script's exports — it doesn't export. Spawn a one-shot using node -e importing copy.

// Simpler: shell out to a small runner that patches CORPUS
const runner = `
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
const modPath = ${JSON.stringify(path.join(__dirname, 'run-fts-abcd.mjs'))};
// Can't import non-exported. Rewrite: exec the fair probe inline in this file.
`;
console.error('building inline probe...');
