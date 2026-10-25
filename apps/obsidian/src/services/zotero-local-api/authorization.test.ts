// The Write Authorization state machine, driven over the fake transport and an
// in-memory credential store: what each dialog outcome leaves the session in,
// and what each refusal of a write does to the key in hand.

import { DateTime, Duration } from "effect";
import { TestClock } from "effect/testing";
import { expect, it, vi } from "vitest";

import type { EffectBridge } from "@/lib/effect-bridge";

import {
  authorized,
  denied,
  keyRejected,
  libraryReadOnly,
  localApiClient,
  localApiDisabled,
  NOW,
  rateLimited,
  rootOk,
  serverChanged,
  unreachable,
  writeAccepted,
  SERVER_ID,
} from "./__fixtures__";
import type { ClientOptions, ZoteroAnswers } from "./__fixtures__";
import type { ZoteroLocalApi } from "./service";

/** One annotation of the personal library, as a write route names it. */
const ITEM_PATH = "/api/users/0/items/PUPR5FG5";
const PERSONAL = "users/0";

/** A second Zotero database, for the swap the session has to notice. */
const OTHER_SERVER_ID = "Zzzz11119999";

it("asks Zotero under the one Client Name, and only when a gesture asks", async () => {
  await using stack = new AsyncDisposableStack();
  const { requests, service, bridge } = await setup(stack);

  // Nothing has acted, so nothing has been sent — no dialog opens by itself.
  expect(requests).toHaveLength(0);
  await bridge.runPromise(service.authorize);

  const authorize = requests.at(-1)!;
  expect(authorize.method).toBe("POST");
  expect(authorize.url.pathname).toBe("/api/local/authorize");
  // The Client Name Zotero shows in its dialog, spelled once for every vault.
  expect(JSON.parse(authorize.body!)).toEqual({
    appName: "ZotLit for Obsidian",
  });
  expect(authorize.headers.get("content-type")).toBe("application/json");
  expect(authorize.headers.get("zotero-server-id")).toBe(SERVER_ID);
  expect(authorize.headers.get("zotero-allowed-request")).toBe("1");
  // The gesture re-checks Zotero before it asks for anything.
  expect(requests.map(({ url }) => url.pathname)).toEqual([
    "/api/",
    "/api/local/authorize",
  ]);
});

it("refuses an Allow, and keeps no key to send", async () => {
  await using stack = new AsyncDisposableStack();
  const { service, bridge, requests, credentials } = await setup(stack, {
    authorize: () => authorized({ remember: false }),
    write: () => writeAccepted(),
  });

  const grant = await bridge.runPromise(service.authorize);
  const sent = requests.length;
  const write = await bridge.runPromise(
    service.authorizedSend(ITEM_PATH, {
      library: PERSONAL,
      method: "PATCH",
      body: '{"annotationColor":"#ff6666"}',
    }),
  );

  expect(grant).toEqual({ failure: { kind: "not-remembered" } });
  // Nothing was written down, and the session still has to ask.
  expect(credentials.writes).toEqual([]);
  expect(await bridge.runPromise(service.remembered)).toBe(false);
  expect(capabilityInput(service, bridge).authorized).toBe(false);
  // The write is refused here: the key from Allow never reaches the wire.
  expect(write).toEqual({ failure: { kind: "unauthorized" } });
  expect(requests.slice(sent)).toEqual([]);
});

it("refuses an Always Allow that the device cannot save", async () => {
  await using stack = new AsyncDisposableStack();
  const { requests, credentials, service, bridge } = await setup(stack, {
    authorize: () => authorized({ remember: true }),
  });
  credentials.remember.mockRejectedValueOnce(new Error("Keychain locked"));

  const grant = await bridge.runPromise(service.authorize);
  const sent = requests.length;
  const write = await bridge.runPromise(
    service.authorizedSend(ITEM_PATH, {
      library: PERSONAL,
      method: "PATCH",
    }),
  );

  expect(grant).toEqual({ failure: { kind: "not-saved" } });
  expect(credentials.record).toBeNull();
  expect(capabilityInput(service, bridge).authorized).toBe(false);
  expect(write).toEqual({ failure: { kind: "unauthorized" } });
  expect(requests.slice(sent)).toEqual([]);
});

