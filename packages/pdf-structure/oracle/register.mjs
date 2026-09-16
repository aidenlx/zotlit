// Installs the resolution hooks before the extractor loads, so `node --import`
// can point at one file.

import { registerHooks } from "node:module";

const { resolve } = await import("./pdfjs-hooks.mjs");

registerHooks({ resolve });
