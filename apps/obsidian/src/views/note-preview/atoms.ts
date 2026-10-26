// Commands owned by one Note Preview leaf.
import { Effect } from "effect";

import { viewRuntime } from "@/lib/view-atoms";
import { Profile } from "@/services/profile/service";

export const makeBuiltInSourceCommand = () =>
  viewRuntime.fn(() =>
    Effect.gen(function* () {
      return yield* (yield* Profile).getBuiltInSource();
    }),
  );

/** The shared Workbench chooser owns its modal and search session. */
export const makeChoiceCommand = (choose: () => Promise<void>) =>
  viewRuntime.fn(() =>
    Effect.tryPromise((signal) => {
      void signal;
      return choose();
    }),
  );