it("writes an Always Allow to the store and never holds it in memory", async () => {
  await using stack = new AsyncDisposableStack();
  const { credentials, requests, service, bridge } = await setup(stack, {
    authorize: () => authorized({ remember: true }),
  });

  const grant = await bridge.runPromise(service.authorize);
  await bridge.runPromise(
    service.authorizedSend(ITEM_PATH, {
      library: PERSONAL,
      method: "PATCH",
    }),
  );
  await bridge.runPromise(
    service.authorizedSend(ITEM_PATH, {
      library: PERSONAL,
      method: "PATCH",
    }),
  );

  expect(grant).toEqual({ value: undefined });
  expect(credentials.record).toEqual({
    serverID: SERVER_ID,
    key: "5ixBzUhQfLu8i8RIhU6OEzENW4pAITLf",
  });
  // Read fresh at every write rather than cached, so a key the user deletes in
  // Obsidian's Keychain is gone by the next attempt.
  expect(credentials.read).toHaveBeenCalledTimes(3);
  expect(
    requests
      .filter(({ method }) => method === "PATCH")
      .map(({ headers }) => headers.get("zotero-api-key")),
  ).toEqual([
    "5ixBzUhQfLu8i8RIhU6OEzENW4pAITLf",
    "5ixBzUhQfLu8i8RIhU6OEzENW4pAITLf",
  ]);
});

it("raises no second dialog once an authorization is remembered", async () => {
  await using stack = new AsyncDisposableStack();
  const { requests, service, bridge } = await setup(
    stack,
    { authorize: () => authorized({ remember: true }) },
    { key: "5ixBzUhQfLu8i8RIhU6OEzENW4pAITLf" },
  );

  const grant = await bridge.runPromise(service.authorize);

  expect(grant).toEqual({ value: undefined });
  expect(requests.map(({ url }) => url.pathname)).toEqual(["/api/"]);
});

/**
 * The dialog outcomes ZotLit keeps as a grant, as Zotero 10.0 reports them,
 * recorded from the real `nsIPromptService` dialog driven button by button.
 * Allow is refused above, and Deny below.
 *
 * **Dismissal is not Deny.** Gecko records slot 1 as the result of any close
 * that is not a button press, and Zotero maps slot 1 to Always Allow, so
 * closing the dialog grants a persistent key. ZotLit cannot treat it as a
 * refusal, because Zotero does not report one.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1144
 */
it.each<[string, () => Response]>([
  ["Always Allow", () => authorized({ remember: true })],
  [
    "a dismissed dialog",
    // Recorded twice — Escape, and `win.close()` on the dialog window.
    () =>
      authorized({ remember: true, key: "4zQONVs9iqR87qvc4istHwfQ3oUp1Ygi" }),
  ],
])("reads %s as a grant", async (_outcome, answer) => {
  await using stack = new AsyncDisposableStack();
  const { service, bridge } = await setup(stack, { authorize: answer });

  const grant = await bridge.runPromise(service.authorize);

  expect(grant).toEqual({ value: undefined });
  expect(capabilityInput(service, bridge).authorized).toBe(true);
});

it("takes Deny as a refusal, and asks again only on the next gesture", async () => {
  await using stack = new AsyncDisposableStack();
  const { requests, credentials, service, bridge } = await setup(stack, {
    authorize: () => denied(),
  });

  const refused = await bridge.runPromise(service.authorize);

  expect(refused).toEqual({ failure: { kind: "denied" } });
  expect(capabilityInput(service, bridge).authorized).toBe(false);
  // Nothing was stored, and nothing asked again by itself.
  expect(credentials.writes).toEqual([]);
  expect(
    requests.filter(({ url }) => url.pathname === "/api/local/authorize"),
  ).toHaveLength(1);
});

