// SPDX-License-Identifier: MPL-2.0
// Derived from Mozilla web-ext src/firefox/remote.js.
// https://github.com/mozilla/web-ext/blob/master/src/firefox/remote.js

import type { RdpClient } from "./rdp-client.ts";

type RemoteFirefoxClient = Pick<RdpClient, "request">;

export type FirefoxAddon = {
  id: string;
  actor: string;
};

export type InstallTemporaryAddonResponse = {
  addon?: FirefoxAddon;
};

type AddonsActorResponse = {
  addonsActor?: string;
};

type ListAddonsResponse = {
  addons: FirefoxAddon[];
};

function remoteRequestError(message: string, cause: unknown): Error {
  return new Error(`Remote Firefox: ${message}`, { cause });
}

async function getAddonsActor(client: RemoteFirefoxClient): Promise<string> {
  try {
    const response = await client.request<AddonsActorResponse>("getRoot");
    if (response.addonsActor === undefined) {
      throw new Error(
        "Remote Firefox does not provide an add-ons actor for temporary add-on installation",
      );
    }

    return response.addonsActor;
  } catch (error) {
    throw remoteRequestError("getRoot() error", error);
  }
}

export async function getInstalledAddon(
  client: RemoteFirefoxClient,
  addonId: string,
): Promise<FirefoxAddon> {
  let response: ListAddonsResponse;

  try {
    response = await client.request<ListAddonsResponse>("listAddons");
  } catch (error) {
    throw remoteRequestError("listAddons() error", error);
  }

  const addon = response.addons.find((candidate) => candidate.id === addonId);
  if (addon === undefined) {
    throw new Error(`Remote Firefox does not have add-on ${addonId} installed`);
  }

  return addon;
}

export async function installTemporaryAddon(
  client: RemoteFirefoxClient,
  absAddonPath: string,
): Promise<InstallTemporaryAddonResponse> {
  const addonsActor = await getAddonsActor(client);

  try {
    return await client.request<InstallTemporaryAddonResponse>({
      to: addonsActor,
      type: "installTemporaryAddon",
      addonPath: absAddonPath,
    });
  } catch (error) {
    throw remoteRequestError("installTemporaryAddon() error", error);
  }
}

export async function reloadAddon(
  client: RemoteFirefoxClient,
  addonId: string,
): Promise<void> {
  const addon = await getInstalledAddon(client, addonId);

  try {
    await client.request({
      to: addon.actor,
      type: "reload",
    });
  } catch (error) {
    throw remoteRequestError("reload() error", error);
  }
}
