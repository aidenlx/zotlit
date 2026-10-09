// A worker entry that runs a fiber through the Effect scheduler and yields
// once, as a long read in the Zotero reads worker does.
import { Effect } from "effect";

declare const reportDone: () => void;

void Effect.runPromise(Effect.yieldNow).then(() => reportDone());