it("holds Zotero's cooldown, with the Retry-After it named", async () => {
  await using stack = new AsyncDisposableStack();
  const { requests, service, bridge } = await setup(stack, {
    authorize: () => rateLimited(),
  });

  const limited = await bridge.runPromise(service.authorize);
  const again = await bridge.runPromise(service.authorize);

  expect(limited).toEqual({
    failure: {
      kind: "cooldown",
      retryAfter: Duration.seconds(60),
    },
  });
  expect(bridge.runSync(service.writeStateFor(null)).cooldownUntil).toEqual(
    DateTime.addDuration(NOW, Duration.seconds(60)),
  );
  // A second gesture inside the cooldown asks Zotero nothing: the rate limit is
  // what a sixth dialog request in a minute costs.
  expect(again).toEqual({
    failure: {
      kind: "cooldown",
      retryAfter: Duration.seconds(60),
    },
  });
  expect(
    requests.filter(({ url }) => url.pathname === "/api/local/authorize"),
  ).toHaveLength(1);
});

it("asks again once the cooldown has run out", async () => {
  await using stack = new AsyncDisposableStack();
  const answers: ZoteroAnswers = {
    authorize: vi
      .fn()
      .mockImplementationOnce(() => rateLimited())
      .mockImplementation(() => authorized({ remember: true })),
  };
  const { runtime, service, bridge } = await setup(stack, answers);

  await bridge.runPromise(service.authorize);
  await runtime.runPromise(TestClock.adjust("61 seconds"));
  const granted = await bridge.runPromise(service.authorize);

  expect(granted).toEqual({ value: undefined });
  expect(bridge.runSync(service.writeStateFor(null)).cooldownUntil).toBeNull();
});

it("reads the local API being off from the probe the gesture runs", async () => {
  await using stack = new AsyncDisposableStack();
  const { requests, service, bridge } = await setup(stack, {
    root: localApiDisabled,
  });

  const refused = await bridge.runPromise(service.authorize);

  expect(refused).toEqual({ failure: { kind: "local-api-disabled" } });
  // No dialog is raised at a Zotero that cannot answer one.
  expect(requests.map(({ url }) => url.pathname)).toEqual(["/api/"]);
});

it("marks one library read-only for the session, and stops sending to it", async () => {
  await using stack = new AsyncDisposableStack();
  const { requests, service, bridge } = await setup(stack, {
    authorize: () => authorized({ remember: true }),
    write: () => libraryReadOnly(),
  });
  await bridge.runPromise(service.authorize);

  const refused = await bridge.runPromise(
    service.authorizedSend(ITEM_PATH, {
      library: PERSONAL,
      method: "PATCH",
    }),
  );
  const again = await bridge.runPromise(
    service.authorizedSend(ITEM_PATH, {
      library: PERSONAL,
      method: "PATCH",
    }),
  );

  expect(refused).toEqual({ failure: { kind: "library-read-only" } });
  expect(again).toEqual({ failure: { kind: "library-read-only" } });
  // The second attempt never left, so the user learns the limit once.
  expect(requests.filter(({ method }) => method === "PATCH")).toHaveLength(1);
  expect(
    bridge.runSync(service.writeStateFor("PUPR5FG5")).libraryReadOnly,
  ).toBe(true);
  // Another library is untouched by it.
  expect(
    bridge.runSync(service.writeStateFor("PUPR5FG5g12345")).libraryReadOnly,
  ).toBe(false);
});

it("lets the next Capability Probe retire a read-only library, and says so", async () => {
  await using stack = new AsyncDisposableStack();
  const { service, bridge } = await setup(stack, {
    authorize: () => authorized({ remember: true }),
    write: () => libraryReadOnly(),
  });
  const retired = vi.fn();
  stack.defer(bridge.subscribe(service.writeRefusalsRetired, retired));
  await bridge.runPromise(service.authorize);
  await bridge.runPromise(
    service.authorizedSend(ITEM_PATH, {
      library: PERSONAL,
      method: "PATCH",
    }),
  );

  expect(
    bridge.runSync(service.writeStateFor("PUPR5FG5")).libraryReadOnly,
  ).toBe(true);
  // The probe behind the gesture had nothing to retire.
  expect(retired).not.toHaveBeenCalled();

  await bridge.runPromise(service.probe);

  expect(
    bridge.runSync(service.writeStateFor("PUPR5FG5")).libraryReadOnly,
  ).toBe(false);
  // A surface that stood a control down on the refusal has to hear the mark go,
  // so the control comes back and the next refusal is news rather than a repeat.
  expect(retired).toHaveBeenCalledOnce();

  // A probe with nothing to retire says nothing.
  await bridge.runPromise(service.probe);
  expect(retired).toHaveBeenCalledOnce();
});

