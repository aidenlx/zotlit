# Fixture pages

A change that adds or changes user-visible behaviour adds or updates a committed
Fixture Vault page in `packages/scripts/lib/fixture/vault-pages/`. Cover each case
the behaviour handles, including edge cases, and state the expected outcome
beside each case.

## Registration

1. Put the page and its supporting vault files under `vault-pages/` at their
   intended vault-relative paths. `writeVaultNotes` in
   `packages/scripts/lib/fixture/build.ts` copies that directory recursively into
   the Fixture Vault; adding the file registers it with the build.
2. Add required Zotero data to `packages/scripts/lib/fixture/spec.ts`. Declare
   Citation Keys used by the page in `SEEDED_CITATION_KEYS`, with their expected
   resolutions.
3. List the page, its cases and how to run them in `docs/fixture.md` under
   **Use the Fixture Vault**.
4. Rebuild with `pnpm fixture` and exercise the page in the Fixture Vault. For
   the Development Vault, follow `/obsidian-debug` to synchronize the new pages.

## Review

Match each case in the change to a case on a committed page, including edge
cases. Check that each expected outcome is beside its case, the Fixture build
includes the page and its data, and `docs/fixture.md` lists it.
