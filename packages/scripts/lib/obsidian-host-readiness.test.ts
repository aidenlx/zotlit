import { afterEach, describe, expect, it, vi } from "vitest";

import { createObsidianHostReadiness } from "./obsidian-host-readiness.ts";

type HostReadinessEffects = Parameters<typeof createObsidianHostReadiness>[0];

describe("Obsidian host readiness", () => {
  afterEach(() => vi.useRealTimers());

  it("reports recovery instructions when Obsidian is stopped", async () => {
    const check = createObsidianHostReadiness(
      {
        pathExists: async () => false,
        readRegistry: async () => ({}),
        runObsidian: async () => {
          throw new Error("command not found");
        },
      },
      { environment: {} },
    );

    await expect(check()).rejects.toThrow(
      /No live Obsidian vault answered within 5 seconds[\s\S]*Open a host vault in Obsidian, then rerun:[\s\S]*obsidian-vault\.ts check/,
    );
  });

  it("requires a vault window when only the welcome window is open", async () => {
    const check = createObsidianHostReadiness(
      {
        pathExists: async () => false,
        readRegistry: async () => ({}),
        runObsidian: async () => "Error: No active vault.",
      },
      { environment: {} },
    );

    await expect(check()).rejects.toThrow(
      "No live Obsidian vault answered within 5 seconds.",
    );
  });

  it("labels a persisted open entry with a missing path as stale", async () => {
    const check = createObsidianHostReadiness(
      {
        pathExists: async () => false,
        readRegistry: async () => ({
          stale: { open: true, path: "/missing/research", ts: 1 },
        }),
        runObsidian: async () => "",
      },
      { environment: {} },
    );

    await expect(check()).rejects.toThrow(
      /Existing registered vaults:\n  none[\s\S]*Registered paths that are missing:\n  - \/missing\/research \(stale; persisted open: true\)/,
    );
  });

  it("lists a valid registered vault as a candidate even when it is closed", async () => {
    const check = createObsidianHostReadiness(
      {
        pathExists: async () => true,
        readRegistry: async () => ({
          research: { open: false, path: "/vaults/research", ts: 1 },
        }),
        runObsidian: async () => "",
      },
      { environment: {} },
    );

    await expect(check()).rejects.toThrow(
      /Existing registered vaults:\n  - \/vaults\/research \(research; persisted open: false\)[\s\S]*Registered paths that are missing:\n  none/,
    );
  });

  it.each(["research", "research-id"])(
    "uses %s to bypass a nonresponsive focused window",
    async (selected) => {
      vi.useFakeTimers();
      const receivedArgs: string[][] = [];
      const registry = {
        "notes-id": { open: true, path: "/vaults/notes" },
        "research-id": { open: true, path: "/vaults/research" },
      };
      const check = createObsidianHostReadiness(
        {
          pathExists: async (path) => path.startsWith("/vaults/"),
          readRegistry: async () => registry,
          runObsidian: async (args) => {
            receivedArgs.push(args);
            if (!args.includes("vault=research-id")) {
              return new Promise(() => {});
            }
            if (args.some((arg) => arg.includes("vault-list"))) {
              return `=> ${JSON.stringify(registry)}`;
            }
            return '=> {"id":"research-id","path":"/vaults/research"}';
          },
        },
        { environment: { ZT_HOST_VAULT: selected } },
      );

      await Promise.all([
        expect(check()).resolves.toEqual({
          id: "research-id",
          path: "/vaults/research",
        }),
        vi.advanceTimersByTimeAsync(5_000),
      ]);
      expect(receivedArgs).toHaveLength(2);
      expect(receivedArgs.flat()).not.toContain("vault=research");
      expect(
        receivedArgs.every((args) => args.includes("vault=research-id")),
      ).toBe(true);
    },
  );

  it.each(["research-id", "RESEARCH-ID"])(
    "rejects a folder named %s that collides with the selected ID",
    async (folder) => {
      const runObsidian = vi.fn<HostReadinessEffects["runObsidian"]>(
        async () => '=> {"id":"research-id","path":"/vaults/research"}',
      );
      const check = createObsidianHostReadiness(
        {
          pathExists: async () => true,
          readRegistry: async () => ({
            "research-id": { open: true, path: "/vaults/research" },
            "other-id": { open: false, path: `/vaults/${folder}` },
          }),
          runObsidian,
        },
        { environment: { ZT_HOST_VAULT: "research-id" } },
      );

      await expect(check()).rejects.toThrow(
        "Selected Obsidian vault research-id conflicts with vault other-id",
      );
      expect(runObsidian).not.toHaveBeenCalled();
    },
  );

  it("does not open a closed vault selected through ZT_HOST_VAULT", async () => {
    const runObsidian = vi.fn<HostReadinessEffects["runObsidian"]>(
      async () => "",
    );
    const check = createObsidianHostReadiness(
      {
        pathExists: async () => true,
        readRegistry: async () => ({
          "research-id": { open: false, path: "/vaults/research" },
        }),
        runObsidian,
      },
      { environment: { ZT_HOST_VAULT: "research" } },
    );

    await expect(check()).rejects.toThrow(
      "ZT_HOST_VAULT does not identify one open vault: research",
    );
    expect(runObsidian).not.toHaveBeenCalled();
  });

  it.each(["host", "live list"])(
    "aborts an unanswered selected vault %s probe at the configured timeout",
    async (probe) => {
      vi.useFakeTimers();
      const signals: AbortSignal[] = [];
      const check = createObsidianHostReadiness(
        {
          pathExists: async () => true,
          readRegistry: async () => ({
            "research-id": { open: true, path: "/vaults/research" },
          }),
          runObsidian: async (args, signal) => {
            signals.push(signal);
            if (
              probe === "live list" &&
              !args.some((arg) => arg.includes("vault-list"))
            ) {
              return '=> {"id":"research-id","path":"/vaults/research"}';
            }
            return new Promise(() => {});
          },
        },
        {
          environment: { ZT_HOST_VAULT: "research" },
          timeoutMs: 10,
        },
      );

      await Promise.all([
        expect(check()).rejects.toThrow(
          "No live Obsidian vault answered within 10 milliseconds.",
        ),
        vi.advanceTimersByTimeAsync(10),
      ]);
      expect(signals.at(-1)?.aborted).toBe(true);
    },
  );

  it("stops a nonresponsive CLI probe at the configured timeout", async () => {
    vi.useFakeTimers();
    const check = createObsidianHostReadiness(
      {
        pathExists: async () => false,
        readRegistry: async () => ({}),
        runObsidian: async () => new Promise(() => {}),
      },
      { environment: {}, timeoutMs: 10 },
    );

    await Promise.all([
      expect(check()).rejects.toThrow(
        "No live Obsidian vault answered within 10 milliseconds.",
      ),
      vi.advanceTimersByTimeAsync(10),
    ]);
  });

  it.each([undefined, ""])(
    "uses focus when the selector is %s",
    async (selected) => {
      const runObsidian = vi.fn<HostReadinessEffects["runObsidian"]>(
        async () => '=> {"id":"notes-id","path":"/vaults/notes"}',
      );
      const readRegistry = vi.fn<HostReadinessEffects["readRegistry"]>(
        async () => ({}),
      );
      const check = createObsidianHostReadiness(
        { pathExists: async () => true, readRegistry, runObsidian },
        { environment: { ZT_HOST_VAULT: selected } },
      );

      await expect(check()).resolves.toEqual({
        id: "notes-id",
        path: "/vaults/notes",
      });
      expect(runObsidian.mock.calls[0]?.[0]?.[0]).toBe("eval");
      expect(readRegistry).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    "rejects duplicate folder names when the other vault has open=%s",
    async (open) => {
      const runObsidian = vi.fn<HostReadinessEffects["runObsidian"]>(
        async () => '=> {"id":"research-id","path":"/vaults/research"}',
      );
      const check = createObsidianHostReadiness(
        {
          pathExists: async () => true,
          readRegistry: async () => ({
            "research-id": { open: true, path: "/vaults/research" },
            "other-id": { open, path: "/other/research" },
          }),
          runObsidian,
        },
        { environment: { ZT_HOST_VAULT: "research" } },
      );

      await expect(check()).rejects.toThrow(
        "ZT_HOST_VAULT does not identify one open vault: research",
      );
      expect(runObsidian).not.toHaveBeenCalled();
    },
  );

  it("uses an exact ID to select among duplicate folder names", async () => {
    const registry = {
      "research-id": { open: true, path: "/vaults/research" },
      "other-id": { open: true, path: "/other/research" },
    };
    const check = createObsidianHostReadiness(
      {
        pathExists: async () => true,
        readRegistry: async () => registry,
        runObsidian: async (args) => {
          if (!args.includes("vault=research-id"))
            throw new Error("Wrong target");
          return args.some((arg) => arg.includes("vault-list"))
            ? `=> ${JSON.stringify(registry)}`
            : '=> {"id":"research-id","path":"/vaults/research"}';
        },
      },
      { environment: { ZT_HOST_VAULT: "research-id" } },
    );

    await expect(check()).resolves.toEqual({
      id: "research-id",
      path: "/vaults/research",
    });
  });

  it.each(["unknown", "research"])(
    "rejects %s without trying a different host",
    async (selected) => {
      const runObsidian = vi.fn<HostReadinessEffects["runObsidian"]>(
        async () => '=> {"id":"notes-id","path":"/vaults/notes"}',
      );
      const check = createObsidianHostReadiness(
        {
          pathExists: async () => true,
          readRegistry: async () => ({
            research: { open: false, path: "/vaults/closed" },
            "notes-id": { open: true, path: "/vaults/research" },
          }),
          runObsidian,
        },
        { environment: { ZT_HOST_VAULT: selected } },
      );

      await expect(check()).rejects.toThrow(
        `ZT_HOST_VAULT does not identify one open vault: ${selected}`,
      );
      expect(runObsidian).not.toHaveBeenCalled();
    },
  );

  it.each([
    { when: "before", probes: 0 },
    { when: "after", probes: 1 },
  ])(
    "rejects a selected base path missing $when the host probe",
    async ({ when, probes }) => {
      let exists = when === "after";
      const runObsidian = vi.fn<HostReadinessEffects["runObsidian"]>(
        async () => {
          exists = false;
          return '=> {"id":"research-id","path":"/vaults/research"}';
        },
      );
      const check = createObsidianHostReadiness(
        {
          pathExists: async () => exists,
          readRegistry: async () => ({
            "research-id": { open: true, path: "/vaults/research" },
          }),
          runObsidian,
        },
        { environment: { ZT_HOST_VAULT: "research" } },
      );

      await expect(check()).rejects.toThrow(
        "Selected Obsidian vault research-id has a missing base path: /vaults/research",
      );
      expect(runObsidian).toHaveBeenCalledTimes(probes);
    },
  );

  it.each([
    '=> {"id":"other-id","path":"/vaults/research"}',
    '=> {"id":"research-id","path":"/other/research"}',
    '=> {"id":"research-id"}',
    "=> invalid",
  ])("rejects a selected host response of %s", async (response) => {
    const check = createObsidianHostReadiness(
      {
        pathExists: async () => true,
        readRegistry: async () => ({
          "research-id": { open: true, path: "/vaults/research" },
        }),
        runObsidian: async () => response,
      },
      { environment: { ZT_HOST_VAULT: "research" } },
    );

    await expect(check()).rejects.toThrow(
      "Selected Obsidian vault research-id returned a different vault ID or base path.",
    );
  });

  it.each([
    ["invalid", "its live vault list was invalid"],
    [
      '{"research-id":{"open":false,"path":"/vaults/research"}}',
      "does not identify one open vault",
    ],
    [
      '{"research-id":{"open":true,"path":"/vaults/research"},"other-id":{"open":false,"path":"/other/research"}}',
      "does not identify one open vault",
    ],
    [
      '{"research-id":{"open":true,"path":"/other/research"}}',
      "returned a different vault ID or base path",
    ],
    [
      '{"other-id":{"open":true,"path":"/vaults/research"}}',
      "returned a different vault ID or base path",
    ],
  ])("rejects a live vault list of %s", async (liveList, error) => {
    const check = createObsidianHostReadiness(
      {
        pathExists: async () => true,
        readRegistry: async () => ({
          "research-id": { open: true, path: "/vaults/research" },
        }),
        runObsidian: async (args) =>
          args.some((arg) => arg.includes("vault-list"))
            ? `=> ${liveList}`
            : '=> {"id":"research-id","path":"/vaults/research"}',
      },
      { environment: { ZT_HOST_VAULT: "research" } },
    );

    await expect(check()).rejects.toThrow(error);
  });

  it("keeps recovery diagnostics when explicit selection cannot read the registry", async () => {
    const runObsidian = vi.fn<HostReadinessEffects["runObsidian"]>(
      async () => "",
    );
    const check = createObsidianHostReadiness(
      {
        pathExists: async () => true,
        readRegistry: async () => {
          throw new Error("permission denied");
        },
        runObsidian,
      },
      { environment: { ZT_HOST_VAULT: "research" } },
    );

    const result = check();
    await expect(result).rejects.toThrow(
      "Cannot read the Obsidian vault registry to select research.",
    );
    await expect(result).rejects.toThrow(
      "Registry diagnosis unavailable: permission denied",
    );
    await expect(result).rejects.toThrow("obsidian-vault.ts check");
    expect(runObsidian).not.toHaveBeenCalled();
  });
});
