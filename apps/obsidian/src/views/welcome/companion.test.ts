// @vitest-environment happy-dom
import { expect, it } from "vitest";

import { makeWelcomeHost, waitFor } from "./__fixtures__";
import { companionInstalledAtom } from "./companion";

it("reads ZotLit Companion as installed from the Zotero add-on list", async () => {
  await using host = await makeWelcomeHost({ companionInstalled: () => true });
  using _held = {
    [Symbol.dispose]: host.registry.mount(companionInstalledAtom),
  };
  await waitFor(() =>
    expect(host.registry.get(companionInstalledAtom)).toBe(true),
  );
});

it("reads the add-on list again when the researcher returns from Zotero", async () => {
  let installed = false;
  let reads = 0;
  await using host = await makeWelcomeHost({
    companionInstalled: () => {
      reads += 1;
      return installed;
    },
  });
  using _held = {
    [Symbol.dispose]: host.registry.mount(companionInstalledAtom),
  };
  await waitFor(() => expect(reads).toBe(1));
  expect(host.registry.get(companionInstalledAtom)).toBe(false);

  installed = true;
  window.dispatchEvent(new Event("focus"));
  await waitFor(() =>
    expect(host.registry.get(companionInstalledAtom)).toBe(true),
  );
});
