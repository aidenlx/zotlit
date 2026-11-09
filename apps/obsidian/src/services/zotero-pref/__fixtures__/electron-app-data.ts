import { createRequire, Module } from "node:module";

/** Replace the Electron CommonJS boundary for a scoped Node test. */
export function electronAppData(appData: string): Disposable {
  const require = createRequire(import.meta.url);
  const id = require.resolve("@electron/remote");
  const previous = require.cache[id];
  const remote = new Module(id);
  remote.exports = {
    app: {
      getPath: (name: string) => {
        if (name !== "appData") throw new Error(`Unexpected path: ${name}`);
        return appData;
      },
    },
  };
  require.cache[id] = remote;
  return {
    [Symbol.dispose]() {
      if (previous) require.cache[id] = previous;
      else delete require.cache[id];
    },
  };
}
