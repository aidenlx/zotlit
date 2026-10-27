// Shared view atoms for the resolved Library Scope and all available Libraries.
import { Effect, Stream } from "effect";
import * as Atom from "effect/reactivity/Atom";

import { held } from "@/lib/view-atoms";

import { DEFAULT_LIBRARY_SCOPE } from "./scope";
import { LibraryScope } from "./service";
import type { LibraryScopeState } from "./service";

export const libraryScopeStateAtom = held<LibraryScopeState>(
  Stream.unwrap(Effect.map(LibraryScope, (scope) => scope.changes)),
  {
    current: null,
    all: null,
    invalid: false,
    effective: DEFAULT_LIBRARY_SCOPE,
    libraryRows: null,
  },
);
export const resolvedLibraryScopeAtom = Atom.map(
  libraryScopeStateAtom,
  (state) => state.current,
);
export const availableLibrariesAtom = Atom.map(
  libraryScopeStateAtom,
  (state) => state.all?.available ?? [],
);
