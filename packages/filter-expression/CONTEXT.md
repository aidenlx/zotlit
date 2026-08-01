# ZotLit Filter Expression Language

The expression language that ZotLit owns for filters and formulas. Its syntax is inspired by Obsidian Bases, while its behavior is defined by ZotLit without an Obsidian compatibility promise.

## Language

**Filter Expression**:
A ZotLit expression that computes a value from literals, identifiers, operators, access, and function calls.
_Avoid_: Obsidian expression, Bases expression

## Vocabulary migration

`@zotlit/bases-query` still uses Bases vocabulary in its package name, its source comments, and its context document. That package owns that rename. Use **Filter Expression** for the language in this package and in new consumer code.
