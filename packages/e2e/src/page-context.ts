import type { E2eServices } from "@zotlit/obsidian/e2e";

import type { createPageHelpers } from "./page-helpers.ts";
import type { PageApp } from "./page-host.ts";

/** Values present in the receiving window. Imports here are type-only. */
export interface ObsidianContext {
  app: PageApp;
  zotlit: { services: E2eServices };
  page: ReturnType<typeof createPageHelpers>;
}

/** JSON data, with undefined allowed for side-effect-only callbacks. */
export type JsonCompatible<T> = T extends
  | string
  | number
  | boolean
  | null
  | undefined
  | void
  ? T
  : T extends (...args: never[]) => unknown
    ? never
    : T extends readonly unknown[]
      ? { [K in keyof T]: JsonCompatible<T[K]> }
      : T extends object
        ? { [K in keyof T]: JsonCompatible<T[K]> }
        : never;
