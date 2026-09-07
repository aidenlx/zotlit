import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";

import type { FixtureLayout } from "./layout.ts";
import { createMockLocalBridge } from "./local-bridge.ts";

export interface StartMockLocalBridgeOptions {
  readonly layout: FixtureLayout;
  readonly allowedOrigin: string;
  readonly port: number;
  readonly conflictNextSave?: boolean;
}

export interface StartedMockLocalBridge {
  readonly server: ServerType;
  readonly initialOneTimeCode: string;
}

export function startMockLocalBridge(
  options: StartMockLocalBridgeOptions,
): StartedMockLocalBridge {
  const bridge = createMockLocalBridge({
    layout: options.layout,
    allowedOrigin: options.allowedOrigin,
  });
  if (options.conflictNextSave) bridge.control.conflictNextSave();
  return {
    server: serve({
      fetch: bridge.app.fetch,
      hostname: "127.0.0.1",
      port: options.port,
    }),
    initialOneTimeCode: bridge.initialOneTimeCode,
  };
}
