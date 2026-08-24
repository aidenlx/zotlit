# Theme hooks expose semantic classes

ZotLit exposes plugin-owned `zt-` classes whose semantic meaning and activation rules stay consistent across Source mode, Live Preview, and Reading view, because Obsidian and CodeMirror DOM classes are not a stable plugin contract. Theme hooks use low-specificity defaults backed by Obsidian variables; element type, nesting, wrapper count, editor segmentation, and native classes remain implementation details. Public hook names live in one registry and each change updates literal-name contract tests, the public reference, and the Obsidian package policy.