it("announces a swapped Zotero database from the probe that adopts it", async () => {
  await using stack = new AsyncDisposableStack();
  let serverID = SERVER_ID;
  const { service, bridge } = await setup(stack, {
    root: () => rootOk({ "Zotero-Server-ID": serverID }),
    authorize: () => authorized({ remember: true }),
    write: () => serverChanged(OTHER_SERVER_ID),
  });
  const changes: string[] = [];
  stack.defer(
    bridge.subscribe(service.serverChanges, (id) => changes.push(id)),
  );

  // The first probe learns a database rather than finding a changed one.
  await bridge.runPromise(service.probe);
  expect(changes).toEqual([]);

  // A write that meets another database sends the probe looking on its own;
  // the probe is what adopts the new one and what names it. The announcement
  // is the signal a check waits on, not a count of turns of the event loop.
  await bridge.runPromise(service.authorize);
  serverID = OTHER_SERVER_ID;
  const announced = new Promise<string>((resolve) => {
    const off = bridge.subscribe(service.serverChanges, (id) => {
      off();
      resolve(id);
    });
  });
  await bridge.runPromise(
    service.authorizedSend(ITEM_PATH, {
      library: PERSONAL,
      method: "PATCH",
    }),
  );

  expect(await announced).toBe(OTHER_SERVER_ID);
  // The session now holds the database that answers, so it says nothing more.
  await bridge.runPromise(service.probe);
  expect(changes).toEqual([OTHER_SERVER_ID]);
});

it("invalidates the record keyless when Zotero rejects the key", async () => {
  await using stack = new AsyncDisposableStack();
  const { service, bridge, credentials } = await setup(
    stack,
    { write: () => keyRejected() },
    { key: "5ixBzUhQfLu8i8RIhU6OEzENW4pAITLf" },
  );
  await bridge.runPromise(service.probe);

  const refused = await bridge.runPromise(
    service.authorizedSend(ITEM_PATH, {
      library: PERSONAL,
      method: "PATCH",
    }),
  );

  expect(refused).toEqual({ failure: { kind: "unauthorized" } });
  // Overwritten without a key — the typed SecretStorage API has no delete.
  expect(credentials.writes).toEqual([{ serverID: SERVER_ID }]);
  expect(credentials.record).toEqual({ serverID: SERVER_ID });
  expect(capabilityInput(service, bridge).authorized).toBe(false);
  expect(await bridge.runPromise(service.remembered)).toBe(false);
});

it("serves two presses of Allow editing with one request", async () => {
  await using stack = new AsyncDisposableStack();
  const pending = Promise.withResolvers<Response>();
  const { requests, service, bridge } = await setup(stack, {
    authorize: () => pending.promise,
  });

  const view = bridge.runPromise(service.authorize);
  const settings = bridge.runPromise(service.authorize);
  // Both gestures wait at one dialog, and the surfaces say so meanwhile.
  await atTheDialog(requests);
  expect(bridge.runSync(service.writeStateFor(null)).authorizing).toBe(true);
  pending.resolve(authorized({ remember: true }));

  expect(await view).toEqual({ value: undefined });
  expect(await settings).toEqual({ value: undefined });
  expect(
    requests.filter(({ url }) => url.pathname === "/api/local/authorize"),
  ).toHaveLength(1);
  expect(bridge.runSync(service.writeStateFor(null)).authorizing).toBe(false);
});

it("starts a new request for a press after the last one settled", async () => {
  await using stack = new AsyncDisposableStack();
  const { requests, service, bridge } = await setup(stack, {
    authorize: () => authorized({ remember: false }),
  });

  const first = await bridge.runPromise(service.authorize);
  const second = await bridge.runPromise(service.authorize);

  expect(first).toEqual({ failure: { kind: "not-remembered" } });
  expect(second).toEqual({ failure: { kind: "not-remembered" } });
  expect(
    requests.filter(({ url }) => url.pathname === "/api/local/authorize"),
  ).toHaveLength(2);
});

