// These suites assert real rendered surfaces (References view, CitationPopover)
// while instantiating the real Pandoc wasm binary. Node's
// WebAssembly.instantiateStreaming brand-checks the native Response, and a
// foreign Blob/File in its body is silently coerced via String() into
// "[object Blob]" rather than read — so this environment is happy-dom with
// the native Response, Blob, and File restored.

import { builtinEnvironments } from "vitest/runtime";
import type { Environment } from "vitest/runtime";

const happyDom = builtinEnvironments["happy-dom"];

export default {
  ...happyDom,
  name: "happy-dom-native-response",
  async setup(global, options) {
    const nativeResponse = global.Response;
    const nativeBlob = global.Blob;
    const nativeFile = global.File;
    const teardown = await happyDom.setup(global, options);
    global.Response = nativeResponse;
    global.Blob = nativeBlob;
    global.File = nativeFile;
    return teardown;
  },
} satisfies Environment;
