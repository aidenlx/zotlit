# JavaScript Templates

JavaScript Templates is an opt-in setting that enables full JavaScript in your templates. It is disabled by default.

## What it enables

When enabled:

- `.eta.md` template files compile and execute (Eta syntax with full JavaScript)
- Frontmatter fields marked as JavaScript evaluate their expressions

When disabled (the default):

- `.eta.md` template files are inert — they are never compiled or executed
- JavaScript frontmatter fields block the note write with an error naming the fields
- Only Liquid templates and Liquid frontmatter fields are active

## Why it exists

Eta templates are full JavaScript, not a restricted templating language. Code in an `.eta.md` file can read and write anything in your vault, reach out over the network, and touch the operating system with the same privileges as Obsidian itself. A template copied from a forum post, a shared vault, or another device runs with that same full access the moment it executes.

Liquid templates can only render text. A Liquid template has no way to open a file it wasn't given, make a network call, or run OS commands — it can only combine the data it's handed into output. That makes Liquid templates safe to share, sync, and install from community sources without having to trust arbitrary code.

JavaScript Templates exists to keep that boundary explicit: Liquid stays safe-by-default, and JavaScript execution requires you to knowingly opt in.

## How to enable

1. Open Settings > Templates
2. Under **JavaScript templates**, click **Turn on**
3. Confirm in the one-time **Enable JavaScript templates?** modal

To turn it back off, click **Turn off** on the same setting (no confirmation is required to disable).

The setting is per-device only — enabling it on your desktop does not enable it on your phone or other devices.

## What happens when disabled

- If your active template is a `.eta.md` file: the operation (create/update note, insert citation) fails with an error naming the inert file. There is no silent fallback.
- If a frontmatter field is marked as JavaScript: any note write consuming that field fails with an error naming the JavaScript fields. Existing notes are not modified.
- The `.eta.md` files remain in your vault — they are simply not executed.

## Coexistence with Liquid

Both `zotlit-note.liquid.md` and `zotlit-note.eta.md` can exist in your vault for the same template name. When both exist:

- The Liquid file always wins (regardless of whether JavaScript Templates is enabled)
- The shadowed Eta file is reported as a warning in settings
- The effective template for a given name never depends on the device-local flag

The settings row for each template includes a language dropdown to switch between Liquid and JavaScript (Eta). Switching replaces which language file exists via vault file operations.

## Breaking change for existing users

If you customized templates before this change was introduced, your `.eta.md` files become inert by default. To continue using them:

1. Enable JavaScript Templates on each device where you use Zotero
2. Or convert your templates to Liquid (see [Eta Syntax](eta/syntax.md) and [Migration Guide](eta/migration.md) for the translation)

This is intentional — every device starts safe by default, and you opt into code execution explicitly per device.

## Security considerations

Enabling JavaScript Templates means:

- Template code on your device runs with Obsidian's full privileges
- Templates are not audited or sandboxed by ZotLit
- A template from an untrusted source could read files, make network requests, or modify your vault
- The consent is one-time per device — once enabled, all `.eta.md` templates execute

If you sync your vault across devices and share it with others, only devices where the owner has explicitly enabled the setting will run JavaScript templates.