it("clears the slot of a request that finishes without suspending", async () => {
  await using stack = new AsyncDisposableStack();
  const { service, bridge, zoteroPref } = await setup(stack);
  // With no port, the request answers `unreachable` before the starter resumes.
  zoteroPref.httpPort = null;
  let changes = 0;
  stack.defer(
    bridge.subscribe(service.capabilityChanges, () => (changes += 1)),
  );

  const first = await bridge.runPromise(service.authorize);
  const second = await bridge.runPromise(service.authorize);

  expect(first).toEqual({ failure: { kind: "unreachable" } });
  expect(second).toEqual({ failure: { kind: "unreachable" } });
  // The first press moves the capability (the probe lands), and each of the
  // two requests announces its start and its end.
  await vi.waitFor(() => expect(changes).toBe(5));
  expect(bridge.runSync(service.writeStateFor(null)).authorizing).toBe(false);
});

it("says a request is in flight only while Zotero's dialog waits", async () => {
  await using stack = new AsyncDisposableStack();
  const pending = Promise.withResolvers<Response>();
  const { requests, service, bridge } = await setup(stack, {
    authorize: () => pending.promise,
  });
  expect(bridge.runSync(service.writeStateFor(null)).authorizing).toBe(false);

  const gesture = bridge.runPromise(service.authorize);
  await atTheDialog(requests);
  expect(bridge.runSync(service.writeStateFor(null)).authorizing).toBe(true);

  pending.resolve(denied());
  await gesture;
  expect(bridge.runSync(service.writeStateFor(null)).authorizing).toBe(false);
});

it("answers a write with no session without reaching Zotero", async () => {
  await using stack = new AsyncDisposableStack();
  const { requests, service, bridge } = await setup(stack, {
    root: unreachable,
  });
  await bridge.runPromise(service.probe);

  const refused = await bridge.runPromise(
    service.authorizedSend(ITEM_PATH, {
      library: PERSONAL,
      method: "PATCH",
    }),
  );

  expect(refused).toEqual({ failure: { kind: "unreachable" } });
  expect(requests.filter(({ method }) => method === "PATCH")).toHaveLength(0);
});

it("drops the Remembered Authorization when the settings row forgets it", async () => {
  await using stack = new AsyncDisposableStack();
  const { service, bridge, credentials } = await setup(
    stack,
    {},
    {
      key: "5ixBzUhQfLu8i8RIhU6OEzENW4pAITLf",
    },
  );
  await bridge.runPromise(service.probe);

  expect(capabilityInput(service, bridge).authorized).toBe(true);
  await bridge.runPromise(service.forgetAuthorization);

  expect(credentials.record).toEqual({ serverID: SERVER_ID });
  expect(capabilityInput(service, bridge).authorized).toBe(false);
  expect(await bridge.runPromise(service.remembered)).toBe(false);
});

it("disables editing when a remembered grant was removed outside ZotLit", async () => {
  await using stack = new AsyncDisposableStack();
  const { credentials, requests, service, bridge } = await setup(
    stack,
    {},
    { key: "5ixBzUhQfLu8i8RIhU6OEzENW4pAITLf" },
  );
  await bridge.runPromise(service.probe);
  await credentials.forget();
  const sent = requests.length;
  expect(
    await bridge.runPromise(
      service.authorizedSend(ITEM_PATH, {
        library: PERSONAL,
        method: "PATCH",
      }),
    ),
  ).toEqual({ failure: { kind: "unauthorized" } });
  expect(capabilityInput(service, bridge).authorized).toBe(false);
  expect(requests.slice(sent)).toEqual([]);
});

/** The authorize request reaching the transport, as a completion signal. */
function atTheDialog(requests: readonly { url: URL }[]): Promise<void> {
  return vi.waitFor(() => {
    const asked = requests.some(
      ({ url }) => url.pathname === "/api/local/authorize",
    );
    if (!asked) throw new Error("No authorization request yet");
  });
}

/** The probe half of what the Editing Capability is computed from. */
function capabilityInput(
  service: ZoteroLocalApi["Service"],
  bridge: EffectBridge,
) {
  const state = bridge.runSync(service.state);
  return { authorized: state.kind === "available" && state.authorized };
}

async function setup(
  stack: AsyncDisposableStack,
  answers: ZoteroAnswers = {},
  options: ClientOptions = {},
) {
  const harness = await localApiClient(answers, options);
  stack.use(harness.disposable);
  return harness;
}
