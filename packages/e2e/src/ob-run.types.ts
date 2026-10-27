import type { readQueryViewUntil } from "./note-query-view.ts";
import type * as Cli from "./obsidian-cli.ts";
import { obRun } from "./obsidian-cli.ts";

// Typecheck is the seam: these calls are compiled, never executed.
function proofs() {
  // @ts-expect-error #1855: Query View reads take typed callbacks.
  const queryViewReader: Parameters<typeof readQueryViewUntil>[1] =
    "JSON.stringify(true)";
  void queryViewReader;
  void obRun("vault", ({ zotlit }) =>
    zotlit.services.bridge.runSync(
      zotlit.services.profileService.getBuiltInSource(),
    ),
  );
  void obRun("vault", ({ zotlit }) => {
    // @ts-expect-error Removed service members must fail before a desktop run.
    return zotlit.services.noSuchService;
  });
  // @ts-expect-error Args follow the callback's declared input.
  void obRun("vault", (_, args: { path: string }) => args.path, { path: 1 });
  // @ts-expect-error A Map cannot cross the JSON transport.
  void obRun("vault", () => new Map<string, string>());
  // @ts-expect-error A function cannot cross the JSON transport.
  void obRun("vault", () => ({ action: () => true }));
}
void proofs;

// #1855: only typed callbacks cross the public eval boundary.
type LegacyEvalExports = Extract<
  keyof typeof Cli,
  | "obEval"
  | "obJson"
  | "obReadUntil"
  | "obEvalUntil"
  | "wrapEvalCode"
  | "parseEvalReply"
  | "WINDOW_DOCUMENTS"
>;
const legacyEvalExports: Record<LegacyEvalExports, never> = {};
void legacyEvalExports;
