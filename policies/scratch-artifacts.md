# Scratch artifacts

Throwaway probe scripts, experiments, and captured command output go in a workspace `tmp/` path under the repo — never `/tmp`, `/tmp/claude/`, or the session scratchpad. Keeping them in the project tree makes them visible and cleanable.

- Read output back via the Read tool or a workspace file, not shell pipe/wrapper indirection.
- Clean up the trial artifacts when done.
