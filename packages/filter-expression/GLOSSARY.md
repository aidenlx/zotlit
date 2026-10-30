# ZotLit Filter Expression Language

The expression language that ZotLit owns for filters and formulas. Its syntax is inspired by Obsidian Bases, while its behavior is defined by ZotLit without an Obsidian compatibility promise.

## Language

**Filter Expression**:
A ZotLit expression that computes a value from literals, identifiers, operators, access, and function calls.
_Avoid_: Obsidian expression, Bases expression

**Syntax Fault**:
The place where a Filter Expression stops parsing, with the token found there, the tokens the grammar accepts there, and the unclosed quote or bracket that explains it, when one exists.
_Avoid_: parse error, error node, Lezer error

## Vocabulary migration

The former `@zotlit/bases-query` proof of concept used Bases vocabulary in its package name, source comments, and context document. Its production successor is **Item Query**. Use **Filter Expression** for the language in this package and in consumer code.
