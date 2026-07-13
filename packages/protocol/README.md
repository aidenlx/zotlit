# @zotlit/protocol

Shared wire contracts for the Zotero companion and Obsidian plugin.

## Protocol version

`src/version.ts` exports `PROTOCOL_VERSION`, a hand-bumped integer for the
**HTTP** wire format. Bump it when an HTTP body/header shape changes
(`src/notify.ts` or the `*RequestSchema` bodies in `src/url.ts`). The
`obsidian://zotlit/*` URL transport is unversioned and permanent, so a URL-only
change never bumps it — see `CONTEXT.md`.

After changing an HTTP wire shape:

1. Update `PROTOCOL_VERSION` in `src/version.ts`.
2. Update the inline wire-format snapshot:

   ```sh
   pnpm --filter @zotlit/protocol exec vitest run src/wire-format.test.ts -u
   ```

3. Review the diff in `src/wire-format.test.ts`.
4. Run the package test:

   ```sh
   pnpm --filter @zotlit/protocol test
   ```

The snapshot includes both the wire surface and the protocol version, so review
should show the schema/action change and the matching version bump together.
