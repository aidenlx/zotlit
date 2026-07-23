# File operations

Don't `stat`/`exists`-check before a file op — it's a TOCTOU race and an extra I/O round-trip. Attempt the op directly and branch on failure: catch, then `isErrno(error, "ENOENT")` (from `@/lib/errno`) for the missing/exists/etc. case. See `src/lib/copy-attachments.ts`.
